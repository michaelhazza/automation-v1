// ---------------------------------------------------------------------------
// geoipDbRefreshJob.ts — Weekly GeoLite2-City database refresh (spec §8.4).
//
// Queue:          geoip-db-refresh
// Singleton key:  geoip-db-refresh-active (60-min window)
// Concurrency:    1
// Cron:           0 4 * * 0 UTC (Sunday 4am)
//
// Idempotency: state-based via the bootstrap script's file-age check.
// Retry safety: the atomic swap means partial downloads never corrupt the
// existing database; pg-boss will retry per its default policy.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);

export const QUEUE = 'geoip-db-refresh';
export const SINGLETON_KEY = 'geoip-db-refresh-active';
export const SINGLETON_MINUTES = 60;
export const CRON = '0 4 * * 0';

export async function register(boss: PgBoss): Promise<void> {
  await boss.work(
    QUEUE,
    { teamSize: 1, teamConcurrency: 1 },
    handler,
  );
  logger.info('geoip.db_refresh.handler_registered');
}

export async function schedule(boss: PgBoss): Promise<void> {
  await boss.schedule(QUEUE, CRON, {}, { singletonKey: SINGLETON_KEY });
}

export async function handler(_job: PgBoss.Job): Promise<void> {
  const licenceKey = process.env.GEOIP_LICENCE_KEY;
  if (!licenceKey) {
    logger.warn('geoip.db.refresh.failed', { step: 'precheck', reason: 'licence_key_missing' });
    return;
  }

  try {
    const { stdout } = await execFileAsync('bash', ['scripts/bootstrap-geoip-db.sh'], {
      env: { ...process.env, GEOIP_LICENCE_KEY: licenceKey },
      timeout: 5 * 60 * 1000,
    });
    logger.info('geoip.db.refreshed', { stdout: stdout.trim() });
  } catch (err: unknown) {
    const error = err as Error & { code?: number };
    logger.warn('geoip.db.refresh.failed', {
      step: 'download',
      reason: String(error.message || error),
    });
    // Job exits successfully — pg-boss singleton + weekly schedule means next
    // attempt is next Sunday. No throw to avoid retry storm.
  }
}
