/**
 * server/services/optimiser/optimiserSubaccountHook.ts
 *
 * Hook called on new sub-account creation to register the optimiser agent link
 * and its daily schedule.
 *
 * Idempotent: uses INSERT ... ON CONFLICT DO NOTHING so re-running is safe.
 * Non-critical: all errors are caught so subaccount creation never fails.
 *
 * Spec: docs/sub-account-optimiser-spec.md §4, §9 Phase 2
 */

import { db } from '../../db/index.js';
import { agents, subaccountAgents } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';
import { agentScheduleService } from '../agentScheduleService.js';
import { computeOptimiserCron } from './optimiserCronPure.js';

const OPTIMISER_AGENT_SLUG = 'subaccount-optimiser';

/**
 * Called after a new sub-account is created.
 *
 * When `optimiser_enabled=true` (the default) AND `OPTIMISER_DISABLED` is not set:
 *   1. Find the optimiser agent for the organisation.
 *   2. Idempotently create the subaccount_agents link.
 *   3. Register the daily schedule using the deterministic cron.
 *
 * Any failure is caught and logged — sub-account creation must not fail because
 * of the optimiser hook. The next backfill run will close the gap.
 */
export async function registerOptimiserForSubaccount(input: {
  subaccountId: string;
  organisationId: string;
  optimiserEnabled?: boolean;
}): Promise<void> {
  const { subaccountId, organisationId, optimiserEnabled = true } = input;

  if (!optimiserEnabled) {
    return;
  }

  // Global kill switch
  if (process.env['OPTIMISER_DISABLED'] === 'true') {
    logger.info('recommendations.schedule_skip.global_kill_switch', {
      subaccountId,
      organisationId,
    });
    return;
  }

  try {
    // Find the optimiser agent for this org
    const [optimiserAgent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.organisationId, organisationId),
          eq(agents.slug, OPTIMISER_AGENT_SLUG),
        ),
      );

    if (!optimiserAgent) {
      logger.warn('recommendations.schedule_skip.agent_not_found', {
        subaccountId,
        organisationId,
        slug: OPTIMISER_AGENT_SLUG,
      });
      return;
    }

    const agentId = optimiserAgent.id;
    const scheduleCron = computeOptimiserCron(subaccountId);

    // Idempotent insert: ON CONFLICT DO NOTHING
    const [linkRow] = await db
      .insert(subaccountAgents)
      .values({
        organisationId,
        subaccountId,
        agentId,
        isActive: true,
        scheduleEnabled: true,
        scheduleCron,
        scheduleTimezone: 'UTC',
      })
      .onConflictDoNothing()
      .returning();

    // If the link already existed, look it up
    let linkId: string;
    if (linkRow) {
      linkId = linkRow.id;
    } else {
      const [existing] = await db
        .select({ id: subaccountAgents.id })
        .from(subaccountAgents)
        .where(
          and(
            eq(subaccountAgents.subaccountId, subaccountId),
            eq(subaccountAgents.agentId, agentId),
          ),
        );

      if (!existing) {
        logger.error('recommendations.schedule_skip.link_lookup_failed', {
          subaccountId,
          organisationId,
          agentId,
        });
        return;
      }

      linkId = existing.id;
    }

    // Register the schedule with singletonKey
    const singletonKey = `subaccount-optimiser:${subaccountId}:${agentId}`;
    await agentScheduleService.registerSchedule(
      linkId,
      scheduleCron,
      {
        subaccountAgentId: linkId,
        agentId,
        subaccountId,
        organisationId,
      },
      'UTC',
      singletonKey,
    );

    logger.info('recommendations.schedule_registered', {
      subaccountId,
      organisationId,
      agentId,
      linkId,
      scheduleCron,
      singletonKey,
    });
  } catch (err) {
    // Non-critical — let subaccount creation succeed
    logger.error('recommendations.schedule_registration_failed', {
      subaccountId,
      organisationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
