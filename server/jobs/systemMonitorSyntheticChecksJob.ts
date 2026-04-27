/**
 * systemMonitorSyntheticChecksJob (queue: system-monitor-synthetic-checks)
 *
 * Concurrency model: pg-boss singletonKey='synthetic-checks-tick' (single-tick-at-a-time)
 *                    — only one tick runs at a time; subsequent ticks skip if one is
 *                    already in flight. tick interval is
 *                    SYSTEM_MONITOR_SYNTHETIC_CHECK_INTERVAL_SECONDS (default 60s).
 *   Key/lock space:  global per-process — no per-tenant or per-check granularity.
 *
 * Idempotency model: each synthetic check emits incidents with a composite
 *                    idempotencyKey = synthetic:<checkId>:<resourceKind>:<resourceId>:<bucketKey>
 *                    where bucketKey collapses to a 15-minute window. A stalled queue
 *                    produces one incident per 15-min window with rising occurrence_count,
 *                    not N identical incidents. The ingestor's LRU dedupletes within the
 *                    process; the DB fingerprint index dedupletes across restarts.
 *   Failure mode:    per-check try/catch in runSyntheticChecksTick — one failing check
 *                    does not abort the tick. The job itself may fail (e.g. DB unreachable);
 *                    pg-boss retries (default 3) then DLQ; the dlq-not-drained synthetic
 *                    check fires as the meta-signal.
 */

import { withSystemPrincipal } from '../services/principal/systemPrincipal.js';
import { runSyntheticChecksTick } from '../services/systemMonitor/synthetic/syntheticChecksTickHandler.js';
import { logger } from '../lib/logger.js';

export async function handleSyntheticChecksTick(): Promise<void> {
  await withSystemPrincipal(async () => {
    try {
      await runSyntheticChecksTick();
    } catch (err) {
      logger.error('synthetic_checks_tick_job_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });
}
