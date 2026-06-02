import type { StorageCapabilities } from './types';

export interface StorageProvider {
  id: string;
  capabilities: StorageCapabilities;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  readFile(name: string): Promise<Uint8Array | null>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  deleteFile(name: string): Promise<void>;

  /** Optional revision token for conflict detection */
  getRevision(name: string): Promise<string | null>;
  setRevision(name: string, revision: string): Promise<void>;

  /** Make registry file readable by anyone with link (Google Drive) */
  ensurePublicReadAccess?(fileName: string): Promise<void>;

  /** Set guest read+write once (Google Drive) — no-op if already configured */
  ensureGuestAccessOnce?(fileName: string): Promise<void>;

  /** Provider supports skipping tmp round-trip validation on save */
  supportsFastSave?: boolean;

  /** Guest write for claims — provider-specific */
  guestUpdateRegistry?(fileId: string, data: Uint8Array): Promise<void>;
}

export type StorageProviderFactory = () => StorageProvider;
