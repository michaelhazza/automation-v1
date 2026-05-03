/**
 * metrics.ts — observability counter wrapper.
 *
 * NOOP implementation: counters are stored in-memory and exposed via
 * getCounterValue / getAllCounters (health endpoint). Replace with a real
 * prom-client exporter when Prometheus scraping is configured — callers
 * use the same incrementCounter(name, labels) signature so the swap is
 * transparent.
 *
 * Registered counter catalogue (Workflows V1, docs/workflows-dev-spec.md §8):
 *
 *   workflow_run_paused_total{reason, template_id, organisation_id}
 *     — operator or cap-triggered run pause.
 *
 *   workflow_gate_open_total{gate_kind, is_critical_synthesised, organisation_id}
 *     — gate opened (approval or ask).
 *
 *   workflow_gate_resolved_total{resolution_reason, gate_kind, organisation_id}
 *     — gate resolved (approved / rejected / answered).
 *
 *   workflow_gate_stalled_total{cadence, organisation_id}
 *     — stall notification fired (cadence: 24h / 72h / 7d).
 *
 *   workflow_gate_orphaned_cascade_total{organisation_id}
 *     — orphaned gate cascade triggered on run completion.
 *
 *   task_event_gap_detected_total{organisation_id}
 *     — gap in task event sequence detected.
 *
 *   task_event_subsequence_collision_total{organisation_id}
 *     — duplicate subsequence key collision detected.
 *
 *   workflow_cost_accumulator_skew_total{organisation_id}
 *     — cost accumulator skew detected (ledger vs. DB drift).
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
