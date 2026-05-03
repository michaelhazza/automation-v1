/**
 * metrics.ts — observability counter wrapper.
 *
 * TODO: Replace NOOP implementation with a real prom-client exporter when
 * Prometheus scraping is configured. The counter names match the Workflows V1
 * spec (docs/workflows-dev-spec.md §8 observability section):
 *
 *   task_event_gap_detected_total{organisation_id}
 *   task_event_subsequence_collision_total{organisation_id}
 *   workflow_run_paused_total
 *   workflow_gate_open_total
 *   workflow_gate_resolved_total
 *   workflow_gate_stalled_total
 *   workflow_gate_orphaned_cascade_total
 *   workflow_cost_accumulator_skew_total
 *
 * Shape mirrors prom-client's Counter.inc() so a future real implementation
 * can drop in without changing callers.
 */

// ─── In-memory accumulator (visible via health endpoint) ─────────────────────

const counters = new Map<string, number>();

function counterKey(name: string, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return labelStr ? `${name}{${labelStr}}` : name;
}

/**
 * Increment a named counter by 1. Labels are optional.
 * NOOP for now — no Prometheus exporter is wired.
 */
export function incrementCounter(
  name: string,
  labels: Record<string, string> = {},
): void {
  const key = counterKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

/**
 * Read the current value of a counter (for health checks / admin endpoints).
 */
export function getCounterValue(
  name: string,
  labels: Record<string, string> = {},
): number {
  return counters.get(counterKey(name, labels)) ?? 0;
}

/**
 * Snapshot all counters (for a /health or /metrics endpoint).
 */
export function getAllCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}
