// ---------------------------------------------------------------------------
// OAuth Provider Configs — centralised registry for all supported OAuth2 providers.
// Activepieces-inspired: one config object per provider, consumed by auth-url
// generation, callback handler, and token refresh.
//
// GitHub uses the GitHub App (installation) model instead of OAuth Apps.
// This gives clients fine-grained, per-repo access control.
// ---------------------------------------------------------------------------

export interface OAuthProviderConfig {
  /** Authorization endpoint — browser is sent here */
  authUrl: string;
  /** Token endpoint — server-side code exchange + refresh calls */
  tokenUrl: string;
  /** Default OAuth scopes */
  scopes: string[];
  /** Extra query params appended to the auth URL (e.g. access_type=offline) */
  extra?: Record<string, string>;
  /** True if PKCE is required (some providers mandate it) */
  pkce?: boolean;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  gmail: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
    // Forces refresh_token issuance even after the user has previously consented
    extra: { access_type: 'offline', prompt: 'consent' },
  },

  // GitHub is handled via GitHub App installation flow, not OAuth.
  // See server/routes/githubApp.ts for the installation endpoints.

  hubspot: {
    authUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    scopes: ['contacts', 'content', 'deals'],
  },

  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read', 'users:read'],
  },

  ghl: {
    authUrl: 'https://marketplace.leadconnectorhq.com/oauth/chooselocation',
    tokenUrl: 'https://services.leadconnectorhq.com/oauth/token',
    scopes: ['contacts.readonly', 'contacts.write', 'opportunities.readonly'],
  },

  teamwork: {
    authUrl: 'https://www.teamwork.com/launchpad/login',
    tokenUrl: 'https://www.teamwork.com/launchpad/v1/token.json',
    // TODO: Teamwork Desk scopes must be configured before production use.
    // See https://apidocs.teamwork.com/docs/teamwork-rest-api for available scopes.
    scopes: [],
  },
};

// ---------------------------------------------------------------------------
// GitHub App Configuration
// Uses the GitHub App (installation) model for fine-grained per-repo access.
// Clients install the app on their GitHub org and choose which repos to share.
//
// Required env vars:
//   GITHUB_APP_ID          — numeric App ID from GitHub App settings
//   GITHUB_APP_PRIVATE_KEY — PEM private key (base64-encoded in env for Replit)
//   GITHUB_APP_SLUG        — app slug for installation URL
//   GITHUB_APP_WEBHOOK_SECRET — optional, for verifying webhook payloads
// ---------------------------------------------------------------------------

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  slug: string;
  webhookSecret?: string;
}

export function getGitHubAppConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
  const slug = process.env.GITHUB_APP_SLUG;

  if (!appId || !privateKeyRaw || !slug) return null;

  // Support base64-encoded PEM (easier to store in env vars / Replit secrets)
  const privateKey = privateKeyRaw.startsWith('-----')
    ? privateKeyRaw
    : Buffer.from(privateKeyRaw, 'base64').toString('utf8');

  return {
    appId,
    privateKey,
    slug,
    webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET,
  };
}

/** Env var prefix pattern: OAUTH_GMAIL_CLIENT_ID, OAUTH_HUBSPOT_CLIENT_SECRET, … */
export function getProviderClientId(provider: string): string | undefined {
  return process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_ID`];
}

export function getProviderClientSecret(provider: string): string | undefined {
  return process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_SECRET`];
}
