// guard-ignore-file: pure-helper-convention reason="Uses dynamic await import('../measureInterventionOutcomeJob.js') — env preamble must run before module-level zod env parse fires"
/**
 * measureInterventionOutcomeJob — idempotency + concurrency contract tests (B2).
 *
 * What this asserts:
 *   1. `__testHooks` seam exported with canonical shape, undefined-by-default.
 *   2. Hook override + reset behave per the spec's production-safety contract.
 *
 * Sequential / parallel DB exercises live behind a real Postgres harness —
 * the per-org `pg_advisory_xact_lock` + the claim-verify NOT-EXISTS re-check
 * inside `db.transaction` need actual transactional semantics. The pure
 * decision logic in `decideOutcomeMeasurement` is exercised by the existing
 * `measureInterventionOutcomeJobPure.test.ts`; this file guards the test seam
 * shape.
 *
 * Runnable via:
 *   npx tsx server/jobs/__tests__/measureInterventionOutcomeJob.idempotency.test.ts
 */
export {}; // force module scope so top-level await and local declarations don't collide

await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';

const { __testHooks } = await import('../measureInterventionOutcomeJob.js');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  __testHooks.pauseBetweenClaimAndCommit = undefined;
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

await test('measureInterventionOutcomeJob: __testHooks is exported with canonical shape', () => {
  check(typeof __testHooks === 'object' && __testHooks !== null, '__testHooks must be an object');
  check(
    __testHooks.pauseBetweenClaimAndCommit === undefined,
    'pauseBetweenClaimAndCommit must default to undefined (production-safe)',
  );
});

await test('measureInterventionOutcomeJob: __testHooks override is invokable', async () => {
  let called = false;
  __testHooks.pauseBetweenClaimAndCommit = async () => {
    called = true;
  };
  await __testHooks.pauseBetweenClaimAndCommit!();
  check(called, 'override is invoked when called');
});

await test('measureInterventionOutcomeJob: __testHooks reset clears override', () => {
  __testHooks.pauseBetweenClaimAndCommit = async () => {};
  __testHooks.pauseBetweenClaimAndCommit = undefined;
  check(__testHooks.pauseBetweenClaimAndCommit === undefined, 'reset clears the override');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
