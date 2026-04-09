#!/usr/bin/env tsx
/**
 * run-regression-cases.ts — Sprint 2 P1.2 manual regression replay script.
 *
 * Invokes the same `runRegressionReplayTick()` routine that the weekly
 * pg-boss job (`regression-replay-tick`, Sundays 04:00) runs, but from
 * the command line. Use this when:
 *
 *   - You need to run the sweep immediately after refreshing an agent's
 *     prompt or tool set, to confirm stale cases flip to `stale` before
 *     the next scheduled tick.
 *   - You're debugging the replay harness (add logging, re-run without
 *     waiting a week).
 *   - An on-call needs a one-shot sweep as part of an incident review.
 *
 * The script logs the summary to stdout and exits non-zero if the sweep
 * throws. It takes no CLI flags — the sweep runs against every `active`
 * regression_case across every organisation (admin-bypass via
 * `withAdminConnection` + `SET LOCAL ROLE admin_role`).
 *
 * Usage:
 *   DATABASE_URL=postgres://… npx tsx scripts/run-regression-cases.ts
 *
 * See docs/improvements-roadmap-spec.md §P1.2.
 */

import 'dotenv/config';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — aborting.');
    process.exit(1);
  }

  const { runRegressionReplayTick } = await import(
    '../server/jobs/regressionReplayJob.js'
  );
  const { client } = await import('../server/db/index.js');

  try {
    const summary = await runRegressionReplayTick();
    console.log('');
    console.log('=== Regression Replay Summary ===');
    console.log(`Active cases swept : ${summary.totalActive}`);
    console.log(`Passed             : ${summary.passed}`);
    console.log(`Stale (flipped)    : ${summary.stale}`);
    console.log(`Errors (skipped)   : ${summary.errors}`);
    console.log('');
  } catch (err) {
    console.error('Regression replay failed:', err);
    process.exit(1);
  } finally {
    await client.end({ timeout: 5 });
  }
}

await main();
