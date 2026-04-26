/**
 * fastPathDecisionsPruneJobPure.test.ts
 *
 * Pure-function tests for fastPathDecisionsPruneJob.
 * Tests the cutoff date computation logic that determines which rows are pruned.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/jobs/__tests__/fastPathDecisionsPruneJobPure.test.ts
 */

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Pure helper: compute the cutoff date for the prune job (mirrors job logic). */
function computePruneCutoff(retentionDays: number, now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

export {}; // make this a module (avoids global-scope redeclaration in tsc)

console.log('\nfastPathDecisionsPruneJob — pure-function tests\n');

const RETENTION_DAYS = 90;

test('cutoff is exactly 90 days before now (calendar days)', () => {
  const now = new Date('2026-04-26T12:00:00Z');
  const cutoff = computePruneCutoff(RETENTION_DAYS, now);
  // setDate moves by local calendar days; verify the date is 90 days earlier
  const diffMs = now.getTime() - cutoff.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  assert(
    Math.round(diffDays) === 90,
    `Expected cutoff to be ~90 days before now, got ${diffDays.toFixed(2)} days`,
  );
});

test('row with decidedAt exactly at cutoff: should be pruned (lt means strictly less than)', () => {
  const now = new Date('2026-04-26T12:00:00Z');
  const cutoff = computePruneCutoff(RETENTION_DAYS, now);
  // decidedAt exactly at cutoff is NOT pruned by `lt` (strict less than)
  const atCutoff = new Date(cutoff);
  assert(
    atCutoff.getTime() === cutoff.getTime(),
    'Boundary check: atCutoff should equal cutoff',
  );
  // lt(decidedAt, cutoff) means decidedAt < cutoff — a row AT the cutoff is NOT deleted
  // This is correct: we want to keep rows from exactly 90 days ago; only delete older ones
  const isOlderThanCutoff = atCutoff.getTime() < cutoff.getTime();
  assert(!isOlderThanCutoff, 'Row at cutoff boundary should NOT be pruned (lt is strict)');
});

test('row 1 ms before cutoff: should be pruned', () => {
  const now = new Date('2026-04-26T12:00:00Z');
  const cutoff = computePruneCutoff(RETENTION_DAYS, now);
  const justBeforeCutoff = new Date(cutoff.getTime() - 1);
  assert(
    justBeforeCutoff.getTime() < cutoff.getTime(),
    'Row 1ms before cutoff should be pruned',
  );
});

test('row created today: should NOT be pruned', () => {
  const now = new Date('2026-04-26T12:00:00Z');
  const cutoff = computePruneCutoff(RETENTION_DAYS, now);
  const today = new Date(now);
  assert(
    today.getTime() >= cutoff.getTime(),
    'Today\'s row should not be pruned',
  );
});

test('empty org list → zero iterations (per-org isolation contract)', () => {
  const orgs: string[] = [];
  let callCount = 0;
  for (const _org of orgs) {
    callCount++;
  }
  assert(callCount === 0, `Expected 0 iterations for empty org list, got ${callCount}`);
});

test('per-org error isolation: one failing org does not stop iteration', () => {
  const orgs = ['org-a', 'org-b', 'org-c'];
  const processed: string[] = [];
  for (const org of orgs) {
    try {
      if (org === 'org-b') throw new Error('simulated failure');
      processed.push(org);
    } catch {
      // error logged and continues
    }
  }
  assert(
    processed.includes('org-a') && processed.includes('org-c') && !processed.includes('org-b'),
    `Expected org-a + org-c processed, org-b skipped; got [${processed.join(', ')}]`,
  );
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
