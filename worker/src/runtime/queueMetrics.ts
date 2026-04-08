// ---------------------------------------------------------------------------
// Queue depth periodic logger (reviewer round 4 #5).
//
// Captures pg-boss queue depth + average wait time per IEE queue and emits
// a single structured log line every IEE_QUEUE_METRICS_INTERVAL_MS. No
// dashboard, no metrics endpoint — just a fast operational signal that an
// SRE can grep for in worker logs to spot saturation.
//
// Cheap: one SQL query per interval, runs on the unref'd timer loop so it
// doesn't keep the process alive.
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { db } from '../db.js';
import { logger } from '../logger.js';

const QUEUES_TO_REPORT = ['iee-browser-task', 'iee-dev-task'] as const;

export interface QueueMetricsHandle {
  stop: () => void;
}

export function startQueueMetricsLogger(intervalMs = 60_000): QueueMetricsHandle {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      // pg-boss stores jobs in the `pgboss.job` table. Created jobs in the
      // 'created' or 'retry' state are waiting; 'active' is in flight.
      // Query is intentionally schema-light so it survives pg-boss minor
      // version bumps without code changes.
      const rows = await db.execute<{
        name: string;
        depth_waiting: number;
        depth_active: number;
        oldest_wait_seconds: number | null;
      }>(
        sql`
          SELECT
            name,
            COUNT(*) FILTER (WHERE state IN ('created', 'retry'))::int AS depth_waiting,
            COUNT(*) FILTER (WHERE state = 'active')::int               AS depth_active,
            EXTRACT(EPOCH FROM (now() - MIN(createdon)
              FILTER (WHERE state IN ('created', 'retry'))))::int        AS oldest_wait_seconds
          FROM pgboss.job
          WHERE name = ANY(${QUEUES_TO_REPORT as unknown as string[]})
          GROUP BY name
        `,
      );

      // postgres-js returns a result-array-like object; tolerate both shapes
      const data: Array<Record<string, unknown>> = Array.isArray(rows)
        ? (rows as unknown as Array<Record<string, unknown>>)
        : ((rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []);

      // Always emit one line per known queue, even if 0/0 — easier to grep
      const seen = new Set<string>();
      for (const r of data) {
        const name = String(r.name ?? '');
        seen.add(name);
        logger.info('iee.queue.depth', {
          queue: name,
          waiting: Number(r.depth_waiting ?? 0),
          active:  Number(r.depth_active  ?? 0),
          oldestWaitSeconds: r.oldest_wait_seconds == null ? 0 : Number(r.oldest_wait_seconds),
        });
      }
      for (const q of QUEUES_TO_REPORT) {
        if (!seen.has(q)) {
          logger.info('iee.queue.depth', { queue: q, waiting: 0, active: 0, oldestWaitSeconds: 0 });
        }
      }
    } catch (err) {
      // Never crash the worker because of a metrics blip
      logger.warn('iee.queue.depth_query_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // First tick after one interval — don't spam during boot
  const handle = setInterval(tick, intervalMs);
  handle.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
