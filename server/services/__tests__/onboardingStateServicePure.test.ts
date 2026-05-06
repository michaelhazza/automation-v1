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
import { expect, test } from 'vitest';

export {}; // force module scope so top-level await and local declarations don't collide

// onboardingStateService transitively pulls in server/lib/env.ts which validates
// required env vars via zod. Seed placeholders before any dynamic import so the
// zod parse does not throw. This test is purely structural — it never touches the
// DB, signs a JWT, or sends email.
import 'dotenv/config';
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

function syncTest(name: string, fn: () => void): void {
  test(name, fn);
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
  expect(mapRunStatusToOnboardingStatus('completed'), 'completed').toBe('completed');
});

syncTest('completed_with_errors maps to completed', () => {
  expect(mapRunStatusToOnboardingStatus('completed_with_errors'), 'completed_with_errors').toBe('completed');
});

syncTest('failed maps to failed', () => {
  expect(mapRunStatusToOnboardingStatus('failed'), 'failed').toBe('failed');
});

syncTest('cancelled maps to failed', () => {
  expect(mapRunStatusToOnboardingStatus('cancelled'), 'cancelled').toBe('failed');
});

syncTest('running maps to in_progress', () => {
  expect(mapRunStatusToOnboardingStatus('running'), 'running').toBe('in_progress');
});

syncTest('pending maps to in_progress', () => {
  expect(mapRunStatusToOnboardingStatus('pending'), 'pending').toBe('in_progress');
});

// ---------------------------------------------------------------------------
// upsertSubaccountOnboardingState — org-scoped DB path tests
// ---------------------------------------------------------------------------

console.log('');
console.log('onboardingStateServicePure — upsertSubaccountOnboardingState');
console.log('');

test('uses org-scoped tx (insert called) for a valid onboarding run', async () => {
  const tx = makeFakeTx();
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams()),
  );
  expect(tx.calls.length >= 1, 'expected at least one insert call on the fake tx').toBeTruthy();
  expect(tx.calls[0].method, 'first call should be insert').toBe('insert');
});

test('returns early (no tx call) when isOnboardingRun is false', async () => {
  const tx = makeFakeTx();
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams({ isOnboardingRun: false })),
  );
  expect(tx.calls.length, 'no db call expected when not an onboarding run').toBe(0);
});

test('returns early (no tx call) when workflowSlug is null', async () => {
  const tx = makeFakeTx();
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams({ workflowSlug: null })),
  );
  expect(tx.calls.length, 'no db call expected when workflowSlug is null').toBe(0);
});

test('returns early (no tx call) when subaccountId is null', async () => {
  const tx = makeFakeTx();
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams({ subaccountId: null })),
  );
  expect(tx.calls.length, 'no db call expected when subaccountId is null').toBe(0);
});

test('swallows db errors and resolves (bookkeeping must not block execution)', async () => {
  const tx = makeFakeTx({ shouldThrow: true });
  // Should not throw — failures are logged and swallowed
  await withFakeTx(tx, () =>
    upsertSubaccountOnboardingState(makeParams()),
  );
  expect(true, 'no exception propagated').toBeTruthy();
});

test('resolves without throwing when called outside withOrgTx (bookkeeping must not block)', async () => {
  // Contract: onboarding-state persistence is bookkeeping — when callers reach
  // the service without an active org-scoped tx, getOrgScopedDb throws
  // missing_org_context, but that throw must be swallowed inside the try/catch
  // so workflow finalisation/cancellation does not hard-fail on bookkeeping.
  let threw = false;
  let thrown: unknown;
  try {
    await upsertSubaccountOnboardingState(makeParams());
  } catch (err) {
    threw = true;
    thrown = err;
  }
  expect(!threw, `expected upsertSubaccountOnboardingState to resolve without throwing when called outside withOrgTx, but it threw: ${
      thrown instanceof Error ? thrown.message : String(thrown)
    }`).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log('');
