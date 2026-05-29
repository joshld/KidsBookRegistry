import type { EncryptedBlob, ProviderConfig, StorageManifest } from './types';

const DB_NAME = 'kbr_cache';
const DB_VERSION = 1;
const STORE = 'cache';

interface CacheRecord {
  lastGoodBlob: ArrayBuffer | null;
  manifest: StorageManifest | null;
  providerConfig: ProviderConfig | null;
  salt: number[] | null;
  wrappedMasterKey: EncryptedBlob | null;
  rememberDevice: boolean;
  googleTokens: { accessToken: string; expiresAt: number } | null;
  pendingBlob: ArrayBuffer | null;
  lastSyncedAt: string | null;
}

const DEFAULT_RECORD: CacheRecord = {
  lastGoodBlob: null,
  manifest: null,
  providerConfig: null,
  salt: null,
  wrappedMasterKey: null,
  rememberDevice: false,
  googleTokens: null,
  pendingBlob: null,
  lastSyncedAt: null,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function readRecord(): Promise<CacheRecord> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const get = tx.objectStore(STORE).get('main');
    get.onsuccess = () => resolve({ ...DEFAULT_RECORD, ...(get.result as Partial<CacheRecord> | undefined) });
    get.onerror = () => reject(get.error);
  });
}

async function writeRecord(partial: Partial<CacheRecord>): Promise<void> {
  const current = await readRecord();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...current, ...partial }, 'main');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLastGoodBlob(): Promise<Uint8Array | null> {
  const rec = await readRecord();
  return rec.lastGoodBlob ? new Uint8Array(rec.lastGoodBlob) : null;
}

export async function setLastGoodBlob(blob: Uint8Array): Promise<void> {
  await writeRecord({ lastGoodBlob: blob.buffer as ArrayBuffer });
}

export async function getCachedManifest(): Promise<StorageManifest | null> {
  return (await readRecord()).manifest;
}

export async function setCachedManifest(manifest: StorageManifest): Promise<void> {
  await writeRecord({ manifest });
}

export async function getProviderConfig(): Promise<ProviderConfig | null> {
  return (await readRecord()).providerConfig;
}

export async function setProviderConfig(config: ProviderConfig): Promise<void> {
  await writeRecord({ providerConfig: config });
}

export async function getSalt(): Promise<Uint8Array | null> {
  const rec = await readRecord();
  return rec.salt ? new Uint8Array(rec.salt) : null;
}

export async function setSalt(salt: Uint8Array): Promise<void> {
  await writeRecord({ salt: Array.from(salt) });
}

export async function getWrappedMasterKey(): Promise<EncryptedBlob | null> {
  return (await readRecord()).wrappedMasterKey;
}

export async function setWrappedMasterKey(wrapped: EncryptedBlob | null, remember: boolean): Promise<void> {
  await writeRecord({ wrappedMasterKey: wrapped, rememberDevice: remember });
}

export async function isRememberDevice(): Promise<boolean> {
  return (await readRecord()).rememberDevice;
}

export async function getGoogleTokens(): Promise<{ accessToken: string; expiresAt: number } | null> {
  return (await readRecord()).googleTokens;
}

export async function setGoogleTokens(tokens: { accessToken: string; expiresAt: number } | null): Promise<void> {
  await writeRecord({ googleTokens: tokens });
}

export async function getPendingBlob(): Promise<Uint8Array | null> {
  const rec = await readRecord();
  return rec.pendingBlob ? new Uint8Array(rec.pendingBlob) : null;
}

export async function setPendingBlob(blob: Uint8Array | null): Promise<void> {
  await writeRecord({ pendingBlob: blob ? (blob.buffer as ArrayBuffer) : null });
}

export async function getLastSyncedAt(): Promise<string | null> {
  return (await readRecord()).lastSyncedAt;
}

export async function setLastSyncedAt(at: string): Promise<void> {
  await writeRecord({ lastSyncedAt: at });
}

export async function clearCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete('main');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
