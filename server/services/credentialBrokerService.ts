// Credential Broker and Identity Boundary primitive per v1.2 brief. See docs/synthetos-nomenclature.md

import { and, desc, eq, gte, ne, sql as sqlOp } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { auditEvents, integrationConnections } from '../db/schema/index.js';
import { emitAgentRunUpdate } from '../websocket/emitters.js';
import { connectionTokenService } from './connectionTokenService.js';
import { integrationConnectionService } from './integrationConnectionService.js';
import { logger } from '../lib/logger.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';
import { assertCredentialUsableOrThrow, CredentialNotUsableError, orderResolvedCredentials } from './credentialBrokerServicePure.js';
import type { OrderableRow } from './credentialBrokerServicePure.js';
import type { UsabilityState } from './operatorSessionLifecycleServicePure.js';
import { OPERATOR_SESSION_USABILITY_RESTORED } from '../../shared/types/operatorBackendEvents.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface IssuedCredential {
  credentialId: string;
  connectionId: string;
  organisationId: string;
  authType: 'oauth2' | 'api_key' | 'web_login';
  issuedAt: Date;
  expiresAt?: Date;
  /**
   * Per-execution redaction pattern (spec B §11.3). When set, the harvest
   * pipeline registers this RegExp for the lifetime of the sandbox execution
   * to scrub any occurrence of the credential value from output.json, logs,
   * and artefact metadata. The pattern is discarded on sandbox close.
   *
   * Existing callers that do not consume sandbox execution outputs may safely
   * ignore this field — it is optional and additive.
   */
  redactionPattern?: RegExp;
}

export interface OperatorSessionEnvelope {
  credentialId: string;
  connectionId: string;
  /** Defence-in-depth: adapter asserts this matches the task's subaccount_id (spec §3.6). */
  subaccountId: string;
  authType: 'operator_session';
  provider: string;
  planTier: 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown';
  usabilityState: 'connected_usable';  // broker refuses to return any other state
  issuedAt: string;
  expiresAt: string | null;
}

/**
 * Redacted API-key credential envelope for operator-session → API-key fallback.
 *
 * Raw key material never leaves the broker — the adapter consumes credentialId
 * only (mirroring the OperatorSessionEnvelope discipline).
 *
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.7 item 2
 */
export interface ApiKeyEnvelope {
  credentialId: string;
  connectionId: string;
  /** Defence-in-depth: adapter asserts this matches the task's subaccount_id (spec §3.6). */
  subaccountId: string;
  authType: 'api_key';
  provider: string;
  issuedAt: string;
  expiresAt: string | null;
}

export interface ResolvedCredential {
  credentialId: string;
  connectionId: string;
  authType: 'oauth2' | 'api_key' | 'web_login' | 'operator_session';
  providerType: string;
  subaccountId: string | null;
}

export interface CredentialAuditEntry {
  credentialId: string;
  action: 'issued' | 'refreshed' | 'revoked' | 'used';
  organisationId: string;
  subaccountId?: string | null;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

export const OWNER_MISMATCH = 'OWNER_MISMATCH' as const;

// ── Internal helpers ──────────────────────────────────────────────────────────

function mapAuthType(
  raw: string,
): 'oauth2' | 'api_key' | 'web_login' {
  if (raw === 'oauth2' || raw === 'api_key' || raw === 'web_login') {
    return raw;
  }
  return 'api_key';
}

function credentialFromConnection(conn: IntegrationConnection): IssuedCredential {
  return {
    credentialId: conn.id,
    connectionId: conn.id,
    organisationId: conn.organisationId,
    authType: mapAuthType(conn.authType),
    issuedAt: new Date(),
    expiresAt: conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : undefined,
  };
}

function rawActionToAuditAction(raw: string): 'issued' | 'refreshed' | 'revoked' | 'used' {
  if (raw.includes('revoke') || raw.includes('revoked')) return 'revoked';
  if (raw.includes('create') || raw.includes('issued')) return 'issued';
  if (raw.includes('refresh')) return 'refreshed';
  return 'used';
}

// ── Facade ────────────────────────────────────────────────────────────────────

export const credentialBrokerService = {
  /**
   * Issue a credential reference for the given scope.
   * Returns an opaque credential id; decrypted material is not returned here.
   * Emits foundation.credential_broker.issued on success.
   */
  async issueCredential(params: {
    organisationId: string;
    subaccountId: string;
    connectionId: string;
    purpose: string;
  }): Promise<IssuedCredential | OperatorSessionEnvelope> {
    const scopedDb = getOrgScopedDb('credentialBrokerService.issueCredential');
    const [conn] = await scopedDb
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, params.connectionId),
          eq(integrationConnections.organisationId, params.organisationId),
          eq(integrationConnections.subaccountId, params.subaccountId),
        ),
      )
      .limit(1);

    if (!conn) {
      throw Object.assign(
        new Error(`No connection ${params.connectionId} found for org ${params.organisationId}`),
        { statusCode: 404, errorCode: 'credential_not_found' },
      );
    }

    // operator_session branch: state-gate only; no token decryption in V1
    if (conn.authType === 'operator_session') {
      // The decryptHook is a no-op; assertCredentialUsableOrThrow still invokes it
      // once when usable (preserving the testable contract: hook invocation count = 1).
      try {
        assertCredentialUsableOrThrow(conn.usabilityState as UsabilityState, () => undefined);
      } catch (err) {
        if (err instanceof CredentialNotUsableError) {
          throw {
            statusCode: 409,
            errorCode: 'credential_not_usable',
            message: `Credential is not usable: ${err.state}`,
            state: err.state,
          };
        }
        throw err;
      }

      return {
        credentialId: conn.id,
        connectionId: conn.id,
        subaccountId: conn.subaccountId ?? params.subaccountId,
        authType: 'operator_session' as const,
        provider: conn.providerType,
        planTier: (conn.planTier ?? 'unknown') as 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown',
        usabilityState: 'connected_usable' as const,
        issuedAt: new Date().toISOString(),
        expiresAt: conn.tokenExpiresAt ? conn.tokenExpiresAt.toISOString() : null,
      } satisfies OperatorSessionEnvelope;
    }

    const credential = credentialFromConnection(conn);

    logger.info('foundation.credential_broker.issued', {
      credentialId: credential.credentialId,
      organisationId: params.organisationId,
      subaccountId: params.subaccountId,
      connectionId: params.connectionId,
      purpose: params.purpose,
    });

    return credential;
  },

  /**
   * Inject credential material into an environment dict for runtime use.
   * Decrypted material is short-lived and dropped at the end of the call
   * site's lifecycle. Delegates to connectionTokenService.
   *
   * When ownerUserId is provided and the connection has an owner_user_id set,
   * the two must match or OWNER_MISMATCH (403) is thrown.
   */
  async injectIntoEnvironment(params: {
    issuedCredential: IssuedCredential | OperatorSessionEnvelope;
    environment: Record<string, string>;
    ownerUserId?: string;
  }): Promise<void> {
    const { issuedCredential, environment } = params;

    // operator_session: no consumer in V1; injection deferred to Phase 3+ (OpenClaw adapter)
    if (params.issuedCredential.authType === 'operator_session') {
      logger.debug('operator_session.inject_no_consumer_v1', {
        connectionId: params.issuedCredential.connectionId,
      });
      return;
    }

    const scopedDb2 = getOrgScopedDb('credentialBrokerService.injectIntoEnvironment');
    const [conn] = await scopedDb2
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, issuedCredential.connectionId),
          eq(integrationConnections.organisationId, (issuedCredential as IssuedCredential).organisationId),
        ),
      )
      .limit(1);

    if (!conn) {
      throw Object.assign(
        new Error(`Connection ${issuedCredential.connectionId} not found for injection`),
        { statusCode: 404, errorCode: 'credential_not_found' },
      );
    }

    if (params.ownerUserId && conn.ownerUserId && conn.ownerUserId !== params.ownerUserId) {
      throw Object.assign(
        new Error(`Credential owner mismatch: expected owner ${params.ownerUserId}, got ${conn.ownerUserId}`),
        { statusCode: 403, errorCode: OWNER_MISMATCH },
      );
    }

    const token = await connectionTokenService.getAccessToken(conn);
    environment['CREDENTIAL_TOKEN'] = token;
    environment['CREDENTIAL_ID'] = issuedCredential.credentialId;
    environment['CREDENTIAL_AUTH_TYPE'] = issuedCredential.authType;
  },

  /**
   * Revoke a credential (connection) by its ID.
   *
   * Scope-strict: the caller's `subaccountId` controls which scope the revoke
   * targets, and the matching predicate cannot be widened to a different scope.
   *   - `subaccountId === null` → revoke an org-level row (subaccount_id IS NULL)
   *     via integrationConnectionService.revokeOrgConnection (which already pins
   *     `subaccount_id IS NULL`).
   *   - `subaccountId === <id>`  → revoke a row in that exact subaccount via
   *     a direct UPDATE pinned to (organisationId, subaccountId).
   *
   * Critically, a subaccount-scoped caller never falls through to an org-level
   * revoke. If the supplied credentialId is actually an org-level row in the
   * same org, the subaccount-pinned UPDATE matches no rows and the revoke is a
   * no-op — the subaccount actor cannot reach across scope.
   *
   * Returns `true` when a row was revoked, `false` when no matching row was
   * found in scope. Callers should map `false` to HTTP 404 — silently
   * succeeding on a missing row would be a UX/security regression vs the
   * pre-broker route behaviour.
   *
   * Emits foundation.credential_broker.revoked on success.
   */
  async revoke(params: {
    organisationId: string;
    credentialId: string;
    subaccountId: string | null;
  }): Promise<boolean> {
    let revoked: boolean;
    if (params.subaccountId === null) {
      // Org-level revoke: integrationConnectionService.revokeOrgConnection
      // already pins (id, organisationId, subaccount_id IS NULL).
      revoked = await integrationConnectionService.revokeOrgConnection(
        params.credentialId,
        params.organisationId,
      );
    } else {
      // Subaccount-scoped revoke: pin (id, organisationId, subaccountId) so a
      // subaccount-A actor cannot revoke a subaccount-B connection nor an
      // org-level connection within the same org. Clears accessToken,
      // refreshToken, and secretsRef (web_login password storage).
      const scopedDb3 = getOrgScopedDb('credentialBrokerService.revoke');
      const result = await scopedDb3
        .update(integrationConnections)
        .set({
          connectionStatus: 'revoked',
          accessToken: null,
          refreshToken: null,
          secretsRef: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrationConnections.id, params.credentialId),
            eq(integrationConnections.organisationId, params.organisationId),
            eq(integrationConnections.subaccountId, params.subaccountId),
          ),
        )
        .returning({ id: integrationConnections.id });
      revoked = result.length > 0;
    }

    if (revoked) {
      logger.info('foundation.credential_broker.revoked', {
        credentialId: params.credentialId,
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
      });
    }

    return revoked;
  },

  /**
   * Query credential audit log for a given scope.
   * Reads from auditEvents table with scope filter.
   *
   * The subaccountId predicate is pushed into SQL (against
   * `metadata->>'subaccountId'`) so that LIMIT applies AFTER the subaccount
   * match — otherwise an org-wide trailing window of newer rows belonging to
   * other subaccounts would crowd out the requested scope's events.
   */
  async audit(params: {
    organisationId: string;
    subaccountId?: string;
    sinceTimestamp?: Date;
    limit?: number;
  }): Promise<CredentialAuditEntry[]> {
    const limit = params.limit ?? 50;

    const conditions = [
      eq(auditEvents.organisationId, params.organisationId),
      eq(auditEvents.entityType, 'integration_connection'),
    ];

    if (params.sinceTimestamp) {
      conditions.push(gte(auditEvents.createdAt, params.sinceTimestamp));
    }

    if (params.subaccountId) {
      // Match metadata->>'subaccountId' = $subaccountId. Drizzle has no
      // first-class JSONB ->> operator helper, so we use a raw sql fragment.
      conditions.push(
        sqlOp`${auditEvents.metadata} ->> 'subaccountId' = ${params.subaccountId}`,
      );
    }

    const scopedDb4 = getOrgScopedDb('credentialBrokerService.audit');
    const rows = await scopedDb4
      .select()
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);

    const entries: CredentialAuditEntry[] = [];
    for (const row of rows) {
      if (!row.action) continue;

      const meta = row.metadata as Record<string, unknown> | null ?? {};
      const rowSubaccountId = (meta.subaccountId as string | undefined) ?? null;

      entries.push({
        credentialId: row.entityId ?? '',
        action: rawActionToAuditAction(row.action),
        organisationId: row.organisationId ?? params.organisationId,
        subaccountId: rowSubaccountId,
        occurredAt: new Date(row.createdAt),
        metadata: row.metadata as Record<string, unknown> | undefined,
      });
    }

    return entries;
  },

  /**
   * Resolve the available credentials for a run context.
   * Lists active connections in scope; does NOT decrypt.
   * Used by Policy Envelope to capture credential availability at run start.
   *
   * Design note (§812-820): agent-specific filtering for operator_session rows is
   * applied here via the optional agentId param. When agentId is omitted, only
   * 'all_agents' operator_session rows are included (safe default for legacy callers).
   * The specific_agents path is also exercised at the agent-route level via
   * operatorSessionService.listAllowedSubscriptionsForAgent (Chunk 3).
   * orderResolvedCredentials (pure helper) is the single source of truth for §9.7
   * ordering: default operator_session first, then non-default sorted by label, then
   * all other authTypes in their original SQL order.
   */
  async resolveAvailableCredentials(params: {
    organisationId: string;
    subaccountId: string;
    agentId?: string;  // Optional: if provided, also includes specific_agents rows for this agent
  }): Promise<ResolvedCredential[]> {
    // Exclude operator_session rows here — they are handled by the second query below
    // with the additional usabilityState filter.
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organisationId, params.organisationId),
          eq(integrationConnections.subaccountId, params.subaccountId),
          eq(integrationConnections.connectionStatus, 'active'),
          ne(integrationConnections.authType, 'operator_session'),
        ),
      );

    // Include operator_session connections that are usable and allowed for the calling context.
    // SQL pre-filter: availabilityScope = 'all_agents' always; when agentId is provided,
    // also include specific_agents rows where allowedAgentIds contains the agentId.
    const agentIdFilter = params.agentId
      ? sqlOp`(
          ${integrationConnections.configJson} -> 'operator_session' ->> 'availabilityScope' = 'all_agents'
          OR ${integrationConnections.configJson} -> 'operator_session' -> 'allowedAgentIds' ? ${params.agentId}::text
        )`
      : sqlOp`${integrationConnections.configJson} -> 'operator_session' ->> 'availabilityScope' = 'all_agents'`;

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const operatorSessionRows = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organisationId, params.organisationId),
          eq(integrationConnections.subaccountId, params.subaccountId),
          eq(integrationConnections.authType, 'operator_session'),
          eq(integrationConnections.connectionStatus, 'active'),
          eq(integrationConnections.usabilityState, 'connected_usable'),
          agentIdFilter,
        ),
      );

    const allRows = [...rows, ...operatorSessionRows];

    // Build OrderableRow shape for the pure ordering helper.
    // Non-operator_session rows use sentinel values that pass all filters so they
    // preserve their original SQL order at the tail of the result (§9.7).
    type ConfigJson = { operator_session?: { availabilityScope?: 'all_agents' | 'specific_agents'; allowedAgentIds?: string[] | null } };
    const orderableRows: (typeof allRows[number] & OrderableRow)[] = allRows.map((conn) => {
      if (conn.authType !== 'operator_session') {
        return Object.assign(conn, {
          label: conn.label ?? null,
          isDefault: conn.isDefault,
          usabilityState: 'connected_usable' as UsabilityState,
          allowedAgentIds: null as string[] | null,
          availabilityScope: 'all_agents' as const,
        });
      }
      const cfg = (conn.configJson as ConfigJson | null)?.operator_session;
      return Object.assign(conn, {
        label: conn.label ?? null,
        isDefault: conn.isDefault,
        usabilityState: (conn.usabilityState as UsabilityState) ?? 'connected_unverified',
        allowedAgentIds: cfg?.allowedAgentIds ?? null,
        availabilityScope: cfg?.availabilityScope ?? 'all_agents',
      });
    });

    const ordered = orderResolvedCredentials(orderableRows, params.agentId ?? '');

    return ordered.map((conn) => ({
      credentialId: conn.id,
      connectionId: conn.id,
      authType: conn.authType === 'operator_session' ? 'operator_session' : mapAuthType(conn.authType),
      providerType: conn.providerType,
      subaccountId: conn.subaccountId,
    }));
  },

  /**
   * Requests an operator-session credential for the given subaccount and agent run.
   *
   * Returns an OperatorSessionEnvelope when a usable credential exists, or
   * { unavailable: true, reason } when no usable credential is available.
   *
   * Only returns credentials whose subaccount_id matches the requested subaccountId
   * (broker-side subaccount-match; adapter performs defence-in-depth assertion).
   *
   * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.6
   */
  async requestOperatorSessionCredential(params: {
    organisationId: string;
    subaccountId: string;
    agentRunId: string;
  }): Promise<OperatorSessionEnvelope | { unavailable: true; reason: string }> {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organisationId, params.organisationId),
          eq(integrationConnections.subaccountId, params.subaccountId),
          eq(integrationConnections.authType, 'operator_session'),
          eq(integrationConnections.connectionStatus, 'active'),
          eq(integrationConnections.usabilityState, 'connected_usable'),
        ),
      )
      .limit(1);

    if (!conn) {
      return { unavailable: true, reason: 'no_usable_operator_session_credential' };
    }

    return {
      credentialId: conn.id,
      connectionId: conn.id,
      subaccountId: conn.subaccountId ?? params.subaccountId,
      authType: 'operator_session' as const,
      provider: conn.providerType,
      planTier: (conn.planTier ?? 'unknown') as 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown',
      usabilityState: 'connected_usable' as const,
      issuedAt: new Date().toISOString(),
      expiresAt: conn.tokenExpiresAt ? conn.tokenExpiresAt.toISOString() : null,
    };
  },

  /**
   * Resolves the fallback credential when the operator-session is unavailable.
   *
   * Returns a { envelope, mode } pair, or null if no fallback is available.
   * Tries a refreshed operator-session first; falls back to an active API-key connection.
   *
   * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.7 item 2
   */
  async resolveFallback(params: {
    organisationId: string;
    subaccountId: string;
    agentRunId: string;
    originalCredentialId: string;
  }): Promise<{ envelope: OperatorSessionEnvelope | ApiKeyEnvelope; mode: 'operator_session' | 'api_key' } | null> {
    // Try a different operator-session credential (not the failing one).
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [otherSession] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organisationId, params.organisationId),
          eq(integrationConnections.subaccountId, params.subaccountId),
          eq(integrationConnections.authType, 'operator_session'),
          eq(integrationConnections.connectionStatus, 'active'),
          eq(integrationConnections.usabilityState, 'connected_usable'),
          ne(integrationConnections.id, params.originalCredentialId),
        ),
      )
      .limit(1);

    if (otherSession) {
      const envelope: OperatorSessionEnvelope = {
        credentialId: otherSession.id,
        connectionId: otherSession.id,
        subaccountId: otherSession.subaccountId ?? params.subaccountId,
        authType: 'operator_session' as const,
        provider: otherSession.providerType,
        planTier: (otherSession.planTier ?? 'unknown') as 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown',
        usabilityState: 'connected_usable' as const,
        issuedAt: new Date().toISOString(),
        expiresAt: otherSession.tokenExpiresAt ? otherSession.tokenExpiresAt.toISOString() : null,
      };
      return { envelope, mode: 'operator_session' };
    }

    // Fall back to an API-key connection for the same subaccount.
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [apiKeyConn] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organisationId, params.organisationId),
          eq(integrationConnections.subaccountId, params.subaccountId),
          eq(integrationConnections.authType, 'api_key'),
          eq(integrationConnections.connectionStatus, 'active'),
        ),
      )
      .limit(1);

    if (apiKeyConn) {
      const envelope: ApiKeyEnvelope = {
        credentialId: apiKeyConn.id,
        connectionId: apiKeyConn.id,
        subaccountId: apiKeyConn.subaccountId ?? params.subaccountId,
        authType: 'api_key' as const,
        provider: apiKeyConn.providerType,
        issuedAt: new Date().toISOString(),
        expiresAt: apiKeyConn.tokenExpiresAt ? apiKeyConn.tokenExpiresAt.toISOString() : null,
      };
      return { envelope, mode: 'api_key' };
    }

    return null;
  },

  /**
   * Emits the OPERATOR_SESSION_USABILITY_RESTORED lifecycle event.
   *
   * Called when the broker detects that a previously unavailable operator-session
   * credential has become usable again. Clears fallback stickiness for any
   * agent runs waiting on the next chain-link dispatch.
   *
   * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.7 item 6
   */
  async emitUsabilityRestored(params: {
    connectionId: string;
    agentRunId?: string;
  }): Promise<void> {
    if (params.agentRunId) {
      emitAgentRunUpdate(params.agentRunId, OPERATOR_SESSION_USABILITY_RESTORED, {
        event: OPERATOR_SESSION_USABILITY_RESTORED,
        agent_run_id: params.agentRunId,
        credential_id: params.connectionId,
      });
    }
  },
};
