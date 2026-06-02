import type { Connect } from 'vite';
import type { Plugin } from 'vite';
import { handleGoogleTokenRequest, parseTokenRequestBody } from './server/googleTokenExchange';

function readRequestBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createGoogleTokenMiddleware(env: Record<string, string>): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.url !== '/api/google/token') {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method not allowed');
      return;
    }

    void (async () => {
      try {
        const raw = await readRequestBody(req);
        const body = parseTokenRequestBody(raw);
        const result = await handleGoogleTokenRequest(body, {
          clientId: env.VITE_GOOGLE_CLIENT_ID ?? env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        });
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result.json));
      } catch {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'server_error',
            error_description: 'Failed to process token request',
          }),
        );
      }
    })();
  };
}

export function googleTokenApiPlugin(env: Record<string, string>): Plugin {
  const attach = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use(createGoogleTokenMiddleware(env));
  };

  return {
    name: 'google-token-api',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
