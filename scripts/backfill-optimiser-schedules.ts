/**
 * One-shot script to register the optimiser schedule for all existing
 * subaccounts with optimiser_enabled = true.
 *
 * Usage: npx tsx scripts/backfill-optimiser-schedules.ts
 *
 * Idempotent — safe to re-run. Uses INSERT ... ON CONFLICT DO NOTHING
 * via registerOptimiserSchedule, so duplicate invocations are harmless.
 *
 * Advisory lock `hashtext('optimiser.backfill')` prevents concurrent runs.
 * If the lock is already held, the script exits immediately with a clear
 * human-readable message and exit code 1.
 */

import 'dotenv/config';
import { pathToFileURL } from 'url';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { agentScheduleService } from '../server/services/agentScheduleService.js';
import { db, client } from '../server/db/index.js';
import { subaccounts } from '../server/db/schema/index.js';
import { logger } from '../server/lib/logger.js';

// ---------------------------------------------------------------------------
// Advisory lock helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to acquire a session-level advisory lock (non-blocking).
 * Returns true if the lock was acquired, false if it is already held.
 *
 * The lock is automatically released when the pg client connection closes.
 * We use pg_try_advisory_lock (non-xact variant) so the lock persists for
 * the lifetime of the connection, not just the current transaction.
 */
async function tryAcquireAdvisoryLock(lockKey: number): Promise<boolean> {
  const result = await db.execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_lock(${lockKey}::bigint) AS acquired`
  );
  return result[0]?.acquired === true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runBackfillOptimiserSchedules(): Promise<{
  processed: number;
  newSchedules: number;
  existingSchedules: number;
  errors: { subaccountId: string; error: string }[];
}> {
  // Let the DB compute hashtext('optimiser.backfill') so the lock key is
  // stable and matches any other callers using the same string.
  const lockRows = await db.execute<{ lock_key: number }>(
    sql`SELECT hashtext('optimiser.backfill') AS lock_key`
  );
  const lockKey: number = lockRows[0].lock_key;

  const acquired = await tryAcquireAdvisoryLock(lockKey);
  if (!acquired) {
    const msg = 'Another backfill is already running (lock held). Wait for it to complete or check for a stalled process, then retry.';
    logger.warn('optimiser_backfill_lock_held', {
      event: 'OPTIMISER_BACKFILL_LOCK_HELD',
      lockKey,
    });
    console.error(`[backfill-optimiser] ${msg}`);
    process.exit(1);
  }

  logger.info('optimiser_backfill_start', { event: 'optimiser.backfill.start' });
  console.log('[backfill-optimiser] lock acquired, starting backfill...');

  const rows = await db
    .select({ id: subaccounts.id, name: subaccounts.name })
    .from(subaccounts)
    .where(and(eq(subaccounts.optimiserEnabled, true), isNull(subaccounts.deletedAt)));

  console.log(`[backfill-optimiser] found ${rows.length} subaccount(s) with optimiser_enabled=true`);

  let newSchedules = 0;
  let existingSchedules = 0;
  const errors: { subaccountId: string; error: string }[] = [];

  for (const sa of rows) {
    try {
      const result = await agentScheduleService.registerOptimiserSchedule(sa.id);
      if (result.wasNew) {
        newSchedules++;
        console.log(`[backfill-optimiser] registered new schedule for ${sa.id} (${sa.name}) cron=${result.cron}`);
      } else {
        existingSchedules++;
        console.log(`[backfill-optimiser] schedule already exists for ${sa.id} (${sa.name}) cron=${result.cron}`);
      }
      logger.info('optimiser_backfill_schedule_registered', {
        event: 'optimiser.backfill.schedule_registered',
        subaccountId: sa.id,
        subaccountAgentId: result.subaccountAgentId,
        cron: result.cron,
        wasNew: result.wasNew,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : String(err));
      errors.push({ subaccountId: sa.id, error: errMsg });
      logger.warn('optimiser_backfill_schedule_error', {
        event: 'optimiser.backfill.schedule_error',
        subaccountId: sa.id,
        error: errMsg,
      });
      console.warn(`[backfill-optimiser] ERROR for ${sa.id} (${sa.name}): ${errMsg}`);
    }
  }

  const summary = {
    processed: rows.length,
    newSchedules,
    existingSchedules,
    errors,
  };

  logger.info('optimiser_backfill_complete', {
    event: 'optimiser.backfill.complete',
    ...summary,
    errorCount: errors.length,
  });

  console.log('[backfill-optimiser] done:');
  console.log(`  processed:         ${summary.processed}`);
  console.log(`  new schedules:     ${summary.newSchedules}`);
  console.log(`  existing (no-op):  ${summary.existingSchedules}`);
  console.log(`  errors:            ${summary.errors.length}`);

  if (errors.length > 0) {
    console.warn('[backfill-optimiser] errors encountered:');
    for (const e of errors) {
      console.warn(`  - ${e.subaccountId}: ${e.error}`);
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

const isDirectInvocation = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isDirectInvocation) {
  runBackfillOptimiserSchedules()
    .then(async (result) => {
      await client.end();
      if (result.errors.length > 0) {
        process.exit(2);
      }
    })
    .catch(async (err) => {
      console.error('[backfill-optimiser] fatal:', err);
      try {
        await client.end();
      } catch {
        // swallow — already failing
      }
      process.exit(1);
    });
}
