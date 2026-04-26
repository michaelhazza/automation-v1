// guard-ignore-file: pure-helper-convention reason="Uses dynamic await import('../onboardingStateService.js') — gate regex only matches static 'from' imports; sibling is imported correctly"
/**
 * onboardingStateServicePure.test.ts — org-scoped DB path unit tests.
 *
 * Verifies that upsertSubaccountOnboardingState uses the org-scoped tx
 * injected by withOrgTx rather than a module-top db handle.
 *
 * Strategy: inject a fake tx via withOrgTx (the same ALS mechanism used in
 * production) and assert the service performs its insert through that fake tx.
 * Also covers the pure mapRunStatusToOnboardingStatus helper.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/onboardingStateServicePure.test.ts
 */
export {}; // force module scope so top-level await and local declarations don't collide

// onboardingStateService transitively pulls in server/lib/env.ts which validates
// required env vars via zod. Seed placeholders before any dynamic import so the
// zod parse does not throw. This test is purely structural — it never touches the
// DB, signs a JWT, or sends email.
await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';

const { withOrgTx } = await import('../../instrumentation.js');
const {
  upsertSubaccountOnboardingState,
  mapRunStatusToOnboardingStatus,
} = await import('../onboardingStateService.js');

// ---------------------------------------------------------------------------
// Lightweight test runner (matches project tsx convention)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
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

function syncTest(name: string, fn: () => void): void {
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

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fake tx builder — insert chain stub that records calls
// ---------------------------------------------------------------------------

interface InsertCall {
  method: 'insert';
}

interface FakeTx {
  calls: InsertCall[];
  insert: (table: unknown) => {
    values: (data: unknown) => {
      onConflictDoUpdate: (opts: unknown) => Promise<void>;
    };
  };
}

function makeFakeTx(opts: { shouldThrow?: boolean } = {}): FakeTx {
  const calls: InsertCall[] = [];
  const tx: FakeTx = {
    calls,
    insert(_table: unknown) {
      calls.push({ method: 'insert' });
      return {
        values(_data: unknown) {
          return {
            onConflictDoUpdate(_opts: unknown): Promise<void> {
              if (opts.shouldThrow) {
                return Promise.reject(new Error('simulated db error'));
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return tx;
}

// ---------------------------------------------------------------------------
// withOrgTx helper
// ---------------------------------------------------------------------------

async function withFakeTx<T>(tx: FakeTx, fn: () => Promise<T>): Promise<T> {
  return withOrgTx(
    {
      tx,
      organisationId: 'org-1',
      source: 'test',
    },
    fn,
  );
}

// ---------------------------------------------------------------------------
// Base params factory
// ---------------------------------------------------------------------------

type UpsertParams = Parameters<typeof upsertSubaccountOnboardingState>[0];

function makeParams(overrides: Partial<UpsertParams> = {}): UpsertParams {
  return {
    runId: 'run-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    workflowSlug: 'onboarding',
    isOnboardingRun: true,
    runStatus: 'completed',
    startedAt: new Date('2026-01-01'),
    completedAt: new Date('2026-01-02'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mapRunStatusToOnboardingStatus — pure function tests (no DB)
// ---------------------------------------------------------------------------

console.log('');
console.log('onboardingStateServicePure — mapRunStatusToOnboardingStatus');
console.log('');

syncTest('completed maps to completed', () => {
  assertEqual(mapRunStatusToOnboardingStatus('completed'), 'completed', 'completed');
});

syncTest('completed_with_errors maps to completed', () => {
  assertEqual(mapRunStatusToOnboardingStatus('completed_with_errors'), 'completed', 'completed_with_errors');
});

syncTest('failed maps to failed', () => {
  assertEqual(mapRunStatusToOnboardingStatus('failed'), 'failed', 'failed');
});

syncTest('cancelled maps to failed', () => {
  assertEqual(mapRunStatusToOnboardingStatus('cancelled'), 'failed', 'cancelled');
});

syncTest('running maps to in_progress', () => {
  assertEqual(mapRunStatusToOnboardingStatus('running'), 'in_progress', 'running');
});

syncTest('pending maps to in_progress', () => {
  assertEqual(mapRunStatusToOnboardingStatus('pending'), 'in_progress', 'pending');
});

// ---------------------------------------------------------------------------
// upsertSubaccountOnboardingState — org-scoped DB path tests
// ---------------------------------------------------------------------------

console.log('');
console.log('onboardingStateServicePure — upsertSubaccountOnboardingState');
console.log('');

await test('uses org-scoped tx (insert called) for a valid onboarding run', async () => {
  const tx = makeFakeTx();
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams()),
  );
  assert(tx.calls.length >= 1, 'expected at least one insert call on the fake tx');
  assertEqual(tx.calls[0].method, 'insert', 'first call should be insert');
});

await test('returns early (no tx call) when isOnboardingRun is false', async () => {
  const tx = makeFakeTx();
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams({ isOnboardingRun: false })),
  );
  assertEqual(tx.calls.length, 0, 'no db call expected when not an onboarding run');
});

await test('returns early (no tx call) when workflowSlug is null', async () => {
  const tx = makeFakeTx();
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams({ workflowSlug: null })),
  );
  assertEqual(tx.calls.length, 0, 'no db call expected when workflowSlug is null');
});

await test('returns early (no tx call) when subaccountId is null', async () => {
  const tx = makeFakeTx();
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams({ subaccountId: null })),
  );
  assertEqual(tx.calls.length, 0, 'no db call expected when subaccountId is null');
});

await test('swallows db errors and resolves (bookkeeping must not block execution)', async () => {
  const tx = makeFakeTx({ shouldThrow: true });
  // Should not throw — failures are logged and swallowed
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams()),
  );
  assert(true, 'no exception propagated');
});

await test('throws missing_org_context when called without withOrgTx', async () => {
  let threw = false;
  try {
    await upsertSubaccountOnboardingState(makeParams());
  } catch {
    threw = true;
  }
  assert(threw, 'expected failure when called outside org context');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
