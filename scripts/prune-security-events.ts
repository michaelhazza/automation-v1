#!/usr/bin/env tsx
/**
 * prune-security-events.ts — Sprint 2 P1.1 Layer 3 manual prune script.
 *
 * Invokes the same `runSecurityEventsCleanup()` routine that the nightly
 * pg-boss job runs, but from the command line. Use this when:
 *
 *   - An org has accumulated a large backlog (>100k rows within the
 *     retention window) and needs multiple bounded passes.
 *   - You're draining rows before shrinking retention_days.
 *   - You need to run retention immediately instead of waiting for the
 *     03:30 cron tick.
 *
 * The script logs a per-org summary to stdout and exits non-zero if the
 * sweep throws. It does NOT take any CLI flags — per-org retention is
 * always read from `organisations.security_event_retention_days`, so
 * changing retention for a specific tenant is a SQL update, not a flag.
 *
 * Usage:
 *   DATABASE_URL=postgres://… npx tsx scripts/prune-security-events.ts
 */

import 'dotenv/config';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — aborting.');
    process.exit(1);
  }

  const { runSecurityEventsCleanup } = await import(
    '../server/jobs/securityEventsCleanupJob.js'
  );
  const { client } = await import('../server/db/index.js');

  try {
    const results = await runSecurityEventsCleanup();
    const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
    console.log('');
    console.log('=== Security Events Cleanup Summary ===');
    console.log(`Organisations swept : ${results.length}`);
    console.log(`Rows deleted        : ${totalDeleted}`);
    console.log('');
    for (const r of results) {
      if (r.deleted > 0) {
        console.log(
          `  org=${r.organisationId} retention=${r.retentionDays}d deleted=${r.deleted}`,
        );
      }
    }
    console.log('');
  } catch (err) {
    console.error('Cleanup failed:', err);
    process.exit(1);
  } finally {
    await client.end({ timeout: 5 });
  }
}

await main();
