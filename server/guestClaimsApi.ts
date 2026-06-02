import { getGuestClaimsStore, type GuestClaimInput } from './guestClaimsStore';

export function parseGuestClaimsRegistryId(url: string): string | null {
  try {
    const parsed = new URL(url, 'http://localhost');
    return parsed.searchParams.get('registryFileId');
  } catch {
    return null;
  }
}

export function parseGuestClaimBody(raw: string): GuestClaimInput | null {
  try {
    const body = JSON.parse(raw) as GuestClaimInput;
    const action = body.action === 'unclaim' ? 'unclaim' : 'claim';
    if (!body.registryFileId?.trim() || !body.childId?.trim() || !body.bookId?.trim()) {
      return null;
    }
    if (action === 'claim' && !body.claimedBy?.trim()) {
      return null;
    }
    return {
      registryFileId: body.registryFileId.trim(),
      childId: body.childId.trim(),
      bookId: body.bookId.trim(),
      action,
      claimedBy: body.claimedBy?.trim() ?? '',
      scannedBook: body.scannedBook,
    };
  } catch {
    return null;
  }
}

export async function handleGuestClaimsGet(
  url: string,
  storagePath?: string,
): Promise<{ status: number; json: unknown }> {
  const registryFileId = parseGuestClaimsRegistryId(url);
  if (!registryFileId) {
    return { status: 400, json: { error: 'missing_registry_file_id' } };
  }
  const claims = await getGuestClaimsStore(storagePath).list(registryFileId);
  return { status: 200, json: { claims } };
}

export async function handleGuestClaimsPost(
  raw: string,
  storagePath?: string,
): Promise<{ status: number; json: unknown }> {
  const body = parseGuestClaimBody(raw);
  if (!body) {
    return { status: 400, json: { error: 'invalid_body' } };
  }
  const claim = await getGuestClaimsStore(storagePath).add(body);
  return { status: 201, json: { ok: true, claim } };
}

export async function handleGuestClaimsDelete(
  raw: string,
  storagePath?: string,
): Promise<{ status: number; json: unknown }> {
  try {
    const body = JSON.parse(raw) as { ids?: string[] };
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return { status: 400, json: { error: 'missing_ids' } };
    }
    await getGuestClaimsStore(storagePath).remove(body.ids);
    return { status: 200, json: { ok: true } };
  } catch {
    return { status: 400, json: { error: 'invalid_body' } };
  }
}
