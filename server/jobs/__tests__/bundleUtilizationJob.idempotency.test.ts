// guard-ignore-file: pure-helper-convention reason="Uses dynamic await import('../bundleUtilizationJob.js') — env preamble must run before module-level zod env parse fires"
/**
 * bundleUtilizationJob — idempotency + concurrency contract tests (B2).
 *
 * What this asserts:
 *   1. `__testHooks` seam exported with canonical shape, undefined-by-default.
 *   2. The hook is overridable + resettable (reset-on-import enforcement).
 *
 * Sequential / parallel DB exercises are deferred to integration tests that
 * boot a real Postgres — the per-org advisory lock + replay-safe
 * UPDATE-the-blob mechanic relies on actual Postgres semantics
 * (`pg_advisory_xact_lock` + transactional rollback) that an in-memory mock
 * cannot faithfully reproduce. The header comment in
 * `server/jobs/bundleUtilizationJob.ts` carries the contract.
 *
 * Runnable via:
 *   npx tsx server/jobs/__tests__/bundleUtilizationJob.idempotency.test.ts
 */
export {}; // force module scope so top-level await and local declarations don't collide

await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';

const { __testHooks } = await import('../bundleUtilizationJob.js');

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

await test('bundleUtilizationJob: __testHooks is exported with canonical shape', () => {
  check(typeof __testHooks === 'object' && __testHooks !== null, '__testHooks must be an object');
  check(
    __testHooks.pauseBetweenClaimAndCommit === undefined,
    'pauseBetweenClaimAndCommit must default to undefined (production-safe)',
  );
});

await test('bundleUtilizationJob: __testHooks override is invokable', async () => {
  let called = 0;
  __testHooks.pauseBetweenClaimAndCommit = async () => {
    called += 1;
  };
  await __testHooks.pauseBetweenClaimAndCommit!();
  await __testHooks.pauseBetweenClaimAndCommit!();
  check(called === 2, 'override is invokable repeatedly');
});

await test('bundleUtilizationJob: __testHooks reset clears override to undefined', () => {
  __testHooks.pauseBetweenClaimAndCommit = async () => {};
  __testHooks.pauseBetweenClaimAndCommit = undefined;
  check(__testHooks.pauseBetweenClaimAndCommit === undefined, 'reset clears the override');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
