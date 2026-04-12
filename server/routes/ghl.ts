import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { env } from '../lib/env.js';

// In-memory store for OAuth state nonces (production: use session or DB)
const pendingOAuthStates = new Map<string, { orgId: string; expiresAt: number }>();

const router = Router();

/**
 * GHL OAuth + API stub routes.
 * These are placeholders for the full Module C implementation.
 * They provide the endpoints the onboarding UI expects.
 */

/** GET /api/ghl/oauth-url — generate GHL OAuth redirect URL */
router.get('/api/ghl/oauth-url', authenticate, asyncHandler(async (req, res) => {
  // TODO: Build from env.GHL_CLIENT_ID, env.GHL_REDIRECT_URI, required scopes.
  // For now return a placeholder so the UI doesn't break.
  const clientId = (env as unknown as Record<string, string | undefined>).GHL_CLIENT_ID;
  if (!clientId) {
    res.json({ url: null, message: 'GHL OAuth not configured. Set GHL_CLIENT_ID in environment.' });
    return;
  }

  // Generate CSRF-safe state nonce tied to the user's org
  const state = crypto.randomBytes(32).toString('hex');
  const orgId = req.orgId ?? '';
  pendingOAuthStates.set(state, { orgId, expiresAt: Date.now() + 10 * 60 * 1000 }); // 10min expiry

  const redirectUri = encodeURIComponent(`${env.APP_BASE_URL}/api/ghl/oauth/callback`);
  const scopes = encodeURIComponent('locations.readonly contacts.readonly opportunities.readonly conversations.readonly payments.readonly businesses.readonly');
  const url = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scopes}&state=${state}`;

  res.json({ url });
}));

/** GET /api/ghl/oauth/callback — handle GHL OAuth callback */
router.get('/api/ghl/oauth/callback', asyncHandler(async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError || !code) {
    res.redirect('/onboarding?error=oauth_denied');
    return;
  }

  // Validate OAuth state nonce to prevent CSRF
  const stateStr = String(state ?? '');
  const pending = pendingOAuthStates.get(stateStr);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingOAuthStates.delete(stateStr);
    res.redirect('/onboarding?error=oauth_denied');
    return;
  }
  pendingOAuthStates.delete(stateStr);

  // TODO: Exchange code for access token using pending.orgId,
  // store in connector_configs, then redirect to onboarding step 2.
  // For now, redirect back to onboarding.
  res.redirect('/onboarding');
}));

/** GET /api/ghl/locations — list discovered GHL locations for the onboarding wizard */
router.get('/api/ghl/locations', authenticate, asyncHandler(async (req, res) => {
  // TODO: Call GHL API to list locations using stored agency token.
  // For now, return empty list.
  res.json({ locations: [] });
}));

export default router;
