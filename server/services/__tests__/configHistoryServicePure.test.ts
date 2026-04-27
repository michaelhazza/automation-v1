// guard-ignore-file: pure-helper-convention reason="Inline pure simulation — tests version-counter retry logic with no imports from parent directory"
/**
 * configHistoryServicePure unit tests — runnable via:
 *   npx tsx server/services/__tests__/configHistoryServicePure.test.ts
 *
 * Tests the version-counter retry logic used by configHistoryService.recordHistory.
 * The retry loop handles Postgres 23505 (unique violation) errors by re-reading
 * maxVersion and retrying the insert. This is a pure simulation — no DB required.
 */
export {};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Retry loop extracted as a pure function for testing ─────────────────────

const MAX_RETRIES = 3;

/**
 * Simulates the recordHistory retry loop.
 * @param readMaxVersion — returns current maxVersion from "DB"
 * @param tryInsert — attempts to insert a record; throws { code: '23505' } on conflict
 * @returns the version that was successfully inserted
 */
function runRetryLoop(
  readMaxVersion: () => number,
  tryInsert: (version: number) => void,
): number {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const nextVersion = readMaxVersion() + 1;
    try {
      tryInsert(nextVersion);
      return nextVersion; // Success
    } catch (err) {
      const isUniqueViolation = (err as { code?: string }).code === '23505';
      if (!isUniqueViolation || attempt === MAX_RETRIES - 1) throw err;
      // Retry: re-read maxVersion on next iteration
    }
  }
  throw new Error('unreachable');
}

// ── Tests ──────────────────────────────────────────────────────────────────

console.log('\n=== configHistoryServicePure — retry logic tests ===\n');

test('succeeds on first attempt when no conflict', () => {
  let inserted = false;
  const version = runRetryLoop(
    () => 0,
    (_v) => { inserted = true; },
  );
  assertEqual(version, 1, 'version');
  assert(inserted, 'insert called');
});

test('succeeds on second attempt after 23505 unique violation', () => {
  let currentMax = 0;
  let attempts = 0;

  const version = runRetryLoop(
    () => currentMax,
    (v) => {
      attempts++;
      if (v === 1 && attempts === 1) {
        // Simulate: another writer already inserted version 1
        currentMax = 1;
        const err = new Error('duplicate key') as Error & { code: string };
        err.code = '23505';
        throw err;
      }
      // Second attempt succeeds
    },
  );

  assertEqual(version, 2, 'should insert version 2 after retry');
  assertEqual(attempts, 2, 'should attempt insert exactly twice');
});

test('succeeds on third attempt after two 23505 conflicts', () => {
  let currentMax = 0;
  let attempts = 0;

  const version = runRetryLoop(
    () => currentMax,
    (v) => {
      attempts++;
      if (attempts <= 2) {
        // Simulate: conflicts on first two attempts
        currentMax = v;
        const err = new Error('duplicate key') as Error & { code: string };
        err.code = '23505';
        throw err;
      }
    },
  );

  assertEqual(version, 3, 'should insert version 3 after two retries');
  assertEqual(attempts, 3, 'should attempt insert exactly three times');
});

test('throws after MAX_RETRIES (3) exhausted on continuous 23505', () => {
  let attempts = 0;
  let threw = false;

  try {
    runRetryLoop(
      () => attempts, // maxVersion increments each time
      () => {
        attempts++;
        const err = new Error('duplicate key') as Error & { code: string };
        err.code = '23505';
        throw err;
      },
    );
  } catch {
    threw = true;
  }

  assert(threw, 'should throw after MAX_RETRIES exhausted');
  assertEqual(attempts, 3, 'should have attempted 3 times total');
});

test('does not catch non-23505 errors — throws immediately', () => {
  let threw = false;
  let caughtMessage = '';

  try {
    runRetryLoop(
      () => 0,
      () => { throw new Error('connection refused'); },
    );
  } catch (err) {
    threw = true;
    caughtMessage = (err as Error).message;
  }

  assert(threw, 'should throw immediately on non-23505 error');
  assertEqual(caughtMessage, 'connection refused', 'should preserve original error');
});

test('does not catch errors without a code property', () => {
  let threw = false;

  try {
    runRetryLoop(
      () => 0,
      () => { throw new TypeError('invalid argument'); },
    );
  } catch {
    threw = true;
  }

  assert(threw, 'should throw on TypeError without code property');
});

// ── Summary ──

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
