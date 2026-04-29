/**
 * fastPathRecalibrateJobPure — pure helpers for the fast-path recalibrate job.
 *
 * Extracted so computeRouteStats can be exercised without DB / env deps.
 */

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
