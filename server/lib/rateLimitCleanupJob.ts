/**
 * rateLimitCleanupJob.ts — TTL cleanup for rate_limit_buckets.
 *
 * Runs every 5 minutes via pg-boss. Bounded-batch DELETE of rows older than
 * 2 hours (= 2 * max(windowSec); longest call-site window is 3600s today).
 *
 * Spec §6.2.4, §10.2.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from './logger.js';
import { env } from './env.js';
import { getPgBoss } from './pgBossInstance.js';

const QUEUE_NAME = 'maintenance:rate-limit-cleanup';
const SCHEDULE_CRON = '*/5 * * * *'; // every 5 minutes
const BATCH_SIZE = 5000;
const MAX_BATCHES_PER_RUN = 20;
const RETENTION_INTERVAL = '2 hours';

export async function runRateLimitCleanupOnce(): Promise<{ rowsDeleted: number; iterations: number; capped: boolean }> {
  let rowsDeleted = 0;
  let iterations = 0;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    iterations = i + 1;
    const result = await db.execute<{ ok: number }>(sql`
      WITH victims AS (
        SELECT key, window_start
        FROM rate_limit_buckets
        WHERE window_start < now() - (${RETENTION_INTERVAL})::interval
        ORDER BY window_start
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM rate_limit_buckets r
      USING victims v
      WHERE r.key = v.key AND r.window_start = v.window_start
      RETURNING 1 AS ok
    `);
    const batchRows = result.rows.length;
    rowsDeleted += batchRows;
    if (batchRows < BATCH_SIZE) {
      return { rowsDeleted, iterations, capped: false };
    }
  }

  const fullCap = rowsDeleted === BATCH_SIZE * MAX_BATCHES_PER_RUN;
  logger.warn('rate_limit.cleanup_capped', {
    rowsDeleted,
    iterations,
    batchSize: BATCH_SIZE,
    maxBatchesPerRun: MAX_BATCHES_PER_RUN,
    retentionInterval: RETENTION_INTERVAL,
    backlogEstimate: fullCap ? 'full-cap' : 'partial-cap',
    likelyBacklogRemaining: fullCap,
  });
  return { rowsDeleted, iterations, capped: true };
}

export async function registerRateLimitCleanupJob(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.warn('rate_limit_cleanup_skipped', { reason: 'pg-boss not configured' });
    return;
  }
  const boss = await getPgBoss();
  await boss.work(QUEUE_NAME, async () => {
    const summary = await runRateLimitCleanupOnce();
    logger.info('rate_limit.cleanup_run', summary);
  });
  await boss.schedule(QUEUE_NAME, SCHEDULE_CRON, {}, { tz: 'UTC' });
  logger.info('rate_limit_cleanup_scheduled', { cron: SCHEDULE_CRON });
}
