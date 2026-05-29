import type { StorageProvider } from '../StorageProvider';
import type { StorageCapabilities } from '../types';
import {
  APP_FOLDER,
  MANIFEST_FILE,
  REGISTRY_CURRENT,
} from '../types';
import {
  getGoogleTokens,
  getProviderConfig,
  setGoogleTokens,
  setProviderConfig,
} from '../localCache';

const CAPABILITIES: StorageCapabilities = {
  serverSideVersionHistory: true,
  atomicRename: false,
  maxFileSize: 10 * 1024 * 1024,
};

const SCOPES = 'https://www.googleapis.com/auth/drive.file';

function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
}

interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime?: string;
  md5Checksum?: string;
}

export class GoogleDriveProvider implements StorageProvider {
  id = 'google-drive';
  capabilities = CAPABILITIES;
  private connected = false;
  private folderId: string | null = null;
  private fileIds: Record<string, string> = {};
  private revisions: Record<string, string> = {};

  async connect(): Promise<void> {
    const clientId = getClientId();
    if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not configured');

    const token = await this.ensureAccessToken(clientId);
    if (!token) throw new Error('Google Drive authentication failed');

    await this.ensureFolder();
    await this.loadFileIds();
    this.connected = true;

    await setProviderConfig({
      type: 'google-drive',
      folderId: this.folderId ?? undefined,
      registryFileId: this.fileIds[REGISTRY_CURRENT],
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await setGoogleTokens(null);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getRegistryFileId(): string | undefined {
    return this.fileIds[REGISTRY_CURRENT];
  }

  getFolderId(): string | undefined {
    return this.folderId ?? undefined;
  }

  private async ensureAccessToken(clientId: string): Promise<string | null> {
    const cached = await getGoogleTokens();
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }

    return new Promise((resolve) => {
      const redirectUri = `${window.location.origin}/oauth/callback`;
      const state = crypto.randomUUID();
      sessionStorage.setItem('kbr_oauth_state', state);

      const codeVerifier = generateCodeVerifier();
      sessionStorage.setItem('kbr_code_verifier', codeVerifier);

      generateCodeChallenge(codeVerifier).then((challenge) => {
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES,
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent',
        });

        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        const popup = window.open(
          `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
          'kbr_google_oauth',
          `width=${width},height=${height},left=${left},top=${top}`,
        );

        const onMessage = async (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          if (event.data?.type !== 'kbr_oauth_code') return;
          window.removeEventListener('message', onMessage);
          popup?.close();

          if (event.data.state !== state) {
            resolve(null);
            return;
          }

          const token = await exchangeCode(
            clientId,
            redirectUri,
            event.data.code as string,
            codeVerifier,
          );
          resolve(token);
        };

        window.addEventListener('message', onMessage);
      });
    });
  }

  private async apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const clientId = getClientId();
    const token = await this.ensureAccessToken(clientId);
    if (!token) throw new Error('Not authenticated with Google Drive');

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(`https://www.googleapis.com/drive/v3${path}`, { ...init, headers });
  }

  private async ensureFolder(): Promise<void> {
    const config = await getProviderConfig();
    if (config?.folderId) {
      this.folderId = config.folderId;
      return;
    }

    const q = encodeURIComponent(
      `mimeType='application/vnd.google-apps.folder' and name='${APP_FOLDER}' and trashed=false`,
    );
    const res = await this.apiFetch(`/files?q=${q}&spaces=drive&fields=files(id,name)`);
    const data = (await res.json()) as { files: DriveFileMeta[] };
    if (data.files.length > 0) {
      this.folderId = data.files[0]!.id;
      return;
    }

    const create = await this.apiFetch('/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: APP_FOLDER,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    const folder = (await create.json()) as DriveFileMeta;
    this.folderId = folder.id;
  }

  private async loadFileIds(): Promise<void> {
    if (!this.folderId) return;
    const q = encodeURIComponent(`'${this.folderId}' in parents and trashed=false`);
    const res = await this.apiFetch(`/files?q=${q}&fields=files(id,name,modifiedTime,md5Checksum)`);
    const data = (await res.json()) as { files: DriveFileMeta[] };
    this.fileIds = {};
    for (const f of data.files) {
      this.fileIds[f.name] = f.id;
      if (f.md5Checksum) this.revisions[f.name] = f.md5Checksum;
    }
  }

  async readFile(name: string): Promise<Uint8Array | null> {
    await this.loadFileIds();
    const fileId = this.fileIds[name];
    if (!fileId) return null;

    const token = await getGoogleTokens();
    if (!token) return null;

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  async writeFile(name: string, data: Uint8Array): Promise<void> {
    await this.loadFileIds();
    const existingId = this.fileIds[name];
    const token = await getGoogleTokens();
    if (!token) throw new Error('Not authenticated');

    if (existingId) {
      const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/octet-stream',
          },
          body: data.buffer as ArrayBuffer,
        },
      );
      if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
      const meta = (await this.apiFetch(`/files/${existingId}?fields=md5Checksum`).then((r) =>
        r.json(),
      )) as DriveFileMeta;
      if (meta.md5Checksum) this.revisions[name] = meta.md5Checksum;
      return;
    }

    if (!this.folderId) throw new Error('Drive folder not ready');

    const metadata = { name, parents: [this.folderId] };
    const boundary = 'kbr_boundary';
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const enc = new TextEncoder();
    const bodyBytes = new Uint8Array(
      enc.encode(body).length + data.length + enc.encode(tail).length,
    );
    bodyBytes.set(enc.encode(body), 0);
    bodyBytes.set(data, enc.encode(body).length);
    bodyBytes.set(enc.encode(tail), enc.encode(body).length + data.length);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: bodyBytes,
      },
    );
    if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
    const created = (await res.json()) as DriveFileMeta;
    this.fileIds[name] = created.id;
    if (created.md5Checksum) this.revisions[name] = created.md5Checksum;

    if (name === REGISTRY_CURRENT) {
      await setProviderConfig({
        type: 'google-drive',
        folderId: this.folderId,
        registryFileId: created.id,
      });
    }
  }

  async deleteFile(name: string): Promise<void> {
    const fileId = this.fileIds[name];
    if (!fileId) return;
    await this.apiFetch(`/files/${fileId}`, { method: 'DELETE' });
    delete this.fileIds[name];
  }

  async getRevision(name: string): Promise<string | null> {
    await this.loadFileIds();
    return this.revisions[name] ?? null;
  }

  async setRevision(name: string, revision: string): Promise<void> {
    this.revisions[name] = revision;
  }

  async ensurePublicReadAccess(fileName: string): Promise<void> {
    await this.ensurePublicPermission(fileName, 'reader');
  }

  async ensurePublicWriteAccess(fileName: string): Promise<void> {
    await this.ensurePublicPermission(fileName, 'writer');
  }

  private async ensurePublicPermission(fileName: string, role: 'reader' | 'writer'): Promise<void> {
    await this.loadFileIds();
    const fileId = this.fileIds[fileName];
    if (!fileId) return;

    await this.apiFetch(`/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, type: 'anyone' }),
    });
  }

  /** Guest write for claims — requires public write permission on registry file */
  async guestUpdateRegistry(fileId: string, data: Uint8Array): Promise<void> {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data.buffer as ArrayBuffer,
      },
    );
    if (res.ok) return;

    const token = await getGoogleTokens();
    if (token) {
      const authed = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/octet-stream',
          },
          body: data.buffer as ArrayBuffer,
        },
      );
      if (authed.ok) return;
    }
    throw new Error(
      'Could not save claim. The owner may need to sync, or the registry must allow public edits for guest claims.',
    );
  }

  /** Download registry file publicly (no auth) for guests */
  static async fetchPublicFile(fileId: string): Promise<Uint8Array | null> {
    const res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Attempt guest write without owner session (requires public write permission) */
  static async guestUpdatePublicFile(fileId: string, data: Uint8Array): Promise<boolean> {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data.buffer as ArrayBuffer,
      },
    );
    return res.ok;
  }
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlFromBytes(array);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  return base64UrlFromBytes(new Uint8Array(digest));
}

async function exchangeCode(
  clientId: string,
  redirectUri: string,
  code: string,
  codeVerifier: string,
): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number };
  await setGoogleTokens({
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

export function createGoogleDriveProvider(): StorageProvider {
  return new GoogleDriveProvider();
}

export { MANIFEST_FILE, REGISTRY_CURRENT };
