/**
 * oauthStateCleanupJob.ts — TTL cleanup for oauth_state_nonces.
 *
 * Runs every 5 minutes via pg-boss. Deletes expired nonce rows in bounded
 * batches. Nonces expire after 10 minutes; cleanup runs every 5 minutes so
 * the table stays small at steady state.
 *
 * Pre-Launch Hardening Phase 1 — S-P0-1, S-P0-2.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js'; // guard-ignore: rls-contract-compliance reason="cleanup job deletes expired nonce rows system-wide; runs as a scheduled job outside any request ALS context"
import { logger } from './logger.js';
import { env } from './env.js';
import { getPgBoss } from './pgBossInstance.js';

const QUEUE_NAME = 'maintenance:oauth-state-cleanup';
const SCHEDULE_CRON = '*/5 * * * *'; // every 5 minutes
const BATCH_SIZE = 1000;

export async function runOauthStateCleanupOnce(): Promise<{ rowsDeleted: number }> {
  const result = await db.execute<{ ok: number }>(sql`
    DELETE FROM oauth_state_nonces
    WHERE nonce IN (
      SELECT nonce FROM oauth_state_nonces
      WHERE expires_at < now()
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING 1 AS ok
  `);
  const rows = result as unknown as Array<{ ok: number }>;
  return { rowsDeleted: rows.length };
}

export async function registerOauthStateCleanupJob(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.warn('oauth_state_cleanup_skipped', { reason: 'pg-boss not configured' });
    return;
  }
  const boss = await getPgBoss();
  await boss.work(QUEUE_NAME, async () => {
    const summary = await runOauthStateCleanupOnce();
    logger.info('oauth_state.cleanup_run', summary);
  });
  await boss.schedule(QUEUE_NAME, SCHEDULE_CRON, {}, { tz: 'UTC' });
  logger.info('oauth_state_cleanup_scheduled', { cron: SCHEDULE_CRON });
}
