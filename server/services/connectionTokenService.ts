/**
 * connectionTokenService
 *
 * Handles encryption/decryption of OAuth tokens stored in integration_connections,
 * and transparent token refresh when tokens are expired or about to expire.
 */

import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrationConnections } from '../db/schema/index.js';
import { env } from '../lib/env.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
// Refresh tokens 5 minutes before they expire
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
// Current key version written into every new encrypted value.
// To rotate: set TOKEN_ENCRYPTION_KEY to a new 64-char hex value, move the old
// value to TOKEN_ENCRYPTION_KEY_V0, then bump this constant to 'k2'. Once all
// legacy ciphertexts have been re-encrypted you can remove TOKEN_ENCRYPTION_KEY_V0.
const CURRENT_KEY_VERSION = 'k1';

// ---------------------------------------------------------------------------
// Key registry — maps version identifiers to raw key buffers.
// Populated once at module load from environment variables.
// ---------------------------------------------------------------------------
const KEY_REGISTRY: Record<string, Buffer> = {};
if (!env.TOKEN_ENCRYPTION_KEY) {
  console.warn('[connectionTokenService] TOKEN_ENCRYPTION_KEY is not set — encryption/decryption will fail at runtime');
} else {
  KEY_REGISTRY[CURRENT_KEY_VERSION] = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex');
}
if (env.TOKEN_ENCRYPTION_KEY_V0) {
  KEY_REGISTRY['k0'] = Buffer.from(env.TOKEN_ENCRYPTION_KEY_V0, 'hex');
}

function getKeyForVersion(version: string): Buffer {
  const key = KEY_REGISTRY[version];
  if (!key) {
    throw { statusCode: 500, message: `Unknown encryption key version: ${version}` };
  }
  return key;
}

export const connectionTokenService = {
  /**
   * Encrypt a plaintext token for storage.
   * Returns a versioned string: k1:iv:authTag:ciphertext (all hex-encoded).
   * The key version prefix enables future rotation without re-encrypting all
   * existing values at once — simply add a new key and bump the version.
   */
  encryptToken(plaintext: string): string {
    const key = getKeyForVersion(CURRENT_KEY_VERSION);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${CURRENT_KEY_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  },

  /**
   * Decrypt a stored token string.
   * Handles both legacy format (iv:authTag:ciphertext) and versioned format
   * (k1:iv:authTag:ciphertext) for backward compatibility.
   */
  decryptToken(ciphertext: string): string {
    const parts = ciphertext.split(':');

    let version: string;
    let ivHex: string, authTagHex: string, encryptedHex: string;
    if (parts.length === 4 && parts[0].startsWith('k')) {
      // Versioned format: k1:iv:authTag:ciphertext
      [version, ivHex, authTagHex, encryptedHex] = parts;
    } else if (parts.length === 3) {
      // Legacy format: iv:authTag:ciphertext — assume current key version
      version = CURRENT_KEY_VERSION;
      [ivHex, authTagHex, encryptedHex] = parts;
      console.warn(JSON.stringify({ event: 'encryption:legacy_format_decrypt', hint: 'Value predates key versioning — re-encrypt to upgrade' }));
    } else {
      throw { statusCode: 500, message: 'Invalid encrypted token format' };
    }

    const key = getKeyForVersion(version);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    if (iv.length !== IV_LENGTH) {
      throw { statusCode: 500, message: 'Invalid encrypted token: wrong IV length' };
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw { statusCode: 500, message: 'Invalid encrypted token: wrong auth tag length' };
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    try {
      return decipher.update(encrypted) + decipher.final('utf8');
    } catch {
      console.error(JSON.stringify({ event: 'encryption:auth_tag_failure', keyVersion: version, hint: 'Key mismatch or data corruption' }));
      throw { statusCode: 500, message: 'Token decryption failed: integrity check failed' };
    }
  },

  /**
   * Get a usable access token for a connection, refreshing if needed.
   */
  async getAccessToken(connection: IntegrationConnection): Promise<string> {
    if (connection.authType === 'api_key') {
      // API keys are stored in secretsRef and don't expire
      if (!connection.secretsRef) {
        throw { statusCode: 400, message: `Connection ${connection.id} has no API key configured` };
      }
      return connectionTokenService.decryptToken(connection.secretsRef);
    }

    // OAuth2 flow: check expiry and refresh if needed
    const refreshed = await connectionTokenService.refreshIfExpired(connection);

    if (!refreshed.accessToken) {
      throw { statusCode: 400, message: `Connection ${refreshed.id} has no access token` };
    }

    return connectionTokenService.decryptToken(refreshed.accessToken);
  },

  /**
   * Refresh the token if it's expired or about to expire.
   * Returns the (possibly updated) connection record.
   */
  async refreshIfExpired(connection: IntegrationConnection): Promise<IntegrationConnection> {
    if (connection.authType !== 'oauth2') return connection;
    if (!connection.tokenExpiresAt) return connection;

    const expiresAt = new Date(connection.tokenExpiresAt).getTime();
    const now = Date.now();

    // Token still valid with buffer
    if (expiresAt > now + REFRESH_BUFFER_MS) return connection;

    // Need to refresh
    if (!connection.refreshToken) {
      // Update status to error since we can't refresh
      await db.update(integrationConnections)
        .set({ connectionStatus: 'error', updatedAt: new Date() })
        // guard-ignore-next-line: org-scoped-writes reason="connection object passed in by caller who obtained it via org-scoped query"
        .where(eq(integrationConnections.id, connection.id));
      throw { statusCode: 400, message: `Connection ${connection.id} token expired and no refresh token available` };
    }

    const decryptedRefreshToken = connectionTokenService.decryptToken(connection.refreshToken);
    const refreshed = await connectionTokenService.performTokenRefresh(
      connection.providerType,
      decryptedRefreshToken
    );

    const encryptedAccess = connectionTokenService.encryptToken(refreshed.accessToken);
    const encryptedRefresh = refreshed.refreshToken
      ? connectionTokenService.encryptToken(refreshed.refreshToken)
      : connection.refreshToken;

    const [updated] = await db.update(integrationConnections)
      .set({
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
        connectionStatus: 'active',
        updatedAt: new Date(),
      })
      // guard-ignore-next-line: org-scoped-writes reason="connection object passed in by caller who obtained it via org-scoped query"
      .where(eq(integrationConnections.id, connection.id))
      .returning();

    return updated;
  },

  /**
   * Provider-specific OAuth2 token refresh.
   * Extend this switch for each new provider.
   */
  async performTokenRefresh(
    provider: string,
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresInSeconds: number }> {
    switch (provider) {
      case 'gmail': {
        // Google OAuth2 token refresh
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: process.env.GOOGLE_CLIENT_ID ?? '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
          }),
        });
        if (!response.ok) {
          throw { statusCode: 400, message: `Gmail token refresh failed: ${response.status}` };
        }
        const data = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string };
        if (!data.access_token) {
          throw { statusCode: 400, message: 'Gmail token refresh returned no access token' };
        }
        return {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresInSeconds: data.expires_in ?? 3600,
        };
      }

      case 'hubspot': {
        const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: process.env.HUBSPOT_CLIENT_ID ?? '',
            client_secret: process.env.HUBSPOT_CLIENT_SECRET ?? '',
          }),
        });
        if (!response.ok) {
          throw { statusCode: 400, message: `HubSpot token refresh failed: ${response.status}` };
        }
        const data = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string };
        if (!data.access_token) {
          throw { statusCode: 400, message: 'HubSpot token refresh returned no access token' };
        }
        return {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresInSeconds: data.expires_in ?? 21600,
        };
      }

      case 'slack': {
        // Slack bot tokens don't typically expire, but user tokens can
        throw { statusCode: 400, message: 'Slack token refresh not yet implemented' };
      }

      default:
        throw { statusCode: 400, message: `Token refresh not supported for provider: ${provider}` };
    }
  },
};
