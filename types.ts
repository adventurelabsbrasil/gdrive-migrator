
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  description?: string;
  properties?: Record<string, string>;
}

export interface MigrationLog {
  sourceId: string;
  sourceName: string;
  destId: string;
  destName: string;
  timestamp: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

export interface MigrationStats {
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
}

export enum AuthState {
  IDLE = 'IDLE',
  SOURCE_AUTH = 'SOURCE_AUTH',
  DEST_AUTH = 'DEST_AUTH',
  READY = 'READY'
}
