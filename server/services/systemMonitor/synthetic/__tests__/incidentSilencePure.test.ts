// guard-ignore-file: pure-helper-convention reason="Pure helper test — no DB, no framework, npx tsx runnable"
/**
 * incidentSilencePure — unit tests for isMonitoringSilent.
 *
 * Runnable via:
 *   npx tsx server/services/systemMonitor/synthetic/__tests__/incidentSilencePure.test.ts
 */
export {};

await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';

const { isMonitoringSilent } = await import('../incidentSilence.js');

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

test('(0, 0) → false (cold-start: no proof-of-life)', () => {
  check(!isMonitoringSilent(0, 0), 'expected false: no proof-of-life (syntheticFires=0)');
});

test('(0, 1) → true (silent + has proof-of-life)', () => {
  check(isMonitoringSilent(0, 1), 'expected true: no incidents + 1 synthetic fire');
});

test('(0, 5) → true (silent + multiple synthetic fires)', () => {
  check(isMonitoringSilent(0, 5), 'expected true: no incidents + 5 synthetic fires');
});

test('(1, 0) → false (has incident, no proof-of-life)', () => {
  check(!isMonitoringSilent(1, 0), 'expected false: incident in window, not silent');
});

test('(1, 5) → false (has incident despite synthetic fires)', () => {
  check(!isMonitoringSilent(1, 5), 'expected false: incident in window = not silent');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
