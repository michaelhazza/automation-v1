import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { oauthStateNonces } from '../db/schema/oauthStateNonces.js';
import { and, eq, gt, sql } from 'drizzle-orm';
import { recordSecurityEvent, SECURITY_AUDIT_SENTINEL_ORG_ID } from './securityAuditService.js';
import { auditEvent } from '../../shared/types/securityAuditEvents.js';

const TTL_MS = 5 * 60 * 1000; // 5 minutes — tighten the OAuth callback window

export async function setGhlOAuthState(
  nonce: string,
  organisationId: string,
  pendingRunId?: string,
  context?: { userAgent?: string | null; ip?: string | null },
): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_MS);
  const scopedDb = getOrgScopedDb('ghlOAuthStateStore.setGhlOAuthState');
  await scopedDb.insert(oauthStateNonces).values({
    nonce,
    organisationId,
    expiresAt,
    pendingRunId: pendingRunId ?? null,
  });

  void recordSecurityEvent({
    event:          auditEvent.oauth.stateIssued,
    organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
    userAgent:      context?.userAgent ?? null,
    ip:             context?.ip ?? null,
    meta:           { provider: 'ghl' },
  });
}

export interface ConsumeResult {
  rowFromDelete: { issuedAt: Date } | null;
  expiredRow: { issuedAt: Date; expiresAt: Date } | null;
}

/**
 * Classifies the outcome of an OAuth state consume attempt.
 *
 * - `rowFromDelete` is the row returned by the DELETE (present = state was valid and consumed)
 * - `expiredRow` is the row returned by a follow-up SELECT (present = state existed but was expired)
 * - If both are null, the state was never issued or has been purged by the cleanup job.
 */
export function classifyOAuthStateConsumeResult(result: ConsumeResult): 'consumed' | 'expired' | 'not_found' {
  if (result.rowFromDelete !== null) return 'consumed';
  if (result.expiredRow !== null) return 'expired';
  return 'not_found';
}

// Nonce is single-use: DELETE ... RETURNING atomically guarantees consume-once.
// On a miss the follow-up SELECT distinguishes expired vs never-issued for observability.
export async function consumeGhlOAuthState(
  nonce: string,
  context?: { userAgent?: string | null; ip?: string | null },
): Promise<{ organisationId: string; pendingRunId: string | null } | null> {
  const now = new Date();

  // Step 1: attempt to DELETE the row only if it has not expired yet.
  // Use DB time (sql`now()`) rather than new Date() to avoid clock-skew across nodes.
  // oauth_state_nonces has no RLS; withAdminConnection is used here because
  // this is the unauthenticated OAuth callback path — no org context is available
  // before the nonce is consumed and the organisationId recovered from it.
  const deletedRows = await withAdminConnection(
    { source: 'ghlOAuthStateStore.consumeGhlOAuthState',
      reason: 'unauthenticated OAuth callback — org context not yet established; nonce table has no RLS',
      skipAudit: true },
    async (adminDb) => adminDb
      .delete(oauthStateNonces)
      .where(and(eq(oauthStateNonces.nonce, nonce), gt(oauthStateNonces.expiresAt, sql`now()`)))
      .returning({
        organisationId: oauthStateNonces.organisationId,
        pendingRunId:   oauthStateNonces.pendingRunId,
        createdAt:      oauthStateNonces.createdAt,
      }),
  );

  if (deletedRows[0]) {
    const issuedAt = deletedRows[0].createdAt;
    const latencyMs = now.getTime() - issuedAt.getTime();
    void recordSecurityEvent({
      event:          auditEvent.oauth.stateConsumed,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      userAgent:      context?.userAgent ?? null,
      ip:             context?.ip ?? null,
      meta:           { provider: 'ghl', issuedAt: issuedAt.toISOString(), consumedAt: now.toISOString(), latencyMs },
    });
    return { organisationId: deletedRows[0].organisationId, pendingRunId: deletedRows[0].pendingRunId };
  }

  // Step 2: DELETE returned nothing — check whether the row exists but is expired,
  // or was never issued (or already purged by the cleanup job).
  //
  // Race note: between the DELETE above and this SELECT, the maintenance/cleanup job
  // could have purged the expired row. A false not_found is the only possible outcome
  // of that race — this is an observability nit, not a security issue.
  const expiredRows = await withAdminConnection(
    { source: 'ghlOAuthStateStore.consumeGhlOAuthState.expiredCheck',
      reason: 'unauthenticated OAuth callback — checking expired nonce for observability',
      skipAudit: true },
    async (adminDb) => adminDb
      .select({
        createdAt: oauthStateNonces.createdAt,
        expiresAt: oauthStateNonces.expiresAt,
      })
      .from(oauthStateNonces)
      .where(eq(oauthStateNonces.nonce, nonce)),
  );

  const classification = classifyOAuthStateConsumeResult({
    rowFromDelete: null,
    expiredRow: expiredRows[0]
      ? { issuedAt: expiredRows[0].createdAt, expiresAt: expiredRows[0].expiresAt }
      : null,
  });

  if (classification === 'expired') {
    const issuedAt = expiredRows[0]!.createdAt;
    const latencyMs = now.getTime() - issuedAt.getTime();
    void recordSecurityEvent({
      event:          auditEvent.oauth.stateExpired,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      userAgent:      context?.userAgent ?? null,
      ip:             context?.ip ?? null,
      meta:           { provider: 'ghl', issuedAt: issuedAt.toISOString(), latencyMs },
    });
  } else {
    void recordSecurityEvent({
      event:          auditEvent.oauth.stateNotFound,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      userAgent:      context?.userAgent ?? null,
      ip:             context?.ip ?? null,
      meta:           { provider: 'ghl' },
    });
  }

  return null;
}
