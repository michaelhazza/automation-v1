/**
 * connectionTokenService
 *
 * Handles encryption/decryption of OAuth tokens stored in integration_connections,
 * and transparent token refresh when tokens are expired or about to expire.
 */

import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { integrationConnections } from '../db/schema/index.js';
import { mcpServerConfigs } from '../db/schema/mcpServerConfigs.js';
import { env } from '../lib/env.js';
import { withBackoff } from '../lib/withBackoff.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';
import { getRefreshBufferMs } from './connectionTokenServicePure.js';
import { getOrgTxContext } from '../instrumentation.js';
import { auditEvent } from '../../shared/types/securityAuditEvents.js';
import { AppError } from '../lib/errors.js';
import { recordSecurityEvent, SECURITY_AUDIT_SENTINEL_ORG_ID } from './securityAuditService.js';

export { validateEncryptionKeyOrThrow } from './connectionTokenValidation.js';

// ─── Phase 3 D.3: principal-context discipline helpers ────────────────────────

function trimmedStackTrace(): string {
  return (new Error().stack ?? '').split('\n').slice(1, 6).join('\n');
}

let systemWorkerContextFlag = false;

/**
 * Set by worker bootstrap to indicate execution inside a pg-boss worker or
 * known internal service. A null principal is only allowed inside verified
 * system contexts (isSystemContext() === true).
 */
export function setSystemWorkerContext(active: boolean): void {
  systemWorkerContextFlag = active;
}

function isSystemContext(): boolean {
  return systemWorkerContextFlag;
}

/**
 * Returns the current principal org ID from the ALS context:
 *   - undefined: no ALS context active (suspicious — outside any withOrgTx)
 *   - null:      ALS context present but org-less (system/worker flows)
 *   - string:    the tenant org ID of the current request/job
 */
function getPrincipalOrgId(): string | null | undefined {
  const ctx = getOrgTxContext();
  if (ctx === undefined) return undefined;
  return ctx.organisationId ?? null;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
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

    // ─── Phase 3 D.3: principal-context discipline ────────────────────────────
    const principalOrgId = getPrincipalOrgId();

    if (principalOrgId === undefined) {
      await recordSecurityEvent({
        event:          auditEvent.security.missingPrincipalContext,
        organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
        meta: { connectionId: connection.id, connectionOrgId: connection.organisationId, callerStack: trimmedStackTrace() },
      });
      throw new AppError({
        code:       'MISSING_PRINCIPAL_CONTEXT',
        statusCode: 500,
        message:    'Principal context not set in ALS — refusing token refresh',
        context:    { connectionId: connection.id, connectionOrgId: connection.organisationId },
      });
    }
    // principalOrgId === null → system flow (pg-boss workers, internal services) — allowed if isSystemContext()
    if (principalOrgId === null && !isSystemContext()) {
      await recordSecurityEvent({
        event:          auditEvent.security.missingPrincipalContext,
        organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
        meta: { connectionId: connection.id, connectionOrgId: connection.organisationId, reason: 'null_principal_outside_system_context', callerStack: trimmedStackTrace() },
      });
      throw new AppError({
        code:       'MISSING_PRINCIPAL_CONTEXT',
        statusCode: 500,
        message:    'Null principal outside system context — refusing token refresh',
        context:    { connectionId: connection.id, connectionOrgId: connection.organisationId },
      });
    }
    if (principalOrgId !== null && principalOrgId !== connection.organisationId) {
      await recordSecurityEvent({
        event:          auditEvent.security.crossTenantAttempt,
        organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
        meta: { connectionId: connection.id, connectionOrgId: connection.organisationId, principalOrgId, attemptedOperation: 'token_refresh' },
      });
      throw new AppError({
        code:       'CROSS_TENANT_TOKEN_REFRESH',
        statusCode: 403,
        message:    'Cross-tenant token refresh blocked',
        context:    { connectionOrgId: connection.organisationId, principalOrgId },
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const expiresAt = new Date(connection.tokenExpiresAt).getTime();
    const now = Date.now();

    // Token still valid with per-provider buffer
    if (expiresAt > now + getRefreshBufferMs(connection.providerType)) return connection;

    // Need to refresh
    if (!connection.refreshToken) {
      // Update status to error since we can't refresh
      await getOrgScopedDb('connectionTokenService.refreshIfExpired').update(integrationConnections)
        .set({ connectionStatus: 'error', updatedAt: new Date() })
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

    const [updated] = await getOrgScopedDb('connectionTokenService.refreshIfExpired').update(integrationConnections)
      .set({
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
        connectionStatus: 'active',
        updatedAt: new Date(),
      })
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

      case 'stripe_agent': {
        // Stripe Connect SPT rotation via platform-level secret key.
        // Uses POST /v1/ephemeral_keys with Stripe-Account header set to the
        // connected account ID. The 'refreshToken' stored on the connection row
        // is the Stripe connected account ID (acct_...) — stable across refreshes.
        // Bypasses per-connection clientIdEnc/clientSecretEnc/tokenUrl per §7.4.
        const platformKey = process.env.STRIPE_PLATFORM_SECRET_KEY ?? '';
        if (!platformKey) {
          throw { statusCode: 500, message: 'STRIPE_PLATFORM_SECRET_KEY is not configured' };
        }
        const connectedAccountId = refreshToken;
        const result = await withBackoff(
          async () => {
            const response = await fetch('https://api.stripe.com/v1/ephemeral_keys', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${platformKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Stripe-Account': connectedAccountId,
                'Stripe-Version': '2024-06-20',
              },
              body: new URLSearchParams({
                customer: connectedAccountId,
              }),
            });
            if (!response.ok) {
              const body = await response.text().catch(() => response.statusText);
              throw { statusCode: response.status, message: `Stripe SPT refresh failed: ${body}` };
            }
            const data = await response.json() as { secret?: string; expires?: number };
            if (!data.secret) {
              throw { statusCode: 500, message: 'Stripe SPT refresh returned no secret' };
            }
            return data;
          },
          {
            label: 'connectionTokenService.stripe_agent.refresh',
            maxAttempts: 3,
            isRetryable: (err: unknown) => {
              const e = err as { statusCode?: number };
              return typeof e.statusCode === 'number' && e.statusCode >= 500;
            },
            correlationId: connectedAccountId,
            runId: 'spt_refresh',
          },
        );
        return {
          accessToken: result.secret!,
          // refreshToken is the connected account ID — stable, pass it back unchanged
          refreshToken: connectedAccountId,
          expiresInSeconds: result.expires
            ? Math.max(0, result.expires - Math.floor(Date.now() / 1000))
            : 3600,
        };
      }

      default:
        throw { statusCode: 400, message: `Token refresh not supported for provider: ${provider}` };
    }
  },

  /**
   * Test connectivity for a connection by id (integration_connections OR mcp_server_configs).
   * Spec §4.9: always returns 200, monotonic 10s timeout, structured error.code drawn from
   * the closed enum { TIMEOUT, AUTH_FAILED, NETWORK_ERROR, PROVIDER_ERROR }.
   *
   * Connection-not-found is a routing error, not a test outcome — returns notFound:true
   * so the route can map it to a 404 instead of a 200 with a fake code.
   */
  async testConnection(
    { id, organisationId }: { id: string; organisationId: string },
  ): Promise<
    | {
        status: 'ok' | 'failed';
        latencyMs: number;
        testedAt: string;
        error?: { code: 'TIMEOUT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR'; message: string };
        capabilities?: string[];
      }
    | { notFound: true }
  > {
    const TIMEOUT_MS = 10_000;
    const testedAt = new Date().toISOString();
    const start = process.hrtime.bigint();

    const elapsed = (): number =>
      Number(process.hrtime.bigint() - start) / 1_000_000;

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<'timeout'>(resolve => {
      timeoutHandle = setTimeout(() => resolve('timeout'), TIMEOUT_MS);
    });
    const clearTimer = (): void => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

    try {
      // Look up the connection — integration or MCP. Filter by (id, organisationId)
      // in SQL (defence-in-depth per DEVELOPMENT_GUIDELINES §1) so the row never
      // crosses tenant boundaries even if the request runs outside an RLS-scoped tx.
      const testScopedDb = getOrgScopedDb('connectionTokenService.testConnection');
      const [icRow] = await testScopedDb.select()
        .from(integrationConnections)
        .where(and(
          eq(integrationConnections.id, id),
          eq(integrationConnections.organisationId, organisationId),
        ))
        .limit(1);

      if (icRow) {
        // Integration connection test
        const testResult = await Promise.race<'ok' | 'timeout'>([
          (async (): Promise<'ok'> => {
            if (icRow.authType === 'api_key') {
              if (!icRow.secretsRef) {
                throw { authFailed: true, message: 'No API key configured.' };
              }
            } else if (icRow.authType === 'oauth2') {
              const hasToken = !!(icRow.accessToken || icRow.refreshToken);
              if (!hasToken) {
                throw { authFailed: true, message: 'No OAuth token stored.' };
              }
              if (icRow.tokenExpiresAt && new Date(icRow.tokenExpiresAt) < new Date()) {
                if (!icRow.refreshToken) {
                  throw { authFailed: true, message: 'Access token expired and no refresh token available.' };
                }
              }
            }
            return 'ok';
          })(),
          timeoutPromise,
        ]);

        if (testResult === 'timeout') {
          return {
            status: 'failed',
            latencyMs: Math.round(elapsed()),
            testedAt,
            error: { code: 'TIMEOUT', message: 'Provider did not respond within 10s.' },
          };
        }

        return { status: 'ok', latencyMs: Math.round(elapsed()), testedAt };
      }

      // Try MCP server config (same dual-filter pattern as above).
      const [mcpRow] = await testScopedDb.select()
        .from(mcpServerConfigs)
        .where(and(
          eq(mcpServerConfigs.id, id),
          eq(mcpServerConfigs.organisationId, organisationId),
        ))
        .limit(1);

      if (mcpRow) {
        if (mcpRow.transport === 'http' && mcpRow.endpointUrl) {
          const testResult = await Promise.race<'ok' | 'timeout'>([
            (async (): Promise<'ok'> => {
              const response = await fetch(mcpRow.endpointUrl!, {
                method: 'HEAD',
                signal: AbortSignal.timeout(9_000),
              });
              if (response.status === 401 || response.status === 403) {
                throw { authFailed: true, message: `MCP server returned ${response.status}.` };
              }
              if (!response.ok) {
                throw { providerError: true, message: `MCP server returned ${response.status}.` };
              }
              return 'ok';
            })(),
            timeoutPromise,
          ]);

          if (testResult === 'timeout') {
            return {
              status: 'failed',
              latencyMs: Math.round(elapsed()),
              testedAt,
              error: { code: 'TIMEOUT', message: 'Provider did not respond within 10s.' },
            };
          }

          const capabilities = mcpRow.discoveredToolsJson
            ? mcpRow.discoveredToolsJson.map(t => t.name)
            : undefined;

          return { status: 'ok', latencyMs: Math.round(elapsed()), testedAt, capabilities };
        }

        // stdio or no endpoint URL — report status from last known state.
        // lastError is upstream text; do not forward it (could leak secrets / URLs).
        if (mcpRow.status === 'error') {
          return {
            status: 'failed',
            latencyMs: Math.round(elapsed()),
            testedAt,
            error: { code: 'PROVIDER_ERROR', message: 'MCP server is in error state.' },
          };
        }

        return { status: 'ok', latencyMs: Math.round(elapsed()), testedAt };
      }

      // Not in either table — routing error, surfaced as 404 by the route.
      return { notFound: true };
    } catch (err: unknown) {
      const e = err as { authFailed?: boolean; providerError?: boolean; name?: string; message?: string };
      // Map internal throw shapes onto the closed enum:
      //   { authFailed: true }    → AUTH_FAILED  (missing/expired credentials, 401/403 from provider)
      //   { providerError: true } → PROVIDER_ERROR (5xx, 4xx non-auth, malformed response)
      //   AbortError / fetch network errors → NETWORK_ERROR
      //   anything else → PROVIDER_ERROR (catch-all stays inside the closed enum)
      let code: 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR';
      let message: string;
      if (e.authFailed) {
        code = 'AUTH_FAILED';
        message = e.message ?? 'Authentication failed.';
      } else if (
        e.name === 'AbortError' ||
        e.name === 'TypeError' ||
        /(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_|TLS|fetch failed)/i.test(e.message ?? '')
      ) {
        code = 'NETWORK_ERROR';
        message = 'Network error contacting provider.';
      } else {
        code = 'PROVIDER_ERROR';
        message = e.providerError ? (e.message ?? 'Provider error.') : 'Provider error.';
      }
      return {
        status: 'failed',
        latencyMs: Math.round(elapsed()),
        testedAt,
        error: { code, message },
      };
    } finally {
      clearTimer();
    }
  },
};
