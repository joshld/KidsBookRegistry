import type { EncryptedBlob } from './types';

const PBKDF2_ITERATIONS = 310_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? padded : padded + '='.repeat(4 - (padded.length % 4));
  return base64ToBytes(pad);
}

export async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Bytes(data: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function randomShareKey(): string {
  return base64UrlEncode(randomBytes(32));
}

async function importAesKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, 'AES-GCM', extractable, [
    'encrypt',
    'decrypt',
  ]);
}

export async function deriveMasterKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    256,
  );
  // Extractable so the key can be wrapped for "remember on this device".
  return importAesKey(new Uint8Array(bits), true);
}

export async function deriveKeyFromShareKey(shareKey: string): Promise<CryptoKey> {
  const bytes = base64UrlDecode(shareKey);
  return importAesKey(bytes);
}

export async function encryptJson(key: CryptoKey, payload: unknown): Promise<EncryptedBlob> {
  const iv = randomBytes(12);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoded,
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer,
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

export async function exportKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  const raw = await globalThis.crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

export async function importKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return importAesKey(raw);
}

export async function wrapMasterKey(masterKey: CryptoKey, deviceKey: CryptoKey): Promise<EncryptedBlob> {
  const raw = await exportKeyRaw(masterKey);
  const iv = randomBytes(12);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    deviceKey,
    raw.buffer as ArrayBuffer,
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function unwrapMasterKey(wrapped: EncryptedBlob, deviceKey: CryptoKey): Promise<CryptoKey> {
  const iv = base64ToBytes(wrapped.iv);
  const ciphertext = base64ToBytes(wrapped.ciphertext);
  const raw = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    deviceKey,
    ciphertext.buffer as ArrayBuffer,
  );
  return importAesKey(new Uint8Array(raw), true);
}

export async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  const DB_NAME = 'kbr_device';
  const STORE = 'keys';
  const KEY_ID = 'deviceKey';

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = async () => {
      const db = req.result;
      const tx = db.transaction(STORE, 'readonly');
      const get = tx.objectStore(STORE).get(KEY_ID);
      get.onsuccess = async () => {
        if (get.result) {
          resolve(await importKeyRaw(new Uint8Array(get.result as ArrayBuffer)));
          return;
        }
        const raw = randomBytes(32);
        const key = await importKeyRaw(raw);
        const wtx = db.transaction(STORE, 'readwrite');
        wtx.objectStore(STORE).put(raw.buffer, KEY_ID);
        wtx.oncomplete = () => resolve(key);
        wtx.onerror = () => reject(wtx.error);
      };
      get.onerror = () => reject(get.error);
    };
  });
}
