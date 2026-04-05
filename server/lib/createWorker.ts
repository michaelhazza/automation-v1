// ---------------------------------------------------------------------------
// createWorker — declarative pg-boss worker registration (Phase A3)
//
// Reads retry, timeout, and error classification from jobConfig.ts.
// Reduces per-queue worker boilerplate from ~30 lines to ~5 lines.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { JOB_CONFIG, type JobName } from '../config/jobConfig.js';
import { isNonRetryable, isTimeoutError, getRetryCount, withTimeout } from './jobErrors.js';

interface WorkerOptions<T> {
  /** Queue name — must match a key in JOB_CONFIG */
  queue: JobName;
  /** pg-boss instance */
  boss: PgBoss;
  /** Handler function — receives the pg-boss job */
  handler: (job: PgBoss.Job<T>) => Promise<void>;
  /** Override concurrency (defaults to env QUEUE_CONCURRENCY or 2) */
  concurrency?: number;
  /** Override timeout in ms (defaults to jobConfig expireInSeconds * 900ms) */
  timeoutMs?: number;
}

/**
 * Register a pg-boss worker with automatic retry, timeout, and error classification
 * based on the centralised job configuration.
 */
export function createWorker<T>(options: WorkerOptions<T>) {
  const config = JOB_CONFIG[options.queue];
  const teamSize = options.concurrency ?? parseInt(process.env.QUEUE_CONCURRENCY ?? '2', 10);

  // Derive timeout: explicit override > config expireInSeconds * 0.9 > 60s default
  const timeoutMs = options.timeoutMs
    ?? ((config as Record<string, unknown>).expireInSeconds
      ? ((config as Record<string, unknown>).expireInSeconds as number) * 900
      : 60_000);

  return options.boss.work<T>(
    options.queue,
    { teamSize, teamConcurrency: 1 },
    async (job) => {
      const retryCount = getRetryCount(job);
      if (retryCount > 0) {
        console.warn(`[Worker:${options.queue}] Retry #${retryCount} for job ${job.id}`);
      }

      try {
        await withTimeout(options.handler(job), timeoutMs);
      } catch (err: unknown) {
        if (isNonRetryable(err)) {
          console.error(`[Worker:${options.queue}] Non-retryable failure for job ${job.id}:`,
            err instanceof Error ? err.message : err);
          await options.boss.fail(job.id);
          return;
        }
        if (isTimeoutError(err)) {
          console.error(`[Worker:${options.queue}] Timeout after ${timeoutMs}ms for job ${job.id}`);
        }
        throw err; // pg-boss handles retry/DLQ
      }
    }
  );
}
