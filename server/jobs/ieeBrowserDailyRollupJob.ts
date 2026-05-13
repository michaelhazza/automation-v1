/**
 * ieeBrowserDailyRollupJob.ts — pg-boss daily cron job for IEE browser cost rollups.
 *
 * Runs at midnight UTC each day. Processes the previous UTC day's spend for each
 * enabled subaccount and evaluates against daily cost ceiling.
 *
 * Emits iee_browser.subaccount_cost_anomaly incidents when spend > ceiling.
 *
 * Per-subaccount errors log + continue (never fail the whole job).
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { recordIncident } from '../services/incidentIngestor.js';
import {
  evaluateDailyCost,
  IEE_BROWSER_EVENT_SUBACCOUNT_COST_ANOMALY,
} from '../services/sandbox/ieeBrowserCostAlarmEvaluatorPure.js';

const QUEUE_NAME = 'iee-browser:daily-cost-rollup';
const SCHEDULE_CRON = '0 0 * * *'; // midnight UTC

interface SubaccountSettings {
  subaccount_id: string;
  organisation_id: string;
  per_subaccount_daily_cost_ceiling_cents: number;
}

interface SpendRow {
  spend_cents: number;
}

/**
 * Core rollup logic: query enabled subaccounts, compute spend for yesterday,
 * evaluate against ceiling, emit incidents as needed.
 */
export async function runIeeBrowserDailyRollup(): Promise<{
  subaccountsProcessed: number;
  incidentsEmitted: number;
  failedSubaccounts: number;
  durationMs: number;
}> {
  const started = Date.now();
  let subaccountsProcessed = 0;
  let incidentsEmitted = 0;
  let failedSubaccounts = 0;

  // Compute yesterday as the previous UTC day: YYYY-MM-DD string
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Query enabled subaccounts
  const settingsRows = await withAdminConnection(
    { source: 'jobs.ieeBrowserDailyRollup', reason: 'cross-tenant scan of enabled IEE browser subaccounts; end-of-day rollup job' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return tx.execute(sql`
        SELECT ss.subaccount_id, ss.organisation_id, ss.per_subaccount_daily_cost_ceiling_cents
        FROM subaccount_iee_browser_settings ss
        WHERE ss.status = 'on' AND ss.rollout_approved = true
        ORDER BY ss.subaccount_id
      `);
    },
  ) as unknown as Array<SubaccountSettings> | { rows?: Array<SubaccountSettings> };

  const settings = (Array.isArray(settingsRows) ? settingsRows : settingsRows.rows ?? []);

  for (const setting of settings) {
    try {
      // Query spend for yesterday
      const spendRows = await withAdminConnection(
        { source: 'jobs.ieeBrowserDailyRollup', reason: 'cross-org spend aggregation for IEE browser daily alarm' },
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE admin_role`);
          return tx.execute(sql`
            SELECT COALESCE(SUM(cost_with_margin_cents), 0) AS spend_cents
            FROM llm_requests
            WHERE subaccount_id = ${setting.subaccount_id}
              AND source_type = 'sandbox_compute'
              AND subtype IN ('task', 'warm_pool')
              AND billing_day = ${yesterday}
          `);
        },
      ) as unknown as Array<SpendRow> | { rows?: Array<SpendRow> };

      const spendData = (Array.isArray(spendRows) ? spendRows : spendRows.rows ?? [])[0];
      const spendCents = spendData?.spend_cents ?? 0;

      subaccountsProcessed += 1;

      // Evaluate against ceiling
      const result = evaluateDailyCost(
        {
          subaccountId: setting.subaccount_id,
          dayUTC: yesterday,
          spendCents,
        },
        {
          perSubaccountDailyCostCeilingCents: setting.per_subaccount_daily_cost_ceiling_cents,
        },
      );

      // Emit incident if threshold breached
      if (result.fire === true) {
        const idempotencyKey = `${IEE_BROWSER_EVENT_SUBACCOUNT_COST_ANOMALY}:${setting.subaccount_id}:${yesterday}:${result.payload.ceilingCents}`;
        void recordIncident({
          source: 'job',
          summary: `iee_browser subaccount daily cost anomaly: subaccount=${setting.subaccount_id} dayUTC=${yesterday} spendCents=${result.payload.spendCents} ceiling=${result.payload.ceilingCents}`,
          errorCode: IEE_BROWSER_EVENT_SUBACCOUNT_COST_ANOMALY,
          idempotencyKey,
          errorDetail: result.payload as unknown as Record<string, unknown>,
          subaccountId: setting.subaccount_id,
          organisationId: setting.organisation_id,
        });
        incidentsEmitted += 1;
      }
    } catch (err) {
      failedSubaccounts += 1;
      logger.error('iee_browser.daily_rollup_subaccount_failed', {
        subaccountId: setting.subaccount_id,
        dayUTC: yesterday,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = {
    subaccountsProcessed,
    incidentsEmitted,
    failedSubaccounts,
    durationMs: Date.now() - started,
  };

  logger.info('iee_browser.daily_rollup_complete', summary);
  return summary;
}

/**
 * Register the cron job with pg-boss.
 * Runs daily at midnight UTC.
 */
export async function registerIeeBrowserDailyRollupJob(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.warn('iee_browser.daily_rollup_skipped', { reason: 'pg-boss not configured' });
    return;
  }
  const boss = await getPgBoss();
  await boss.work(QUEUE_NAME, async () => {
    await runIeeBrowserDailyRollup();
  });
  await boss.schedule(QUEUE_NAME, SCHEDULE_CRON, {}, { tz: 'UTC' });
  logger.info('iee_browser.daily_rollup_scheduled', { cron: SCHEDULE_CRON });
}
