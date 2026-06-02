import type { AppState } from '../../types';
import {
  containerFromAppState,
  decryptRegistryFile,
  encryptRegistryFile,
  mergeClaimsIntoState,
  parseRegistryFileJson,
  serializeRegistryFile,
  validateContainer,
  appendClaimToFile,
  decryptPublicSlice,
  createClaimRecord,
  emptyOwnerPayload,
} from './container';
import {
  deriveMasterKey,
  getOrCreateDeviceKey,
  randomBytes,
  sha256Bytes,
  unwrapMasterKey,
  wrapMasterKey,
} from './crypto';
import {
  getLastGoodBlob,
  getPendingBlob,
  getProviderConfig,
  getSalt,
  getWrappedMasterKey,
  isRememberDevice,
  setCachedManifest,
  setLastGoodBlob,
  setLastSyncedAt,
  setPendingBlob,
  setProviderConfig,
  setSalt,
  setWrappedMasterKey,
} from './localCache';
import type { StorageProvider } from './StorageProvider';
import {
  createLocalBlobProvider,
  LocalBlobProvider,
  readLocalProviderFile,
  writeLocalProviderFile,
} from './providers/localBlob';
import { createGoogleDriveProvider, GoogleDriveProvider } from './providers/googleDrive';
import type {
  ClaimRecord,
  LoadResult,
  RegistryContainer,
  StorageManifest,
  SyncStatus,
} from './types';
import {
  LOCAL_REGISTRY_FILE_ID,
  MANIFEST_FILE,
  REGISTRY_CURRENT,
  REGISTRY_PREV,
  REGISTRY_TMP,
} from './types';

type SyncListener = (status: SyncStatus) => void;

class RegistryService {
  private provider: StorageProvider | null = null;
  private masterKey: CryptoKey | null = null;
  private container: RegistryContainer | null = null;
  private syncListeners = new Set<SyncListener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedChecksum: string | null = null;
  private conflictMessage: string | null = null;
  private status: SyncStatus = {
    state: 'idle',
    lastSyncedAt: null,
    pendingChanges: false,
    error: null,
  };

  onSyncStatus(listener: SyncListener): () => void {
    this.syncListeners.add(listener);
    listener(this.status);
    return () => this.syncListeners.delete(listener);
  }

  private emitStatus(partial: Partial<SyncStatus>) {
    this.status = { ...this.status, ...partial };
    this.syncListeners.forEach((l) => l(this.status));
  }

  getSyncStatus(): SyncStatus {
    return this.status;
  }

  isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  getContainer(): RegistryContainer | null {
    return this.container;
  }

  getAppState(): AppState {
    if (!this.container) {
      return emptyOwnerPayload().state;
    }
    return mergeClaimsIntoState(this.container);
  }

  getShareKey(childId: string): string | null {
    return this.container?.owner.shareKeys[childId] ?? null;
  }

  getRegistryFileId(): string | undefined {
    if (this.provider instanceof GoogleDriveProvider) {
      return this.provider.getRegistryFileId();
    }
    return undefined;
  }

  createProvider(type: 'local' | 'google-drive'): StorageProvider {
    if (type === 'google-drive') return createGoogleDriveProvider();
    return createLocalBlobProvider();
  }

  async connectProvider(type: 'local' | 'google-drive'): Promise<void> {
    this.provider = this.createProvider(type);
    await this.provider.connect();
    await setProviderConfig({ type, folderId: undefined, registryFileId: undefined });
  }

  async unlockWithPassphrase(passphrase: string, rememberDevice: boolean): Promise<void> {
    let salt = await getSalt();
    if (!salt) {
      salt = randomBytes(16);
      await setSalt(salt);
    }
    this.masterKey = await deriveMasterKey(passphrase, salt);

    if (rememberDevice) {
      const deviceKey = await getOrCreateDeviceKey();
      const wrapped = await wrapMasterKey(this.masterKey, deviceKey);
      await setWrappedMasterKey(wrapped, true);
    } else {
      await setWrappedMasterKey(null, false);
    }
  }

  async tryRememberedUnlock(): Promise<boolean> {
    const remember = await isRememberDevice();
    if (!remember) return false;
    const wrapped = await getWrappedMasterKey();
    const salt = await getSalt();
    if (!wrapped || !salt) return false;

    try {
      const deviceKey = await getOrCreateDeviceKey();
      this.masterKey = await unwrapMasterKey(wrapped, deviceKey);
      return true;
    } catch {
      return false;
    }
  }

  async initializeFromConfig(): Promise<void> {
    const config = await getProviderConfig();
    if (!config) return;
    this.provider = this.createProvider(config.type);
    if (config.type === 'google-drive') {
      try {
        await this.provider.connect();
      } catch {
        this.provider = null;
      }
    } else {
      await this.provider.connect();
    }
  }

  async load(): Promise<LoadResult> {
    if (!this.provider || !this.masterKey) {
      throw new Error('Registry not connected or unlocked');
    }

    this.emitStatus({ state: 'loading', error: null });

    try {
      const result = await this.loadWithFallback();
      this.container = result.container;
      const merged = mergeClaimsIntoState(result.container);
      this.container = {
        ...result.container,
        owner: { ...result.container.owner, state: merged },
      };
      this.emitStatus({
        state: 'idle',
        lastSyncedAt: new Date().toISOString(),
        pendingChanges: false,
        error: result.warning ?? null,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Load failed';
      this.emitStatus({ state: 'error', error: msg });
      throw err;
    }
  }

  private async loadWithFallback(): Promise<LoadResult> {
    const manifest = await this.readManifest();

    if (manifest) {
      const current = await this.provider!.readFile(manifest.current);
      if (current) {
        const container = await this.tryParseBlob(current);
        if (container) {
          await setLastGoodBlob(current);
          await setCachedManifest(manifest);
          this.loadedChecksum = manifest.currentChecksum;
          return { container, source: 'cloud' };
        }
      }

      const prev = await this.provider!.readFile(manifest.previous);
      if (prev) {
        const container = await this.tryParseBlob(prev);
        if (container) {
          await setLastGoodBlob(prev);
          return {
            container,
            source: 'previous',
            warning: 'Loaded from previous backup copy',
          };
        }
      }
    } else {
      const current = await this.provider!.readFile(REGISTRY_CURRENT);
      if (current) {
        const container = await this.tryParseBlob(current);
        if (container) {
          await setLastGoodBlob(current);
          return { container, source: 'cloud' };
        }
      }
    }

    const cached = await getLastGoodBlob();
    if (cached) {
      const container = await this.tryParseBlob(cached);
      if (container) {
        return {
          container,
          source: 'cache',
          warning: 'Loaded from local cache — cloud unavailable or corrupt',
        };
      }
    }

    const empty = await containerFromAppState(emptyOwnerPayload().state);
    return { container: empty, source: 'cloud' };
  }

  private async tryParseBlob(blob: Uint8Array): Promise<RegistryContainer | null> {
    if (!this.masterKey) return null;
    try {
      const file = parseRegistryFileJson(new TextDecoder().decode(blob));
      const container = await decryptRegistryFile(file, this.masterKey);
      if (!(await validateContainer(container))) return null;
      return container;
    } catch {
      return null;
    }
  }

  private async readManifest(): Promise<StorageManifest | null> {
    const raw = await this.provider!.readFile(MANIFEST_FILE);
    if (!raw) return null;
    try {
      return JSON.parse(new TextDecoder().decode(raw)) as StorageManifest;
    } catch {
      return null;
    }
  }

  getConflictMessage(): string | null {
    return this.conflictMessage;
  }

  async resolveConflict(useRemote: boolean, localState: AppState): Promise<AppState> {
    this.conflictMessage = null;
    if (useRemote) {
      const result = await this.loadWithFallback();
      this.container = result.container;
      return mergeClaimsIntoState(result.container);
    }
    await this.save(localState);
    return localState;
  }

  private async checkForConflict(): Promise<void> {
    const manifest = await this.readManifest();
    if (manifest && this.loadedChecksum && manifest.currentChecksum !== this.loadedChecksum) {
      this.conflictMessage =
        'The cloud registry was updated on another device. Choose which copy to keep.';
      throw new Error('Sync conflict');
    }
  }

  scheduleSave(state: AppState): void {
    if (!this.masterKey) return;
    this.emitStatus({ pendingChanges: true });

    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.save(state);
    }, 500);
  }

  async save(state: AppState): Promise<void> {
    if (!this.provider || !this.masterKey) return;

    this.emitStatus({ state: 'saving', error: null });

    try {
      await this.checkForConflict();

      const existingClaims = this.container?.claims ?? {};
      const existingShareKeys = this.container?.owner.shareKeys ?? {};
      const container = await containerFromAppState(state, existingShareKeys, existingClaims);
      this.container = container;

      const file = await encryptRegistryFile(container, this.masterKey);
      const bytes = serializeRegistryFile(file);
      const checksum = await sha256Bytes(bytes);

      await this.provider.writeFile(REGISTRY_TMP, bytes);

      const tmpRead = await this.provider.readFile(REGISTRY_TMP);
      if (!tmpRead || (await sha256Bytes(tmpRead)) !== checksum) {
        throw new Error('Save validation failed');
      }

      const current = await this.provider.readFile(REGISTRY_CURRENT);
      if (current) {
        await this.provider.writeFile(REGISTRY_PREV, current);
      }

      await this.provider.writeFile(REGISTRY_CURRENT, bytes);

      if (this.provider.ensurePublicReadAccess) {
        await this.provider.ensurePublicReadAccess(REGISTRY_CURRENT);
      }

      const drive = this.provider as GoogleDriveProvider;
      if (typeof drive.ensurePublicWriteAccess === 'function') {
        await drive.ensurePublicWriteAccess(REGISTRY_CURRENT);
      }

      const manifest: StorageManifest = {
        version: 1,
        current: REGISTRY_CURRENT,
        previous: REGISTRY_PREV,
        updatedAt: new Date().toISOString(),
        currentChecksum: checksum,
        previousChecksum: current ? await sha256Bytes(current) : '',
      };
      await this.provider.writeFile(
        MANIFEST_FILE,
        new TextEncoder().encode(JSON.stringify(manifest)),
      );

      await setLastGoodBlob(bytes);
      await setCachedManifest(manifest);
      await setPendingBlob(null);
      const now = new Date().toISOString();
      await setLastSyncedAt(now);
      this.loadedChecksum = checksum;
      this.conflictMessage = null;

      this.emitStatus({
        state: 'idle',
        lastSyncedAt: now,
        pendingChanges: false,
        error: null,
      });
    } catch (err) {
      if (!navigator.onLine) {
        const container = await containerFromAppState(
          state,
          this.container?.owner.shareKeys ?? {},
          this.container?.claims ?? {},
        );
        this.container = container;
        const file = await encryptRegistryFile(container, this.masterKey);
        await setPendingBlob(serializeRegistryFile(file));
        this.emitStatus({
          state: 'offline',
          pendingChanges: true,
          error: 'Offline — changes queued locally',
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Save failed';
      this.emitStatus({ state: 'error', error: msg, pendingChanges: true });
      throw err;
    }
  }

  async flushPending(): Promise<void> {
    const pending = await getPendingBlob();
    if (!pending || !this.provider || !this.masterKey) return;
    const container = await this.tryParseBlob(pending);
    if (!container) return;
    await this.save(container.owner.state);
  }

  async prepareShareLink(childId: string, state: AppState): Promise<string | null> {
    await this.save(state);

    if (this.status.state === 'error') {
      throw new Error(this.status.error ?? 'Could not sync registry before sharing');
    }

    if (
      this.status.state === 'offline' &&
      this.provider instanceof GoogleDriveProvider
    ) {
      throw new Error('Offline — connect to the internet before sharing');
    }

    return this.buildShareUrl(childId);
  }

  buildShareUrl(childId: string): string | null {
    const shareKey = this.getShareKey(childId);
    if (!shareKey) return null;

    const fileId = this.getRegistryFileIdSync();
    const base = `${window.location.origin}/share/${childId}`;
    const fileParam = fileId ? `?f=${encodeURIComponent(fileId)}` : '';
    return `${base}${fileParam}#${shareKey}`;
  }

  private getRegistryFileIdSync(): string | undefined {
    if (this.provider instanceof GoogleDriveProvider) {
      return this.provider.getRegistryFileId();
    }
    if (this.provider instanceof LocalBlobProvider) {
      return LOCAL_REGISTRY_FILE_ID;
    }
    return undefined;
  }

  async loadGuestWishlist(
    fileId: string,
    childId: string,
    shareKey: string,
  ): Promise<{ childName: string; books: import('./types').PublicBookSlice[] } | null> {
    let blob: Uint8Array | null = null;

    if (fileId === LOCAL_REGISTRY_FILE_ID) {
      blob = await readLocalProviderFile(REGISTRY_CURRENT);
    } else if (this.provider?.readFile) {
      blob = await this.provider.readFile(REGISTRY_CURRENT);
    }
    if (!blob && fileId !== LOCAL_REGISTRY_FILE_ID) {
      blob = await GoogleDriveProvider.fetchPublicFile(fileId);
    }
    if (!blob) return null;

    const file = parseRegistryFileJson(new TextDecoder().decode(blob));
    const slice = await decryptPublicSlice(file, childId, shareKey);
    if (!slice) return null;
    return { childName: slice.childName, books: slice.books };
  }

  async submitGuestClaim(
    fileId: string,
    childId: string,
    shareKey: string,
    bookId: string,
    claimedBy: string,
  ): Promise<void> {
    let blob: Uint8Array | null = null;
    if (fileId === LOCAL_REGISTRY_FILE_ID) {
      blob = await readLocalProviderFile(REGISTRY_CURRENT);
    } else {
      blob = await GoogleDriveProvider.fetchPublicFile(fileId);
      if (!blob && this.provider) {
        blob = await this.provider.readFile(REGISTRY_CURRENT);
      }
    }
    if (!blob) throw new Error('Could not fetch registry');

    const file = parseRegistryFileJson(new TextDecoder().decode(blob));
    const claim = createClaimRecord(bookId, claimedBy);
    const updated = await appendClaimToFile(file, childId, shareKey, claim);
    const bytes = serializeRegistryFile(updated);

    let uploaded = false;
    if (fileId === LOCAL_REGISTRY_FILE_ID) {
      await writeLocalProviderFile(REGISTRY_CURRENT, bytes);
      uploaded = true;
    } else if (this.provider?.guestUpdateRegistry) {
      try {
        await this.provider.guestUpdateRegistry(fileId, bytes);
        uploaded = true;
      } catch {
        uploaded = false;
      }
    }
    if (!uploaded && fileId !== LOCAL_REGISTRY_FILE_ID) {
      uploaded = await GoogleDriveProvider.guestUpdatePublicFile(fileId, bytes);
    }
    if (!uploaded) {
      throw new Error(
        'Could not save claim remotely. The owner can sync claims when they open the app.',
      );
    }

    if (this.masterKey && this.container) {
      const claims = this.container.claims[childId] ?? [];
      if (!claims.some((c) => c.bookId === bookId)) {
        this.container.claims[childId] = [...claims, claim];
      }
      const state = mergeClaimsIntoState(this.container);
      await this.save(state);
    }
  }

  async mergeRemoteClaims(): Promise<AppState | null> {
    if (!this.container || !this.masterKey || !this.provider) return null;

    const blob = await this.provider.readFile(REGISTRY_CURRENT);
    if (!blob) return null;

    try {
      const file = parseRegistryFileJson(new TextDecoder().decode(blob));
      const remote = await decryptRegistryFile(file, this.masterKey);

      for (const [childId, records] of Object.entries(remote.claims)) {
        const local = this.container.claims[childId] ?? [];
        const merged = [...local];
        for (const r of records) {
          if (!merged.some((m) => m.claimId === r.claimId)) merged.push(r);
        }
        this.container.claims[childId] = merged;
      }

      const state = mergeClaimsIntoState(this.container);
      this.container.owner.state = state;
      await this.save(state);
      return state;
    } catch {
      return null;
    }
  }

  lock(): void {
    this.masterKey = null;
    this.container = null;
  }
}

export const registryService = new RegistryService();

export type { ClaimRecord, RegistryContainer, LoadResult, SyncStatus };
