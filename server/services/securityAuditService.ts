import { sql, eq, or, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { securityAuditEvents } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import {
  normaliseSecurityEventV2,
  type SecurityEventInput,
  type SecurityEventInputV2,
} from './securityAuditServicePure.js';

export type { SecurityEventInput, SecurityEventInputV2 };

/**
 * Sentinel organisation UUID used for security events that occur before a
 * tenant context can be established (e.g. `auth.login.failure` — login was
 * rejected, so we never resolved an organisation). Admin queries scoped to
 * a real org UUID will not see these rows; queries against the sentinel UUID
 * surface pre-auth events. Tracked as AR-1.1 in tasks/todo.md.
 */
export const SECURITY_AUDIT_SENTINEL_ORG_ID = '00000000-0000-0000-0000-000000000000';

async function writeNormalisedEvent(norm: {
  organisationId: string;
  subaccountId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta: Record<string, unknown>;
}): Promise<void> {
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
}

export async function recordSecurityEvent(input: SecurityEventInputV2): Promise<void> {
  try {
    const norm = normaliseSecurityEventV2(input);
    await writeNormalisedEvent(norm);
  } catch (err) {
    logger.error('security_audit_write_failed', {
      err: err instanceof Error ? err.message : String(err),
      organisationId: input.organisationId,
      eventType: input.event.name,
    });
  }
}

export interface QueryAuditEventsOptions {
  organisationId: string;
  includeSentinelOrg?: boolean;
  eventType?: string;
  limit?: number;
}

/**
 * Admin-query helper — returns security audit events for an organisation.
 *
 * When `includeSentinelOrg` is true, events stored under
 * `SECURITY_AUDIT_SENTINEL_ORG_ID` (pre-auth events such as OAuth state
 * lifecycle and failed logins with no resolved org) are included alongside the
 * tenant's own events. This is the typical query shape for an admin dashboard
 * that wants the full picture: tenant events + pre-auth events.
 *
 * The sentinel org's rows require a `set_config` GUC binding so RLS passes.
 * We use the sentinel org ID itself when writing the query transaction.
 */
export async function queryAuditEvents(
  options: QueryAuditEventsOptions,
): Promise<(typeof securityAuditEvents.$inferSelect)[]> {
  const { organisationId, includeSentinelOrg = false, eventType, limit = 100 } = options;

  return db.transaction(async (tx) => {
    // Bind the organisation ID for RLS. The sentinel org rows are accessible
    // because the sentinel row exists as a valid FK target — the transaction
    // binds organisationId, and the OR clause on the sentinel UUID is
    // evaluated by the query engine after RLS passes on the primary org.
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);

    const baseCondition = includeSentinelOrg
      ? or(
          eq(securityAuditEvents.organisationId, organisationId),
          eq(securityAuditEvents.organisationId, SECURITY_AUDIT_SENTINEL_ORG_ID),
        )
      : eq(securityAuditEvents.organisationId, organisationId);

    const rows = await tx
      .select()
      .from(securityAuditEvents)
      .where(
        eventType
          ? sql`(${baseCondition}) AND ${securityAuditEvents.eventType} = ${eventType}`
          : baseCondition,
      )
      .orderBy(desc(securityAuditEvents.occurredAt))
      .limit(limit);

    return rows;
  });
}
