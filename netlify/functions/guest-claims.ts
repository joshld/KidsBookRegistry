import {
  handleGuestClaimsDelete,
  handleGuestClaimsGet,
  handleGuestClaimsPost,
} from '../../server/guestClaimsApi';

const STORAGE_PATH = '/tmp/guest-claims.json';

export default async (request: Request): Promise<Response> => {
  const method = request.method;

  if (method === 'GET') {
    const result = await handleGuestClaimsGet(request.url, STORAGE_PATH);
    return Response.json(result.json, { status: result.status });
  }

  if (method === 'POST') {
    const raw = await request.text();
    const result = await handleGuestClaimsPost(raw, STORAGE_PATH);
    return Response.json(result.json, { status: result.status });
  }

  if (method === 'DELETE') {
    const raw = await request.text();
    const result = await handleGuestClaimsDelete(raw, STORAGE_PATH);
    return Response.json(result.json, { status: result.status });
  }

  return new Response('Method not allowed', { status: 405 });
};
