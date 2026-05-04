/**
 * systemMonitorBaselineRefreshJob (queue: system-monitor-baseline-refresh)
 *
 * Concurrency model: pg-boss singletonKey='baseline-refresh' (single-tick-at-a-time)
 *                    + pg_advisory_xact_lock(hashtext('baseline-refresh')::bigint) inside
 *                    the admin transaction. The next tick blocks until the prior commits.
 *   Key/lock space:  global per-process — only one refresh tick runs at a time. Two
 *                    runners with the singleton key collapse at the queue layer; the
 *                    advisory lock is the second wall against same-process race.
 *
 * Idempotency model: replay-safe deterministic recompute — the aggregate query against
 *                    append-only source tables is deterministic at any point in time.
 *                    UPSERT into system_monitor_baselines on the (entity_kind, entity_id,
 *                    metric_name) unique constraint replaces the prior row's stats with
 *                    the recomputed values. Last-write-wins is acceptable because both
 *                    writers compute against the same window per spec §4.9.2.
 *   Failure mode:    a mid-execution crash inside the admin transaction rolls back via
 *                    Drizzle's transaction wrapper — no partial row updates persist.
 *                    pg-boss retries (default 3) per the standard retry policy; after
 *                    exhaustion the job lands in DLQ and the dlq-not-drained synthetic
 *                    check fires.
 */

import { withSystemPrincipal } from '../services/principal/systemPrincipal.js';
import { runBaselineRefresh } from '../services/systemMonitor/baselines/refreshJob.js';
import { logger } from '../lib/logger.js';

export async function handleBaselineRefresh(): Promise<void> {
  await withSystemPrincipal(async () => {
    try {
      await runBaselineRefresh();
    } catch (err) {
      logger.error('baseline_refresh_job_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err; // re-throw so pg-boss marks the job failed and retries
    }
  });
}
