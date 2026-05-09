// Credential Broker and Identity Boundary primitive per v1.2 brief. See docs/synthetos-nomenclature.md
// 'operator_session' is Phase-3 forward-compatible — do NOT add the literal yet

import { and, desc, eq, gte, sql as sqlOp } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditEvents, integrationConnections } from '../db/schema/index.js';
import { connectionTokenService } from './connectionTokenService.js';
import { integrationConnectionService } from './integrationConnectionService.js';
import { logger } from '../lib/logger.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface IssuedCredential {
  credentialId: string;
  connectionId: string;
  authType: 'oauth2' | 'api_key' | 'web_login';
  issuedAt: Date;
  expiresAt?: Date;
}

export interface ResolvedCredential {
  credentialId: string;
  connectionId: string;
  authType: 'oauth2' | 'api_key' | 'web_login';
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
  }): Promise<IssuedCredential> {
    const [conn] = await db
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
   */
  async injectIntoEnvironment(params: {
    issuedCredential: IssuedCredential;
    environment: Record<string, string>;
  }): Promise<void> {
    const { issuedCredential, environment } = params;

    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, issuedCredential.connectionId))
      .limit(1);

    if (!conn) {
      throw Object.assign(
        new Error(`Connection ${issuedCredential.connectionId} not found for injection`),
        { statusCode: 404, errorCode: 'credential_not_found' },
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
      const result = await db
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

    const rows = await db
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
   */
  async resolveAvailableCredentials(params: {
    organisationId: string;
    subaccountId: string;
  }): Promise<ResolvedCredential[]> {
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organisationId, params.organisationId),
          eq(integrationConnections.subaccountId, params.subaccountId),
          eq(integrationConnections.connectionStatus, 'active'),
        ),
      );

    return rows.map((conn) => ({
      credentialId: conn.id,
      connectionId: conn.id,
      authType: mapAuthType(conn.authType),
      providerType: conn.providerType,
      subaccountId: conn.subaccountId,
    }));
  },
};
