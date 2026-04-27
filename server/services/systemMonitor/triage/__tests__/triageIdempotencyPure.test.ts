// guard-ignore-file: pure-helper-convention reason="Pure helper test — no DB, no framework, npx tsx runnable"
/**
 * triageIdempotencyPure — unit tests for shouldIncrementAttemptCount.
 *
 * Runnable via:
 *   npx tsx server/services/systemMonitor/triage/__tests__/triageIdempotencyPure.test.ts
 */
export {};

await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';

const { shouldIncrementAttemptCount } = await import('../triageIdempotencyPure.js');

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

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

test('same jobId → false (pg-boss internal retry should not increment)', () => {
  check(shouldIncrementAttemptCount('job-A', 'job-A') === false, 'expected false for same jobId');
});

test('different jobId → true (operator manual retry should increment)', () => {
  check(shouldIncrementAttemptCount('job-A', 'job-B') === true, 'expected true for different jobId');
});

test('null current + non-null candidate → true (first attempt should increment)', () => {
  check(shouldIncrementAttemptCount(null, 'job-A') === true, 'expected true when currentJobId is null');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
