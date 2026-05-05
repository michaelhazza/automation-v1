// Process-local ring buffer of recent sweep tick outcomes, used by
// `sweepCoverageDegraded` to compute the rolling coverage rate per spec §8.2 / §12.5.
//
// Persistence model: in-memory. After a process restart the buffer resets and
// the synthetic check returns `fired: false` until enough ticks accumulate
// (§8.2 cold-start tolerance). Survives restarts only at the cost of a brief
// false-negative window — acceptable per the spec's same-pattern treatment for
// `heartbeat-self` (synthetic/heartbeatSelf.ts).
//
// Multi-instance caveat: pg-boss can dispatch the sweep job and the synthetic-
// checks job to different web instances. Each instance owns its own buffer, so
// the synthetic check on instance B will not see ticks recorded on instance A
// and may return `fired: false` despite a real coverage drop — or, after a
// limited evaluator on B, fire incorrectly. For staging the in-memory store is
// fine; for production multi-instance promote this to a `system_monitor_sweep_
// ticks` table (see todo.md "Persist sweep tick history to DB" follow-up).
//
// Ring size is sized to hold at least 2× the maximum lookback so concurrent
// reads never see fewer entries than the active threshold demands.

export interface SweepTickRecord {
  bucketKey: string;
  candidatesEvaluated: number;
  /** True when the candidate-load query hit its hard ceiling (load cap, see loadCandidates.ts). */
  limitReached: boolean;
  /** True when the candidate-load query threw — the sweep produced no work this tick. */
  loadFailed: boolean;
  completedAt: Date;
}

const MAX_HISTORY = 32;
const history: SweepTickRecord[] = [];

export function recordSweepTick(record: SweepTickRecord): void {
  history.push(record);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

export function getRecentSweepTicks(limit: number): SweepTickRecord[] {
  if (limit <= 0) return [];
  return history.slice(-limit);
}

/** Test-only — clears the buffer between unit tests. */
export function _resetSweepTickHistory(): void {
  history.length = 0;
}
