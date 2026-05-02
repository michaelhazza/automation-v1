/**
 * scripts/backfill-optimiser-schedules.ts
 *
 * One-shot backfill script that registers the optimiser agent + daily schedule
 * for every sub-account where subaccounts.optimiser_enabled = true.
 *
 * Idempotent: uses INSERT ... ON CONFLICT DO NOTHING for the subaccount_agents
 * link, so re-running produces zero new rows the second time.
 *
 * The cron is computed deterministically per sub-account via
 * computeOptimiserCron(subaccountId), spreading fires across 06:00-11:59 UTC.
 * This is NOT a one-time stagger — the same formula is applied by
 * subaccountService.create hooks for new sub-accounts going forward.
 *
 * Usage:
 *   npx tsx scripts/backfill-optimiser-schedules.ts
 *   npx tsx scripts/backfill-optimiser-schedules.ts --dry-run
 *
 * Spec: docs/sub-account-optimiser-spec.md §4, §13
 */

import 'dotenv/config';
import { db } from '../server/db/index.js';
import { subaccounts, agents, subaccountAgents } from '../server/db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { computeOptimiserCron } from '../server/services/optimiser/optimiserCronPure.js';
import { agentScheduleService } from '../server/services/agentScheduleService.js';

const DRY_RUN = process.argv.includes('--dry-run');
const OPTIMISER_AGENT_SLUG = 'subaccount-optimiser';

async function main(): Promise<void> {
  if (process.env['OPTIMISER_DISABLED'] === 'true') {
    console.log('OPTIMISER_DISABLED=true: backfill skipped');
    return;
  }

  console.log(`[backfill-optimiser-schedules] Starting${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  // Fetch all opted-in sub-accounts (include settings for timezone)
  const eligibleSubaccounts = await db
    .select({
      id: subaccounts.id,
      organisationId: subaccounts.organisationId,
      name: subaccounts.name,
      settings: subaccounts.settings,
    })
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.optimiserEnabled, true),
        isNull(subaccounts.deletedAt),
      ),
    );

  console.log(`[backfill-optimiser-schedules] Found ${eligibleSubaccounts.length} eligible sub-accounts.`);

  if (eligibleSubaccounts.length === 0) {
    console.log('[backfill-optimiser-schedules] Nothing to do.');
    return;
  }

  // Group by org to minimise agent lookups
  const orgIds = [...new Set(eligibleSubaccounts.map((sa) => sa.organisationId))];

  // Build org → optimiser agent id map
  const orgAgentMap = new Map<string, string>();
  for (const orgId of orgIds) {
    const [optimiserAgent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.organisationId, orgId), eq(agents.slug, OPTIMISER_AGENT_SLUG)));

    if (optimiserAgent) {
      orgAgentMap.set(orgId, optimiserAgent.id);
    } else {
      console.warn(`[backfill-optimiser-schedules] WARNING: No optimiser agent found for org ${orgId} — skipping sub-accounts in this org.`);
    }
  }

  let created = 0;
  let alreadyExisted = 0;
  let scheduleRegistered = 0;
  let errors = 0;

  for (const sa of eligibleSubaccounts) {
    const agentId = orgAgentMap.get(sa.organisationId);
    if (!agentId) {
      continue;
    }

    const scheduleCron = computeOptimiserCron(sa.id);
    const saSettings = sa.settings as Record<string, unknown> | null | undefined;
    const scheduleTimezone = (typeof saSettings?.['timezone'] === 'string' && saSettings['timezone'])
      ? saSettings['timezone']
      : 'UTC';

    try {
      let linkId: string;
      let action: 'created' | 'already_existed';

      if (!DRY_RUN) {
        const [linkRow] = await db
          .insert(subaccountAgents)
          .values({
            organisationId: sa.organisationId,
            subaccountId: sa.id,
            agentId,
            isActive: true,
            scheduleEnabled: true,
            scheduleCron,
            scheduleTimezone,
          })
          .onConflictDoNothing()
          .returning();

        if (linkRow) {
          linkId = linkRow.id;
          action = 'created';
        } else {
          // Row already existed — fetch it
          const [existing] = await db
            .select({ id: subaccountAgents.id })
            .from(subaccountAgents)
            .where(
              and(
                eq(subaccountAgents.subaccountId, sa.id),
                eq(subaccountAgents.agentId, agentId),
              ),
            );

          if (!existing) {
            console.error(`[backfill-optimiser-schedules] ERROR: Could not find existing link for subaccount ${sa.id}`);
            errors++;
            continue;
          }

          linkId = existing.id;
          action = 'already_existed';
        }

        const singletonKey = `subaccount-optimiser:${sa.id}:${agentId}`;
        await agentScheduleService.registerSchedule(
          linkId,
          scheduleCron,
          {
            subaccountAgentId: linkId,
            agentId,
            subaccountId: sa.id,
            organisationId: sa.organisationId,
          },
          scheduleTimezone,
          singletonKey,
        );

        scheduleRegistered++;
      } else {
        action = 'dry_run';
        linkId = '(dry-run)';
      }

      if (action === 'created') created++;
      else if (action === 'already_existed') alreadyExisted++;

      console.log(JSON.stringify({
        subaccountId: sa.id,
        subaccountName: sa.name,
        action,
        computed_cron: scheduleCron,
        schedule_registered: !DRY_RUN,
      }));
    } catch (err) {
      errors++;
      console.error(`[backfill-optimiser-schedules] ERROR for subaccount ${sa.id}:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[backfill-optimiser-schedules] Done. created=${created} already_existed=${alreadyExisted} schedules_registered=${scheduleRegistered} errors=${errors}`);
}

main().catch((err) => {
  console.error('[backfill-optimiser-schedules] FATAL:', err);
  process.exit(1);
});
