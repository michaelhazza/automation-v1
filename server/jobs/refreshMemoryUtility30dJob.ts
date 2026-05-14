/**
 * refreshMemoryUtility30dJob (queue: refresh_memory_utility_30d)
 *
 * Thin pg-boss job handler that delegates to runMemoryUtilityRefresh().
 *
 * Concurrency model: pg_try_advisory_xact_lock inside the admin transaction
 *                    prevents concurrent refreshes — second runner skips
 *                    immediately with a `skipped_locked` log event.
 *
 * Idempotency model: REFRESH MATERIALIZED VIEW CONCURRENTLY is idempotent —
 *                    replays recompute the same per-org aggregate and replace
 *                    the prior view contents. Last-write-wins is acceptable
 *                    because the underlying fact tables are append-only.
 *
 * Failure mode: errors propagate to pg-boss, which retries per its default
 *               policy. After exhaustion the job lands in the DLQ and the
 *               dlq-not-drained synthetic check fires.
 */

import { runMemoryUtilityRefresh } from '../services/memoryUtilityRefreshService.js';

export async function refreshMemoryUtility30dJob(_job: unknown): Promise<void> {
  await runMemoryUtilityRefresh();
}
