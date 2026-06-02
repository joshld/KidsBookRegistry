import type { Connect } from 'vite';
import type { Plugin } from 'vite';
import { join } from 'node:path';
import { fetchPublicRegistryFile, parseRegistryFileIdParam } from './server/fetchPublicRegistry';
import {
  handleGuestClaimsDelete,
  handleGuestClaimsGet,
  handleGuestClaimsPost,
} from './server/guestClaimsApi';
import { handleGoogleTokenRequest, parseTokenRequestBody } from './server/googleTokenExchange';

function readRequestBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createGoogleApiMiddleware(env: Record<string, string>): Connect.NextHandleFunction {
  const guestClaimsPath = join(process.cwd(), '.data', 'guest-claims.json');

  return (req, res, next) => {
    const url = req.url ?? '';

    if (url.startsWith('/api/guest-claims')) {
      void (async () => {
        try {
          if (req.method === 'GET') {
            const result = await handleGuestClaimsGet(url, guestClaimsPath);
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result.json));
            return;
          }

          if (req.method === 'POST' || req.method === 'DELETE') {
            const raw = await readRequestBody(req);
            const result =
              req.method === 'POST'
                ? await handleGuestClaimsPost(raw, guestClaimsPath)
                : await handleGuestClaimsDelete(raw, guestClaimsPath);
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result.json));
            return;
          }

          res.statusCode = 405;
          res.end('Method not allowed');
        } catch {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'server_error' }));
        }
      })();
      return;
    }

    if (url.startsWith('/api/google/registry')) {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end('Method not allowed');
        return;
      }

      void (async () => {
        const fileId = parseRegistryFileIdParam(url);
        if (!fileId) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'missing_file_id' }));
          return;
        }

        const bytes = await fetchPublicRegistryFile(fileId);
        if (!bytes) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: 'not_found',
              message: 'Could not download registry from Google Drive. It may not be public yet.',
            }),
          );
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.end(Buffer.from(bytes));
      })();
      return;
    }

    if (url !== '/api/google/token') {
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
    server.middlewares.use(createGoogleApiMiddleware(env));
  };

  return {
    name: 'google-token-api',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
