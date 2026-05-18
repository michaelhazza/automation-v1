import { eq, and, sql, isNull, or, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { integrationConnections, subaccounts } from '../db/schema/index.js';
import { configHistoryService } from './configHistoryService.js';
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

  async listOrgConnections(organisationId: string, provider?: string) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.listOrgConnections');
    const rows = await scopedDb
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
        provider ? eq(integrationConnections.providerType, provider as typeof integrationConnections.providerType._.data) : undefined,
      ));
    return rows.map(sanitizeConnection);
  },

  async getOrgConnection(id: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.getOrgConnection');
    const [conn] = await scopedDb
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
      ));
    return conn ? sanitizeConnection(conn) : null;
  },

  // Like getOrgConnection but returns the raw row including encrypted tokens.
  // Used by routes that need to decrypt tokens (e.g. Slack channel fetching).
  async getOrgConnectionWithToken(id: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.getOrgConnectionWithToken');
    const [conn] = await scopedDb
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
      ));
    return conn ?? null;
  },

  // Look up a connection by ID within an org, regardless of subaccount scope.
  // Returns subaccount-scoped or org-level rows. Routes that accept either
  // scope (e.g. Google Drive attach/picker) should use this and then enforce
  // the subaccount-membership check themselves.
  async getConnectionWithToken(id: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.getConnectionWithToken');
    const [conn] = await scopedDb
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
      ));
    return conn ?? null;
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

    const scopedDb = getOrgScopedDb('integrationConnectionService.createOrgConnection');
    const [connection] = await scopedDb.insert(integrationConnections).values({
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

    // Config history — snapshot uses sanitized (no secrets) version
    await configHistoryService.recordHistory({
      entityType: 'integration_connection', entityId: connection.id, organisationId,
      snapshot: sanitizeConnection(connection) as unknown as Record<string, unknown>,
      changedBy: null, changeSource: 'api',
    });

    return sanitizeConnection(connection);
  },

  async updateOrgConnection(id: string, organisationId: string, data: Record<string, unknown>) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.updateOrgConnection');
    const [existing] = await scopedDb.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
      ));
    if (!existing) return null;

    await configHistoryService.recordHistory({
      entityType: 'integration_connection', entityId: id, organisationId,
      snapshot: sanitizeConnection(existing) as unknown as Record<string, unknown>,
      changedBy: null, changeSource: 'api',
    });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.label !== undefined) updates.label = data.label;
    if (data.displayName !== undefined) updates.displayName = data.displayName;
    if (data.connectionStatus !== undefined) updates.connectionStatus = data.connectionStatus;
    if (data.configJson !== undefined) updates.configJson = data.configJson;
    if (data.accessToken) updates.accessToken = connectionTokenService.encryptToken(data.accessToken as string);
    if (data.refreshToken) updates.refreshToken = connectionTokenService.encryptToken(data.refreshToken as string);
    if (data.tokenExpiresAt) updates.tokenExpiresAt = new Date(data.tokenExpiresAt as string);
    if (data.secretsRef) updates.secretsRef = connectionTokenService.encryptToken(data.secretsRef as string);

    const [updated] = await scopedDb.update(integrationConnections)
      .set(updates)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
      ))
      .returning();
    return updated ? sanitizeConnection(updated) : null;
  },

  async revokeOrgConnection(id: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.revokeOrgConnection');
    const [existing] = await scopedDb.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
      ));
    if (!existing) return false;

    await scopedDb.update(integrationConnections)
      .set({ connectionStatus: 'revoked', accessToken: null, refreshToken: null, updatedAt: new Date() })
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.organisationId, organisationId),
      ));
    return true;
  },

  /**
   * Revoke all connections of the given providerType for a sub-account.
   * Idempotent — if all matching connections are already revoked, returns
   * { alreadyRevoked: true } rather than throwing.
   *
   * Sets connectionStatus = 'revoked' and nulls both accessToken and
   * refreshToken on every matching row. Audit-logged via configHistoryService.
   *
   * Used by sptVaultService for SPT kill-switch (providerType = 'stripe_agent').
   */
  async revokeSubaccountConnection(
    subaccountId: string,
    organisationId: string,
    providerType: string,
  ): Promise<{ alreadyRevoked: boolean }> {
    const scopedDb = getOrgScopedDb('integrationConnectionService.revokeSubaccountConnection');
    const rows = await scopedDb.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.subaccountId, subaccountId),
        eq(integrationConnections.organisationId, organisationId),
        eq(integrationConnections.providerType, providerType as IntegrationConnection['providerType']),
      ));

    if (rows.length === 0) {
      return { alreadyRevoked: true };
    }

    const allAlreadyRevoked = rows.every((r) => r.connectionStatus === 'revoked');
    if (allAlreadyRevoked) {
      // Audit-log even on idempotent calls so every revoke attempt is visible
      for (const row of rows) {
        await configHistoryService.recordHistory({
          entityType: 'integration_connection', entityId: row.id, organisationId,
          snapshot: { ...sanitizeConnection(row), revokeNote: 'already_revoked' } as unknown as Record<string, unknown>,
          changedBy: null, changeSource: 'api',
        });
      }
      return { alreadyRevoked: true };
    }

    for (const row of rows) {
      await configHistoryService.recordHistory({
        entityType: 'integration_connection', entityId: row.id, organisationId,
        snapshot: sanitizeConnection(row) as unknown as Record<string, unknown>,
        changedBy: null, changeSource: 'api',
      });
    }

    await scopedDb.update(integrationConnections)
      .set({ connectionStatus: 'revoked', accessToken: null, refreshToken: null, updatedAt: new Date() })
      .where(and(
        eq(integrationConnections.subaccountId, subaccountId),
        eq(integrationConnections.organisationId, organisationId),
        eq(integrationConnections.providerType, providerType as IntegrationConnection['providerType']),
      ));

    return { alreadyRevoked: false };
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

    const scopedDb = getOrgScopedDb('integrationConnectionService.getDecryptedConnection');
    const [conn] = await scopedDb
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
    //
    // Label is intentionally excluded from the lookup: a seed or admin may have
    // pre-created a placeholder row with a custom label (e.g. 'Breakout Solutions Slack').
    // We want to update that row rather than insert a new one and hit the unique
    // constraint on (subaccount_id, provider_type).
    const conditions = [
      eq(integrationConnections.organisationId, params.organisationId),
      eq(integrationConnections.providerType, params.providerType as IntegrationConnection['providerType']),
    ];

    if (params.subaccountId) {
      conditions.push(eq(integrationConnections.subaccountId, params.subaccountId));
    } else {
      conditions.push(isNull(integrationConnections.subaccountId));
    }

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="unauthenticated OAuth callback path — org resolved via JWT state; no withOrgTx wrapper at route level"
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
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="unauthenticated OAuth callback path — org resolved via JWT state; no withOrgTx wrapper at route level"
      await db.update(integrationConnections)
        .set({ ...updateSet, configJson: mergedConfigJson })
        // guard-ignore-next-line: org-scoped-writes reason="existing.id obtained from prior SELECT with and(...conditions) which includes organisationId and subaccountId filters"
        .where(eq(integrationConnections.id, existing.id));
    } else {
      try {
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="unauthenticated OAuth callback path — org resolved via JWT state; no withOrgTx wrapper at route level"
        await db.insert(integrationConnections).values(insertValues);
      } catch (err: unknown) {
        // Handle race condition: concurrent OAuth callback already inserted
        const isUniqueViolation = (err as { code?: string }).code === '23505';
        if (isUniqueViolation) {
          // Re-query and update the row that won the race
          // guard-ignore-next-line: with-org-tx-or-scoped-db reason="unauthenticated OAuth callback path — org resolved via JWT state; no withOrgTx wrapper at route level"
          const [raceWinner] = await db.select({ id: integrationConnections.id, configJson: integrationConnections.configJson })
            .from(integrationConnections)
            .where(and(...conditions))
            .limit(1);
          if (raceWinner) {
            const mergedConfigJson = {
              ...(raceWinner.configJson as Record<string, unknown> | null ?? {}),
              scopes: params.scopes,
            };
            // guard-ignore-next-line: with-org-tx-or-scoped-db reason="unauthenticated OAuth callback path — org resolved via JWT state; no withOrgTx wrapper at route level"
            await db.update(integrationConnections)
              .set({ ...updateSet, configJson: mergedConfigJson })
              // guard-ignore-next-line: org-scoped-writes reason="raceWinner.id obtained from prior SELECT with and(...conditions) which includes organisationId and subaccountId filters"
              .where(eq(integrationConnections.id, raceWinner.id));
          }
        } else {
          throw err;
        }
      }
    }
  },

  // ── Subaccount-level connection CRUD ─────────────────────────────────────

  async listSubaccountConnections(subaccountId: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.listSubaccountConnections');
    const rows = await scopedDb
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.subaccountId, subaccountId),
        eq(integrationConnections.organisationId, organisationId),
      ));
    return rows.map(sanitizeConnection);
  },

  async getSubaccountConnection(id: string, subaccountId: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.getSubaccountConnection');
    const [conn] = await scopedDb
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.subaccountId, subaccountId),
        eq(integrationConnections.organisationId, organisationId),
      ));
    return conn ? sanitizeConnection(conn) : null;
  },

  // Returns raw row including encrypted tokens — used when decryption is needed (e.g. Slack channels).
  async getSubaccountConnectionWithToken(id: string, subaccountId: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.getSubaccountConnectionWithToken');
    const [conn] = await scopedDb
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.subaccountId, subaccountId),
        eq(integrationConnections.organisationId, organisationId),
      ));
    return conn ?? null;
  },

  async createSubaccountConnection(subaccountId: string, organisationId: string, data: {
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

    const scopedDb = getOrgScopedDb('integrationConnectionService.createSubaccountConnection');
    const [connection] = await scopedDb.insert(integrationConnections).values({
      organisationId,
      subaccountId,
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

  async updateSubaccountConnection(id: string, subaccountId: string, organisationId: string, data: Record<string, unknown>) {
    const scopedDb = getOrgScopedDb('integrationConnectionService.updateSubaccountConnection');
    const [existing] = await scopedDb.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.subaccountId, subaccountId),
        eq(integrationConnections.organisationId, organisationId),
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

    const [updated] = await scopedDb.update(integrationConnections)
      .set(updates)
      .where(and(
        eq(integrationConnections.id, id),
        eq(integrationConnections.subaccountId, subaccountId),
        eq(integrationConnections.organisationId, organisationId),
      ))
      .returning();
    return updated ? sanitizeConnection(updated) : null;
  },

  /**
   * Verify that a subaccount belongs to the given org.
   * Returns the subaccount id if found, null otherwise.
   */
  async verifySubaccountOwnership(subaccountId: string, organisationId: string): Promise<string | null> {
    const scopedDb = getOrgScopedDb('integrationConnectionService.verifySubaccountOwnership');
    const [row] = await scopedDb
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(and(
        eq(subaccounts.id, subaccountId),
        eq(subaccounts.organisationId, organisationId),
      ))
      .limit(1);
    return row?.id ?? null;
  },

  /**
   * Upsert a GitHub App installation connection.
   * Uses conflict-on (subaccountId, providerType, label) to handle reinstalls.
   */
  async upsertGitHubAppConnection(params: {
    subaccountId: string;
    organisationId: string;
    installationId: number;
    setupAction: string | undefined;
    accountLogin: string | null;
    accountType: string | null;
    repositorySelection: string | null;
    displayName: string;
    label: string | null;
  }): Promise<void> {
    const configJson = {
      installationId: params.installationId,
      setupAction: params.setupAction,
      accountLogin: params.accountLogin,
      accountType: params.accountType,
      repositorySelection: params.repositorySelection,
    };
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="unauthenticated GitHub App callback — org resolved via JWT state; no withOrgTx wrapper at route level"
    await db
      .insert(integrationConnections)
      .values({
        subaccountId: params.subaccountId,
        organisationId: params.organisationId,
        providerType: 'github',
        authType: 'github_app',
        connectionStatus: 'active',
        label: params.label,
        displayName: params.displayName,
        configJson,
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
          displayName: params.displayName,
          configJson,
          oauthStatus: 'active',
          updatedAt: new Date(),
        },
      });
  },

  /**
   * Get an active GitHub App connection by id scoped to an org.
   * Returns the raw row (including configJson with installationId).
   */
  async getActiveGitHubConnection(connectionId: string, organisationId: string): Promise<IntegrationConnection | null> {
    const scopedDb = getOrgScopedDb('integrationConnectionService.getActiveGitHubConnection');
    const [conn] = await scopedDb
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, connectionId),
        eq(integrationConnections.organisationId, organisationId),
        eq(integrationConnections.providerType, 'github'),
        eq(integrationConnections.connectionStatus, 'active'),
      ))
      .limit(1);
    return conn ?? null;
  },

  /**
   * Returns the first active connection for the given provider in this
   * org/subaccount scope. Returns null (never throws) if none exists.
   * Checks both subaccount-specific AND org-level (subaccountId IS NULL)
   * connections per the connection-resolution contract.
   * Used by integrationBlockService to decide whether to block a tool call.
   * Assumes at most one "effective" active connection per provider per scope.
   * If multiple exist, latest updatedAt wins (deterministic but not DB-enforced).
   */
  async findActiveConnection(params: {
    organisationId: string;
    subaccountId: string | null;
    providerType: string;
  }): Promise<IntegrationConnection | null> {
    const { organisationId, subaccountId, providerType } = params;

    const scopedDb = getOrgScopedDb('integrationConnectionService.findActiveConnection');
    const [conn] = await scopedDb
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organisationId, organisationId),
          eq(integrationConnections.providerType, providerType as IntegrationConnection['providerType']),
          eq(integrationConnections.connectionStatus, 'active'),
          eq(integrationConnections.oauthStatus, 'active'),
          subaccountId
            ? or(
                eq(integrationConnections.subaccountId, subaccountId),
                isNull(integrationConnections.subaccountId),
              )
            : isNull(integrationConnections.subaccountId),
        ),
      )
      .orderBy(
        desc(integrationConnections.updatedAt),
        desc(integrationConnections.createdAt),
        desc(integrationConnections.id),
      )
      .limit(1);

    return conn ?? null;
  },

  /** Resolve the subaccount that installed a GitHub App by its installation_id.
   * Scans all github connections and matches on configJson.installationId.
   * Returns null when no connection matches (unknown installation). */
  async resolveSubaccountFromGitHubInstallation(
    installationId: number,
  ): Promise<{ subaccountId: string; organisationId: string } | null> {
    const connections = await withAdminConnection(
      { source: 'integrationConnectionService.resolveSubaccountFromGitHubInstallation',
        reason: 'cross-tenant scan — GitHub webhook resolves org by installationId before org context is known' },
      async (adminDb) => {
        await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
        return adminDb
          .select({
            subaccountId: integrationConnections.subaccountId,
            organisationId: integrationConnections.organisationId,
            configJson: integrationConnections.configJson,
          })
          .from(integrationConnections)
          .where(eq(integrationConnections.providerType, 'github'));
      },
    );

    for (const conn of connections) {
      const cfg = conn.configJson as { installationId?: number } | null;
      if (cfg?.installationId === installationId) {
        return { subaccountId: conn.subaccountId!, organisationId: conn.organisationId };
      }
    }
    return null;
  },

  async findActiveOperatorSessionConnection(
    orgId: string,
    subaccountId: string,
  ): Promise<{ id: string } | null> {
    const scopedDb = getOrgScopedDb('integrationConnectionService.findActiveOperatorSessionConnection');
    const [conn] = await scopedDb
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organisationId, orgId),
          eq(integrationConnections.subaccountId, subaccountId),
          eq(integrationConnections.authType, 'operator_session'),
          eq(integrationConnections.connectionStatus, 'active'),
        ),
      )
      .limit(1);
    return conn ?? null;
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
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="advisory-lock refresh path — conn obtained via org-scoped query; pg_advisory_lock session-scope requires bare db handle"
    const [fresh] = await db
      .select()
      .from(integrationConnections)
      // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT; conn passed in by callers who obtained it via org-scoped query; re-fetch to get latest token state"
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
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="advisory-lock refresh path — conn obtained via org-scoped query; pg_advisory_lock session-scope requires bare db handle"
    const [current] = await db
      .select()
      .from(integrationConnections)
      // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT; conn passed in by callers who obtained it via org-scoped query; re-fetch after acquiring advisory lock"
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
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="advisory-lock refresh path — conn obtained via org-scoped query; pg_advisory_lock session-scope requires bare db handle"
      await db
        .update(integrationConnections)
        .set({ oauthStatus: 'error', updatedAt: new Date() })
        // guard-ignore-next-line: org-scoped-writes reason="conn passed in by callers who obtained it via org-scoped query; updating own record within advisory lock"
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

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="advisory-lock refresh path — conn obtained via org-scoped query; pg_advisory_lock session-scope requires bare db handle"
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
      // guard-ignore-next-line: org-scoped-writes reason="conn passed in by callers who obtained it via org-scoped query; updating own record within advisory lock after successful token refresh"
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
