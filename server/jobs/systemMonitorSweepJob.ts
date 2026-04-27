/**
 * systemMonitorSweepJob (queue: system-monitor-sweep)
 *
 * Concurrency model: pg-boss singletonKey=`sweep:${bucketKey}` (one sweep in flight
 *                    per 15-minute bucket at a time). bucketKey is derived from the
 *                    job's scheduledAt so retries for the same tick land on the same
 *                    singleton.
 *   Key/lock space:  per-bucket. Overlapping ticks from drift or clock skew collapse
 *                    at the queue layer; the next bucket gets its own key.
 *
 * Idempotency model: `recordIncident` uses a per-entity fingerprintOverride of
 *                    `sweep:${entityKind}:${entityId}:${bucketKey}` — duplicate
 *                    incidents for the same entity in the same bucket are de-duped
 *                    at the ingestor. Heuristic fire rows are append-only (no upsert),
 *                    so a retry re-writes fire rows; total count grows but does not
 *                    affect downstream incident de-dup.
 *   Failure mode:    pg-boss retry-up-to-3 on handler throw. Candidate-load failure
 *                    returns early with status='failure'. Per-heuristic errors are
 *                    isolated (continue loop); the sweep completes as partial_success.
 *                    DLQ on hard fail.
 */

import { withSystemPrincipal } from '../services/principal/systemPrincipal.js';
import { runSweep } from '../services/systemMonitor/triage/sweepHandler.js';
import { logger } from '../lib/logger.js';

export async function handleSystemMonitorSweep(job: { data?: Record<string, unknown> }): Promise<void> {
  await withSystemPrincipal(async () => {
    try {
      const result = await runSweep();
      if (result.status === 'failure') {
        throw new Error('sweep_run_failed: candidate load failed — see sweep_load_candidates_failed log');
      }
    } catch (err) {
      logger.error('system_monitor_sweep_job_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err; // re-throw so pg-boss marks the job failed and retries
    }
  });
}
