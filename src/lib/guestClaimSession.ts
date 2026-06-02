const PREFIX = 'kbr_guest_claims';

function storageKey(pointerFileId: string, childId: string): string {
  return `${PREFIX}:${pointerFileId}:${childId}`;
}

function readIds(pointerFileId: string, childId: string): string[] {
  try {
    const raw = sessionStorage.getItem(storageKey(pointerFileId, childId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIds(pointerFileId: string, childId: string, bookIds: string[]): void {
  sessionStorage.setItem(storageKey(pointerFileId, childId), JSON.stringify(bookIds));
}

export function recordGuestClaim(pointerFileId: string, childId: string, bookId: string): void {
  const ids = readIds(pointerFileId, childId);
  if (!ids.includes(bookId)) {
    writeIds(pointerFileId, childId, [...ids, bookId]);
  }
}

export function removeGuestClaimRecord(pointerFileId: string, childId: string, bookId: string): void {
  writeIds(
    pointerFileId,
    childId,
    readIds(pointerFileId, childId).filter((id) => id !== bookId),
  );
}

export function canGuestUnclaim(pointerFileId: string, childId: string, bookId: string): boolean {
  return readIds(pointerFileId, childId).includes(bookId);
}

export function getGuestClaimedBookIds(pointerFileId: string, childId: string): string[] {
  return readIds(pointerFileId, childId);
}
