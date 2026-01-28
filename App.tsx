
import React, { useState, useEffect, useRef } from 'react';
import { DriveFile, MigrationLog, MigrationStats } from './types';
import { DriveService } from './services/googleDrive';
import DriveItem from './components/DriveItem';

declare const chrome: any;

// Client ID fornecido pelo usuário
const GOOGLE_CLIENT_ID = '842276626628-e2nos59rlbsagd9m3941bsgdvbprqed2.apps.googleusercontent.com';

const BATCH_SIZE = 5;

const App: React.FC = () => {
  const [sourceToken, setSourceToken] = useState<string>('');
  const [destToken, setDestToken] = useState<string>('');
  const [sourceFiles, setSourceFiles] = useState<DriveFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentFolderId, setCurrentFolderId] = useState<string>('root');
  const [folderPath, setFolderPath] = useState<{id: string, name: string}[]>([{id: 'root', name: 'Meu Drive'}]);
  
  const [isMigrating, setIsMigrating] = useState(false);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [stats, setStats] = useState<MigrationStats>({ total: 0, processed: 0, success: 0, failed: 0, skipped: 0 });
  const [syncVerifying, setSyncVerifying] = useState(false);

  const sourceService = useRef<DriveService | null>(null);
  const destService = useRef<DriveService | null>(null);

  const handleAuth = (type: 'source' | 'dest') => {
    // A URL de redirecionamento autorizada no Console para o ID ljhmbicggpkcdhagonodjlmgckdincpe
    const redirectUri = `https://ljhmbicggpkcdhagonodjlmgckdincpe.chromiumapp.org/`;
    
    const scope = 'https://www.googleapis.com/auth/drive';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&prompt=select_account`;

    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    }, (redirectUrl: string) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        console.error('Auth Error:', chrome.runtime.lastError);
        alert('Erro na autenticação. Verifique se o URI de redirecionamento no Console está configurado exatamente como: ' + redirectUri);
        return;
      }

      const params = new URLSearchParams(new URL(redirectUrl).hash.substring(1));
      const token = params.get('access_token');

      if (token) {
        if (type === 'source') setSourceToken(token);
        else setDestToken(token);
      }
    });
  };

  useEffect(() => {
    if (sourceToken) {
      sourceService.current = new DriveService(sourceToken);
      loadFiles(currentFolderId);
    }
  }, [sourceToken, currentFolderId]);

  useEffect(() => {
    if (destToken) {
      destService.current = new DriveService(destToken);
    }
  }, [destToken]);

  const loadFiles = async (folderId: string) => {
    if (!sourceService.current) return;
    try {
      const files = await sourceService.current.listFiles(folderId);
      setSourceFiles(files);
    } catch (err) {
      console.error(err);
      alert('Erro ao carregar arquivos da origem.');
    }
  };

  const navigateToFolder = (id: string, name: string) => {
    setCurrentFolderId(id);
    setFolderPath(prev => [...prev, {id, name}]);
  };

  const goBack = () => {
    if (folderPath.length <= 1) return;
    const newPath = [...folderPath];
    newPath.pop();
    const parent = newPath[newPath.length - 1];
    setFolderPath(newPath);
    setCurrentFolderId(parent.id);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startMigration = async () => {
    if (!sourceService.current || !destService.current) return;
    if (selectedIds.size === 0) return alert('Selecione arquivos ou pastas.');

    setIsMigrating(true);
    setStats({ total: selectedIds.size, processed: 0, success: 0, failed: 0, skipped: 0 });
    setLogs([]);

    const itemsToProcess = sourceFiles.filter(f => selectedIds.has(f.id));
    
    // Processamento em lotes (Batch processing)
    for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
      const batch = itemsToProcess.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(item => processItem(item, 'root')));
    }

    setIsMigrating(false);
    alert('Migração em lote concluída!');
  };

  const processItem = async (item: DriveFile, destParentId: string) => {
    if (!sourceService.current || !destService.current) return;

    try {
      // 1. Não duplicar: verifica se o arquivo já existe no destino via propriedade personalizada
      const existingId = await destService.current.findDuplicate(destParentId, item.id);
      if (existingId) {
        addLog({
          sourceId: item.id, sourceName: item.name, destId: existingId, destName: item.name,
          timestamp: new Date().toISOString(), status: 'skipped'
        });
        updateStats('skipped');
        return;
      }

      const logMsg = `MIGRADO: ${new Date().toLocaleString()}\nOrigem ID: ${item.id}\nProprietário anterior: Cloud-to-Cloud Migrator`;

      if (item.mimeType === 'application/vnd.google-apps.folder') {
        const newFolderId = await destService.current.createFolder(item.name, destParentId);
        // Atualiza pasta com metadados de log
        await destService.current.updateFile(newFolderId, { 
          description: logMsg,
          properties: { 'original_id': item.id } 
        });
        addLog({
          sourceId: item.id, sourceName: item.name, destId: newFolderId, destName: item.name,
          timestamp: new Date().toISOString(), status: 'success'
        });
        updateStats('success');
      } else {
        // Cópia direta: o token de destino garante que a conta destino seja o NOVO proprietário
        const copiedFile = await destService.current.copyFile(item.id, destParentId, {
          description: logMsg,
          properties: { 'original_id': item.id }
        });
        addLog({
          sourceId: item.id, sourceName: item.name, destId: copiedFile.id, destName: item.name,
          timestamp: new Date().toISOString(), status: 'success'
        });
        updateStats('success');
      }
    } catch (err: any) {
      addLog({
        sourceId: item.id, sourceName: item.name, destId: '', destName: '',
        timestamp: new Date().toISOString(), status: 'failed', error: err.message
      });
      updateStats('failed');
    }
  };

  const addLog = (log: MigrationLog) => {
    setLogs(prev => [log, ...prev]);
  };

  const updateStats = (key: keyof Omit<MigrationStats, 'total' | 'processed'>) => {
    setStats(prev => ({
      ...prev,
      processed: prev.processed + 1,
      [key]: prev[key] + 1
    }));
  };

  const verifySync = async () => {
    if (!sourceService.current || !destService.current) return;
    setSyncVerifying(true);
    const items = sourceFiles.filter(f => selectedIds.has(f.id));
    let missing = 0;
    for (const item of items) {
      const exists = await destService.current.findDuplicate('root', item.id);
      if (!exists) missing++;
    }
    setSyncVerifying(false);
    alert(missing === 0 ? '✅ Sincronização Verificada: 100% OK' : `⚠️ Inconsistência: ${missing} itens faltantes.`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#f1f5f9' }}>
      <header style={{ background: '#0f172a', color: 'white', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>🚀</span>
          <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 800, letterSpacing: '0.5px' }}>DRIVE MIGRATOR</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => handleAuth('source')} style={{ background: sourceToken ? '#10b981' : '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}>
            {sourceToken ? 'ORIGEM OK' : 'AUTH ORIGEM'}
          </button>
          <button onClick={() => handleAuth('dest')} style={{ background: destToken ? '#10b981' : '#6366f1', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}>
            {destToken ? 'DESTINO OK' : 'AUTH DESTINO'}
          </button>
        </div>
      </header>

      <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', gap: '12px', padding: '12px', overflow: 'hidden' }}>
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
          <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: '#475569' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={goBack} disabled={folderPath.length <= 1} style={{ border: 'none', background: '#cbd5e1', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px' }}>VOLTAR</button>
              <span style={{ color: '#1e293b' }}>{folderPath[folderPath.length-1].name.toUpperCase()}</span>
            </div>
            <span style={{ color: '#3b82f6' }}>{selectedIds.size} SELECIONADOS</span>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!sourceToken ? (
              <div style={{ padding: '80px 20px', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '40px', marginBottom: '16px' }}>🔑</div>
                <p style={{ fontSize: '13px', maxWidth: '200px', margin: '0 auto' }}>Faça login na conta de origem para começar a listar arquivos.</p>
              </div>
            ) : (
              sourceFiles.map(file => (
                <DriveItem key={file.id} item={file} isSelected={selectedIds.has(file.id)} onToggle={toggleSelect} onNavigate={file.mimeType.includes('folder') ? () => navigateToFolder(file.id, file.name) : undefined} />
              ))
            )}
          </div>

          <div style={{ padding: '16px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px', backgroundColor: '#f8fafc' }}>
            <button 
              onClick={startMigration} 
              disabled={isMigrating || !destToken || selectedIds.size === 0} 
              style={{ flex: 1, padding: '12px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 800, fontSize: '12px', cursor: 'pointer', opacity: (isMigrating || !destToken || selectedIds.size === 0) ? 0.5 : 1, transition: 'all 0.2s' }}
            >
              {isMigrating ? '⚡ PROCESSANDO MIGRACAO...' : 'COPIAR PARA DESTINO'}
            </button>
            <button 
              onClick={verifySync} 
              disabled={syncVerifying || !destToken || selectedIds.size === 0}
              style={{ padding: '12px 16px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
            >
              VERIFICAR SINCRONISMO
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
          <div style={{ background: 'white', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
            <div style={{ textAlign: 'center', borderRight: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: '#10b981', marginBottom: '4px' }}>SUCESSO</div>
              <div style={{ fontSize: '24px', fontWeight: 900, color: '#0f172a' }}>{stats.success}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: '#ef4444', marginBottom: '4px' }}>FALHA</div>
              <div style={{ fontSize: '24px', fontWeight: 900, color: '#0f172a' }}>{stats.failed}</div>
            </div>
          </div>

          <div style={{ flex: 1, background: '#1e293b', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #334155' }}>
            <div style={{ padding: '8px 12px', background: '#334155', color: '#94a3b8', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>LOG DE EVENTOS</div>
            <div style={{ flex: 1, padding: '12px', overflowY: 'auto', fontFamily: '"JetBrains Mono", monospace', fontSize: '10px', color: '#cbd5e1', lineHeight: '1.6' }}>
              {logs.length === 0 && <div style={{ color: '#475569' }}># Sistema pronto para migração...</div>}
              {logs.map((log, i) => (
                <div key={i} style={{ marginBottom: '6px', paddingBottom: '4px', borderBottom: '1px solid #334155' }}>
                  <span style={{ color: log.status === 'success' ? '#4ade80' : log.status === 'skipped' ? '#fbbf24' : '#f87171', fontWeight: 700 }}>
                    [{log.status.toUpperCase()}]
                  </span> {log.sourceName}
                  {log.error && <div style={{ color: '#fca5a5', marginLeft: '10px', fontSize: '9px' }}>↳ Erro: {log.error}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
