import type { StorageProvider } from '../StorageProvider';
import type { StorageCapabilities } from '../types';
import {
  MANIFEST_FILE,
  REGISTRY_CURRENT,
  REGISTRY_PREV,
  REGISTRY_TMP,
} from '../types';

const CAPABILITIES: StorageCapabilities = {
  serverSideVersionHistory: false,
  atomicRename: false,
  maxFileSize: 10 * 1024 * 1024,
};

const BLOB_STORE = 'files';
const REV_STORE = 'revisions';
const DB_NAME = 'kbr_local_provider';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(BLOB_STORE);
      db.createObjectStore(REV_STORE);
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function idbGet(store: string, key: string): Promise<ArrayBuffer | string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const get = tx.objectStore(store).get(key);
    get.onsuccess = () => resolve((get.result as ArrayBuffer | string | undefined) ?? null);
    get.onerror = () => reject(get.error);
  });
}

async function idbPut(store: string, key: string, value: ArrayBuffer | string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export class LocalBlobProvider implements StorageProvider {
  id = 'local';
  capabilities = CAPABILITIES;
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async readFile(name: string): Promise<Uint8Array | null> {
    const buf = await idbGet(BLOB_STORE, name);
    return buf ? new Uint8Array(buf as ArrayBuffer) : null;
  }

  async writeFile(name: string, data: Uint8Array): Promise<void> {
    await idbPut(BLOB_STORE, name, data.buffer as ArrayBuffer);
    const rev = Date.now().toString();
    await idbPut(REV_STORE, name, rev);
  }

  async deleteFile(name: string): Promise<void> {
    await idbDelete(BLOB_STORE, name);
    await idbDelete(REV_STORE, name);
  }

  async getRevision(name: string): Promise<string | null> {
    const rev = await idbGet(REV_STORE, name);
    return typeof rev === 'string' ? rev : null;
  }

  async setRevision(name: string, revision: string): Promise<void> {
    await idbPut(REV_STORE, name, revision);
  }

  async ensurePublicReadAccess(_fileName: string): Promise<void> {
    // Local provider — always accessible within same origin
  }

  async guestUpdateRegistry(_fileId: string, data: Uint8Array): Promise<void> {
    await this.writeFile(REGISTRY_CURRENT, data);
  }
}

export async function readLocalProviderFile(name: string): Promise<Uint8Array | null> {
  const buf = await idbGet(BLOB_STORE, name);
  return buf ? new Uint8Array(buf as ArrayBuffer) : null;
}

export async function writeLocalProviderFile(name: string, data: Uint8Array): Promise<void> {
  await idbPut(BLOB_STORE, name, data.buffer as ArrayBuffer);
  await idbPut(REV_STORE, name, Date.now().toString());
}

export async function clearLocalProvider(): Promise<void> {
  for (const name of [MANIFEST_FILE, REGISTRY_CURRENT, REGISTRY_PREV, REGISTRY_TMP]) {
    try {
      await idbDelete(BLOB_STORE, name);
      await idbDelete(REV_STORE, name);
    } catch {
      // ignore
    }
  }
}

export function createLocalBlobProvider(): StorageProvider {
  return new LocalBlobProvider();
}
