/** Server-side fetch of a publicly readable Google Drive file (avoids browser CORS). */
export async function fetchPublicRegistryFile(fileId: string): Promise<Uint8Array | null> {
  const id = fileId.trim();
  if (!id) return null;

  const urls = [
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
    `https://drive.google.com/uc?id=${encodeURIComponent(id)}&export=download`,
  ];

  for (const url of urls) {
    try {
      const bytes = await fetchDriveDownloadUrl(url);
      if (bytes && looksLikeRegistryJson(bytes)) return bytes;
    } catch {
      // try next URL
    }
  }

  return null;
}

async function fetchDriveDownloadUrl(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (looksLikeRegistryJson(bytes)) return bytes;

  const text = new TextDecoder().decode(bytes.slice(0, 8192));
  const confirmMatch =
    text.match(/confirm=([0-9A-Za-z_-]+)/) ??
    text.match(/download-form[\s\S]*?confirm=([0-9A-Za-z_-]+)/);
  if (!confirmMatch) return null;

  const id = new URL(url).searchParams.get('id');
  if (!id) return null;

  const confirmUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}&confirm=${confirmMatch[1]}`;
  const res2 = await fetch(confirmUrl, { redirect: 'follow' });
  if (!res2.ok) return null;
  return new Uint8Array(await res2.arrayBuffer());
}

function looksLikeRegistryJson(bytes: Uint8Array): boolean {
  const start = new TextDecoder().decode(bytes.slice(0, 32)).trimStart();
  return start.startsWith('{');
}

export function parseRegistryFileIdParam(url: string): string | null {
  try {
    const parsed = new URL(url, 'http://localhost');
    return parsed.searchParams.get('fileId');
  } catch {
    return null;
  }
}
