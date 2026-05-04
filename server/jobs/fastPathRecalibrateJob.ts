/**
 * maintenance:fast-path-recalibrate
 * Reads last 7 days of fast_path_decisions and emits structured logs
 * flagging confidence thresholds that should be tuned.
 * Does NOT auto-tune — output is for human review during first month post-launch.
 * Scheduled nightly in queueService.ts.
 *
 * Execution contract (Phase 3 — B10-MAINT-RLS):
 *   - Org enumeration in a short-lived withAdminConnection + SET LOCAL ROLE admin_role.
 *   - Sequential per-org processing; no parallel fan-out in v1.
 *   - Per-org SELECT runs in a fresh db.transaction + withOrgTx so that
 *     app.organisation_id is set and RLS policies engage for each org's read.
 *     A per-org error does not abort the surrounding sweep.
 *   - Per-org try/catch: one org failure is logged; iteration continues.
 *   - Terminal event emitted with outcome counters regardless of mixed results.
 *
 * Idempotency: state-based (read-only; re-running produces the same log output
 *   for the same data window).
 * Retry classification: safe (read-only job; pg-boss retry is acceptable).
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { computeRouteStats } from './fastPathRecalibrateJobPure.js';

const SOURCE = 'fast-path-recalibrate' as const;
const LOOKBACK_DAYS = 7;
const OVERRIDE_RATE_THRESHOLD = 0.1;

export interface FastPathRecalibrateResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  durationMs: number;
}

export { computeRouteStats } from './fastPathRecalibrateJobPure.js';

export async function runFastPathRecalibrate(): Promise<FastPathRecalibrateResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, { jobRunId, scheduledAt: new Date().toISOString() });

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  // Phase 1 — fetch the org list under one short-lived admin tx.
  let orgs: Array<{ id: string }>;
  try {
    orgs = await withAdminConnection(
      { source: SOURCE, reason: 'Nightly cross-org fast_path_decisions recalibration: enumerate orgs', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return (await tx.execute(
          sql`SELECT id FROM organisations`,
        )) as unknown as Array<{ id: string }>;
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result: FastPathRecalibrateResult = {
      status: 'failed',
      orgsAttempted: 0,
      orgsSucceeded: 0,
      orgsFailed: 0,
      durationMs,
    };
    logger.error(`${SOURCE}.completed`, {
      jobRunId,
      ...result,
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  let orgsSucceeded = 0;
  let orgsFailed = 0;

  // Phase 2 — per-org reads, each in a fresh tenant-scoped tx so RLS policies
  // engage for every SELECT. A per-org failure does not abort the sweep.
  for (const org of orgs) {
    logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
    const orgStart = Date.now();
    try {
      const rows = await db.transaction(async (orgTx) => {
        await orgTx.execute(sql`SELECT set_config('app.organisation_id', ${org.id}, true)`);
        return withOrgTx(
          { tx: orgTx, organisationId: org.id, source: `${SOURCE}:per-org` },
          async () => {
            return (await orgTx.execute(
              sql`
                SELECT decided_route AS route, decided_tier AS tier,
                       downstream_outcome AS outcome, user_overrode_scope_to AS "overrodeTo"
                FROM fast_path_decisions
                WHERE organisation_id = ${org.id}::uuid
                  AND decided_at >= ${since}
              `,
            )) as unknown as Array<{
              route: string;
              tier: number | null;
              outcome: string | null;
              overrodeTo: string | null;
            }>;
          },
        );
      });

      if (rows.length > 0) {
        const byRoute = computeRouteStats(rows);
        for (const [route, stats] of Object.entries(byRoute)) {
          const overrideRate = stats.count > 0 ? stats.overrideCount / stats.count : 0;
          const tier2Rate = stats.count > 0 ? stats.tier2Count / stats.count : 0;
          logger.info(`${SOURCE}.route_stats`, {
            jobRunId,
            orgId: org.id,
            route,
            count: stats.count,
            override_rate: overrideRate.toFixed(3),
            tier2_rate: tier2Rate.toFixed(3),
            flag_override_rate: overrideRate > OVERRIDE_RATE_THRESHOLD,
            lookback_days: LOOKBACK_DAYS,
          });
        }
      }

      orgsSucceeded++;
      logger.info(`${SOURCE}.org_completed`, {
        jobRunId,
        orgId: org.id,
        rowsAffected: rows.length,
        durationMs: Date.now() - orgStart,
        status: 'success',
      });
    } catch (err) {
      orgsFailed++;
      logger.error(`${SOURCE}.org_failed`, {
        jobRunId,
        orgId: org.id,
        error: err instanceof Error ? err.message : String(err),
        errorClass: err instanceof Error ? 'tx_failure' : 'unknown',
        status: 'failed',
      });
    }
  }

  const status: FastPathRecalibrateResult['status'] =
    orgsFailed === 0 ? 'success'
    : orgsSucceeded === 0 ? 'failed'
    : 'partial';

  const result: FastPathRecalibrateResult = {
    status,
    orgsAttempted: orgs.length,
    orgsSucceeded,
    orgsFailed,
    durationMs: Date.now() - startedAt,
  };

  logger.info(`${SOURCE}.completed`, { jobRunId, ...result });
  return result;
}
