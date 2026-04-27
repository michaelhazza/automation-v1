// guard-ignore-file: pure-helper-convention reason="Pure helper test — no DB, no framework, npx tsx runnable"
/**
 * silentAgentSuccessPure — unit tests for isSilentAgentRatioElevated.
 *
 * Runnable via:
 *   npx tsx server/services/systemMonitor/synthetic/__tests__/silentAgentSuccessPure.test.ts
 */
export {};

await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';

const { isSilentAgentRatioElevated } = await import('../silentAgentSuccess.js');

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

const THRESHOLD = 0.30;
const MIN_SAMPLES = 5;

test('0/5 → false (no silent runs)', () => {
  check(!isSilentAgentRatioElevated(5, 0, THRESHOLD, MIN_SAMPLES), 'expected false: 0/5 = 0%');
});

test('2/5 (40%) → true at threshold 0.30', () => {
  check(isSilentAgentRatioElevated(5, 2, THRESHOLD, MIN_SAMPLES), 'expected true: 2/5 = 40% >= 30%');
});

test('1/5 (20%) → false at threshold 0.30', () => {
  check(!isSilentAgentRatioElevated(5, 1, THRESHOLD, MIN_SAMPLES), 'expected false: 1/5 = 20% < 30%');
});

test('3/4 → false because below minSamples (4 < 5)', () => {
  check(!isSilentAgentRatioElevated(4, 3, THRESHOLD, MIN_SAMPLES), 'expected false: 4 total < minSamples 5');
});

test('0/0 → false (zero total)', () => {
  check(!isSilentAgentRatioElevated(0, 0, THRESHOLD, MIN_SAMPLES), 'expected false: total = 0');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
