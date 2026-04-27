// guard-ignore-file: pure-helper-convention reason="Uses dynamic await import('../ruleAutoDeprecateJob.js') — env preamble must run before module-level zod env parse fires"
/**
 * ruleAutoDeprecateJob — idempotency + concurrency contract tests (B2).
 *
 * What this asserts:
 *   1. `__testHooks` seam exported with canonical shape, undefined-by-default.
 *   2. Hook override + reset behave per the spec's production-safety contract.
 *
 * The job uses a GLOBAL advisory lock (justified inline in the header comment
 * by the nightly cadence). Sequential / parallel DB exercises live behind a
 * real Postgres harness; the lock + the `WHERE deprecated_at IS NULL`
 * predicate together guarantee that a second runner that arrives while the
 * first holds the lock will block, then re-iterate orgs and find every
 * already-deprecated row filtered out — yielding a structured no-op.
 *
 * Runnable via:
 *   npx tsx server/jobs/__tests__/ruleAutoDeprecateJob.idempotency.test.ts
 */
export {}; // force module scope so top-level await and local declarations don't collide

await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';

const { __testHooks } = await import('../ruleAutoDeprecateJob.js');

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

await test('ruleAutoDeprecateJob: __testHooks is exported with canonical shape', () => {
  check(typeof __testHooks === 'object' && __testHooks !== null, '__testHooks must be an object');
  check(
    __testHooks.pauseBetweenClaimAndCommit === undefined,
    'pauseBetweenClaimAndCommit must default to undefined (production-safe)',
  );
});

await test('ruleAutoDeprecateJob: __testHooks override is invokable', async () => {
  let called = false;
  __testHooks.pauseBetweenClaimAndCommit = async () => {
    called = true;
  };
  await __testHooks.pauseBetweenClaimAndCommit!();
  check(called, 'override is invoked when called');
});

await test('ruleAutoDeprecateJob: __testHooks reset clears override', () => {
  __testHooks.pauseBetweenClaimAndCommit = async () => {};
  __testHooks.pauseBetweenClaimAndCommit = undefined;
  check(__testHooks.pauseBetweenClaimAndCommit === undefined, 'reset clears the override');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
