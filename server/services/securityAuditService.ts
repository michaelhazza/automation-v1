import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { securityAuditEvents } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { normaliseSecurityEvent, type SecurityEventInput } from './securityAuditServicePure.js';

export type { SecurityEventInput };

/**
 * Sentinel organisation UUID used for security events that occur before a
 * tenant context can be established (e.g. `auth.login.failure` — login was
 * rejected, so we never resolved an organisation). Admin queries scoped to
 * a real org UUID will not see these rows; queries against the sentinel UUID
 * surface pre-auth events. Tracked as AR-1.1 in tasks/todo.md.
 */
export const SECURITY_AUDIT_SENTINEL_ORG_ID = '00000000-0000-0000-0000-000000000000';

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    const norm = normaliseSecurityEvent(input);
    // security_audit_events has FORCE ROW LEVEL SECURITY — the module-level pool connection
    // has no app.organisation_id GUC, so we must set it explicitly inside our own transaction
    // (same pattern as taskEventService.appendAndEmitTaskEvent per KNOWLEDGE.md 2026-05-05).
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${norm.organisationId}, true)`);
      await tx.insert(securityAuditEvents).values({
        organisationId: norm.organisationId,
        subaccountId:   norm.subaccountId ?? null,
        actorUserId:    norm.actorUserId ?? null,
        actorRole:      norm.actorRole ?? null,
        eventType:      norm.eventType,
        targetType:     norm.targetType ?? null,
        targetId:       norm.targetId ?? null,
        ip:             norm.ip ?? null,
        userAgent:      norm.userAgent ?? null,
        meta:           norm.meta ?? {},
        occurredAt:     sql`now()`,
      });
    });
  } catch (err) {
    logger.error('security_audit_write_failed', {
      err: err instanceof Error ? err.message : String(err),
      organisationId: input.organisationId,
      eventType: input.eventType,
    });
  }
}
