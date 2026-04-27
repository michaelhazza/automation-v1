import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';
import { getRecentSweepTicks } from './sweepTickHistory.js';

// Spec §8.2 row 8 + §12.5 — the monitor-the-monitor coverage signal.
//
// We approximate "candidates_evaluated / source-table active-entity count" by
// the share of recent sweep ticks that returned a degraded coverage state.
// A tick is degraded when either:
//   - the load query hit its candidate cap (limitReached) — the source-table
//     entity list was truncated, so coverage for that tick is < 1.0; or
//   - the load query threw (loadFailed) — coverage for that tick is 0.
// A healthy tick loaded every active entity (coverage = 1.0). Rolling average
// of these states reflects coverage faithfully — the cap and load failure are
// the two mechanisms by which the sweep can leave entities unevaluated
// (per-heuristic errors are surfaced separately via partial_success).
//
// Cold-start tolerance: until LOOKBACK_TICKS ticks have been recorded since
// process start, the check returns `fired: false` (matches §8.2 cold-start
// posture for baseline-dependent checks).

function parsePositiveInt(raw: string | undefined, fallback: number, max = 100): number {
  const parsed = raw === undefined ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > max) return fallback;
  return parsed;
}

function parseProbability(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback;
  return parsed;
}

const LOOKBACK_TICKS = parsePositiveInt(process.env.SYSTEM_MONITOR_COVERAGE_LOOKBACK_TICKS, 6);
const COVERAGE_THRESHOLD = parseProbability(process.env.SYSTEM_MONITOR_COVERAGE_THRESHOLD, 0.95);

export const sweepCoverageDegraded: SyntheticCheck = {
  id: 'sweep-coverage-degraded',
  description: "The sweep job's coverage rate dropped below threshold — the monitor is silently leaving entities unevaluated.",
  defaultSeverity: 'high',

  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const ticks = getRecentSweepTicks(LOOKBACK_TICKS);
    if (ticks.length < LOOKBACK_TICKS) {
      return { fired: false };
    }

    const limitReachedCount = ticks.filter((t) => t.limitReached).length;
    const loadFailedCount = ticks.filter((t) => t.loadFailed).length;
    const degradedCount = limitReachedCount + loadFailedCount;
    const coverageRate = (ticks.length - degradedCount) / ticks.length;

    if (coverageRate >= COVERAGE_THRESHOLD) {
      return { fired: false };
    }

    return {
      fired: true,
      severity: 'high',
      resourceKind: 'job',
      resourceId: 'system-monitor-sweep',
      summary: `Sweep coverage rate ${(coverageRate * 100).toFixed(0)}% over the last ${ticks.length} ticks is below the ${(COVERAGE_THRESHOLD * 100).toFixed(0)}% threshold; ${limitReachedCount} hit the candidate cap, ${loadFailedCount} failed to load.`,
      bucketKey: bucket15min(ctx.now),
      metadata: {
        checkId: 'sweep-coverage-degraded',
        coverageRate,
        coverageThreshold: COVERAGE_THRESHOLD,
        lookbackTicks: ticks.length,
        limitReachedCount,
        loadFailedCount,
        ticks: ticks.map((t) => ({
          bucketKey: t.bucketKey,
          candidatesEvaluated: t.candidatesEvaluated,
          limitReached: t.limitReached,
          loadFailed: t.loadFailed,
        })),
      },
    };
  },
};
