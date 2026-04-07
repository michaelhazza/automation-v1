// ---------------------------------------------------------------------------
// Worker bootstrap. Spec §4.4.
// Initialises pg-boss + Drizzle, registers handlers, returns shutdown.
// ---------------------------------------------------------------------------

import { randomUUID } from 'crypto';
import PgBoss from 'pg-boss';
import { db, client } from './db.js';
import { env } from './config/env.js';
import { logger, setBaseLogContext } from './logger.js';

export interface BootstrapResult {
  boss: PgBoss;
  workerInstanceId: string;
  shutdown: () => Promise<void>;
}

export async function bootstrap(): Promise<BootstrapResult> {
  const workerInstanceId = randomUUID();
  setBaseLogContext({ workerInstanceId });

  // Same connection options as the main app's pgBossInstance
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    retentionDays: 7,
    archiveCompletedAfterSeconds: 43200,
    deleteAfterDays: 14,
    monitorStateIntervalSeconds: 30,
  });

  boss.on('error', (err) => {
    logger.error('iee.worker.boss_error', { error: String(err) });
  });

  await boss.start();

  // ── Compat check (§4.4.5) ───────────────────────────────────────────────
  try {
    const [{ version }] = await db.execute<{ version: string }>(
      // postgres-js returns rows directly
      // @ts-expect-error - drizzle execute returns row arrays
      { sql: 'SELECT version()' }
    );
    logger.info('iee.worker.db_connected', {
      pgVersion: typeof version === 'string' ? version.split(' ').slice(0, 2).join(' ') : 'unknown',
    });
  } catch {
    // Non-fatal — main path is the boss client which has its own validation
  }

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    logger.info('iee.worker.shutdown_starting');
    try { await boss.stop({ graceful: true, timeout: 10_000 }); } catch (err) {
      logger.error('iee.worker.boss_stop_failed', { error: String(err) });
    }
    try { await client.end({ timeout: 5 }); } catch (err) {
      logger.error('iee.worker.db_close_failed', { error: String(err) });
    }
    logger.info('iee.worker.shutdown_complete');
  };

  return { boss, workerInstanceId, shutdown };
}
