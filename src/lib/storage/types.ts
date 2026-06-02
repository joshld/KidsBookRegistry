import type { AppState, BookStatus } from '../../types';

export const REGISTRY_VERSION = 1;
export const MANIFEST_FILE = 'manifest.json';
export const REGISTRY_CURRENT = 'registry.kbr';
export const REGISTRY_PREV = 'registry.kbr.prev';
export const REGISTRY_TMP = 'registry.kbr.tmp';
export const APP_FOLDER = 'KidsBookRegistry';
/** Query param value for local dev storage (same browser only). */
export const LOCAL_REGISTRY_FILE_ID = 'local';

export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
}

export interface OwnerPayload {
  state: AppState;
  shareKeys: Record<string, string>;
}

export interface PublicBookSlice {
  id: string;
  isbn: string;
  title: string;
  author: string;
  imageUrl: string;
  status: BookStatus;
  claimedBy?: string;
}

/** Owned titles shared with guests for in-store duplicate checking (ISBN match only). */
export interface PublicOwnedBookSlice {
  isbn: string;
  title: string;
  author: string;
  imageUrl: string;
}

export interface PublicSlice {
  childName: string;
  books: PublicBookSlice[];
  ownedBooks?: PublicOwnedBookSlice[];
}

export interface ClaimRecord {
  claimId: string;
  bookId: string;
  claimedBy: string;
  at: string;
}

export interface RegistryContainer {
  version: number;
  updatedAt: string;
  innerChecksum: string;
  owner: OwnerPayload;
  public: Record<string, PublicSlice>;
  claims: Record<string, ClaimRecord[]>;
}

export interface RegistryFile {
  version: number;
  updatedAt: string;
  owner: EncryptedBlob;
  public: Record<string, EncryptedBlob>;
  claims: Record<string, EncryptedBlob>;
}

export interface StorageManifest {
  version: number;
  current: string;
  previous: string;
  updatedAt: string;
  currentChecksum: string;
  previousChecksum: string;
  /** Drive file id for registry.kbr — lets guests resolve the latest registry via manifest.json */
  registryFileId?: string;
}

export interface StorageCapabilities {
  serverSideVersionHistory: boolean;
  atomicRename: boolean;
  maxFileSize: number;
}

export interface LoadResult {
  container: RegistryContainer;
  source: 'cloud' | 'previous' | 'cache';
  warning?: string;
}

export interface SyncStatus {
  state: 'idle' | 'loading' | 'saving' | 'error' | 'offline';
  lastSyncedAt: string | null;
  pendingChanges: boolean;
  error: string | null;
}

export interface ProviderConfig {
  type: 'local' | 'google-drive';
  registryFileId?: string;
  /** Stable public pointer — share links use this instead of registryFileId */
  manifestFileId?: string;
  folderId?: string;
}
