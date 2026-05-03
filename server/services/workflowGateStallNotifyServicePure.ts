/**
 * workflowGateStallNotifyServicePure.ts — pure helpers for stall-and-notify.
 *
 * All functions are deterministic and side-effect free, suitable for
 * unit tests without any DB or pg-boss dependency.
 *
 * Spec §5.3: three stall-and-notify cadences (24h / 72h / 7d) scheduled at
 * gate-open, cancelled at gate-resolve.
 */

export type StallCadence = '24h' | '72h' | '7d';

const STALL_CADENCES: StallCadence[] = ['24h', '72h', '7d'];

/** Seconds from gate creation for each stall cadence. */
const CADENCE_SECONDS: Record<StallCadence, number> = {
  '24h': 24 * 60 * 60,
  '72h': 72 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
};

/**
 * Build the pg-boss job name for a stall notification job.
 * Pattern: `stall-notify-${gateId}-${cadence}`.
 * Idempotent on (gateId, cadence) because the name is unique in pgboss.job.
 */
export function buildStallJobName(gateId: string, cadence: StallCadence): string {
  return `stall-notify-${gateId}-${cadence}`;
}

export interface StallScheduleEntry {
  cadence: StallCadence;
  /** Seconds from now (relative to gateCreatedAt) to fire the job. */
  startAfterSeconds: number;
}

/**
 * Compute the three stall schedule entries for a gate.
 * Returns three entries, one per cadence, each with `startAfterSeconds`
 * measured from the moment of enqueue (pg-boss `sendAfter` semantics).
 *
 * gateCreatedAt is not used: pg-boss schedules from enqueue time, which
 * lands within milliseconds of gate-open — close enough for the 24h/72h/7d
 * cadence. The parameter is omitted to keep the pure function honest.
 */
export function computeStallSchedule(): StallScheduleEntry[] {
  return STALL_CADENCES.map((cadence) => ({
    cadence,
    startAfterSeconds: CADENCE_SECONDS[cadence],
  }));
}

/**
 * Stale-fire guard: returns `true` when the in-flight job should abort
 * without sending a notification.
 *
 * A job is stale when EITHER:
 *   - the gate has been resolved (resolvedAt is non-null), OR
 *   - the gate's createdAt no longer matches the ISO string that was baked
 *     into the payload at schedule time (i.e. the gate was deleted and
 *     re-created with the same ID, which cannot happen under the current
 *     schema, but the check is defensive).
 *
 * The `expectedCreatedAtIso` comparison is string-equal on ISO timestamps
 * supplied by the DB row — no application `Date.now()` involved.
 */
export function isStallFireStale(
  currentResolvedAt: Date | null,
  currentCreatedAt: Date,
  expectedCreatedAtIso: string,
): boolean {
  if (currentResolvedAt !== null) return true;
  return currentCreatedAt.toISOString() !== expectedCreatedAtIso;
}

/** Re-export cadences list for iteration in service layer. */
export { STALL_CADENCES }; // test-only export
