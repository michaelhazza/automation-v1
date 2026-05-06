/**
 * Write-path throughput timing v2 for measureInterventionOutcomeJob Phase 2 §4.7.
 *
 * Directly benchmarks interventionService.recordOutcome() (new ON CONFLICT path)
 * against a simulated per-row transaction + pg_advisory_xact_lock (legacy path),
 * using seeded actions from 2 orgs x 100 rows (200 total).
 *
 * NOTE: In this tsx environment, drizzle .onConflictDoNothing() returns []
 * instead of a rowCount object — a local postgres-js/drizzle version quirk.
 * We verify row count via DB query after each run.
 *
 * Run from project root: npx tsx tasks/builds/pre-prod-tenancy/time_write_path_v2.ts
 */
export {};
await import('dotenv/config');

const { db } = await import('../../../server/db/index.js');
const { interventionService } = await import('../../../server/services/interventionService.js');
const { sql } = await import('drizzle-orm');

const ORG1 = 'bde54a4f-7e21-418a-8741-4a5f2a143a00';
// const ORG2 = '421fa9b9-0055-44d0-adbd-51e439c4cb0a'; // reserved for future use
const ACCOUNT1 = '22200001-0000-0000-0000-000000000001';
const ACCOUNT2 = '22200001-0000-0000-0000-000000000002';
const NUM_ORGS = 2;

// Load seeded action IDs
const rows = await db.execute(
  sql`SELECT id, organisation_id FROM actions WHERE idempotency_key LIKE 'perf-test-%' ORDER BY organisation_id, executed_at`
);
const actionRows = Array.from(rows as Iterable<Record<string, unknown>>) as { id: string; organisation_id: string }[];

if (actionRows.length === 0) {
  console.error('No seeded perf-test actions found. Run seed_perf_test.sql first.');
  process.exit(1);
}
console.log(`Loaded ${actionRows.length} seeded actions across ${NUM_ORGS} orgs.`);

function getAccountId(orgId: string): string {
  return orgId === ORG1 ? ACCOUNT1 : ACCOUNT2;
}

async function cleanup() {
  await db.execute(sql`DELETE FROM intervention_outcomes WHERE intervention_type_slug = 'perf-test'`);
}

async function countWritten(): Promise<number> {
  const r = await db.execute(sql`SELECT COUNT(*) as n FROM intervention_outcomes WHERE intervention_type_slug = 'perf-test'`);
  return Number((Array.from(r as Iterable<Record<string, unknown>>)[0] as { n: string }).n);
}

// ── NEW PATH: ON CONFLICT DO NOTHING via interventionService.recordOutcome ───

console.log('\n=== NEW PATH: ON CONFLICT DO NOTHING ===');
const newTimes: number[] = [];
for (let run = 1; run <= 3; run++) {
  await cleanup();
  const t0 = performance.now();

  for (const row of actionRows) {
    await interventionService.recordOutcome({
      organisationId: row.organisation_id,
      interventionId: row.id,
      accountId: getAccountId(row.organisation_id),
      interventionTypeSlug: 'perf-test',
      measuredAfterHours: 24,
      executionFailed: false,
    });
  }

  const elapsed = performance.now() - t0;
  newTimes.push(elapsed);
  const written = await countWritten();
  const rowsPerSecTotal = written / (elapsed / 1000);
  const rowsPerSecPerOrg = (written / NUM_ORGS) / (elapsed / 1000);
  console.log(
    `Run ${run}: ${written} written in ${elapsed.toFixed(1)}ms → ${rowsPerSecTotal.toFixed(0)} rows/sec total, ${rowsPerSecPerOrg.toFixed(0)} rows/sec/org`
  );
}

// ── LEGACY PATH: per-row transaction + advisory lock + NOT EXISTS ─────────────

console.log('\n=== LEGACY PATH: pg_advisory_xact_lock row-by-row ===');
const legacyTimes: number[] = [];
for (let run = 1; run <= 3; run++) {
  await cleanup();
  const t0 = performance.now();

  for (const row of actionRows) {
    // Each row gets its own transaction with per-org advisory lock (legacy behavior)
    await db.transaction(async (tx) => {
      const lockKey = `${row.organisation_id}::measureInterventionOutcomes`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

      // Claim-verify NOT EXISTS check
      const exists = await tx.execute(
        sql`SELECT 1 FROM intervention_outcomes WHERE intervention_id = ${row.id}`
      );
      if (Array.from(exists as Iterable<unknown>).length === 0) {
        await tx.execute(sql`
          INSERT INTO intervention_outcomes (
            organisation_id, intervention_id, account_id, intervention_type_slug,
            measured_after_hours, band_changed, execution_failed
          ) VALUES (
            ${row.organisation_id},
            ${row.id},
            ${getAccountId(row.organisation_id)}::uuid,
            'perf-test',
            24,
            false,
            false
          )
        `);
      }
    });
  }

  const elapsed = performance.now() - t0;
  legacyTimes.push(elapsed);
  const written = await countWritten();
  const rowsPerSecTotal = written / (elapsed / 1000);
  const rowsPerSecPerOrg = (written / NUM_ORGS) / (elapsed / 1000);
  console.log(
    `Run ${run}: ${written} written in ${elapsed.toFixed(1)}ms → ${rowsPerSecTotal.toFixed(0)} rows/sec total, ${rowsPerSecPerOrg.toFixed(0)} rows/sec/org`
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

const median = (arr: number[]) => {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const newMedian = median(newTimes);
const legacyMedian = median(legacyTimes);
const totalRows = actionRows.length;
const newRowsPerSecPerOrg = (totalRows / NUM_ORGS) / (newMedian / 1000);
const legacyRowsPerSecPerOrg = (totalRows / NUM_ORGS) / (legacyMedian / 1000);
const speedup = newRowsPerSecPerOrg / legacyRowsPerSecPerOrg;

console.log('\n=== SUMMARY ===');
console.log(`Fixture: ${totalRows} rows, ${NUM_ORGS} orgs`);
console.log(`New path durations (ms): ${newTimes.map((t) => t.toFixed(1)).join(', ')}`);
console.log(`Legacy path durations (ms): ${legacyTimes.map((t) => t.toFixed(1)).join(', ')}`);
console.log(`New path median: ${newMedian.toFixed(1)}ms → ${newRowsPerSecPerOrg.toFixed(0)} rows/sec/org`);
console.log(`Legacy path median: ${legacyMedian.toFixed(1)}ms → ${legacyRowsPerSecPerOrg.toFixed(0)} rows/sec/org`);
console.log(`Speedup: ${speedup.toFixed(2)}x (pass: ≥5x → ${speedup >= 5 ? 'PASS' : 'FAIL'})`);
console.log(`Absolute floor: ${newRowsPerSecPerOrg.toFixed(0)} rows/sec/org (pass: ≥200 → ${newRowsPerSecPerOrg >= 200 ? 'PASS' : 'FAIL'})`);

// ── Concurrency check ─────────────────────────────────────────────────────────

console.log('\n=== CONCURRENCY CHECK ===');
await cleanup();

await Promise.all([
  (async () => {
    for (const row of actionRows) {
      await interventionService.recordOutcome({
        organisationId: row.organisation_id,
        interventionId: row.id,
        accountId: getAccountId(row.organisation_id),
        interventionTypeSlug: 'perf-test',
        measuredAfterHours: 24,
        executionFailed: false,
      });
    }
  })(),
  (async () => {
    for (const row of actionRows) {
      await interventionService.recordOutcome({
        organisationId: row.organisation_id,
        interventionId: row.id,
        accountId: getAccountId(row.organisation_id),
        interventionTypeSlug: 'perf-test',
        measuredAfterHours: 24,
        executionFailed: false,
      });
    }
  })(),
]);

const concWritten = await countWritten();
const dupCheck = await db.execute(sql`
  SELECT COUNT(*) as cnt FROM (
    SELECT intervention_id FROM intervention_outcomes
    WHERE intervention_type_slug = 'perf-test'
    GROUP BY intervention_id
    HAVING COUNT(*) > 1
  ) dups
`);
const dupCount = Number((Array.from(dupCheck as Iterable<Record<string, unknown>>)[0] as { cnt: string }).cnt);
console.log(`2 concurrent sweeps of ${totalRows} actions → ${concWritten} total rows in DB`);
console.log(`Duplicate intervention_id rows: ${dupCount} (pass: 0 → ${dupCount === 0 ? 'PASS' : 'FAIL'})`);

await cleanup();
process.exit(0);
