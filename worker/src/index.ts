// ---------------------------------------------------------------------------
// AutomationOS IEE worker — entry point.
// Spec: docs/iee-development-spec.md §4.3, §10.5.
// ---------------------------------------------------------------------------

import { bootstrap } from './bootstrap.js';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { registerBrowserHandler } from './handlers/browserTask.js';
import { registerDevHandler } from './handlers/devTask.js';
import { registerCleanupHandler } from './handlers/cleanupOrphans.js';
import { registerCostRollupHandler } from './handlers/costRollup.js';
import { reconcileAbandonedRuns } from './persistence/reconcile.js';

async function main(): Promise<void> {
  const { boss, workerInstanceId, shutdown } = await bootstrap();

  // Reconcile any rows left in 'running' by a previous worker that died.
  // Spec §13.3.
  await reconcileAbandonedRuns(workerInstanceId);

  await registerBrowserHandler(boss, workerInstanceId);
  await registerDevHandler(boss, workerInstanceId);
  await registerCleanupHandler(boss);
  await registerCostRollupHandler(boss);

  logger.info('iee.worker.started', {
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    browserConcurrency: env.IEE_BROWSER_CONCURRENCY,
    devConcurrency: env.IEE_DEV_CONCURRENCY,
    databaseHost: (() => {
      try { return new URL(env.DATABASE_URL).host; } catch { return 'unknown'; }
    })(),
  });

  const handleSignal = (sig: string) => {
    logger.info('iee.worker.signal', { signal: sig });
    void shutdown().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT',  () => handleSignal('SIGINT'));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    msg: 'iee.worker.fatal',
    error: err instanceof Error ? err.message : String(err),
  }));
  process.exit(1);
});
