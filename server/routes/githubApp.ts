/**
 * GitHub App installation routes — handles the GitHub App install flow.
 *
 * Unlike OAuth Apps (which grant broad `repo` access to ALL repos), GitHub Apps
 * let clients choose exactly which repos to share. The platform registers ONE
 * GitHub App; each client "installs" it on their org/repos.
 *
 * Flow:
 *   1. GET /api/integrations/github/install-url → redirect URL to install the app
 *   2. User installs on GitHub, selects repos
 *   3. GitHub redirects to GET /api/integrations/github/callback with installation_id
 *   4. We store the installation_id on the subaccount's integration_connections
 *   5. When we need API access, we mint short-lived installation tokens on demand
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccounts, integrationConnections } from '../db/schema/index.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getGitHubAppConfig } from '../config/oauthProviders.js';
import { connectionTokenService } from '../services/connectionTokenService.js';
import { env } from '../lib/env.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/integrations/github/install-url
// Returns the GitHub App installation URL for the authenticated user.
// ---------------------------------------------------------------------------

router.get(
  '/api/integrations/github/install-url',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId, label } = req.query as { subaccountId: string; label?: string };

    if (!subaccountId) {
      throw Object.assign(new Error('subaccountId is required'), { statusCode: 400 });
    }

    const appConfig = getGitHubAppConfig();
    if (!appConfig) {
      throw Object.assign(
        new Error('GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_SLUG.'),
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

    // State JWT: signed nonce binding subaccountId + orgId for CSRF protection
    const state = jwt.sign(
      {
        provider: 'github',
        subaccountId,
        organisationId: req.orgId!,
        label: label || null,
        nonce: crypto.randomUUID(),
      },
      env.JWT_SECRET,
      { expiresIn: '10m' },
    );

    // GitHub App installation URL
    const url = `https://github.com/apps/${appConfig.slug}/installations/new?state=${encodeURIComponent(state)}`;

    res.json({ url, state });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/integrations/github/callback
// Handles GitHub redirect after app installation.
// GitHub sends: installation_id, setup_action, state
// ---------------------------------------------------------------------------

router.get(
  '/api/integrations/github/callback',
  asyncHandler(async (req, res) => {
    const { installation_id, setup_action, state } = req.query as {
      installation_id?: string;
      setup_action?: string;
      state?: string;
    };

    const appBase = env.APP_BASE_URL;

    if (!installation_id || !state) {
      return res.redirect(`${appBase}/settings/integrations?error=missing_params`);
    }

    let payload: { provider: string; subaccountId: string; organisationId: string; label: string | null };
    try {
      payload = jwt.verify(state, env.JWT_SECRET) as typeof payload;
    } catch {
      return res.redirect(`${appBase}/settings/integrations?error=invalid_state`);
    }

    const { subaccountId, organisationId, label } = payload;

    const appConfig = getGitHubAppConfig();
    if (!appConfig) {
      return res.redirect(`${appBase}/settings/integrations?error=provider_not_configured`);
    }

    // Fetch installation details from GitHub API to get account info
    let installationMeta: { account: { login: string; type: string }; repository_selection: string } | null = null;
    try {
      const appJwt = mintAppJwt(appConfig);
      const metaRes = await fetch(`https://api.github.com/app/installations/${installation_id}`, {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github.v3+json',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (metaRes.ok) {
        installationMeta = await metaRes.json() as typeof installationMeta;
      }
    } catch {
      // Non-fatal — we can still store the installation
    }

    const displayName = installationMeta
      ? `${installationMeta.account.login} (${installationMeta.account.type})`
      : `GitHub Installation ${installation_id}`;

    // Store (or update) the connection
    try {
      await db
        .insert(integrationConnections)
        .values({
          subaccountId,
          organisationId,
          providerType: 'github',
          authType: 'github_app',
          connectionStatus: 'active',
          label: label || null,
          displayName,
          configJson: {
            installationId: Number(installation_id),
            setupAction: setup_action,
            accountLogin: installationMeta?.account?.login ?? null,
            accountType: installationMeta?.account?.type ?? null,
            repositorySelection: installationMeta?.repository_selection ?? null,
          },
          oauthStatus: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            integrationConnections.subaccountId,
            integrationConnections.providerType,
            integrationConnections.label,
          ],
          set: {
            connectionStatus: 'active',
            displayName,
            configJson: {
              installationId: Number(installation_id),
              setupAction: setup_action,
              accountLogin: installationMeta?.account?.login ?? null,
              accountType: installationMeta?.account?.type ?? null,
              repositorySelection: installationMeta?.repository_selection ?? null,
            },
            oauthStatus: 'active',
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      console.error('[GitHub App] Failed to store installation connection:', err);
      return res.redirect(`${appBase}/settings/integrations?error=storage_failed`);
    }

    return res.redirect(`${appBase}/settings/integrations?connected=github`);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/integrations/github/repos
// List repos accessible via a GitHub App installation connection.
// ---------------------------------------------------------------------------

router.get(
  '/api/integrations/github/repos',
  authenticate,
  asyncHandler(async (req, res) => {
    const { connectionId } = req.query as { connectionId: string };

    if (!connectionId) {
      throw Object.assign(new Error('connectionId is required'), { statusCode: 400 });
    }

    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.organisationId, req.orgId!),
          eq(integrationConnections.providerType, 'github'),
          eq(integrationConnections.connectionStatus, 'active'),
        ),
      )
      .limit(1);

    if (!conn) {
      throw Object.assign(new Error('GitHub connection not found'), { statusCode: 404 });
    }

    const config = conn.configJson as { installationId?: number } | null;
    if (!config?.installationId) {
      throw Object.assign(new Error('Connection has no installation ID'), { statusCode: 400 });
    }

    const token = await getInstallationAccessToken(config.installationId);

    const repoRes = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!repoRes.ok) {
      throw Object.assign(new Error('Failed to fetch repos from GitHub'), { statusCode: 502 });
    }

    const data = await repoRes.json() as { repositories: Array<{ id: number; full_name: string; private: boolean; html_url: string; default_branch: string }> };

    res.json({
      repos: data.repositories.map(r => ({
        id: r.id,
        fullName: r.full_name,
        private: r.private,
        htmlUrl: r.html_url,
        defaultBranch: r.default_branch,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Helpers — GitHub App JWT and installation token minting
// ---------------------------------------------------------------------------

/**
 * Mint a short-lived JWT signed with the GitHub App's private key.
 * Used to authenticate as the app itself (not as an installation).
 */
function mintAppJwt(config: { appId: string; privateKey: string }): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60, // clock drift buffer
      exp: now + 600, // 10 minutes max
      iss: config.appId,
    },
    config.privateKey,
    { algorithm: 'RS256' },
  );
}

/**
 * Get a short-lived installation access token for a GitHub App installation.
 * These tokens are valid for 1 hour and scoped to the repos the user selected.
 */
export async function getInstallationAccessToken(installationId: number): Promise<string> {
  const appConfig = getGitHubAppConfig();
  if (!appConfig) {
    throw Object.assign(
      new Error('GitHub App is not configured'),
      { statusCode: 503 },
    );
  }

  const appJwt = mintAppJwt(appConfig);

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw Object.assign(
      new Error(`Failed to get GitHub installation token: ${errText}`),
      { statusCode: 502, errorCode: 'environment_failure' },
    );
  }

  const data = await res.json() as { token: string; expires_at: string };
  return data.token;
}

export default router;
