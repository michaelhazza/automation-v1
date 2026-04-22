/**
 * maintenance:fast-path-recalibrate
 * Reads last 7 days of fast_path_decisions and emits structured logs
 * flagging confidence thresholds that should be tuned.
 * Does NOT auto-tune — output is for human review during first month post-launch.
 * Scheduled nightly in queueService.ts.
 */

import { db } from '../db/index.js';
import { fastPathDecisions } from '../db/schema/index.js';
import { gte, isNotNull } from 'drizzle-orm';
import { logger } from '../lib/logger.js';

const LOOKBACK_DAYS = 7;
const OVERRIDE_RATE_THRESHOLD = 0.1; // flag if >10% of decisions get overridden

export async function runFastPathRecalibrate(): Promise<void> {
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const rows = await db
    .select({
      route: fastPathDecisions.decidedRoute,
      confidence: fastPathDecisions.decidedConfidence,
      tier: fastPathDecisions.decidedTier,
      outcome: fastPathDecisions.downstreamOutcome,
      overrodeTo: fastPathDecisions.userOverrodeScopeTo,
    })
    .from(fastPathDecisions)
    .where(gte(fastPathDecisions.decidedAt, since));

  if (rows.length === 0) {
    return;
  }

  const byRoute: Record<string, { count: number; overrideCount: number; tier2Count: number }> = {};

  for (const row of rows) {
    const key = row.route;
    if (!byRoute[key]) byRoute[key] = { count: 0, overrideCount: 0, tier2Count: 0 };
    byRoute[key]!.count++;
    if (row.outcome === 'user_overrode_scope' || row.overrodeTo) byRoute[key]!.overrideCount++;
    if (row.tier === 2) byRoute[key]!.tier2Count++;
  }

  for (const [route, stats] of Object.entries(byRoute)) {
    const overrideRate = stats.count > 0 ? stats.overrideCount / stats.count : 0;
    const tier2Rate = stats.count > 0 ? stats.tier2Count / stats.count : 0;

    logger.info('maintenance:fast-path-recalibrate', {
      route,
      count: stats.count,
      override_rate: overrideRate.toFixed(3),
      tier2_rate: tier2Rate.toFixed(3),
      flag_override_rate: overrideRate > OVERRIDE_RATE_THRESHOLD,
      lookback_days: LOOKBACK_DAYS,
    });
  }
}
