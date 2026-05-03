import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { OAUTH_PROVIDERS, getProviderClientId } from '../config/oauthProviders.js';
import { setGhlOAuthState } from '../lib/ghlOAuthStateStore.js';

const router = Router();

/**
 * GET /api/ghl/oauth-url
 * Generates the GHL install URL and registers the CSRF state nonce.
 * Requires authenticated session — orgId is taken from JWT (never from query params).
 */
router.get('/api/ghl/oauth-url', authenticate, asyncHandler(async (req, res) => {
  const clientId = getProviderClientId('ghl');
  if (!clientId) {
    throw Object.assign(
      new Error('GHL OAuth not configured: OAUTH_GHL_CLIENT_ID missing'),
      { statusCode: 503 },
    );
  }

  const nonce = crypto.randomBytes(32).toString('hex');
  const orgId = req.orgId ?? '';
  setGhlOAuthState(nonce, orgId);

  const appBase = process.env.OAUTH_CALLBACK_BASE_URL || process.env.APP_BASE_URL || '';
  const redirectUri = `${appBase}/api/oauth/callback`;
  const scopes = OAUTH_PROVIDERS.ghl.scopes.join(' ');

  const url = new URL(OAUTH_PROVIDERS.ghl.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', nonce);

  res.json({ url: url.toString() });
}));

export default router;
