/**
 * OAuth2 integration routes — handles the auth-url generation and callback flow.
 * These routes are NOT subaccount-scoped at the middleware level because the
 * callback is a browser redirect from the OAuth provider (no JWT available).
 * Auth is enforced via a signed state JWT in both endpoints.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { OAUTH_PROVIDERS, getProviderClientId, getProviderClientSecret } from '../config/oauthProviders.js';
import { integrationConnectionService } from '../services/integrationConnectionService.js';
import { env } from '../lib/env.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/integrations/oauth2/auth-url
// Returns the provider authorization URL and state JWT.
// ---------------------------------------------------------------------------

router.get(
  '/api/integrations/oauth2/auth-url',
  authenticate,
  asyncHandler(async (req, res) => {
    const { provider, subaccountId } = req.query as { provider: string; subaccountId: string };

    if (!provider || !subaccountId) {
      throw Object.assign(new Error('provider and subaccountId are required'), { statusCode: 400 });
    }

    const config = OAUTH_PROVIDERS[provider];
    if (!config) {
      throw Object.assign(new Error(`Unknown provider: ${provider}`), { statusCode: 400 });
    }

    const clientId = getProviderClientId(provider);
    if (!clientId) {
      throw Object.assign(
        new Error(`OAUTH_${provider.toUpperCase()}_CLIENT_ID is not configured`),
        { statusCode: 503 },
      );
    }

    // Verify the subaccount belongs to the authenticated org
    const [subaccount] = await db
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(
        and(
          eq(subaccounts.id, subaccountId),
          eq(subaccounts.organisationId, req.orgId!),
        ),
      )
      .limit(1);

    if (!subaccount) {
      throw Object.assign(new Error('Subaccount not found'), { statusCode: 404 });
    }

    // State JWT: signed nonce binding provider + subaccountId + orgId for CSRF protection
    const state = jwt.sign(
      {
        provider,
        subaccountId,
        organisationId: req.orgId!,
        nonce: crypto.randomUUID(),
      },
      env.JWT_SECRET,
      { expiresIn: '10m' },
    );

    const callbackUrl = `${env.APP_BASE_URL}/api/integrations/oauth2/callback`;
    const url = new URL(config.authUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', config.scopes.join(' '));
    url.searchParams.set('state', state);

    for (const [k, v] of Object.entries(config.extra ?? {})) {
      url.searchParams.set(k, v);
    }

    res.json({ url: url.toString(), state });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/integrations/oauth2/callback
// Handles the provider redirect, exchanges code for tokens, stores encrypted.
// Not authenticated via JWT — auth is implicit via state JWT verification.
// ---------------------------------------------------------------------------

router.get(
  '/api/integrations/oauth2/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    const appBase = env.APP_BASE_URL;

    // Provider signalled an error (e.g. user denied consent)
    if (oauthError) {
      return res.redirect(`${appBase}/settings/integrations?error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
      return res.redirect(`${appBase}/settings/integrations?error=missing_params`);
    }

    let payload: { provider: string; subaccountId: string; organisationId: string };
    try {
      payload = jwt.verify(state, env.JWT_SECRET) as typeof payload;
    } catch {
      return res.redirect(`${appBase}/settings/integrations?error=invalid_state`);
    }

    const { provider, subaccountId, organisationId } = payload;
    const config = OAUTH_PROVIDERS[provider];
    if (!config) {
      return res.redirect(`${appBase}/settings/integrations?error=unknown_provider`);
    }

    const clientId = getProviderClientId(provider);
    const clientSecret = getProviderClientSecret(provider);
    if (!clientId || !clientSecret) {
      return res.redirect(`${appBase}/settings/integrations?error=provider_not_configured`);
    }

    // Exchange authorization code for tokens
    const callbackUrl = `${appBase}/api/integrations/oauth2/callback`;
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      client_id: clientId,
      client_secret: clientSecret,
    });

    let tokenData: {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    try {
      const tokenResponse = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: tokenBody.toString(),
        signal: AbortSignal.timeout(20_000),
      });

      if (!tokenResponse.ok) {
        const errText = await tokenResponse.text().catch(() => tokenResponse.statusText);
        console.error(`[OAuth] Token exchange failed for ${provider}:`, errText);
        return res.redirect(`${appBase}/settings/integrations?error=token_exchange_failed`);
      }

      tokenData = await tokenResponse.json();
    } catch (err) {
      console.error(`[OAuth] Token exchange error for ${provider}:`, err);
      return res.redirect(`${appBase}/settings/integrations?error=token_exchange_error`);
    }

    const claimedAt = Math.floor(Date.now() / 1000);
    const scopes = tokenData.scope
      ? tokenData.scope.split(/[\s,]+/)
      : config.scopes;

    try {
      await integrationConnectionService.upsertFromOAuth({
        subaccountId,
        organisationId,
        providerType: provider as IntegrationConnection['providerType'],
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        claimedAt,
        expiresIn: tokenData.expires_in ?? 3600,
        tokenUrl: config.tokenUrl,
        clientId,
        clientSecret,
        scopes,
      });
    } catch (err) {
      console.error(`[OAuth] Failed to store ${provider} connection:`, err);
      return res.redirect(`${appBase}/settings/integrations?error=storage_failed`);
    }

    return res.redirect(`${appBase}/settings/integrations?connected=${provider}`);
  }),
);

export default router;
