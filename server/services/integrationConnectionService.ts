import { eq, and, sql, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrationConnections, subaccounts } from '../db/schema/index.js';
import { connectionTokenService } from './connectionTokenService.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

// ---------------------------------------------------------------------------
// Connection Resolution Contract
//
// When resolving a connection for execution, the precedence order is:
//   1. Exact subaccount match — connection.subaccountId === target subaccountId
//   2. Org-level fallback    — connection.subaccountId IS NULL, same org
//   3. Error                 — no active connection found
//
// This means subaccount-specific connections always override org-level ones.
// Org-level connections act as shared defaults across all subaccounts.
//
// Both scopes enforce:
//   - connection.organisationId === caller's orgId (tenant isolation)
//   - connection.connectionStatus === 'active'
//
// Labels: the same label can exist at both org and subaccount level.
// Resolution always picks the most specific scope first.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Integration Connection Service — Activepieces-pattern OAuth token management
//
// Key behaviours:
//   1. claimed_at + expires_in — avoids clock drift vs stored expires_at
//   2. 15-minute early refresh buffer — refreshes before expiry, not after
//   3. mergeNonNull — preserves existing refresh_token if provider doesn't re-issue
//   4. Advisory lock — prevents parallel token refreshes racing on the same conn
// ---------------------------------------------------------------------------

const REFRESH_BUFFER_SECONDS = 15 * 60; // refresh 15 min early

export interface DecryptedConnection {
  id: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  scopes: string[] | null;
  organisationId: string;
  subaccountId: string | null;
}

/** Sanitise a connection row before sending to client — strip all secrets. */
function sanitizeConnection(conn: IntegrationConnection) {
  const { accessToken, refreshToken, secretsRef, clientIdEnc, clientSecretEnc, ...rest } = conn;
  return {
    ...rest,
    hasAccessToken: !!accessToken,
    hasRefreshToken: !!refreshToken,
    hasSecretsRef: !!secretsRef,
  };
}

export const integrationConnectionService = {
  // ── Org-level connection CRUD ──────────────────────────────────────────────

  async listOrgConnections(organisationId: string) {
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
      ));
    return rows.map(sanitizeConnection);
  },

  async getOrgConnection(id: string, organisationId: string) {
    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
      ));
    return conn ? sanitizeConnection(conn) : null;
  },

  async createOrgConnection(organisationId: string, data: {
    providerType: string;
    authType: string;
    label?: string | null;
    displayName?: string | null;
    configJson?: Record<string, unknown> | null;
    accessToken?: string | null;
    refreshToken?: string | null;
    tokenExpiresAt?: string | null;
    secretsRef?: string | null;
  }) {
    const encryptedAccess = data.accessToken ? connectionTokenService.encryptToken(data.accessToken) : null;
    const encryptedRefresh = data.refreshToken ? connectionTokenService.encryptToken(data.refreshToken) : null;
    const encryptedSecret = data.secretsRef ? connectionTokenService.encryptToken(data.secretsRef) : null;

    const [connection] = await db.insert(integrationConnections).values({
      organisationId,
      subaccountId: null,
      providerType: data.providerType as IntegrationConnection['providerType'],
      authType: data.authType as IntegrationConnection['authType'],
      label: data.label ?? null,
      displayName: data.displayName ?? null,
      configJson: data.configJson ?? null,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null,
      secretsRef: encryptedSecret,
      connectionStatus: 'active',
    }).returning();

    return sanitizeConnection(connection);
  },

  async updateOrgConnection(id: string, organisationId: string, data: Record<string, unknown>) {
    const [existing] = await db.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
      ));
    if (!existing) return null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.label !== undefined) updates.label = data.label;
    if (data.displayName !== undefined) updates.displayName = data.displayName;
    if (data.connectionStatus !== undefined) updates.connectionStatus = data.connectionStatus;
    if (data.configJson !== undefined) updates.configJson = data.configJson;
    if (data.accessToken) updates.accessToken = connectionTokenService.encryptToken(data.accessToken as string);
    if (data.refreshToken) updates.refreshToken = connectionTokenService.encryptToken(data.refreshToken as string);
    if (data.tokenExpiresAt) updates.tokenExpiresAt = new Date(data.tokenExpiresAt as string);
    if (data.secretsRef) updates.secretsRef = connectionTokenService.encryptToken(data.secretsRef as string);

    const [updated] = await db.update(integrationConnections)
      .set(updates)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
      ))
      .returning();
    return updated ? sanitizeConnection(updated) : null;
  },

  async revokeOrgConnection(id: string, organisationId: string) {
    const [existing] = await db.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
      ));
    if (!existing) return false;

    await db.update(integrationConnections)
      .set({ connectionStatus: 'revoked', accessToken: null, refreshToken: null, updatedAt: new Date() })
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
      ));
    return true;
  },
  /**
   * Get a decrypted, valid connection for a subaccount + provider.
   * Auto-refreshes if the token expires within the next 15 minutes.
   * Throws if no active connection exists.
   *
   * organisationId is required and enforced at the DB query level to prevent
   * cross-tenant token leakage if a stale subaccountId is passed by mistake.
   */
  async getDecryptedConnection(
    subaccountId: string | null,
    provider: string,
    organisationId: string,
    connectionId?: string,
  ): Promise<DecryptedConnection> {
    const conditions = [
      eq(integrationConnections.organisationId, organisationId),
      eq(integrationConnections.providerType, provider as IntegrationConnection['providerType']),
      eq(integrationConnections.connectionStatus, 'active'),
    ];

    // For subaccount-scoped lookups, filter by subaccountId.
    // For org-level lookups (null subaccountId), always restrict to org-scoped connections.
    if (subaccountId) {
      conditions.push(eq(integrationConnections.subaccountId, subaccountId));
    } else {
      conditions.push(isNull(integrationConnections.subaccountId));
    }

    if (connectionId) {
      conditions.push(eq(integrationConnections.id, connectionId));
    }

    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(and(...conditions))
      .limit(1);

    if (!conn) {
      const scope = subaccountId ? `subaccount ${subaccountId}` : `organisation ${organisationId}`;
      throw Object.assign(
        new Error(`No active ${provider} connection for ${scope}`),
        { statusCode: 404 },
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const needsRefresh =
      conn.claimedAt !== null &&
      conn.expiresIn !== null &&
      conn.refreshToken !== null &&
      nowSeconds + REFRESH_BUFFER_SECONDS >= conn.claimedAt + conn.expiresIn!;

    if (needsRefresh && conn.refreshToken) {
      return refreshWithLock(conn);
    }

    return {
      id: conn.id,
      provider: conn.providerType,
      accessToken: connectionTokenService.decryptToken(conn.accessToken!),
      refreshToken: conn.refreshToken
        ? connectionTokenService.decryptToken(conn.refreshToken)
        : undefined,
      scopes: conn.configJson ? (conn.configJson as Record<string, unknown>).scopes as string[] : null,
      organisationId: conn.organisationId,
      subaccountId: conn.subaccountId,
    };
  },

  /**
   * Upsert a connection after OAuth callback completes.
   * Encrypts all sensitive fields before storage.
   */
  async upsertFromOAuth(params: {
    subaccountId?: string | null;
    organisationId: string;
    providerType: IntegrationConnection['providerType'];
    accessToken: string;
    refreshToken?: string;
    claimedAt: number;
    expiresIn: number;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string[];
    label?: string;
  }): Promise<void> {
    const encAccess = connectionTokenService.encryptToken(params.accessToken);
    const encRefresh = params.refreshToken
      ? connectionTokenService.encryptToken(params.refreshToken)
      : null;
    const encClientId = connectionTokenService.encryptToken(params.clientId);
    const encClientSecret = connectionTokenService.encryptToken(params.clientSecret);

    const updateSet = {
      accessToken: encAccess,
      refreshToken: encRefresh ?? sql`refresh_token`,
      claimedAt: params.claimedAt,
      expiresIn: params.expiresIn,
      tokenUrl: params.tokenUrl,
      clientIdEnc: encClientId,
      clientSecretEnc: encClientSecret,
      configJson: { scopes: params.scopes },
      connectionStatus: 'active' as const,
      oauthStatus: 'active' as const,
      updatedAt: new Date(),
    };

    const insertValues = {
      subaccountId: params.subaccountId ?? null,
      organisationId: params.organisationId,
      providerType: params.providerType,
      authType: 'oauth2' as const,
      connectionStatus: 'active' as const,
      accessToken: encAccess,
      refreshToken: encRefresh,
      claimedAt: params.claimedAt,
      expiresIn: params.expiresIn,
      tokenUrl: params.tokenUrl,
      clientIdEnc: encClientId,
      clientSecretEnc: encClientSecret,
      configJson: { scopes: params.scopes },
      label: params.label ?? null,
      oauthStatus: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Partial unique indexes don't support onConflictDoUpdate target, so we
    // use a non-atomic check-then-insert/update pattern with a 23505 catch
    // for concurrent OAuth callbacks. Safe under expected callback frequency.
    const conditions = [
      eq(integrationConnections.organisationId, params.organisationId),
      eq(integrationConnections.providerType, params.providerType as IntegrationConnection['providerType']),
    ];

    if (params.subaccountId) {
      conditions.push(eq(integrationConnections.subaccountId, params.subaccountId));
    } else {
      conditions.push(isNull(integrationConnections.subaccountId));
    }

    // Label matching: NULL label matches NULL
    if (params.label) {
      conditions.push(eq(integrationConnections.label, params.label));
    } else {
      conditions.push(isNull(integrationConnections.label));
    }

    const [existing] = await db.select({ id: integrationConnections.id, configJson: integrationConnections.configJson })
      .from(integrationConnections)
      .where(and(...conditions))
      .limit(1);

    if (existing) {
      // Merge scopes into existing configJson to preserve operator-set fields
      // (e.g. Slack defaultChannel) that the provider does not re-send on reconnect.
      const mergedConfigJson = {
        ...(existing.configJson as Record<string, unknown> | null ?? {}),
        scopes: params.scopes,
      };
      await db.update(integrationConnections)
        .set({ ...updateSet, configJson: mergedConfigJson })
        .where(eq(integrationConnections.id, existing.id));
    } else {
      try {
        await db.insert(integrationConnections).values(insertValues);
      } catch (err: unknown) {
        // Handle race condition: concurrent OAuth callback already inserted
        const isUniqueViolation = (err as { code?: string }).code === '23505';
        if (isUniqueViolation) {
          // Re-query and update the row that won the race
          const [raceWinner] = await db.select({ id: integrationConnections.id, configJson: integrationConnections.configJson })
            .from(integrationConnections)
            .where(and(...conditions))
            .limit(1);
          if (raceWinner) {
            const mergedConfigJson = {
              ...(raceWinner.configJson as Record<string, unknown> | null ?? {}),
              scopes: params.scopes,
            };
            await db.update(integrationConnections)
              .set({ ...updateSet, configJson: mergedConfigJson })
              .where(eq(integrationConnections.id, raceWinner.id));
          }
        } else {
          throw err;
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Refresh with advisory lock
// Prevents parallel processes from double-spending the same refresh token.
// Uses PostgreSQL session-level advisory locks (numeric key derived from hash).
// ---------------------------------------------------------------------------

async function refreshWithLock(conn: IntegrationConnection): Promise<DecryptedConnection> {
  // Derive a stable integer lock key from orgId + subaccountId + providerType
  const lockKey = hashToLockKey(`oauth_refresh:${conn.organisationId}:${conn.subaccountId ?? 'org'}:${conn.providerType}`);

  // Try to acquire advisory lock — non-blocking
  const [lockResult] = await db.execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_lock(${lockKey}) AS acquired`,
  );

  if (!lockResult.acquired) {
    // Another process is refreshing — wait a moment then re-fetch
    await new Promise((r) => setTimeout(r, 500));
    const [fresh] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, conn.id))
      .limit(1);
    if (!fresh) throw new Error('Connection disappeared during refresh');
    return {
      id: fresh.id,
      provider: fresh.providerType,
      accessToken: connectionTokenService.decryptToken(fresh.accessToken!),
      refreshToken: fresh.refreshToken
        ? connectionTokenService.decryptToken(fresh.refreshToken)
        : undefined,
      scopes: fresh.configJson ? (fresh.configJson as Record<string, unknown>).scopes as string[] : null,
      organisationId: fresh.organisationId,
      subaccountId: fresh.subaccountId,
    };
  }

  try {
    // Re-check after acquiring lock — another worker may have already refreshed
    const [current] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, conn.id))
      .limit(1);

    if (!current) throw new Error('Connection not found');

    const nowSeconds = Math.floor(Date.now() / 1000);
    const alreadyFresh =
      current.claimedAt !== null &&
      current.expiresIn !== null &&
      current.claimedAt + current.expiresIn! > nowSeconds + REFRESH_BUFFER_SECONDS;

    if (alreadyFresh) {
      return {
        id: current.id,
        provider: current.providerType,
        accessToken: connectionTokenService.decryptToken(current.accessToken!),
        refreshToken: current.refreshToken
          ? connectionTokenService.decryptToken(current.refreshToken)
          : undefined,
        scopes: current.configJson ? (current.configJson as Record<string, unknown>).scopes as string[] : null,
        organisationId: current.organisationId,
        subaccountId: current.subaccountId,
      };
    }

    // Perform the refresh
    const clientId = connectionTokenService.decryptToken(conn.clientIdEnc!);
    const clientSecret = connectionTokenService.decryptToken(conn.clientSecretEnc!);
    const refreshToken = connectionTokenService.decryptToken(conn.refreshToken!);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(conn.tokenUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      await db
        .update(integrationConnections)
        .set({ oauthStatus: 'error', updatedAt: new Date() })
        .where(eq(integrationConnections.id, conn.id));
      throw new Error(`Token refresh failed for ${conn.providerType}: ${errText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // mergeNonNull: preserve existing refresh_token if provider doesn't re-issue
    const newRefreshEnc = data.refresh_token
      ? connectionTokenService.encryptToken(data.refresh_token)
      : conn.refreshToken; // keep existing

    const newClaimedAt = Math.floor(Date.now() / 1000);
    const newExpiresIn = data.expires_in ?? 3600;

    await db
      .update(integrationConnections)
      .set({
        accessToken: connectionTokenService.encryptToken(data.access_token),
        refreshToken: newRefreshEnc,
        claimedAt: newClaimedAt,
        expiresIn: newExpiresIn,
        connectionStatus: 'active',
        oauthStatus: 'active',
        updatedAt: new Date(),
      })
      .where(eq(integrationConnections.id, conn.id));

    return {
      id: conn.id,
      provider: conn.providerType,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      scopes: conn.configJson ? (conn.configJson as Record<string, unknown>).scopes as string[] : null,
      organisationId: conn.organisationId,
      subaccountId: conn.subaccountId,
    };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
  }
}

function hashToLockKey(input: string): number {
  // Derive a stable 32-bit integer from a string for pg_advisory_lock
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}
