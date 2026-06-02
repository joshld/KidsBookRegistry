import { fetchPublicRegistryFile, parseRegistryFileIdParam } from '../../server/fetchPublicRegistry';

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const fileId = parseRegistryFileIdParam(request.url);
  if (!fileId) {
    return Response.json({ error: 'missing_file_id' }, { status: 400 });
  }

  const bytes = await fetchPublicRegistryFile(fileId);
  if (!bytes) {
    return Response.json(
      { error: 'not_found', message: 'Could not download registry from Google Drive. It may not be public yet.' },
      { status: 404 },
    );
  }

  return new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=60',
    },
  });
};
