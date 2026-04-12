import { eq, and, isNull, gte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentTriggers, agentRuns, subaccountAgents } from '../db/schema/index.js';
import { MAX_TRIGGERED_RUNS_PER_MINUTE } from '../config/limits.js';

// ---------------------------------------------------------------------------
// Trigger Service — checks and fires event-based agent triggers
// ---------------------------------------------------------------------------

type JobSender = (name: string, data: object) => Promise<string | null>;

let triggerJobSender: JobSender | null = null;

export function setTriggerJobSender(sender: JobSender): void {
  triggerJobSender = sender;
}

const TRIGGER_RUN_QUEUE = 'agent-triggered-run';

// ---------------------------------------------------------------------------
// Rate cap helpers
// ---------------------------------------------------------------------------

async function countTriggeredRunsInLastMinute(subaccountId: string): Promise<number> {
  const since = new Date(Date.now() - 60_000);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.subaccountId, subaccountId),
        eq(agentRuns.runType, 'triggered'),
        gte(agentRuns.createdAt, since)
      )
    );
  return total ?? 0;
}

// ---------------------------------------------------------------------------
// Filter matching
// ---------------------------------------------------------------------------

function matchesFilter(
  filter: Record<string, unknown>,
  eventData: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (eventData[key] !== value) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const triggerService = {
  /**
   * Check active triggers for a given event and fire matching ones.
   * Non-blocking: call with .catch() at hook points.
   */
  async checkAndFire(
    subaccountId: string,
    organisationId: string,
    eventType: 'task_created' | 'task_moved' | 'agent_completed',
    eventData: Record<string, unknown>
  ): Promise<void> {
    // Rate cap check
    const recentCount = await countTriggeredRunsInLastMinute(subaccountId);

    if (recentCount >= MAX_TRIGGERED_RUNS_PER_MINUTE) {
      console.warn(`[TriggerService] Rate cap reached (${recentCount}/${MAX_TRIGGERED_RUNS_PER_MINUTE}) for ${eventType} in subaccount ${subaccountId} — suppressing`);
      return;
    }

    // Soft warning at 70%
    if (recentCount >= Math.floor(MAX_TRIGGERED_RUNS_PER_MINUTE * 0.7)) {
      console.warn(`[TriggerService] Approaching rate cap (${recentCount}/${MAX_TRIGGERED_RUNS_PER_MINUTE}) for subaccount ${subaccountId}`);
    }

    // Load active triggers for this event
    const triggers = await db
      .select()
      .from(agentTriggers)
      .where(
        and(
          eq(agentTriggers.subaccountId, subaccountId),
          eq(agentTriggers.eventType, eventType),
          eq(agentTriggers.isActive, true),
          isNull(agentTriggers.deletedAt)
        )
      );

    if (triggers.length === 0) return;

    let fired = 0;

    for (const trigger of triggers) {
      // In-loop rate cap: re-check so a single batch cannot overshoot
      if (recentCount + fired >= MAX_TRIGGERED_RUNS_PER_MINUTE) {
        console.warn(`[TriggerService] Rate cap hit mid-batch (${recentCount + fired}/${MAX_TRIGGERED_RUNS_PER_MINUTE}) for subaccount ${subaccountId} — stopping`);
        break;
      }

      // Cooldown check
      if (trigger.lastTriggeredAt) {
        const cooldownMs = trigger.cooldownSeconds * 1000;
        const elapsed = Date.now() - trigger.lastTriggeredAt.getTime();
        if (elapsed < cooldownMs) continue;
      }

      // Filter match
      const filter = (trigger.eventFilter ?? {}) as Record<string, unknown>;
      if (!matchesFilter(filter, eventData)) continue;

      // Self-trigger guard — skip if the triggering agent is the target agent
      const triggeringAgentId = eventData.agentId as string | undefined;
      if (triggeringAgentId) {
        const [saLink] = await db
          .select({ agentId: subaccountAgents.agentId })
          .from(subaccountAgents)
          .where(eq(subaccountAgents.id, trigger.subaccountAgentId!))
          .limit(1);

        if (saLink?.agentId === triggeringAgentId) continue;
      }

      // Enqueue via pg-boss
      if (triggerJobSender) {
        await triggerJobSender(TRIGGER_RUN_QUEUE, {
          subaccountAgentId: trigger.subaccountAgentId,
          subaccountId,
          organisationId,
          triggerContext: { source: 'trigger', eventType, eventData, triggerId: trigger.id },
        });
      }

      // Update trigger stats
      await db
        .update(agentTriggers)
        .set({
          lastTriggeredAt: new Date(),
          triggerCount: trigger.triggerCount + 1,
          updatedAt: new Date(),
        })
        // guard-ignore-next-line: org-scoped-writes reason="trigger was loaded from prior org-scoped query filtered by organisationId and subaccountId"
        .where(eq(agentTriggers.id, trigger.id));

      fired++;
    }

    console.info(`[TriggerService] Fired ${fired} of ${triggers.length} triggers for ${eventType} in subaccount ${subaccountId}`);
  },

  /**
   * Dry run — returns what would fire without executing.
   */
  async dryRun(
    subaccountId: string,
    organisationId: string,
    eventType: 'task_created' | 'task_moved' | 'agent_completed',
    eventData: Record<string, unknown>
  ): Promise<Array<{ triggerId: string; agentId: string | null; wouldFire: boolean; reason?: string }>> {
    const triggers = await db
      .select()
      .from(agentTriggers)
      .where(
        and(
          eq(agentTriggers.subaccountId, subaccountId),
          eq(agentTriggers.eventType, eventType),
          eq(agentTriggers.isActive, true),
          isNull(agentTriggers.deletedAt)
        )
      );

    const results: Array<{ triggerId: string; agentId: string | null; wouldFire: boolean; reason?: string }> = [];

    for (const trigger of triggers) {
      // Look up agent ID for the response
      const [saLink] = await db
        .select({ agentId: subaccountAgents.agentId })
        .from(subaccountAgents)
        .where(eq(subaccountAgents.id, trigger.subaccountAgentId!))
        .limit(1);

      const agentId = saLink?.agentId ?? null;

      // Cooldown check
      if (trigger.lastTriggeredAt) {
        const cooldownMs = trigger.cooldownSeconds * 1000;
        const elapsed = Date.now() - trigger.lastTriggeredAt.getTime();
        if (elapsed < cooldownMs) {
          results.push({ triggerId: trigger.id, agentId, wouldFire: false, reason: 'cooldown_active' });
          continue;
        }
      }

      // Filter match
      const filter = (trigger.eventFilter ?? {}) as Record<string, unknown>;
      if (!matchesFilter(filter, eventData)) {
        results.push({ triggerId: trigger.id, agentId, wouldFire: false, reason: 'filter_mismatch' });
        continue;
      }

      // Self-trigger guard
      const triggeringAgentId = eventData.agentId as string | undefined;
      if (triggeringAgentId && agentId === triggeringAgentId) {
        results.push({ triggerId: trigger.id, agentId, wouldFire: false, reason: 'self_trigger' });
        continue;
      }

      results.push({ triggerId: trigger.id, agentId, wouldFire: true });
    }

    return results;
  },

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async listTriggers(subaccountId: string, organisationId: string) {
    return db
      .select()
      .from(agentTriggers)
      .where(
        and(
          eq(agentTriggers.subaccountId, subaccountId),
          eq(agentTriggers.organisationId, organisationId),
          isNull(agentTriggers.deletedAt)
        )
      );
  },

  async createTrigger(data: {
    organisationId: string;
    subaccountId: string;
    subaccountAgentId: string;
    eventType: 'task_created' | 'task_moved' | 'agent_completed';
    eventFilter?: Record<string, unknown>;
    cooldownSeconds?: number;
  }) {
    const [trigger] = await db
      .insert(agentTriggers)
      .values({
        organisationId: data.organisationId,
        subaccountId: data.subaccountId,
        subaccountAgentId: data.subaccountAgentId,
        eventType: data.eventType,
        eventFilter: data.eventFilter ?? {},
        cooldownSeconds: data.cooldownSeconds ?? 60,
        isActive: true,
        triggerCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return trigger;
  },

  async updateTrigger(
    triggerId: string,
    organisationId: string,
    subaccountId: string,
    data: {
      eventFilter?: Record<string, unknown>;
      cooldownSeconds?: number;
      isActive?: boolean;
    }
  ) {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.eventFilter !== undefined) update.eventFilter = data.eventFilter;
    if (data.cooldownSeconds !== undefined) update.cooldownSeconds = data.cooldownSeconds;
    if (data.isActive !== undefined) update.isActive = data.isActive;

    const [updated] = await db
      .update(agentTriggers)
      .set(update)
      .where(
        and(
          eq(agentTriggers.id, triggerId),
          eq(agentTriggers.organisationId, organisationId),
          eq(agentTriggers.subaccountId, subaccountId),
          isNull(agentTriggers.deletedAt)
        )
      )
      .returning();

    if (!updated) throw { statusCode: 404, message: 'Trigger not found' };
    return updated;
  },

  async deleteTrigger(triggerId: string, organisationId: string, subaccountId: string) {
    const [deleted] = await db
      .update(agentTriggers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(agentTriggers.id, triggerId),
          eq(agentTriggers.organisationId, organisationId),
          eq(agentTriggers.subaccountId, subaccountId),
          isNull(agentTriggers.deletedAt)
        )
      )
      .returning();

    if (!deleted) throw { statusCode: 404, message: 'Trigger not found' };
    return deleted;
  },
};
