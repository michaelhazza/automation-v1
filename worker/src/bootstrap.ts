// ---------------------------------------------------------------------------
// Worker bootstrap. Spec §4.4.
// Initialises pg-boss + Drizzle, registers handlers, returns shutdown.
// ---------------------------------------------------------------------------

import { randomUUID } from 'crypto';
import PgBoss from 'pg-boss';
import { db, client } from './db.js';
import { env } from './config/env.js';
import { logger, setBaseLogContext } from './logger.js';
import { setPersistenceBoss } from './persistence/runs.js';

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
  setPersistenceBoss(boss);

  // ── Playwright version consistency check (audit Blocker #5) ─────────────
  // The Dockerfile pins a specific `playwright:vX.Y.Z-jammy` base image; the
  // runtime `playwright` package comes from package.json. If these drift
  // (e.g. package.json bumped without a Dockerfile rebuild) Playwright will
  // fail at the first navigation with a cryptic "browser version mismatch"
  // error. This check surfaces the mismatch loudly at boot.
  try {
    const playwrightModule = await import('playwright');
    // The default export has no version field; re-import from the package.json
    // shipped with the installed package via node:module resolution.
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const pkg = require('playwright/package.json') as { version?: string };
    const runtimeVersion = pkg.version ?? 'unknown';
    // Chromium revision isn't directly exposed — launching a browser just to
    // check would be expensive. We settle for package version visibility and
    // rely on the Dockerfile's base image for binary consistency.
    logger.info('iee.worker.playwright_version', {
      runtimePackageVersion: runtimeVersion,
      // Spot the mismatch: if the Dockerfile was built against v1.59.1 but
      // npm install pulled a newer minor/patch, operators will see it here.
      note: 'Runtime Playwright package version — compare against Dockerfile FROM tag.',
    });
    // Basic smoke: if the Chromium executable path does not exist, log loud.
    try {
      const chromiumPath = (playwrightModule as { chromium?: { executablePath?: () => string } }).chromium?.executablePath?.();
      if (chromiumPath) {
        const { access, constants } = await import('fs/promises');
        try {
          await access(chromiumPath, constants.X_OK);
        } catch {
          logger.error('iee.worker.playwright_binary_missing', {
            expectedPath: chromiumPath,
            runtimePackageVersion: runtimeVersion,
            hint: 'Chromium binary not found at the path the installed playwright package expects. Rebuild the worker image or run `npx playwright install chromium`.',
          });
        }
      }
    } catch (err) {
      logger.warn('iee.worker.playwright_binary_check_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    logger.warn('iee.worker.playwright_version_check_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

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
