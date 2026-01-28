
import { DriveFile } from '../types';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

export class DriveService {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async fetchAPI(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`https://www.googleapis.com/drive/v3${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Drive API Error');
    }

    return response.json();
  }

  async listFiles(folderId: string = 'root'): Promise<DriveFile[]> {
    const q = `'${folderId}' in parents and trashed = false`;
    const data = await this.fetchAPI(`/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,description,properties)`);
    return data.files;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    return this.fetchAPI(`/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,description,properties`);
  }

  async createFolder(name: string, parentId?: string): Promise<string> {
    const body = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    };
    const data = await this.fetchAPI('/files', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return data.id;
  }

  async copyFile(fileId: string, destParentId: string, metadata: Partial<DriveFile>): Promise<DriveFile> {
    const body = {
      parents: [destParentId],
      ...metadata
    };
    return this.fetchAPI(`/files/${fileId}/copy`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateFile(fileId: string, metadata: Partial<DriveFile>): Promise<void> {
    await this.fetchAPI(`/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify(metadata),
    });
  }

  // Find if a file already exists in destination by searching for original ID in properties
  async findDuplicate(parentId: string, originalId: string): Promise<string | null> {
    const q = `'${parentId}' in parents and properties has { key='original_id' and value='${originalId}' } and trashed = false`;
    const data = await this.fetchAPI(`/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    return data.files.length > 0 ? data.files[0].id : null;
  }
}
