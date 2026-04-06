// ---------------------------------------------------------------------------
// Job Queue Health Service — queue metrics, DLQ inspection, job search (A2)
// ---------------------------------------------------------------------------

import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { JOB_CONFIG, type JobName } from '../config/jobConfig.js';

// Queue tier classification
const QUEUE_TIERS: Record<string, 'agent_execution' | 'financial' | 'maintenance' | 'memory'> = {
  'agent-scheduled-run': 'agent_execution',
  'agent-org-scheduled-run': 'agent_execution',
  'agent-handoff-run': 'agent_execution',
  'agent-triggered-run': 'agent_execution',
  'execution-run': 'agent_execution',
  'workflow-resume': 'agent_execution',
  'llm-aggregate-update': 'financial',
  'llm-reconcile-reservations': 'financial',
  'llm-monthly-invoices': 'financial',
  'payment-reconciliation': 'financial',
  'stale-run-cleanup': 'maintenance',
  'maintenance:cleanup-execution-files': 'maintenance',
  'maintenance:cleanup-budget-reservations': 'maintenance',
  'maintenance:memory-decay': 'maintenance',
  'llm-clean-old-aggregates': 'maintenance',
  'memory-context-enrichment': 'memory',
};

export interface QueueSummary {
  queue: string;
  tier: string;
  active: number;
  pending: number;
  completed: number;
  failed: number;
  dlqDepth: number;
  avgDurationMs: number | null;
  retryRate: number;
  oldestPendingAge: number | null;
}

export const jobQueueHealthService = {
  /**
   * Get health summaries for all queues.
   * Uses job_queue_stats for historical aggregates (write-time aggregation).
   */
  async getQueueSummaries(): Promise<QueueSummary[]> {
    const summaries: QueueSummary[] = [];

    for (const queue of Object.keys(QUEUE_TIERS)) {
      // Live counts from pg-boss tables
      const liveRows = await db.execute<{ state: string; cnt: number }>(sql`
        SELECT state, count(*)::int AS cnt
        FROM pgboss.job
        WHERE name = ${queue}
          AND state IN ('created', 'active')
        GROUP BY state
      `);
      const live = liveRows as unknown as Array<{ state: string; cnt: number }>;

      const pending = live.find(r => r.state === 'created')?.cnt ?? 0;
      const active = live.find(r => r.state === 'active')?.cnt ?? 0;

      // DLQ depth
      const dlqName = `${queue}__dlq`;
      const dlqRows = await db.execute<{ cnt: number }>(sql`
        SELECT count(*)::int AS cnt FROM pgboss.job WHERE name = ${dlqName}
      `);
      const dlqDepth = (dlqRows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0;

      // Historical stats from rolling aggregates (last 24h)
      const statsRows = await db.execute<{
        completed: number; failed: number; retried: number; avg_duration: number;
      }>(sql`
        SELECT
          COALESCE(SUM(completed_count), 0)::int AS completed,
          COALESCE(SUM(failed_count), 0)::int AS failed,
          COALESCE(SUM(retry_count), 0)::int AS retried,
          CASE WHEN SUM(completed_count) > 0
            THEN (SUM(total_duration_ms) / SUM(completed_count))::int
            ELSE NULL
          END AS avg_duration
        FROM job_queue_stats
        WHERE queue = ${queue}
          AND window_start >= NOW() - INTERVAL '24 hours'
      `);
      const stats = (statsRows as unknown as Array<Record<string, number>>)[0] ?? {};

      // Oldest pending job age
      const oldestRows = await db.execute<{ age_ms: number }>(sql`
        SELECT EXTRACT(EPOCH FROM (NOW() - createdon))::int * 1000 AS age_ms
        FROM pgboss.job
        WHERE name = ${queue} AND state = 'created'
        ORDER BY createdon ASC
        LIMIT 1
      `);
      const oldestPendingAge = (oldestRows as unknown as Array<{ age_ms: number }>)[0]?.age_ms ?? null;

      const completed = (stats as Record<string, number>).completed ?? 0;
      const failed = (stats as Record<string, number>).failed ?? 0;
      const retried = (stats as Record<string, number>).retried ?? 0;

      summaries.push({
        queue,
        tier: QUEUE_TIERS[queue] ?? 'unknown',
        active,
        pending,
        completed,
        failed,
        dlqDepth,
        avgDurationMs: (stats as Record<string, number | null>).avg_duration ?? null,
        retryRate: completed > 0 ? Math.round((retried / completed) * 100) : 0,
        oldestPendingAge,
      });
    }

    return summaries;
  },

  /**
   * Get DLQ jobs for a specific queue.
   */
  async getDlqJobs(queue: string, limit = 20, offset = 0) {
    const dlqName = `${queue}__dlq`;
    const rows = await db.execute(sql`
      SELECT id, name, data, createdon, completedon
      FROM pgboss.job
      WHERE name = ${dlqName}
      ORDER BY completedon DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return (rows as unknown as Array<Record<string, unknown>>).map(row => ({
      id: row.id,
      queue,
      createdAt: row.createdon,
      completedAt: row.completedon,
      data: typeof row.data === 'string'
        ? JSON.parse(row.data.slice(0, 5000))
        : row.data,
    }));
  },

  /**
   * Record a job completion/failure in rolling aggregates.
   * Called from createWorker on job completion.
   */
  async recordJobStat(queue: string, completed: boolean, retried: boolean, durationMs: number) {
    // Round to 5-minute bucket
    const now = new Date();
    const minutes = now.getMinutes();
    const bucketMinutes = minutes - (minutes % 5);
    const windowStart = new Date(now);
    windowStart.setMinutes(bucketMinutes, 0, 0);

    await db.execute(sql`
      INSERT INTO job_queue_stats (queue, window_start, completed_count, failed_count, retry_count, total_duration_ms)
      VALUES (${queue}, ${windowStart.toISOString()}, ${completed ? 1 : 0}, ${completed ? 0 : 1}, ${retried ? 1 : 0}, ${durationMs})
      ON CONFLICT (queue, window_start)
      DO UPDATE SET
        completed_count = job_queue_stats.completed_count + EXCLUDED.completed_count,
        failed_count = job_queue_stats.failed_count + EXCLUDED.failed_count,
        retry_count = job_queue_stats.retry_count + EXCLUDED.retry_count,
        total_duration_ms = job_queue_stats.total_duration_ms + EXCLUDED.total_duration_ms
    `);
  },
};
