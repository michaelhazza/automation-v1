/**
 * webLoginConnectionService — CRUD + test for `web_login` integration
 * connections (paywall credentials).
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §6 (Code Change D).
 *
 * Storage shape:
 *  - providerType: 'web_login'
 *  - authType: 'web_login'
 *  - configJson: {
 *      loginUrl, contentUrl?, username, usernameSelector?, passwordSelector?,
 *      submitSelector?, successSelector?, timeoutMs?,
 *      lastTestedAt?, lastTestStatus?
 *    }
 *  - secretsRef: encrypted password (via connectionTokenService)
 *
 * Tenant isolation: every read filters by organisationId. Subaccount-scoped
 * connections require an exact subaccountId match.
 */

import { eq, and, isNull, or, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrationConnections, subaccountAgents, agents } from '../db/schema/index.js';
import { connectionTokenService } from './connectionTokenService.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebLoginConfigInput {
  loginUrl: string;
  contentUrl?: string | null;
  username: string;
  usernameSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
  successSelector?: string | null;
  timeoutMs?: number | null;
}

export interface WebLoginConfigStored extends WebLoginConfigInput {
  /** ISO timestamp of last successful test, if any. */
  lastTestedAt?: string | null;
  /** 'success' | 'failed' | 'untested' */
  lastTestStatus?: 'success' | 'failed' | 'untested' | null;
  /** Failure detail if last test failed. */
  lastTestError?: string | null;
}

export interface WebLoginCredentials {
  loginUrl: string;
  contentUrl?: string;
  username: string;
  password: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successSelector?: string;
  timeoutMs: number;
}

// Default selectors used when configJson does not specify them. These match
// the most common login form patterns. Operators can override per connection
// via the Advanced section in the IntegrationsPage form.
const DEFAULT_SELECTORS = {
  username: 'input[type=email], input[name=email], #email, input[name=username]',
  password: 'input[type=password], #password, input[name=password]',
  submit: 'button[type=submit], input[type=submit]',
  timeoutMs: 30_000,
} as const;

/**
 * Sanitize a row before sending it back to the API caller. Strips the
 * encrypted password (`secretsRef`), exposes the config but masks the
 * password presence as a boolean.
 */
function sanitize(row: IntegrationConnection) {
  const config = (row.configJson as WebLoginConfigStored | null) ?? null;
  return {
    id: row.id,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
    providerType: row.providerType,
    authType: row.authType,
    label: row.label,
    displayName: row.displayName,
    connectionStatus: row.connectionStatus,
    config,
    hasPassword: !!row.secretsRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastVerifiedAt: row.lastVerifiedAt,
  };
}

export const webLoginConnectionService = {
  /**
   * List all active web_login connections for an org/subaccount scope.
   * Subaccount scope returns subaccount-specific connections only (NOT org
   * fallback — that is the runtime resolution path's responsibility, not
   * the management API).
   *
   * Revoked connections are excluded — the management API should never
   * surface them to the UI.
   */
  async list(organisationId: string, subaccountId: string | null) {
    const conditions = [
      eq(integrationConnections.organisationId, organisationId),
      eq(integrationConnections.providerType, 'web_login'),
      ne(integrationConnections.connectionStatus, 'revoked'),
    ];
    if (subaccountId) {
      conditions.push(eq(integrationConnections.subaccountId, subaccountId));
    } else {
      conditions.push(isNull(integrationConnections.subaccountId));
    }
    const rows = await db.select().from(integrationConnections).where(and(...conditions));
    return rows.map(sanitize);
  },

  /**
   * Get one web_login connection by id. **Tenant-scoped on both
   * organisationId AND subaccountId** (per pr-reviewer BLOCKER-2 fix):
   *  - subaccountId === null  → only org-level connections (subaccount_id IS NULL)
   *  - subaccountId === 'X'   → only connections with subaccount_id = 'X'
   *
   * A user with CONNECTIONS_VIEW on subaccount A cannot fetch a connection
   * belonging to subaccount B by knowing its UUID. Revoked connections are
   * also excluded.
   */
  async getById(id: string, organisationId: string, subaccountId: string | null) {
    const conditions = [
      eq(integrationConnections.id, id),
      eq(integrationConnections.organisationId, organisationId),
      eq(integrationConnections.providerType, 'web_login'),
      ne(integrationConnections.connectionStatus, 'revoked'),
    ];
    if (subaccountId === null) {
      conditions.push(isNull(integrationConnections.subaccountId));
    } else {
      conditions.push(eq(integrationConnections.subaccountId, subaccountId));
    }
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(and(...conditions))
      .limit(1);
    return row ? sanitize(row) : null;
  },

  /**
   * Create a new web_login connection. The plaintext password is encrypted
   * via connectionTokenService (existing AES-256-GCM helper, key versioning,
   * env var TOKEN_ENCRYPTION_KEY).
   */
  async create(input: {
    organisationId: string;
    subaccountId: string | null;
    label: string;
    displayName?: string;
    config: WebLoginConfigInput;
    password: string;
  }) {
    const stored: WebLoginConfigStored = {
      ...input.config,
      lastTestedAt: null,
      lastTestStatus: 'untested',
      lastTestError: null,
    };
    const [row] = await db
      .insert(integrationConnections)
      .values({
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        providerType: 'web_login',
        authType: 'web_login',
        label: input.label,
        displayName: input.displayName ?? input.label,
        configJson: stored as unknown as Record<string, unknown>,
        secretsRef: connectionTokenService.encryptToken(input.password),
        connectionStatus: 'active',
      })
      .returning();
    return sanitize(row);
  },

  /**
   * Update label/displayName/config and optionally rotate the password.
   * Tenant-isolated on BOTH organisationId AND subaccountId per BLOCKER-2.
   */
  async update(
    id: string,
    organisationId: string,
    subaccountId: string | null,
    patch: {
      label?: string;
      displayName?: string;
      config?: WebLoginConfigInput;
      password?: string;
      connectionStatus?: 'active' | 'error';
    },
  ) {
    const scopeConditions = [
      eq(integrationConnections.id, id),
      eq(integrationConnections.organisationId, organisationId),
      eq(integrationConnections.providerType, 'web_login'),
      // Revoked connections cannot be updated — revoke() is a one-way operation
      // that clears the password. Allowing updates on revoked rows could create
      // an 'active' connection with no secretsRef.
      ne(integrationConnections.connectionStatus, 'revoked'),
    ];
    if (subaccountId === null) {
      scopeConditions.push(isNull(integrationConnections.subaccountId));
    } else {
      scopeConditions.push(eq(integrationConnections.subaccountId, subaccountId));
    }

    const [existing] = await db
      .select()
      .from(integrationConnections)
      .where(and(...scopeConditions));
    if (!existing) return null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.label !== undefined) updates.label = patch.label;
    if (patch.displayName !== undefined) updates.displayName = patch.displayName;
    if (patch.config !== undefined) {
      const merged: WebLoginConfigStored = {
        ...((existing.configJson as WebLoginConfigStored | null) ?? { loginUrl: '', username: '' }),
        ...patch.config,
      };
      updates.configJson = merged as unknown as Record<string, unknown>;
    }
    if (patch.password) {
      updates.secretsRef = connectionTokenService.encryptToken(patch.password);
    }
    if (patch.connectionStatus !== undefined) {
      updates.connectionStatus = patch.connectionStatus;
    }

    const [updated] = await db
      .update(integrationConnections)
      .set(updates)
      .where(and(...scopeConditions))
      .returning();
    return updated ? sanitize(updated) : null;
  },

  /**
   * Soft-revoke (matches the existing pattern in integrationConnectionService).
   * Sets connectionStatus to 'revoked' and clears the password.
   *
   * Tenant-isolated on BOTH organisationId AND subaccountId per BLOCKER-2.
   */
  async revoke(id: string, organisationId: string, subaccountId: string | null) {
    const scopeConditions = [
      eq(integrationConnections.id, id),
      eq(integrationConnections.organisationId, organisationId),
      eq(integrationConnections.providerType, 'web_login'),
    ];
    if (subaccountId === null) {
      scopeConditions.push(isNull(integrationConnections.subaccountId));
    } else {
      scopeConditions.push(eq(integrationConnections.subaccountId, subaccountId));
    }

    const [existing] = await db
      .select()
      .from(integrationConnections)
      .where(and(...scopeConditions));
    if (!existing) return false;

    await db
      .update(integrationConnections)
      .set({
        connectionStatus: 'revoked',
        secretsRef: null,
        updatedAt: new Date(),
      })
      .where(and(...scopeConditions));
    return true;
  },

  /**
   * Update the last-test status fields after a connection-test run completes.
   * Called by the route handler after polling the IEE login_test job result.
   * Tenant-isolated on BOTH organisationId AND subaccountId per BLOCKER-2.
   */
  async recordTestResult(
    id: string,
    organisationId: string,
    subaccountId: string | null,
    result: { success: boolean; error?: string },
  ) {
    const scopeConditions = [
      eq(integrationConnections.id, id),
      eq(integrationConnections.organisationId, organisationId),
      eq(integrationConnections.providerType, 'web_login'),
    ];
    if (subaccountId === null) {
      scopeConditions.push(isNull(integrationConnections.subaccountId));
    } else {
      scopeConditions.push(eq(integrationConnections.subaccountId, subaccountId));
    }
    const [existing] = await db
      .select()
      .from(integrationConnections)
      .where(and(...scopeConditions));
    if (!existing) return null;
    const config: WebLoginConfigStored = {
      ...((existing.configJson as WebLoginConfigStored | null) ?? { loginUrl: '', username: '' }),
      lastTestedAt: new Date().toISOString(),
      lastTestStatus: result.success ? 'success' : 'failed',
      lastTestError: result.success ? null : (result.error ?? 'unknown error'),
    };
    const [updated] = await db
      .update(integrationConnections)
      .set({
        configJson: config as unknown as Record<string, unknown>,
        lastVerifiedAt: result.success ? new Date() : existing.lastVerifiedAt,
        connectionStatus: result.success ? 'active' : existing.connectionStatus,
        updatedAt: new Date(),
      })
      .where(and(...scopeConditions))
      .returning();
    return updated ? sanitize(updated) : null;
  },

  /**
   * Build the runtime credentials struct used by performLogin in the worker.
   * Applies default selectors when configJson omits them so the operator only
   * needs to fill the Advanced section if defaults do not match the site.
   *
   * This is the only path that DECRYPTS the password. Callers must ensure
   * they are running on the worker (where ENCRYPTION_KEY is present and
   * the run is tenant-scoped). Server-side callers other than the worker
   * should NEVER need this — they hand the connection ID to the worker via
   * the pg-boss payload.
   */
  async listTestEligibleAgents(organisationId: string, subaccountId: string) {
    return db
      .select({
        id: subaccountAgents.id,
        agentId: subaccountAgents.agentId,
        isActive: subaccountAgents.isActive,
        name: agents.name,
      })
      .from(subaccountAgents)
      .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
      .where(
        and(
          eq(subaccountAgents.organisationId, organisationId),
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.isActive, true),
        ),
      );
  },

  async validateSubaccountAgentLink(
    subaccountAgentId: string,
    subaccountId: string,
    agentId: string,
  ) {
    const [link] = await db
      .select({
        id: subaccountAgents.id,
        agentId: subaccountAgents.agentId,
        subaccountId: subaccountAgents.subaccountId,
      })
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.id, subaccountAgentId),
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.agentId, agentId),
        ),
      );
    return link ?? null;
  },

  resolveCredentials(row: IntegrationConnection): WebLoginCredentials {
    const config = (row.configJson as WebLoginConfigStored | null) ?? null;
    if (!config || !config.loginUrl || !config.username) {
      throw Object.assign(new Error('web_login connection has incomplete config'), {
        statusCode: 500,
        errorCode: 'web_login_config_incomplete',
      });
    }
    if (!row.secretsRef) {
      throw Object.assign(new Error('web_login connection has no password set'), {
        statusCode: 500,
        errorCode: 'web_login_password_missing',
      });
    }
    return {
      loginUrl: config.loginUrl,
      contentUrl: config.contentUrl ?? undefined,
      username: config.username,
      password: connectionTokenService.decryptToken(row.secretsRef),
      usernameSelector: config.usernameSelector || DEFAULT_SELECTORS.username,
      passwordSelector: config.passwordSelector || DEFAULT_SELECTORS.password,
      submitSelector: config.submitSelector || DEFAULT_SELECTORS.submit,
      successSelector: config.successSelector ?? undefined,
      timeoutMs: config.timeoutMs ?? DEFAULT_SELECTORS.timeoutMs,
    };
  },
};
