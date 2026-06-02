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
  getDriveGuestAccessFileIds,
  addDriveGuestAccessFileId,
  clearDriveGuestAccessFileIds,
} from '../localCache';

const CAPABILITIES: StorageCapabilities = {
  serverSideVersionHistory: true,
  atomicRename: false,
  maxFileSize: 10 * 1024 * 1024,
};

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const OAUTH_TIMEOUT_MS = 120_000;

export class GoogleDriveAuthError extends Error {
  readonly details?: string;

  constructor(message: string, details?: string) {
    super(message);
    this.name = 'GoogleDriveAuthError';
    this.details = details;
  }
}

function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
}

function mapOAuthCallbackError(error: string, redirectUri: string): GoogleDriveAuthError {
  switch (error) {
    case 'access_denied':
      return new GoogleDriveAuthError(
        'Google sign-in was cancelled or access was denied.',
        'If the app is in Testing mode, add your Gmail under OAuth consent screen → Test users in Google Cloud Console.',
      );
    case 'admin_policy_enforced':
      return new GoogleDriveAuthError(
        'Your Google Workspace admin blocked this app.',
        `OAuth error: ${error}`,
      );
    default:
      return new GoogleDriveAuthError(
        `Google sign-in failed (${error}).`,
        `Register redirect URI in Google Cloud Console: ${redirectUri}`,
      );
  }
}

function mapTokenExchangeError(
  error: string,
  errorDescription: string | undefined,
  redirectUri: string,
): GoogleDriveAuthError {
  const desc = errorDescription?.trim();
  switch (error) {
    case 'redirect_uri_mismatch':
      return new GoogleDriveAuthError(
        'Redirect URI mismatch — this site URL is not registered in Google Cloud Console.',
        `Add this exact Authorized redirect URI:\n${redirectUri}`,
      );
    case 'invalid_client':
      return new GoogleDriveAuthError(
        'Google rejected the token exchange (invalid_client).',
        desc ??
          'Verify VITE_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET match the same Web application OAuth client in Google Cloud Console.',
      );
    case 'invalid_grant':
      return new GoogleDriveAuthError(
        'Sign-in code expired or was already used.',
        'Close any open sign-in popups, wait a moment, and try Connect Google Drive once more.',
      );
    case 'invalid_request':
      return new GoogleDriveAuthError(
        'Token exchange request was rejected.',
        desc ??
          'If this mentions client_secret, add GOOGLE_CLIENT_SECRET to .env (server-only, no VITE_ prefix) and restart the dev server.',
      );
    case 'unauthorized_client':
      return new GoogleDriveAuthError(
        'This OAuth client is not authorized for this sign-in flow.',
        desc ?? `Expected redirect URI: ${redirectUri}`,
      );
    default:
      return new GoogleDriveAuthError(
        `Token exchange failed (${error}).`,
        desc ?? `Expected redirect URI: ${redirectUri}`,
      );
  }
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
  supportsFastSave = true;
  private connected = false;
  private folderId: string | null = null;
  private fileIds: Record<string, string> = {};
  private revisions: Record<string, string> = {};
  private fileIdsLoaded = false;

  async connect(): Promise<void> {
    const clientId = getClientId();
    if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not configured');

    await this.ensureAccessToken(clientId);

    await this.ensureFolder();
    await this.loadFileIds();
    this.connected = true;

    await setProviderConfig({
      type: 'google-drive',
      folderId: this.folderId ?? undefined,
      registryFileId: this.fileIds[REGISTRY_CURRENT],
      manifestFileId: this.fileIds[MANIFEST_FILE],
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.fileIdsLoaded = false;
    await setGoogleTokens(null);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getRegistryFileId(): string | undefined {
    return this.fileIds[REGISTRY_CURRENT];
  }

  getManifestFileId(): string | undefined {
    return this.fileIds[MANIFEST_FILE];
  }

  getFolderId(): string | undefined {
    return this.folderId ?? undefined;
  }

  private async ensureAccessToken(clientId: string): Promise<string> {
    const cached = await getGoogleTokens();
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }

    const redirectUri = `${window.location.origin}/oauth/callback`;
    return runOAuthPopup(clientId, redirectUri);
  }

  private async apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const clientId = getClientId();
    const token = await this.ensureAccessToken(clientId);

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

  private async loadFileIdsOnce(force = false): Promise<void> {
    if (this.fileIdsLoaded && !force) return;
    await this.loadFileIds();
    this.fileIdsLoaded = true;
  }

  private async loadFileIds(): Promise<void> {
    if (!this.folderId) return;
    const q = encodeURIComponent(`'${this.folderId}' in parents and trashed=false`);
    const res = await this.apiFetch(
      `/files?q=${q}&fields=files(id,name,modifiedTime,md5Checksum)&pageSize=200`,
    );
    const data = (await res.json()) as { files: DriveFileMeta[] };

    const bestByName = new Map<string, DriveFileMeta>();
    for (const f of data.files) {
      const existing = bestByName.get(f.name);
      if (!existing || (f.modifiedTime ?? '') > (existing.modifiedTime ?? '')) {
        bestByName.set(f.name, f);
      }
    }

    const config = await getProviderConfig();
    if (config?.registryFileId) {
      const preferred = data.files.find((f) => f.id === config.registryFileId);
      if (preferred) {
        bestByName.set(REGISTRY_CURRENT, preferred);
      }
    }
    if (config?.manifestFileId) {
      const preferred = data.files.find((f) => f.id === config.manifestFileId);
      if (preferred) {
        bestByName.set(MANIFEST_FILE, preferred);
      }
    }

    this.fileIds = {};
    this.revisions = {};
    for (const f of bestByName.values()) {
      this.fileIds[f.name] = f.id;
      if (f.md5Checksum) this.revisions[f.name] = f.md5Checksum;
    }
  }

  async readFile(name: string): Promise<Uint8Array | null> {
    await this.loadFileIdsOnce();
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
    await this.loadFileIdsOnce();
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
        manifestFileId: this.fileIds[MANIFEST_FILE],
      });
    }

    if (name === MANIFEST_FILE) {
      const config = await getProviderConfig();
      await setProviderConfig({
        type: 'google-drive',
        folderId: this.folderId ?? config?.folderId,
        registryFileId: config?.registryFileId ?? this.fileIds[REGISTRY_CURRENT],
        manifestFileId: created.id,
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
    await this.loadFileIdsOnce();
    return this.revisions[name] ?? null;
  }

  async setRevision(name: string, revision: string): Promise<void> {
    this.revisions[name] = revision;
  }

  async ensureGuestAccessOnce(fileName: string, force = false): Promise<void> {
    await this.loadFileIdsOnce();
    const fileId = this.fileIds[fileName];
    if (!fileId) return;

    const cached = await getDriveGuestAccessFileIds();
    if (!force && cached.has(fileId)) return;

    const readerOk = await this.ensurePublicPermission(fileName, 'reader');
    await this.ensurePublicPermission(fileName, 'writer');
    if (!readerOk) {
      await clearDriveGuestAccessFileIds();
      throw new Error(
        'Could not make the registry readable for guests. Try copying the share link again after saving.',
      );
    }
    await addDriveGuestAccessFileId(fileId);
  }

  async ensurePublicReadAccess(fileName: string): Promise<void> {
    await this.ensurePublicPermission(fileName, 'reader');
  }

  async ensurePublicWriteAccess(fileName: string): Promise<void> {
    await this.ensurePublicPermission(fileName, 'writer');
  }

  private async ensurePublicPermission(fileName: string, role: 'reader' | 'writer'): Promise<boolean> {
    await this.loadFileIdsOnce();
    const fileId = this.fileIds[fileName];
    if (!fileId) return false;

    const res = await this.apiFetch(`/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, type: 'anyone' }),
    });
    // Permission may already exist from a prior save — treat as success.
    return res.ok || res.status === 409;
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
    try {
      const proxy = await fetch(
        `/api/google/registry?fileId=${encodeURIComponent(fileId)}`,
      );
      if (proxy.ok) {
        const bytes = new Uint8Array(await proxy.arrayBuffer());
        const head = new TextDecoder().decode(bytes.slice(0, 8)).trimStart();
        if (head.startsWith('{')) return bytes;
        return null;
      }
    } catch {
      // fall through to direct fetch (may work in some environments)
    }

    const res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder().decode(bytes.slice(0, 8)).trimStart();
    if (!head.startsWith('{')) return null;
    return bytes;
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
  redirectUri: string,
  code: string,
  codeVerifier: string,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/google/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier, redirectUri }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    throw new GoogleDriveAuthError(
      'Could not reach the app server to complete sign-in.',
      `${msg}. Ensure the dev server is running. Token exchange requires GOOGLE_CLIENT_SECRET on the server.`,
    );
  }

  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || body.error) {
    if (body.error === 'server_misconfigured') {
      throw new GoogleDriveAuthError(
        'Server is missing GOOGLE_CLIENT_SECRET.',
        body.error_description ??
          'In Google Cloud Console, open your Web application OAuth client and copy the Client secret into .env as GOOGLE_CLIENT_SECRET (no VITE_ prefix). Restart npm run dev.',
      );
    }
    throw mapTokenExchangeError(body.error ?? `http_${res.status}`, body.error_description, redirectUri);
  }

  if (!body.access_token || !body.expires_in) {
    throw new GoogleDriveAuthError(
      'Server returned an unexpected token response.',
      `HTTP ${res.status}. Expected access_token and expires_in.`,
    );
  }

  await setGoogleTokens({
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
}

async function runOAuthPopup(clientId: string, redirectUri: string): Promise<string> {
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(codeVerifier);

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

  return new Promise((resolve, reject) => {
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'kbr_google_oauth',
      `width=${width},height=${height},left=${left},top=${top}`,
    );

    if (!popup) {
      reject(
        new GoogleDriveAuthError(
          'Sign-in popup was blocked.',
          'Allow popups for this site in your browser, then click Connect Google Drive again.',
        ),
      );
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
      fn();
    };

    const timeoutId = window.setTimeout(() => {
      popup.close();
      finish(() =>
        reject(
          new GoogleDriveAuthError(
            'Sign-in timed out.',
            `No response within ${OAUTH_TIMEOUT_MS / 1000}s. Expected callback at ${redirectUri}. If the popup opened in a new tab (common on mobile), try desktop Chrome or Firefox with popups allowed.`,
          ),
        ),
      );
    }, OAUTH_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'kbr_oauth_code') return;

      popup.close();

      if (event.data.error) {
        finish(() => reject(mapOAuthCallbackError(String(event.data.error), redirectUri)));
        return;
      }

      if (event.data.state !== state) {
        finish(() =>
          reject(
            new GoogleDriveAuthError(
              'Sign-in session mismatch.',
              'The OAuth state did not match. Click Connect Google Drive once and complete sign-in without opening multiple popups.',
            ),
          ),
        );
        return;
      }

      const code = event.data.code as string | undefined;
      if (!code) {
        finish(() =>
          reject(
            new GoogleDriveAuthError(
              'Google did not return an authorization code.',
              `Callback reached ${redirectUri} but no code was received.`,
            ),
          ),
        );
        return;
      }

      void exchangeCode(redirectUri, code, codeVerifier)
        .then((token) => finish(() => resolve(token)))
        .catch((err) =>
          finish(() =>
            reject(
              err instanceof GoogleDriveAuthError
                ? err
                : new GoogleDriveAuthError(
                    'Google Drive authentication failed.',
                    err instanceof Error ? err.message : undefined,
                  ),
            ),
          ),
        );
    };

    window.addEventListener('message', onMessage);
  });
}

export function createGoogleDriveProvider(): StorageProvider {
  return new GoogleDriveProvider();
}

export { MANIFEST_FILE, REGISTRY_CURRENT };
