// ---------------------------------------------------------------------------
// OAuth Provider Configs — centralised registry for all supported OAuth2 providers.
// Activepieces-inspired: one config object per provider, consumed by auth-url
// generation, callback handler, and token refresh.
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

  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org'],
  },

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
};

/** Env var prefix pattern: OAUTH_GMAIL_CLIENT_ID, OAUTH_GITHUB_CLIENT_SECRET, … */
export function getProviderClientId(provider: string): string | undefined {
  return process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_ID`];
}

export function getProviderClientSecret(provider: string): string | undefined {
  return process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_SECRET`];
}
