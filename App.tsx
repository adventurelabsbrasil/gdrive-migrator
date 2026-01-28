
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthState, DriveFile, MigrationLog, MigrationStats } from './types';
import { DriveService } from './services/googleDrive';
import DriveItem from './components/DriveItem';

// Declare chrome for types
declare const chrome: any;

// INSTRUÇÃO: Substitua este valor pelo seu ID do Cliente gerado no Google Cloud Console
const GOOGLE_CLIENT_ID = 'SUA_CLIENT_ID_AQUI.apps.googleusercontent.com';

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
    if (GOOGLE_CLIENT_ID.includes('SUA_CLIENT_ID')) {
      alert('Por favor, configure o GOOGLE_CLIENT_ID no arquivo App.tsx.');
      return;
    }

    // Em extensões, usamos launchWebAuthFlow para permitir login em múltiplas contas
    const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive')}&prompt=select_account`;

    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    }, (redirectUrl: string) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        console.error(chrome.runtime.lastError);
        return;
      }

      // Extrair o access_token da URL de redirecionamento
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
    if (selectedIds.size === 0) return alert('Selecione ao menos um arquivo ou pasta.');

    setIsMigrating(true);
    setStats({ total: selectedIds.size, processed: 0, success: 0, failed: 0, skipped: 0 });
    setLogs([]);

    const itemsToProcess = sourceFiles.filter(f => selectedIds.has(f.id));
    const targetFolderId = 'root';

    for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
      const batch = itemsToProcess.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(item => processItem(item, targetFolderId)));
    }

    setIsMigrating(false);
    alert('Migração concluída!');
  };

  const processItem = async (item: DriveFile, destParentId: string) => {
    if (!sourceService.current || !destService.current) return;

    try {
      const existingId = await destService.current.findDuplicate(destParentId, item.id);
      if (existingId) {
        addLog({
          sourceId: item.id,
          sourceName: item.name,
          destId: existingId,
          destName: item.name,
          timestamp: new Date().toISOString(),
          status: 'skipped'
        });
        updateStats('skipped');
        return;
      }

      if (item.mimeType === 'application/vnd.google-apps.folder') {
        const newFolderId = await destService.current.createFolder(item.name, destParentId);
        const logMsg = `[MIGRATION LOG] Original ID: ${item.id} | Migrated at: ${new Date().toLocaleString()}`;
        await destService.current.updateFile(newFolderId, { 
          description: logMsg,
          properties: { 'original_id': item.id } 
        });

        addLog({
          sourceId: item.id,
          sourceName: item.name,
          destId: newFolderId,
          destName: item.name,
          timestamp: new Date().toISOString(),
          status: 'success'
        });
        updateStats('success');
      } else {
        const logMsg = `[MIGRATION LOG] Original ID: ${item.id} | Size: ${item.size || 'unknown'} | Migrated: ${new Date().toLocaleString()}`;
        const copiedFile = await destService.current.copyFile(item.id, destParentId, {
          description: logMsg,
          properties: { 'original_id': item.id }
        });

        addLog({
          sourceId: item.id,
          sourceName: item.name,
          destId: copiedFile.id,
          destName: item.name,
          timestamp: new Date().toISOString(),
          status: 'success'
        });
        updateStats('success');
      }
    } catch (err: any) {
      addLog({
        sourceId: item.id,
        sourceName: item.name,
        destId: '',
        destName: '',
        timestamp: new Date().toISOString(),
        status: 'failed',
        error: err.message
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
    if (missing === 0) alert('Sincronização verificada: Todos os itens selecionados estão no destino!');
    else alert(`Sincronização incompleta: Faltam ${missing} itens no destino.`);
  };

  return (
    <div className="min-h-screen flex flex-col w-[800px] h-[600px] overflow-hidden">
      <header className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚡</span>
            <h1 className="text-xl font-bold tracking-tight">DriveMigrator Pro</h1>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => handleAuth('source')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${sourceToken ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {sourceToken ? 'Origem ✔️' : 'Login Origem'}
            </button>
            <button 
              onClick={() => handleAuth('dest')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${destToken ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              {destToken ? 'Destino ✔️' : 'Login Destino'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 overflow-hidden">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <button onClick={goBack} disabled={folderPath.length <= 1} className="p-1 hover:bg-slate-200 rounded disabled:opacity-30">⬅️</button>
              <div className="text-xs font-medium text-slate-600 truncate max-w-[200px]">
                {folderPath.map((f, i) => (
                  <span key={f.id}>{i > 0 && ' / '}{f.name}</span>
                ))}
              </div>
            </div>
            <div className="text-[10px] text-slate-500 uppercase font-bold">
              {selectedIds.size} selecionados
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!sourceToken ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                <span className="text-4xl mb-2">🔑</span>
                <p className="text-sm">Faça login na conta de origem para listar os arquivos.</p>
                {GOOGLE_CLIENT_ID.includes('SUA_CLIENT_ID') && (
                  <p className="text-red-500 text-[10px] mt-2 font-mono bg-red-50 p-2 rounded">ERRO: Configure o Client ID no App.tsx</p>
                )}
              </div>
            ) : sourceFiles.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm italic">Pasta vazia.</div>
            ) : (
              sourceFiles.map(file => (
                <DriveItem 
                  key={file.id} 
                  item={file} 
                  isSelected={selectedIds.has(file.id)}
                  onToggle={toggleSelect}
                  onNavigate={file.mimeType === 'application/vnd.google-apps.folder' ? () => navigateToFolder(file.id, file.name) : undefined}
                />
              ))
            )}
          </div>

          <div className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2">
             <button 
              onClick={startMigration}
              disabled={isMigrating || selectedIds.size === 0 || !destToken}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg text-sm shadow-md disabled:opacity-50 transition-all"
            >
              {isMigrating ? '🔄 Migrando...' : '🚀 Iniciar Migração'}
            </button>
            <button 
              onClick={verifySync}
              disabled={syncVerifying || selectedIds.size === 0 || !destToken}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-2 px-4 rounded-lg text-xs shadow-sm disabled:opacity-50"
            >
              {syncVerifying ? '🔍' : '✔️ Verificar'}
            </button>
          </div>
        </div>

        <div className="space-y-4 overflow-hidden flex flex-col">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Status</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-blue-50 p-2 rounded border border-blue-100">
                <p className="text-[10px] text-blue-600 font-bold">OK</p>
                <p className="text-lg font-black text-blue-900">{stats.success}</p>
              </div>
              <div className="bg-red-50 p-2 rounded border border-red-100">
                <p className="text-[10px] text-red-600 font-bold">ERRO</p>
                <p className="text-lg font-black text-red-900">{stats.failed}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1">
            <div className="p-3 bg-slate-900 text-white text-[10px] font-bold">LOG DE ATIVIDADES</div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-[9px] space-y-1 bg-slate-50">
              {logs.length === 0 ? (
                <p className="text-slate-400 text-center mt-4">Aguardando início...</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`p-1.5 rounded border-l-2 ${
                    log.status === 'success' ? 'bg-green-50 border-green-500' :
                    log.status === 'skipped' ? 'bg-amber-50 border-amber-500' :
                    'bg-red-50 border-red-500'
                  }`}>
                    <div className="flex justify-between font-bold">
                      <span className={log.status === 'success' ? 'text-green-700' : 'text-slate-700'}>{log.sourceName.substring(0, 20)}...</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
