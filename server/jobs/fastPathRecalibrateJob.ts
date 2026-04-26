/**
 * maintenance:fast-path-recalibrate
 * Reads last 7 days of fast_path_decisions and emits structured logs
 * flagging confidence thresholds that should be tuned.
 * Does NOT auto-tune — output is for human review during first month post-launch.
 * Scheduled nightly in queueService.ts.
 *
 * Execution contract (Phase 3 — B10-MAINT-RLS):
 *   - withAdminConnection + SET LOCAL ROLE admin_role to bypass RLS for the
 *     cross-org read sweep.
 *   - Sequential per-org processing; no parallel fan-out in v1.
 *   - Per-org try/catch: one org failure is logged; iteration continues.
 *   - Terminal event emitted with outcome counters regardless of mixed results.
 *
 * Idempotency: state-based (read-only; re-running produces the same log output
 *   for the same data window).
 * Retry classification: safe (read-only job; pg-boss retry is acceptable).
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

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

/** Pure helper: compute per-route calibration stats from raw decision rows. */
export function computeRouteStats(
  rows: Array<{
    route: string;
    tier: number | null;
    outcome: string | null;
    overrodeTo: string | null;
  }>,
): Record<string, { count: number; overrideCount: number; tier2Count: number }> {
  const byRoute: Record<string, { count: number; overrideCount: number; tier2Count: number }> = {};
  for (const row of rows) {
    const key = row.route;
    if (!byRoute[key]) byRoute[key] = { count: 0, overrideCount: 0, tier2Count: 0 };
    byRoute[key]!.count++;
    if (row.outcome === 'user_overrode_scope' || row.overrodeTo) byRoute[key]!.overrideCount++;
    if (row.tier === 2) byRoute[key]!.tier2Count++;
  }
  return byRoute;
}

export async function runFastPathRecalibrate(): Promise<FastPathRecalibrateResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, { jobRunId, scheduledAt: new Date().toISOString() });

  let result: FastPathRecalibrateResult;

  try {
    result = await withAdminConnection(
      { source: SOURCE, reason: 'Nightly cross-org fast_path_decisions recalibration sweep' },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const since = new Date();
        since.setDate(since.getDate() - LOOKBACK_DAYS);

        const orgs = (await tx.execute(
          sql`SELECT id FROM organisations`,
        )) as unknown as Array<{ id: string }>;

        let orgsSucceeded = 0;
        let orgsFailed = 0;

        for (const org of orgs) {
          logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
          const orgStart = Date.now();
          try {
            const rows = (await tx.execute(
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

        return {
          status,
          orgsAttempted: orgs.length,
          orgsSucceeded,
          orgsFailed,
          durationMs: Date.now() - startedAt,
        };
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    result = {
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

  logger.info(`${SOURCE}.completed`, { jobRunId, ...result });
  return result;
}
