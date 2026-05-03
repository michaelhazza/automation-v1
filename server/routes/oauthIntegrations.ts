/**
 * OAuth2 integration routes — handles the auth-url generation and callback flow.
 * These routes are NOT subaccount-scoped at the middleware level because the
 * callback is a browser redirect from the OAuth provider (no JWT available).
 * Auth is enforced via a signed state JWT in both endpoints.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { authenticate, checkOrgPermission } from '../middleware/auth.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { OAUTH_PROVIDERS, getProviderClientId, getProviderClientSecret } from '../config/oauthProviders.js';
import { integrationConnectionService } from '../services/integrationConnectionService.js';
import { resumeFromIntegrationConnect } from '../services/agentResumeService.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
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
    const { provider, subaccountId, scope: connectionScope, returnPath, resumeToken, conversationId } = req.query as {
      provider: string;
      subaccountId?: string;
      scope?: string;
      returnPath?: string;
      resumeToken?: string;
      conversationId?: string;
    };

    const isOrgLevel = connectionScope === 'org';

    if (!provider || (!subaccountId && !isOrgLevel)) {
      throw Object.assign(new Error('provider and either subaccountId or scope=org are required'), { statusCode: 400 });
    }

    // Org-level OAuth requires org.connections.manage permission
    if (isOrgLevel) {
      const hasPermission = await checkOrgPermission(
        req.user!.id, req.orgId!, req.user!.role, ORG_PERMISSIONS.CONNECTIONS_MANAGE,
      );
      if (!hasPermission) {
        throw Object.assign(new Error('Forbidden: org.connections.manage permission required'), { statusCode: 403 });
      }
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

    // For subaccount-scoped connections, verify the subaccount belongs to the org
    // (also filters soft-deleted subaccounts via resolveSubaccount)
    if (subaccountId && !isOrgLevel) {
      await resolveSubaccount(subaccountId, req.orgId!);
    }

    // State JWT: signed nonce binding provider + scope + orgId for CSRF protection.
    // returnPath is the client-supplied path to redirect to after the callback
    // (e.g. /admin/subaccounts/:id/connections). Validated to be a relative path only.
    // Validate returnPath is a relative path to prevent open redirect.
    // Allow alphanumeric, slashes, hyphens, underscores, dots — but reject
    // path traversal (..) and anything that could form a protocol-relative URL (//).
    const safeReturnPath =
      returnPath &&
      /^\/[a-zA-Z0-9/._-]*$/.test(returnPath) &&
      !returnPath.includes('..') &&
      !returnPath.startsWith('//')
        ? returnPath
        : null;

    // Validate resumeToken is a non-empty opaque string (hex, no length constraint here)
    const safeResumeToken = resumeToken && typeof resumeToken === 'string' && /^[a-f0-9]{64}$/.test(resumeToken)
      ? resumeToken
      : undefined;
    // Validate conversationId is a UUID
    const safeConversationId = conversationId && typeof conversationId === 'string' && /^[0-9a-f-]{36}$/.test(conversationId)
      ? conversationId
      : undefined;

    const state = jwt.sign(
      {
        provider,
        subaccountId: isOrgLevel ? null : subaccountId,
        organisationId: req.orgId!,
        connectionScope: isOrgLevel ? 'org' : 'subaccount',
        returnPath: safeReturnPath,
        nonce: crypto.randomUUID(),
        ...(safeResumeToken ? { resumeToken: safeResumeToken } : {}),
        ...(safeConversationId ? { conversationId: safeConversationId } : {}),
      },
      env.JWT_SECRET,
      { expiresIn: '10m' },
    );

    // OAUTH_CALLBACK_BASE_URL is the publicly reachable URL Slack will POST back to
    // (e.g. an ngrok tunnel in local dev). APP_BASE_URL is where the browser ends up
    // after auth (always the local frontend). They differ only in local dev.
    const callbackBase = env.OAUTH_CALLBACK_BASE_URL || env.APP_BASE_URL;
    const callbackUrl = `${callbackBase}/api/integrations/oauth2/callback`;
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

    // Provider signalled an error (e.g. user denied consent).
    // OAuth providers include the state parameter in error responses, so attempt
    // to decode it to recover returnPath and send the user back to the origin page.
    if (oauthError) {
      let errorReturnPath: string | null = null;
      if (state) {
        try {
          const errorPayload = jwt.verify(state, env.JWT_SECRET) as { returnPath?: string | null };
          errorReturnPath = errorPayload.returnPath ?? null;
        } catch {
          // State invalid or expired — fall back to default
        }
      }
      const errorBase = errorReturnPath ?? '/settings/integrations';
      return res.redirect(`${appBase}${errorBase}?error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
      return res.redirect(`${appBase}/settings/integrations?error=missing_params`);
    }

    let payload: {
      provider: string;
      subaccountId: string | null;
      organisationId: string;
      connectionScope?: string;
      returnPath?: string | null;
      resumeToken?: string;
      conversationId?: string;
    };
    try {
      payload = jwt.verify(state, env.JWT_SECRET) as typeof payload;
    } catch {
      return res.redirect(`${appBase}/settings/integrations?error=invalid_state`);
    }

    const { provider, subaccountId, organisationId } = payload;
    const isOrgLevel = payload.connectionScope === 'org';
    const redirectBase = payload.returnPath
      || (isOrgLevel ? '/settings/org-connections' : '/settings/integrations');

    const config = OAUTH_PROVIDERS[provider];
    if (!config) {
      return res.redirect(`${appBase}${redirectBase}?error=unknown_provider`);
    }

    const clientId = getProviderClientId(provider);
    const clientSecret = getProviderClientSecret(provider);
    if (!clientId || !clientSecret) {
      return res.redirect(`${appBase}${redirectBase}?error=provider_not_configured`);
    }

    // Exchange authorization code for tokens — redirect_uri must exactly match what was
    // sent in the auth request, so use OAUTH_CALLBACK_BASE_URL here too.
    const callbackBase = env.OAUTH_CALLBACK_BASE_URL || env.APP_BASE_URL;
    const callbackUrl = `${callbackBase}/api/integrations/oauth2/callback`;
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
        return res.redirect(`${appBase}${redirectBase}?error=token_exchange_failed`);
      }

      tokenData = await tokenResponse.json();
    } catch (err) {
      console.error(`[OAuth] Token exchange error for ${provider}:`, err);
      return res.redirect(`${appBase}${redirectBase}?error=token_exchange_error`);
    }

    const claimedAt = Math.floor(Date.now() / 1000);
    const scopes = tokenData.scope
      ? tokenData.scope.split(/[\s,]+/)
      : config.scopes;

    try {
      await integrationConnectionService.upsertFromOAuth({
        subaccountId: isOrgLevel ? null : subaccountId,
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
      return res.redirect(`${appBase}${redirectBase}?error=storage_failed`);
    }

    // Popup / agent-resume flow: if the state contained a resumeToken, this
    // was a popup-based connect triggered by an integration_card. Resume the
    // blocked agent run server-side and render a self-closing popup page
    // instead of the normal redirect.
    if (payload.resumeToken) {
      try {
        await resumeFromIntegrationConnect({
          resumeToken: payload.resumeToken,
          organisationId,
          conversationId: payload.conversationId,
        });
      } catch (err) {
        // Non-fatal — the integration is connected, even if the run resume
        // fails (e.g. token expired). The popup will still close.
        console.warn('[OAuth] run resume failed after connect:', err);
      }

      return res.send(`<!DOCTYPE html>
<html>
<head><title>Connected</title></head>
<body>
<script>
  try { window.opener && window.opener.postMessage({ type: 'oauth_success' }, window.location.origin); } catch (e) {}
  window.close();
</script>
<p>Connected! You may close this window.</p>
</body>
</html>`);
    }

    return res.redirect(`${appBase}${redirectBase}?connected=${provider}`);
  }),
);

// ── NEW standalone handler — GHL agency OAuth only ────────────────────────
// Separate route from /api/integrations/oauth2/callback.
// GHL state = raw nonce (ghlOAuthStateStore); no JWT verification here.
router.get('/api/oauth/callback', asyncHandler(async (req, res) => {
  const appBase = env.APP_BASE_URL;
  const { code, state } = req.query as Record<string, string | undefined>;

  // ghl.oauth.callback_failure logger helper — mandatory event per spec §5.9.
  // orgId is null until the state nonce is consumed; companyId is null until
  // the token exchange returns.
  const logCallbackFailure = (
    reason: string,
    orgId: string | null,
    companyId: string | null,
  ): void => {
    logger.warn('ghl.oauth.callback_failure', {
      event: 'ghl.oauth.callback_failure',
      provider: 'ghl',
      orgId,
      companyId,
      locationId: null,
      result: 'failure',
      error: { code: reason, message: reason },
    });
  };

  if (!code || !state) {
    logCallbackFailure('invalid_callback', null, null);
    return res.redirect(`${appBase}/onboarding?error=invalid_callback`);
  }

  const { consumeGhlOAuthState } = await import('../lib/ghlOAuthStateStore.js');
  const ghlOrgId = consumeGhlOAuthState(state);
  if (!ghlOrgId) {
    logCallbackFailure('invalid_state', null, null);
    return res.redirect(`${appBase}/onboarding?error=invalid_state`);
  }

  const callbackBase = env.OAUTH_CALLBACK_BASE_URL || env.APP_BASE_URL;
  const redirectUri = `${callbackBase}/api/oauth/callback`;

  const { exchangeGhlAuthCode } = await import('../services/ghlAgencyOauthService.js');
  const tokenData = await exchangeGhlAuthCode(code, redirectUri);
  if (!tokenData) {
    logCallbackFailure('token_exchange_failed', ghlOrgId, null);
    return res.redirect(`${appBase}/onboarding?error=token_exchange_failed`);
  }

  const { validateAgencyTokenResponse, computeAgencyTokenExpiresAt, parseGhlScope } =
    await import('../services/ghlAgencyOauthServicePure.js');

  try {
    validateAgencyTokenResponse(tokenData);
  } catch {
    logCallbackFailure('token_validation_failed', ghlOrgId, tokenData.companyId ?? null);
    return res.redirect(`${appBase}/onboarding?error=token_validation_failed`);
  }

  const claimedAt = new Date();
  const expiresAt = computeAgencyTokenExpiresAt(claimedAt, tokenData.expires_in);
  const scope = parseGhlScope(tokenData.scope).join(' ');

  const { connectorConfigService } = await import('../services/connectorConfigService.js');
  let connection;
  try {
    connection = await connectorConfigService.upsertAgencyConnection({
      orgId: ghlOrgId,
      companyId: tokenData.companyId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scope,
    });
  } catch (err: unknown) {
    const e = err as { statusCode?: number };
    if (e.statusCode === 409) {
      logCallbackFailure('agency_already_installed', ghlOrgId, tokenData.companyId);
      return res.redirect(`${appBase}/onboarding?error=agency_already_installed`);
    }
    logCallbackFailure('storage_failed', ghlOrgId, tokenData.companyId);
    return res.redirect(`${appBase}/onboarding?error=storage_failed`);
  }

  logger.info('ghl.oauth.callback_success', {
    event: 'ghl.oauth.callback_success',
    provider: 'ghl',
    orgId: ghlOrgId,
    companyId: tokenData.companyId,
    locationId: null,
    result: 'success',
    error: null,
  });

  // Fire sub-account enumeration + enrolment. Best-effort — connection stays active
  // even if enumeration fails. Hard timeout: 15s. autoEnrolAgencyLocations is added
  // in Task 9; imported via unknown cast to avoid a typecheck error before that chunk lands.
  try {
    const svc = await import('../services/ghlAgencyOauthService.js') as unknown as {
      autoEnrolAgencyLocations?: (orgId: string, connection: unknown, label: string) => Promise<void>;
    };
    if (typeof svc.autoEnrolAgencyLocations === 'function') {
      await Promise.race([
        svc.autoEnrolAgencyLocations(ghlOrgId, connection, `oauth_callback:${connection.id}`),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('autoEnrolAgencyLocations timeout')), 15_000),
        ),
      ]);
    }
  } catch (err) {
    logger.warn('ghl.oauth.callback_enrol_failed', {
      event: 'ghl.oauth.callback_enrol_failed',
      provider: 'ghl',
      orgId: ghlOrgId,
      companyId: tokenData.companyId,
      locationId: null,
      result: 'failure',
      error: { message: String(err) },
    });
  }

  return res.redirect(`${appBase}/onboarding?connected=ghl`);
}));
// ── End GHL agency callback ───────────────────────────────────────────────

export default router;
