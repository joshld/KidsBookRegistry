import type { AppState, Book, Child } from '../../types';
import { crypto as newId } from '../uid';
import { sha256Hex, randomShareKey } from './crypto';
import type {
  ClaimRecord,
  OwnerPayload,
  PublicSlice,
  RegistryContainer,
  RegistryFile,
} from './types';
import { REGISTRY_VERSION } from './types';
import type { EncryptedBlob } from './types';
import {
  deriveKeyFromShareKey,
  deriveMasterKey,
  encryptJson,
  decryptJson,
} from './crypto';

const DEFAULT_STATE: AppState = {
  profile: null,
  children: [],
  books: [],
};

export function emptyOwnerPayload(): OwnerPayload {
  return { state: DEFAULT_STATE, shareKeys: {} };
}

export function buildPublicSlice(child: Child, books: Book[]): PublicSlice {
  return {
    childName: child.name,
    books: books
      .filter((b) => b.childId === child.id && b.listType === 'wishlist')
      .map((b) => ({
        id: b.id,
        isbn: b.isbn,
        title: b.title,
        author: b.author,
        imageUrl: b.imageUrl,
        status: b.status,
        claimedBy: b.claimedBy,
      })),
  };
}

export function buildContainer(
  owner: OwnerPayload,
  existingClaims: Record<string, ClaimRecord[]> = {},
): RegistryContainer {
  const state = owner.state;
  const shareKeys = { ...owner.shareKeys };

  for (const child of state.children) {
    if (!shareKeys[child.id]) shareKeys[child.id] = randomShareKey();
  }

  const normalizedOwner: OwnerPayload = { state, shareKeys };
  const publicSlices: Record<string, PublicSlice> = {};
  for (const child of state.children) {
    publicSlices[child.id] = buildPublicSlice(child, state.books);
  }

  const claims: Record<string, ClaimRecord[]> = { ...existingClaims };
  for (const child of state.children) {
    if (!claims[child.id]) claims[child.id] = [];
  }

  const inner = {
    version: REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    innerChecksum: '',
    owner: normalizedOwner,
    public: publicSlices,
    claims,
  };

  return { ...inner, innerChecksum: '' };
}

async function computeInnerChecksum(container: Omit<RegistryContainer, 'innerChecksum'>): Promise<string> {
  const canonical = JSON.stringify({
    version: container.version,
    updatedAt: container.updatedAt,
    owner: container.owner,
    public: container.public,
    claims: container.claims,
  });
  return sha256Hex(canonical);
}

export async function finalizeContainer(
  container: Omit<RegistryContainer, 'innerChecksum'>,
): Promise<RegistryContainer> {
  const innerChecksum = await computeInnerChecksum(container);
  return { ...container, innerChecksum };
}

export function validateAppState(state: AppState): boolean {
  if (state.profile !== null) {
    if (!state.profile.id || !state.profile.email) return false;
  }
  for (const child of state.children) {
    if (!child.id || !child.name) return false;
  }
  const childIds = new Set(state.children.map((c) => c.id));
  const bookIds = new Set<string>();
  for (const book of state.books) {
    if (!book.id || !book.isbn || !book.title) return false;
    if (!childIds.has(book.childId)) return false;
    if (bookIds.has(book.id)) return false;
    bookIds.add(book.id);
    if (book.listType !== 'owned' && book.listType !== 'wishlist') return false;
    if (book.status !== 'Available' && book.status !== 'Claimed') return false;
  }
  return true;
}

export async function validateContainer(container: RegistryContainer): Promise<boolean> {
  const expected = await computeInnerChecksum({
    version: container.version,
    updatedAt: container.updatedAt,
    owner: container.owner,
    public: container.public,
    claims: container.claims,
  });
  if (container.innerChecksum !== expected) return false;
  return validateAppState(container.owner.state);
}

export async function encryptRegistryFile(
  container: RegistryContainer,
  masterKey: CryptoKey,
): Promise<RegistryFile> {
  const finalized = await finalizeContainer(container);
  const ownerBlob = await encryptJson(masterKey, finalized.owner);

  const publicBlobs: Record<string, EncryptedBlob> = {};
  for (const [childId, slice] of Object.entries(finalized.public)) {
    const shareKey = finalized.owner.shareKeys[childId];
    if (!shareKey) continue;
    const key = await deriveKeyFromShareKey(shareKey);
    publicBlobs[childId] = await encryptJson(key, slice);
  }

  const claimsBlobs: Record<string, EncryptedBlob> = {};
  for (const [childId, records] of Object.entries(finalized.claims)) {
    const shareKey = finalized.owner.shareKeys[childId];
    if (!shareKey) continue;
    const key = await deriveKeyFromShareKey(shareKey);
    claimsBlobs[childId] = await encryptJson(key, records);
  }

  return {
    version: REGISTRY_VERSION,
    updatedAt: finalized.updatedAt,
    owner: ownerBlob,
    public: publicBlobs,
    claims: claimsBlobs,
  };
}

export async function decryptRegistryFile(
  file: RegistryFile,
  masterKey: CryptoKey,
): Promise<RegistryContainer> {
  const owner = await decryptJson<OwnerPayload>(masterKey, file.owner);

  const publicSlices: Record<string, PublicSlice> = {};
  for (const [childId, blob] of Object.entries(file.public)) {
    const shareKey = owner.shareKeys[childId];
    if (!shareKey) continue;
    const key = await deriveKeyFromShareKey(shareKey);
    publicSlices[childId] = await decryptJson<PublicSlice>(key, blob);
  }

  const claims: Record<string, ClaimRecord[]> = {};
  for (const [childId, blob] of Object.entries(file.claims)) {
    const shareKey = owner.shareKeys[childId];
    if (!shareKey) continue;
    const key = await deriveKeyFromShareKey(shareKey);
    claims[childId] = await decryptJson<ClaimRecord[]>(key, blob);
  }

  const container: RegistryContainer = {
    version: file.version,
    updatedAt: file.updatedAt,
    innerChecksum: '',
    owner,
    public: publicSlices,
    claims,
  };

  return finalizeContainer(container);
}

export async function decryptPublicSlice(
  file: RegistryFile,
  childId: string,
  shareKey: string,
): Promise<PublicSlice | null> {
  const blob = file.public[childId];
  if (!blob) return null;
  const key = await deriveKeyFromShareKey(shareKey);
  return decryptJson<PublicSlice>(key, blob);
}

export async function decryptClaims(
  file: RegistryFile,
  childId: string,
  shareKey: string,
): Promise<ClaimRecord[]> {
  const blob = file.claims[childId];
  if (!blob) return [];
  const key = await deriveKeyFromShareKey(shareKey);
  return decryptJson<ClaimRecord[]>(key, blob);
}

export function mergeClaimsIntoState(container: RegistryContainer): AppState {
  const state = structuredClone(container.owner.state);

  for (const [childId, records] of Object.entries(container.claims)) {
    for (const claim of records) {
      const book = state.books.find((b) => b.id === claim.bookId && b.childId === childId);
      if (!book || book.listType !== 'wishlist') continue;
      if (book.status === 'Claimed') continue;
      book.status = 'Claimed';
      book.claimedBy = claim.claimedBy;
    }
  }

  return state;
}

export function containerFromAppState(
  state: AppState,
  existingShareKeys: Record<string, string> = {},
  existingClaims: Record<string, ClaimRecord[]> = {},
): Promise<RegistryContainer> {
  const owner: OwnerPayload = { state, shareKeys: existingShareKeys };
  return finalizeContainer(buildContainer(owner, existingClaims));
}

export function parseRegistryFileJson(text: string): RegistryFile {
  return JSON.parse(text) as RegistryFile;
}

export function serializeRegistryFile(file: RegistryFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(file));
}

export function createClaimRecord(bookId: string, claimedBy: string): ClaimRecord {
  return {
    claimId: newId(),
    bookId,
    claimedBy,
    at: new Date().toISOString(),
  };
}

export async function appendClaimToFile(
  file: RegistryFile,
  childId: string,
  shareKey: string,
  claim: ClaimRecord,
): Promise<RegistryFile> {
  const key = await deriveKeyFromShareKey(shareKey);
  const existing = file.claims[childId]
    ? await decryptJson<ClaimRecord[]>(key, file.claims[childId]!)
    : [];

  if (existing.some((c) => c.bookId === claim.bookId)) return file;

  const updatedClaims = [...existing, claim];
  const claimsBlob = await encryptJson(key, updatedClaims);

  const publicSlice = file.public[childId]
    ? await decryptJson<PublicSlice>(key, file.public[childId]!)
    : null;

  let updatedPublic = file.public;
  if (publicSlice) {
    const book = publicSlice.books.find((b) => b.id === claim.bookId);
    if (book && book.status === 'Available') {
      book.status = 'Claimed';
      book.claimedBy = claim.claimedBy;
      updatedPublic = { ...file.public, [childId]: await encryptJson(key, publicSlice) };
    }
  }

  return {
    ...file,
    updatedAt: new Date().toISOString(),
    claims: { ...file.claims, [childId]: claimsBlob },
    public: updatedPublic,
  };
}

export { deriveMasterKey };
