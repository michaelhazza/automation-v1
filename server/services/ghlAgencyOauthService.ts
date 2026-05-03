import { withBackoff } from '../lib/withBackoff.js';
import { logger } from '../lib/logger.js';
import {
  buildTokenExchangeBody,
  type AgencyTokenResponse,
} from './ghlAgencyOauthServicePure.js';

export async function exchangeGhlAuthCode(
  code: string,
  redirectUri: string,
): Promise<AgencyTokenResponse | null> {
  const clientId = process.env.OAUTH_GHL_CLIENT_ID ?? '';
  const clientSecret = process.env.OAUTH_GHL_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) return null;

  const body = buildTokenExchangeBody({ code, redirectUri, clientId, clientSecret });
  const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

  try {
    return await withBackoff(
      async () => {
        const r = await fetch(GHL_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: body.toString(),
          signal: AbortSignal.timeout(20_000),
        });
        if (r.status === 429 || r.status >= 500) {
          throw Object.assign(new Error(`GHL token exchange ${r.status}`), { statusCode: r.status });
        }
        if (!r.ok) return null;
        return r.json() as Promise<AgencyTokenResponse>;
      },
      {
        label: 'ghl.exchangeAuthCode',
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        isRetryable: (err: unknown) => {
          const e = err as { statusCode?: number };
          return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
        },
        correlationId: 'oauth_callback',
        runId: code.slice(0, 8),
      },
    );
  } catch {
    logger.warn('ghl.exchangeAuthCode.failed', { codePrefix: code.slice(0, 8) });
    return null;
  }
}
