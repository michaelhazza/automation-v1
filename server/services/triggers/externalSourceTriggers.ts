import { eq, and, gte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
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
  const since = new Date(Date.now() - 60_000);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(externalTriggerDedup)
    .where(
      and(
        eq(externalTriggerDedup.ownerUserId, event.ownerUserId),
        gte(externalTriggerDedup.firedAt, since),
      )
    );

  if ((total ?? 0) >= MAX_EXTERNAL_TRIGGERED_RUNS_PER_MINUTE_PER_OWNER) {
    return { outcome: 'rate_capped' };
  }

  // 3. Dedup check — insert with ON CONFLICT DO NOTHING. Uses the resolved subaccountId
  //    so the row satisfies the NOT NULL constraint on external_trigger_dedup.subaccount_id.
  const inserted = await db
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
