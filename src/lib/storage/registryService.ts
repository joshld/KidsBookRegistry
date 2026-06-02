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
  removeClaimFromFile,
  decryptPublicSlice,
  createClaimRecord,
  emptyOwnerPayload,
  type GuestScannedBook,
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
  clearDriveGuestAccessFileIds,
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

function pruneClaimsForState(
  state: AppState,
  claims: Record<string, ClaimRecord[]>,
): Record<string, ClaimRecord[]> {
  const pruned: Record<string, ClaimRecord[]> = {};
  for (const [childId, records] of Object.entries(claims)) {
    const kept = records.filter((record) => {
      const book = state.books.find((b) => b.id === record.bookId && b.childId === childId);
      return book?.listType === 'wishlist' && book.status === 'Claimed';
    });
    if (kept.length > 0) {
      pruned[childId] = kept;
    }
  }
  return pruned;
}

type SyncListener = (status: SyncStatus) => void;

function isStorageManifest(value: unknown): value is StorageManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'current' in value &&
    'currentChecksum' in value &&
    typeof (value as StorageManifest).version === 'number'
  );
}

export type GuestLoadResult =
  | {
      ok: true;
      childName: string;
      books: import('./types').PublicBookSlice[];
      ownedBooks: import('./types').PublicOwnedBookSlice[];
    }
  | { ok: false; message: string };

class RegistryService {
  private provider: StorageProvider | null = null;
  private masterKey: CryptoKey | null = null;
  private container: RegistryContainer | null = null;
  private syncListeners = new Set<SyncListener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveInFlight: Promise<void> | null = null;
  private lastSavedBytes: Uint8Array | null = null;
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
      const cachedBlob = await getLastGoodBlob();
      if (cachedBlob) this.lastSavedBytes = cachedBlob;
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

    if (this.saveInFlight) {
      await this.saveInFlight;
      if (!this.status.pendingChanges && this.status.state !== 'error') return;
    }

    this.saveInFlight = this.performSave(state).finally(() => {
      this.saveInFlight = null;
    });
    return this.saveInFlight;
  }

  private async performSave(state: AppState): Promise<void> {
    if (!this.provider || !this.masterKey) return;

    this.emitStatus({ state: 'saving', error: null });

    try {
      await this.checkForConflict();

      const existingClaims = pruneClaimsForState(state, this.container?.claims ?? {});
      const existingShareKeys = this.container?.owner.shareKeys ?? {};
      const container = await containerFromAppState(state, existingShareKeys, existingClaims);
      this.container = container;

      const file = await encryptRegistryFile(container, this.masterKey);
      const bytes = serializeRegistryFile(file);
      const checksum = await sha256Bytes(bytes);

      const useFastSave = this.provider.supportsFastSave === true;
      let previousChecksum = '';

      if (useFastSave) {
        if (this.lastSavedBytes) {
          previousChecksum = await sha256Bytes(this.lastSavedBytes);
          await this.provider.writeFile(REGISTRY_PREV, this.lastSavedBytes);
        }
        await this.provider.writeFile(REGISTRY_CURRENT, bytes);
        if (this.provider.ensureGuestAccessOnce) {
          await this.provider.ensureGuestAccessOnce(REGISTRY_CURRENT);
          await this.provider.ensureGuestAccessOnce(MANIFEST_FILE);
        }
      } else {
        await this.provider.writeFile(REGISTRY_TMP, bytes);

        const tmpRead = await this.provider.readFile(REGISTRY_TMP);
        if (!tmpRead || (await sha256Bytes(tmpRead)) !== checksum) {
          throw new Error('Save validation failed');
        }

        const current = await this.provider.readFile(REGISTRY_CURRENT);
        if (current) {
          previousChecksum = await sha256Bytes(current);
          await this.provider.writeFile(REGISTRY_PREV, current);
        }

        await this.provider.writeFile(REGISTRY_CURRENT, bytes);

        if (this.provider.ensurePublicReadAccess) {
          await this.provider.ensurePublicReadAccess(REGISTRY_CURRENT);
          await this.provider.ensurePublicReadAccess(MANIFEST_FILE);
        }

        const drive = this.provider as GoogleDriveProvider;
        if (typeof drive.ensurePublicWriteAccess === 'function') {
          await drive.ensurePublicWriteAccess(REGISTRY_CURRENT);
        }
      }

      const manifest: StorageManifest = {
        version: 1,
        current: REGISTRY_CURRENT,
        previous: REGISTRY_PREV,
        updatedAt: new Date().toISOString(),
        currentChecksum: checksum,
        previousChecksum,
        registryFileId:
          this.provider instanceof GoogleDriveProvider
            ? this.provider.getRegistryFileId()
            : undefined,
      };
      await this.provider.writeFile(
        MANIFEST_FILE,
        new TextEncoder().encode(JSON.stringify(manifest)),
      );

      this.lastSavedBytes = bytes;
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
    if (this.saveInFlight) {
      await this.saveInFlight;
    }

    if (this.status.pendingChanges || this.status.state === 'saving') {
      await this.save(state);
    }

    if (this.status.state === 'error') {
      throw new Error(this.status.error ?? 'Could not sync registry before sharing');
    }

    if (
      this.status.state === 'offline' &&
      this.provider instanceof GoogleDriveProvider
    ) {
      throw new Error('Offline — connect to the internet before sharing');
    }

    const fileId =
      this.getSharePointerFileIdSync() ?? (await getProviderConfig())?.manifestFileId;
    const url = this.buildShareUrl(childId, fileId);
    if (!url) return null;

    const parsed = new URL(url);
    const verifyFileId = parsed.searchParams.get('f');
    const verifyKey =
      parsed.hash.replace(/^#/, '') || parsed.searchParams.get('k') || '';
    if (verifyFileId && verifyKey) {
      let verify = await this.loadGuestWishlist(verifyFileId, childId, verifyKey);
      if (
        !verify.ok &&
        verify.message.includes('download') &&
        this.provider instanceof GoogleDriveProvider
      ) {
        await clearDriveGuestAccessFileIds();
        await this.provider.ensureGuestAccessOnce(REGISTRY_CURRENT, true);
        await this.provider.ensureGuestAccessOnce(MANIFEST_FILE, true);
        verify = await this.loadGuestWishlist(verifyFileId, childId, verifyKey);
      }
      if (!verify.ok) {
        throw new Error(verify.message);
      }
    }

    return url;
  }

  buildShareUrl(childId: string, fileId?: string): string | null {
    const shareKey = this.getShareKey(childId);
    if (!shareKey) return null;

    const resolvedFileId = fileId ?? this.getSharePointerFileIdSync();
    const base = `${window.location.origin}/share/${childId}`;
    const params = new URLSearchParams();
    if (resolvedFileId) params.set('f', resolvedFileId);
    params.set('k', shareKey);
    const query = params.toString();
    return `${base}?${query}#${shareKey}`;
  }

  private getSharePointerFileIdSync(): string | undefined {
    if (this.provider instanceof GoogleDriveProvider) {
      return this.provider.getManifestFileId() ?? this.provider.getRegistryFileId();
    }
    if (this.provider instanceof LocalBlobProvider) {
      return LOCAL_REGISTRY_FILE_ID;
    }
    return undefined;
  }

  private getRegistryFileIdSync(): string | undefined {
    if (this.provider instanceof GoogleDriveProvider) {
      const fromProvider = this.provider.getRegistryFileId();
      if (fromProvider) return fromProvider;
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
  ): Promise<GuestLoadResult> {
    const resolved = await this.fetchGuestRegistryBlob(fileId);
    if (!resolved) {
      return {
        ok: false,
        message:
          'Could not download the registry from Google Drive. The owner may need to copy a fresh share link after saving.',
      };
    }

    let file;
    try {
      file = parseRegistryFileJson(new TextDecoder().decode(resolved.blob));
    } catch {
      return {
        ok: false,
        message: 'Downloaded file is not a valid registry. Ask for a fresh share link.',
      };
    }

    if (!file.public || !file.public[childId]) {
      const childIds = Object.keys(file.public ?? {});
      return {
        ok: false,
        message:
          childIds.length === 0
            ? 'This registry has no shared wish lists yet. The owner should open the app, wait for sync to finish, then copy a new link.'
            : 'This share link does not match the registry on Google Drive. Ask for a freshly copied link.',
      };
    }

    try {
      const slice = await decryptPublicSlice(file, childId, shareKey);
      if (!slice) {
        return {
          ok: false,
          message: 'Could not decrypt this wish list. Ask for a fresh share link.',
        };
      }
      return {
        ok: true,
        childName: slice.childName,
        books: slice.books,
        ownedBooks: slice.ownedBooks ?? [],
      };
    } catch {
      return {
        ok: false,
        message:
          'Could not decrypt this wish list. The link may be incomplete — make sure the full URL was copied, including the part after #.',
      };
    }
  }

  /** Resolve registry bytes from a share pointer (manifest.json) or legacy direct registry id. */
  private async fetchGuestRegistryBlob(
    fileId: string,
  ): Promise<{ blob: Uint8Array; registryFileId: string } | null> {
    if (fileId === LOCAL_REGISTRY_FILE_ID) {
      const blob = await readLocalProviderFile(REGISTRY_CURRENT);
      return blob ? { blob, registryFileId: LOCAL_REGISTRY_FILE_ID } : null;
    }

    const pointer = await GoogleDriveProvider.fetchPublicFile(fileId);
    if (!pointer) return null;

    const text = new TextDecoder().decode(pointer);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }

    if (isStorageManifest(parsed) && parsed.registryFileId) {
      if (parsed.registryFileId === fileId) {
        return null;
      }
      const blob = await GoogleDriveProvider.fetchPublicFile(parsed.registryFileId);
      return blob ? { blob, registryFileId: parsed.registryFileId } : null;
    }

    if (typeof parsed === 'object' && parsed !== null && 'owner' in parsed) {
      return { blob: pointer, registryFileId: fileId };
    }

    return null;
  }

  async submitGuestClaim(
    fileId: string,
    childId: string,
    shareKey: string,
    bookId: string,
    claimedBy: string,
    scannedBook?: GuestScannedBook,
  ): Promise<GuestLoadResult> {
    const resolved = await this.fetchGuestRegistryBlob(fileId);
    if (!resolved) throw new Error('Could not fetch registry');

    const file = parseRegistryFileJson(new TextDecoder().decode(resolved.blob));
    const claim = createClaimRecord(bookId, claimedBy);
    const updated = await appendClaimToFile(file, childId, shareKey, claim, scannedBook);

    const slice = await decryptPublicSlice(updated, childId, shareKey);
    if (!slice) {
      throw new Error('Could not update wish list');
    }

    const sliceResult: GuestLoadResult = {
      ok: true,
      childName: slice.childName,
      books: slice.books,
      ownedBooks: slice.ownedBooks ?? [],
    };

    const uploaded = await this.uploadGuestRegistry(resolved.registryFileId, updated, {
      registryFileId: resolved.registryFileId,
      childId,
      bookId,
      action: 'claim',
      claimedBy,
      scannedBook,
    });
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

    return sliceResult;
  }

  async submitGuestUnclaim(
    fileId: string,
    childId: string,
    shareKey: string,
    bookId: string,
  ): Promise<GuestLoadResult> {
    const resolved = await this.fetchGuestRegistryBlob(fileId);
    if (!resolved) throw new Error('Could not fetch registry');

    const file = parseRegistryFileJson(new TextDecoder().decode(resolved.blob));
    const updated = await removeClaimFromFile(file, childId, shareKey, bookId);
    const slice = await decryptPublicSlice(updated, childId, shareKey);
    if (!slice) {
      throw new Error('Could not update wish list');
    }

    const sliceResult: GuestLoadResult = {
      ok: true,
      childName: slice.childName,
      books: slice.books,
      ownedBooks: slice.ownedBooks ?? [],
    };

    const uploaded = await this.uploadGuestRegistry(
      resolved.registryFileId,
      updated,
      {
        registryFileId: resolved.registryFileId,
        childId,
        bookId,
        action: 'unclaim',
      },
    );
    if (!uploaded) {
      throw new Error(
        'Could not save unclaim remotely. The owner can sync when they open the app.',
      );
    }

    if (this.masterKey && this.container) {
      this.container.claims[childId] = (this.container.claims[childId] ?? []).filter(
        (c) => c.bookId !== bookId,
      );
      const state = mergeClaimsIntoState(this.container);
      const book = state.books.find((b) => b.id === bookId && b.childId === childId);
      if (book) {
        book.status = 'Available';
        book.claimedBy = undefined;
      }
      this.container.owner.state = state;
      await this.save(state);
    }

    return sliceResult;
  }

  private async uploadGuestRegistry(
    registryFileId: string,
    file: import('./types').RegistryFile,
    relay: {
      registryFileId: string;
      childId: string;
      bookId: string;
      action: 'claim' | 'unclaim';
      claimedBy?: string;
      scannedBook?: GuestScannedBook;
    },
  ): Promise<boolean> {
    const bytes = serializeRegistryFile(file);

    if (registryFileId === LOCAL_REGISTRY_FILE_ID) {
      await writeLocalProviderFile(REGISTRY_CURRENT, bytes);
      return true;
    }

    if (this.provider?.guestUpdateRegistry) {
      try {
        await this.provider.guestUpdateRegistry(registryFileId, bytes);
        return true;
      } catch {
        // fall through
      }
    }

    if (await GoogleDriveProvider.guestUpdatePublicFile(registryFileId, bytes)) {
      return true;
    }

    return this.relayGuestClaim(relay);
  }

  private async relayGuestClaim(input: {
    registryFileId: string;
    childId: string;
    bookId: string;
    action?: 'claim' | 'unclaim';
    claimedBy?: string;
    scannedBook?: GuestScannedBook;
  }): Promise<boolean> {
    try {
      const res = await fetch('/api/guest-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async fetchRelayedClaims(registryFileId: string): Promise<
    Array<{
      id: string;
      childId: string;
      bookId: string;
      action: 'claim' | 'unclaim';
      claimedBy: string;
      scannedBook?: GuestScannedBook;
    }>
  > {
    try {
      const res = await fetch(
        `/api/guest-claims?registryFileId=${encodeURIComponent(registryFileId)}`,
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        claims?: Array<{
          id: string;
          childId: string;
          bookId: string;
          action?: 'claim' | 'unclaim';
          claimedBy: string;
          scannedBook?: GuestScannedBook;
        }>;
      };
      return (data.claims ?? []).map((c) => ({
        ...c,
        action: c.action === 'unclaim' ? 'unclaim' : 'claim',
      }));
    } catch {
      return [];
    }
  }

  private async clearRelayedClaims(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await fetch('/api/guest-claims', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      // Best effort — claims may be applied again on next sync (appendClaimToFile dedupes by bookId)
    }
  }

  private async applyRelayedClaims(registryFileId: string): Promise<boolean> {
    if (!this.provider || !this.masterKey || !this.container) return false;

    const relayed = await this.fetchRelayedClaims(registryFileId);
    if (relayed.length === 0) return false;

    const blob = await this.provider.readFile(REGISTRY_CURRENT);
    if (!blob) return false;

    let file = parseRegistryFileJson(new TextDecoder().decode(blob));
    const appliedIds: string[] = [];

    for (const pending of relayed) {
      const shareKey = this.container.owner.shareKeys[pending.childId];
      if (!shareKey) continue;
      if (pending.action === 'unclaim') {
        file = await removeClaimFromFile(file, pending.childId, shareKey, pending.bookId);
      } else {
        const claim = createClaimRecord(pending.bookId, pending.claimedBy);
        file = await appendClaimToFile(
          file,
          pending.childId,
          shareKey,
          claim,
          pending.scannedBook,
        );
      }
      appliedIds.push(pending.id);
    }

    if (appliedIds.length === 0) return false;

    const bytes = serializeRegistryFile(file);
    await this.provider.writeFile(REGISTRY_CURRENT, bytes);
    await this.clearRelayedClaims(appliedIds);

    const remote = await decryptRegistryFile(file, this.masterKey);
    this.container = remote;
    return true;
  }

  async mergeRemoteClaims(): Promise<AppState | null> {
    if (!this.container || !this.masterKey || !this.provider) return null;

    const registryFileId = this.getRegistryFileIdSync();
    if (registryFileId && registryFileId !== LOCAL_REGISTRY_FILE_ID) {
      await this.applyRelayedClaims(registryFileId);
    }

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

      this.container = {
        ...remote,
        claims: this.container.claims,
      };

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

export type { ClaimRecord, RegistryContainer, LoadResult, SyncStatus, GuestLoadResult };
