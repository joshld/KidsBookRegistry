import { handleGoogleTokenRequest, parseTokenRequestBody } from '../../server/googleTokenExchange';

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = parseTokenRequestBody(await request.text());
  } catch {
    return Response.json(
      { error: 'invalid_request', error_description: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const result = await handleGoogleTokenRequest(body, {
    clientId: process.env.VITE_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });

  return Response.json(result.json, { status: result.status });
};
