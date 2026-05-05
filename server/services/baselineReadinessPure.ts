/**
 * F3 §4 — pure combinatorial readiness check.
 *
 * Extracted from baselineReadinessService so it can be unit-tested without
 * a DB connection (importing the service pulls in getOrgScopedDb → env
 * validation). Mirrors the pattern of baselineStateMachinePure.ts.
 */

export interface ReadinessResult {
  ready: boolean;
  missing: string[];
  reason?: string;
  qualifying_poll_count: number;
  earliest_qualifying_poll_at: Date | null;
}

export type CoreConnectorRow = {
  pollCount: number | null;
  firstAt: Date | null;
  settleOk: boolean;
};

export type CoreMetricRow = {
  slug: string;
};

export const CORE_METRIC_SLUGS = [
  'pipeline_value',
  'lead_count',
  'conversation_engagement',
  'revenue_last_30d',
] as const;

/**
 * Given raw DB rows, evaluate the four §4 readiness conditions:
 *   (1) ≥1 active connector
 *   (2) ≥2 successful polls in total across all connectors
 *   (3) Settle window: at least one connector has settleOk = true
 *       (Postgres evaluated: now() - first_qualifying_poll_at >= interval '1 hour')
 *   (4) ≥2 of 4 core metrics have a non-null currentValue
 *
 * Idempotent and side-effect-free.
 */
export function evaluateReadiness(
  connectors: CoreConnectorRow[],
  metricRows: CoreMetricRow[],
): ReadinessResult {
  const missing: string[] = [];

  // (1)
  if (connectors.length === 0) missing.push('active_connector');

  // (2)
  const totalPolls = connectors.reduce((sum, c) => sum + (c.pollCount ?? 0), 0);
  if (totalPolls < 2) missing.push('successful_polls_min_2');

  // (3) — settle decision was made by Postgres; JS only reads the boolean.
  const settleOk = connectors.some((c) => c.settleOk === true);
  if (!settleOk) missing.push('settle_window_1h');

  // earliest timestamp for telemetry only — never used as a JS comparison anchor.
  const earliest =
    connectors
      .map((c) => c.firstAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  // (4)
  const distinctSlugsWithValue = new Set(metricRows.map((r) => r.slug)).size;
  if (distinctSlugsWithValue < 2) missing.push('canonical_metrics_min_2');

  return {
    ready: missing.length === 0,
    missing,
    reason: missing.length === 0 ? undefined : `missing: ${missing.join(', ')}`,
    qualifying_poll_count: totalPolls,
    earliest_qualifying_poll_at: earliest,
  };
}
