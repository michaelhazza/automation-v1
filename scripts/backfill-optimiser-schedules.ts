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
import { sql } from 'drizzle-orm';
import { subaccounts, agents, subaccountAgents } from '../server/db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { withAdminConnection } from '../server/lib/adminDbConnection.js';
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

  // Cross-org reads use withAdminConnection + SET LOCAL ROLE admin_role to bypass RLS.
  // Per-org inserts run inside the same admin tx (they are idempotent via ON CONFLICT DO NOTHING).
  const { eligibleSubaccounts, orgAgentMap } = await withAdminConnection(
    { source: 'backfill-optimiser-schedules', reason: 'admin sweep: register optimiser schedules', skipAudit: true },
    async (adminTx) => {
      await adminTx.execute(sql`SET LOCAL ROLE admin_role`);

      // Fetch all opted-in sub-accounts (include settings for timezone)
      const rows = await adminTx
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

      // Group by org to minimise agent lookups
      const orgIds = [...new Set(rows.map((sa) => sa.organisationId))];
      const agentMap = new Map<string, string>();
      for (const orgId of orgIds) {
        const [optimiserAgent] = await adminTx
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.organisationId, orgId), eq(agents.slug, OPTIMISER_AGENT_SLUG)));

        if (optimiserAgent) {
          agentMap.set(orgId, optimiserAgent.id);
        } else {
          console.warn(`[backfill-optimiser-schedules] WARNING: No optimiser agent found for org ${orgId} — skipping sub-accounts in this org.`);
        }
      }

      return { eligibleSubaccounts: rows, orgAgentMap: agentMap };
    },
  );

  console.log(`[backfill-optimiser-schedules] Found ${eligibleSubaccounts.length} eligible sub-accounts.`);

  if (eligibleSubaccounts.length === 0) {
    console.log('[backfill-optimiser-schedules] Nothing to do.');
    return;
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
        // Per-org insert — use its own admin connection so each org's write is isolated
        const linkResult = await withAdminConnection(
          { source: 'backfill-optimiser-schedules', reason: `insert link for subaccount ${sa.id}`, skipAudit: true },
          async (adminTx) => {
            await adminTx.execute(sql`SET LOCAL ROLE admin_role`);

            const [linkRow] = await adminTx
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
              return { id: linkRow.id, action: 'created' as const };
            }

            // Row already existed — fetch it
            const [existing] = await adminTx
              .select({ id: subaccountAgents.id })
              .from(subaccountAgents)
              .where(
                and(
                  eq(subaccountAgents.subaccountId, sa.id),
                  eq(subaccountAgents.agentId, agentId),
                ),
              );

            if (!existing) {
              return null;
            }

            return { id: existing.id, action: 'already_existed' as const };
          },
        );

        if (!linkResult) {
          console.error(`[backfill-optimiser-schedules] ERROR: Could not find existing link for subaccount ${sa.id}`);
          errors++;
          continue;
        }

        linkId = linkResult.id;
        action = linkResult.action;

        const singletonKey = `subaccount-optimiser:${sa.id}:${agentId}`;
        // agentScheduleService.registerSchedule talks to pg-boss only — outside any DB tx
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
