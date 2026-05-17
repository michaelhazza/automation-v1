import {
  withAdvisoryLock,
  LOCK_ID_CLEANUP_FILES,
  LOCK_ID_CLEANUP_RESERVATIONS,
  serializeError,
} from '../types.js';
import {
  cleanupExpiredExecutionFiles,
  cleanupExpiredComputeReservations,
} from '../enqueueHelpers.js';

export function startIntervalFallback(): void {
  // In-memory queue: setInterval + advisory locks prevent duplicate runs
  setInterval(async () => {
    await withAdvisoryLock(LOCK_ID_CLEANUP_FILES, () =>
      cleanupExpiredExecutionFiles().then(() => undefined)
    ).catch((err: unknown) => {
      console.error(JSON.stringify({ event: 'maintenance:cleanup_execution_files_error', ...serializeError(err) }));
    });
  }, 60 * 60 * 1000); // every hour

  setInterval(async () => {
    await withAdvisoryLock(LOCK_ID_CLEANUP_RESERVATIONS, () =>
      cleanupExpiredComputeReservations().then(() => undefined)
    ).catch((err: unknown) => {
      console.error(JSON.stringify({ event: 'maintenance:cleanup_reservations_error', ...serializeError(err) }));
    });
  }, 5 * 60 * 1000); // every 5 minutes

  setInterval(async () => {
    const { runMemoryDecay } = await import('../../../jobs/memoryDecayJob.js');
    runMemoryDecay().catch((err: unknown) => {
      console.error(JSON.stringify({ event: 'maintenance:memory_decay_error', ...serializeError(err) }));
    });
  }, 24 * 60 * 60 * 1000); // daily

  // Sprint 2 P1.1 Layer 3 — security event retention sweep in the
  // in-memory fallback. Admin-bypass job, no advisory lock needed
  // because there's only one instance in in-memory mode by definition.
  setInterval(async () => {
    const { runSecurityEventsCleanup } = await import('../../../jobs/securityEventsCleanupJob.js');
    runSecurityEventsCleanup().catch((err: unknown) => {
      console.error(JSON.stringify({ event: 'maintenance:security_events_cleanup_error', ...serializeError(err) }));
    });
  }, 24 * 60 * 60 * 1000); // daily

  // Sprint 3 P2.1 Sprint 3A — agent_runs retention prune in the
  // in-memory fallback. Admin-bypass cross-org sweep.
  setInterval(async () => {
    const { runAgentRunCleanupTick } = await import('../../../jobs/agentRunCleanupJob.js');
    runAgentRunCleanupTick().catch((err: unknown) => {
      console.error(JSON.stringify({ event: 'maintenance:agent_run_cleanup_error', ...serializeError(err) }));
    });
  }, 24 * 60 * 60 * 1000); // daily

  // Agent Intelligence Phase 2B — memory dedup daily sweep (in-memory fallback)
  setInterval(async () => {
    const { runMemoryDedup } = await import('../../../jobs/memoryDedupJob.js');
    runMemoryDedup().catch((err: unknown) => {
      console.error(JSON.stringify({ event: 'maintenance:memory_dedup_error', ...serializeError(err) }));
    });
  }, 24 * 60 * 60 * 1000); // daily

  // Workspace seat rollup — hourly billing snapshot (in-memory fallback)
  setInterval(async () => {
    const { runSeatRollup } = await import('../../../jobs/seatRollupJob.js');
    runSeatRollup().catch((err: unknown) => {
      console.error(JSON.stringify({ event: 'seat-rollup:error', ...serializeError(err) }));
    });
  }, 60 * 60 * 1000); // hourly

  console.log(JSON.stringify({ event: 'maintenance:started', mode: 'interval' }));
}
