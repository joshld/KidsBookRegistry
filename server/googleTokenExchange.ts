export interface GoogleTokenSuccess {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

export interface GoogleTokenError {
  error: string;
  error_description?: string;
}

export async function exchangeGoogleAuthCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenSuccess> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const body = (await res.json()) as GoogleTokenSuccess & GoogleTokenError;

  if (!res.ok || body.error) {
    const err = new Error(body.error_description ?? body.error ?? `HTTP ${res.status}`);
    (err as Error & { code?: string }).code = body.error ?? `http_${res.status}`;
    throw err;
  }

  if (!body.access_token || !body.expires_in) {
    throw new Error('Google returned an unexpected token response');
  }

  return {
    access_token: body.access_token,
    expires_in: body.expires_in,
    refresh_token: body.refresh_token,
  };
}

export interface TokenRequestBody {
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
}

export function parseTokenRequestBody(raw: string): TokenRequestBody {
  return JSON.parse(raw) as TokenRequestBody;
}

export async function handleGoogleTokenRequest(
  body: TokenRequestBody,
  env: { clientId?: string; clientSecret?: string },
): Promise<{ status: number; json: GoogleTokenSuccess | GoogleTokenError }> {
  const clientId = env.clientId?.trim();
  const clientSecret = env.clientSecret?.trim();

  if (!clientId || !clientSecret) {
    return {
      status: 500,
      json: {
        error: 'server_misconfigured',
        error_description:
          'GOOGLE_CLIENT_SECRET is not set on the server. Add it to .env (without VITE_ prefix) and restart.',
      },
    };
  }

  const { code, codeVerifier, redirectUri } = body;
  if (!code || !codeVerifier || !redirectUri) {
    return {
      status: 400,
      json: {
        error: 'invalid_request',
        error_description: 'Missing code, codeVerifier, or redirectUri',
      },
    };
  }

  try {
    const tokens = await exchangeGoogleAuthCode({
      code,
      codeVerifier,
      redirectUri,
      clientId,
      clientSecret,
    });
    return { status: 200, json: tokens };
  } catch (err) {
    const code = (err as Error & { code?: string }).code ?? 'token_exchange_failed';
    return {
      status: 400,
      json: {
        error: code,
        error_description: err instanceof Error ? err.message : 'Token exchange failed',
      },
    };
  }
}
