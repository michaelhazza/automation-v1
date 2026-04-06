// ---------------------------------------------------------------------------
// Singleton pg-boss instance — shared across all services
//
// Replaces per-service lazy-loaded instances to reduce DB connections
// and ensure a single lifecycle for graceful shutdown.
// ---------------------------------------------------------------------------

import PgBoss from 'pg-boss';
import { env } from './env.js';

let instance: PgBoss | null = null;

export async function getPgBoss(): Promise<PgBoss> {
  if (instance) return instance;
  instance = new PgBoss({
    connectionString: env.DATABASE_URL,
    retentionDays: 7,
    archiveCompletedAfterSeconds: 43200, // 12h
    deleteAfterDays: 14,
    monitorStateIntervalSeconds: 30,
  });
  await instance.start();
  return instance;
}

export async function stopPgBoss(): Promise<void> {
  if (instance) {
    await instance.stop({ graceful: true, timeout: 10000 });
    instance = null;
  }
}
