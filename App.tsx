
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthState, DriveFile, MigrationLog, MigrationStats } from './types';
import { DriveService } from './services/googleDrive';
import DriveItem from './components/DriveItem';

// Fix: Augmenting the Window interface to include 'google' for Google Identity Services.
declare global {
  interface Window {
    google: any;
  }
}

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

  // Auth Handlers
  const handleAuth = (type: 'source' | 'dest') => {
    // Fix: Using window.google which is now typed via declare global above
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: 'YOUR_GOOGLE_CLIENT_ID', // Usually provided via environment
      scope: 'https://www.googleapis.com/auth/drive',
      callback: (response: any) => {
        if (response.access_token) {
          if (type === 'source') setSourceToken(response.access_token);
          else setDestToken(response.access_token);
        }
      },
    });
    client.requestAccessToken();
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

  // Migration Core Logic
  const startMigration = async () => {
    if (!sourceService.current || !destService.current) return;
    if (selectedIds.size === 0) return alert('Selecione ao menos um arquivo ou pasta.');

    setIsMigrating(true);
    setStats({ total: selectedIds.size, processed: 0, success: 0, failed: 0, skipped: 0 });
    setLogs([]);

    const itemsToProcess = sourceFiles.filter(f => selectedIds.has(f.id));
    const targetFolderId = 'root'; // For simplicity, always migrating to destination root

    // Process in batches
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
      // 1. Check if already exists (anti-duplication)
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

      // 2. Handle Folder vs File
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        // Create folder in dest
        const newFolderId = await destService.current.createFolder(item.name, destParentId);
        
        // Add metadata log to folder description
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

        // Note: For deep nesting, we would recursively call processItem for each child, 
        // but for the demo we focus on the selected level.
      } else {
        // 3. Copy File (Inherits destination user as owner automatically in Drive API v3 copy)
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
    
    // Simple verification: Check if all selected IDs have a matching 'original_id' in dest root
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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚡</span>
            <h1 className="text-xl font-bold tracking-tight">DriveMigrator Pro</h1>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => handleAuth('source')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${sourceToken ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {sourceToken ? 'Origem Conectada' : 'Conectar Origem (@gmail)'}
            </button>
            <button 
              onClick={() => handleAuth('dest')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${destToken ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              {destToken ? 'Destino Conectado' : 'Conectar Destino (Workspace)'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Source Explorer */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <button 
                onClick={goBack}
                disabled={folderPath.length <= 1}
                className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"
              >
                ⬅️
              </button>
              <div className="text-sm font-medium text-slate-600">
                {folderPath.map((f, i) => (
                  <span key={f.id}>{i > 0 && ' / '}{f.name}</span>
                ))}
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {selectedIds.size} itens selecionados
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[600px]">
            {!sourceToken ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 p-12">
                <span className="text-6xl mb-4">☁️</span>
                <p>Conecte sua conta de origem para começar</p>
              </div>
            ) : sourceFiles.length === 0 ? (
              <div className="p-8 text-center text-slate-500">Pasta vazia ou carregando...</div>
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

          <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-4">
             <button 
              onClick={startMigration}
              disabled={isMigrating || selectedIds.size === 0 || !destToken}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {isMigrating ? 'Migrando...' : '🚀 Iniciar Migração'}
            </button>
            <button 
              onClick={verifySync}
              disabled={syncVerifying || selectedIds.size === 0 || !destToken}
              className="bg-white border-2 border-slate-200 hover:border-blue-400 text-slate-700 font-semibold py-3 px-6 rounded-lg shadow-sm disabled:opacity-50 transition-all flex items-center gap-2"
            >
              {syncVerifying ? '🔍 Verificando...' : '✔️ Verificar Sincronização'}
            </button>
          </div>
        </div>

        {/* Right: Monitoring & Logs */}
        <div className="space-y-6">
          {/* Dashboard Stats */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <span>📊</span> Painel de Controle
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                <p className="text-xs text-blue-600 font-bold uppercase">Total</p>
                <p className="text-2xl font-black text-blue-900">{stats.total}</p>
              </div>
              <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                <p className="text-xs text-green-600 font-bold uppercase">Sucesso</p>
                <p className="text-2xl font-black text-green-900">{stats.success}</p>
              </div>
              <div className="bg-amber-50 p-3 rounded-lg border border-amber-100">
                <p className="text-xs text-amber-600 font-bold uppercase">Pulados</p>
                <p className="text-2xl font-black text-amber-900">{stats.skipped}</p>
              </div>
              <div className="bg-red-50 p-3 rounded-lg border border-red-100">
                <p className="text-xs text-red-600 font-bold uppercase">Falhas</p>
                <p className="text-2xl font-black text-red-900">{stats.failed}</p>
              </div>
            </div>
            
            {isMigrating && (
              <div className="mt-4">
                <div className="w-full bg-slate-200 rounded-full h-2.5">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" 
                    style={{ width: `${(stats.processed / stats.total) * 100}%` }}
                  ></div>
                </div>
                <p className="text-right text-xs mt-1 text-slate-500">{stats.processed} / {stats.total}</p>
              </div>
            )}
          </div>

          {/* Activity Logs */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[400px]">
            <div className="p-4 bg-slate-900 text-white text-sm font-bold flex justify-between items-center">
              <span>📜 Log de Atividades</span>
              <button 
                onClick={() => setLogs([])}
                className="text-xs hover:text-slate-300"
              >
                Limpar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] space-y-1">
              {logs.length === 0 ? (
                <p className="text-slate-400 text-center mt-8 italic">Sem atividades registradas</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`p-2 rounded border-l-4 ${
                    log.status === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    log.status === 'skipped' ? 'bg-amber-50 border-amber-500 text-amber-800' :
                    'bg-red-50 border-red-500 text-red-800'
                  }`}>
                    <div className="flex justify-between">
                      <span className="font-bold">{log.status.toUpperCase()}</span>
                      <span className="text-slate-400">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-1 truncate">De: {log.sourceName}</div>
                    {log.destId && <div className="truncate text-slate-500 italic">Novo ID: {log.destId}</div>}
                    {log.error && <div className="text-red-600 font-bold mt-1">Err: {log.error}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer Instructions */}
      <footer className="bg-slate-50 border-t border-slate-200 p-6">
        <div className="container mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-slate-600">
          <div>
            <h4 className="font-bold text-slate-800 mb-2">🛡️ Segurança de Dados</h4>
            <p>Os arquivos são copiados diretamente pela infraestrutura do Google. O app não armazena o conteúdo dos seus documentos.</p>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">📋 Metadados Preservados</h4>
            <p>O ID original e a data da migração são gravados na descrição do arquivo no destino para rastreabilidade total.</p>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">🚀 Ownership Automático</h4>
            <p>Ao realizar a cópia usando a conta de destino, o usuário do Workspace torna-se automaticamente o novo proprietário.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
