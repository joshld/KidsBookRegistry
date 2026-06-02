import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface PendingGuestClaim {
  id: string;
  registryFileId: string;
  childId: string;
  bookId: string;
  action: 'claim' | 'unclaim';
  claimedBy: string;
  scannedBook?: {
    id: string;
    isbn: string;
    title: string;
    author: string;
    imageUrl: string;
  };
  createdAt: string;
}

export interface GuestClaimInput {
  registryFileId: string;
  childId: string;
  bookId: string;
  action?: 'claim' | 'unclaim';
  claimedBy?: string;
  scannedBook?: PendingGuestClaim['scannedBook'];
}

function newId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `claim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class GuestClaimsStore {
  private claims: PendingGuestClaim[] = [];
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as PendingGuestClaim[];
      this.claims = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.claims = [];
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.claims, null, 2), 'utf8');
  }

  async add(input: GuestClaimInput): Promise<PendingGuestClaim> {
    await this.ensureLoaded();
    const action = input.action ?? 'claim';
    const claim: PendingGuestClaim = {
      id: newId(),
      createdAt: new Date().toISOString(),
      action,
      claimedBy: input.claimedBy ?? '',
      registryFileId: input.registryFileId,
      childId: input.childId,
      bookId: input.bookId,
      scannedBook: input.scannedBook,
    };
    this.claims.push(claim);
    await this.persist();
    return claim;
  }

  async list(registryFileId: string): Promise<PendingGuestClaim[]> {
    await this.ensureLoaded();
    return this.claims.filter((c) => c.registryFileId === registryFileId);
  }

  async remove(ids: string[]): Promise<void> {
    await this.ensureLoaded();
    const drop = new Set(ids);
    this.claims = this.claims.filter((c) => !drop.has(c.id));
    await this.persist();
  }
}

const stores = new Map<string, GuestClaimsStore>();

export function getGuestClaimsStore(storagePath?: string): GuestClaimsStore {
  const path =
    storagePath ??
    process.env.GUEST_CLAIMS_PATH ??
    join(process.cwd(), '.data', 'guest-claims.json');
  let store = stores.get(path);
  if (!store) {
    store = new GuestClaimsStore(path);
    stores.set(path, store);
  }
  return store;
}
