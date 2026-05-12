import { eq, and, gte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { withAdminConnection } from '../../lib/adminDbConnection.js';
import { integrationConnections } from '../../db/schema/index.js';
import { externalTriggerDedup } from '../../db/schema/externalTriggerDedup.js';
import { triggerService } from '../triggerService.js';
import { MAX_EXTERNAL_TRIGGERED_RUNS_PER_MINUTE_PER_OWNER } from '../../config/limits.js';
import { deriveDedupKey } from './externalSourceTriggersPure.js';
import type { ExternalSourceTriggerEvent } from '../../../shared/types/externalSourceTrigger.js';

// ---------------------------------------------------------------------------
// External-source trigger dispatch
// ---------------------------------------------------------------------------

export type DispatchOutcome = 'fired' | 'dedup_hit' | 'rate_capped' | 'owner_unresolved' | 'owner_mismatch';

export interface DispatchResult {
  outcome: DispatchOutcome;
  triggerId?: string;
  runId?: string;
}

function providerForEventType(eventType: ExternalSourceTriggerEvent['eventType']): 'gmail' | 'google_calendar' | 'slack' {
  switch (eventType) {
    case 'gmail_message_received': return 'gmail';
    case 'calendar_event_imminent': return 'google_calendar';
    case 'slack_mention': return 'slack';
  }
}

export async function dispatch(
  event: ExternalSourceTriggerEvent,
  ctx: { organisationId: string; subaccountId?: string }
): Promise<DispatchResult> {
  const provider = providerForEventType(event.eventType);
  const dedupKey = deriveDedupKey(event);

  // 1. Owner resolution — look up integration connection to derive subaccount + verify owner
  const [connection] = await db
    .select({
      id: integrationConnections.id,
      ownerUserId: integrationConnections.ownerUserId,
      subaccountId: integrationConnections.subaccountId,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.ownerUserId, event.ownerUserId),
        eq(integrationConnections.providerType, provider),
        eq(integrationConnections.connectionStatus, 'active')
      )
    )
    .limit(1);

  if (!connection) {
    return { outcome: 'owner_unresolved' };
  }

  if (connection.ownerUserId && connection.ownerUserId !== event.ownerUserId) {
    return { outcome: 'owner_mismatch' };
  }

  const subaccountId = ctx.subaccountId ?? connection.subaccountId;
  if (!subaccountId) {
    return { outcome: 'owner_unresolved' };
  }

  // 2. Rate-cap check — must come BEFORE dedup insert so a rate-capped event
  //    does not plant a permanent dedup key that silences future valid events.
  //
  // Admin-bypass note (chatgpt-pr-review R2 F1):
  //   external_trigger_dedup is FORCE-RLS; its USING/WITH CHECK policies key
  //   on app.current_user_id and app.organisation_id session variables. The
  //   webhook + poll dispatch path runs without app.current_user_id set
  //   (jobs only set app.organisation_id; webhooks have no per-user context).
  //   We therefore route both the rate-cap SELECT and the dedup INSERT through
  //   `withAdminConnection` + `SET LOCAL ROLE admin_role` (BYPASSRLS) so the
  //   operations succeed regardless of the caller's session GUCs. User-facing
  //   read paths never touch this table.
  const since = new Date(Date.now() - 60_000);
  const total = await withAdminConnection(
    {
      source: 'externalSourceTriggers.dispatch',
      reason: 'rate-cap count against external_trigger_dedup (admin write path)',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(externalTriggerDedup)
        .where(
          and(
            eq(externalTriggerDedup.ownerUserId, event.ownerUserId),
            gte(externalTriggerDedup.firedAt, since),
          ),
        );
      return total ?? 0;
    },
  );

  if (total >= MAX_EXTERNAL_TRIGGERED_RUNS_PER_MINUTE_PER_OWNER) {
    return { outcome: 'rate_capped' };
  }

  // 3. Dedup check — insert with ON CONFLICT DO NOTHING. Uses the resolved subaccountId
  //    so the row satisfies the NOT NULL constraint on external_trigger_dedup.subaccount_id.
  //    Admin-bypass write per the note above.
  const inserted = await withAdminConnection(
    {
      source: 'externalSourceTriggers.dispatch',
      reason: 'insert external_trigger_dedup row (admin write path)',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return tx
        .insert(externalTriggerDedup)
        .values({
          provider,
          dedupKey,
          ownerUserId: event.ownerUserId,
          organisationId: ctx.organisationId,
          subaccountId,
          firedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ provider: externalTriggerDedup.provider });
    },
  );

  if (inserted.length === 0) {
    return { outcome: 'dedup_hit' };
  }

  // 4. Fire trigger — call checkAndFire with resolved owner context
  await triggerService.checkAndFire(
    subaccountId,
    ctx.organisationId,
    event.eventType,
    event as unknown as Record<string, unknown>
  );

  return { outcome: 'fired' };
}
