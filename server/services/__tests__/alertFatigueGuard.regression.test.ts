/**
 * alertFatigueGuard.regression.test.ts
 *
 * Regression safety net for the AlertFatigueGuard base-class extraction.
 * Verifies that the refactored subclass produces identical output for a
 * golden fixture input set against the pre-refactor behaviour spec.
 *
 * Because the guard queries the DB, we test its behaviour through a mock
 * subclass that returns controlled counts — making this a pure behaviour test.
 */

import { AlertFatigueGuardBase } from '../alertFatigueGuardBase.js';
import type { AlertLimits } from '../orgConfigService.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  const result = fn();
  const handle = (err?: unknown) => {
    if (err) {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err instanceof Error ? err.message : err}`);
    } else {
      passed++;
      console.log(`  PASS  ${name}`);
    }
  };
  if (result instanceof Promise) {
    return result.then(() => handle(), handle);
  }
  handle();
  return Promise.resolve();
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// TestGuard — concrete subclass with injectable today-count
// ---------------------------------------------------------------------------

class TestGuard extends AlertFatigueGuardBase {
  private todayCounts: Map<string, number>;

  constructor(limits: AlertLimits, todayCounts: Map<string, number> = new Map()) {
    super(limits);
    this.todayCounts = todayCounts;
  }

  protected async queryTodayCount(key: string): Promise<number> {
    return this.todayCounts.get(key) ?? 0;
  }

  protected getDayCapDimension(): string {
    return 'account';
  }
}

const defaultLimits: AlertLimits = {
  maxAlertsPerRun: 5,
  maxAlertsPerAccountPerDay: 10,
  batchLowPriority: false,
};

// ---------------------------------------------------------------------------
// Tests mirroring pre-refactor AlertFatigueGuard behaviour spec
// ---------------------------------------------------------------------------

const tests: Array<() => Promise<void>> = [];

tests.push(async () => test('delivers first alert for high severity', async () => {
  const guard = new TestGuard(defaultLimits);
  const result = await guard.shouldDeliver('account-1', 'high');
  assertEqual(result.deliver, true, 'should deliver');
  assertEqual(result.reason, undefined, 'no suppress reason');
}));

tests.push(async () => test('increments alertsThisRun counter', async () => {
  const guard = new TestGuard(defaultLimits);
  await guard.shouldDeliver('account-1', 'high');
  await guard.shouldDeliver('account-1', 'medium');
  assertEqual(guard.alertCount, 2, 'counter should be 2');
}));

tests.push(async () => test('blocks when per-run cap reached', async () => {
  const guard = new TestGuard({ ...defaultLimits, maxAlertsPerRun: 2 });
  await guard.shouldDeliver('a', 'high');
  await guard.shouldDeliver('b', 'high');
  const third = await guard.shouldDeliver('c', 'high');
  assertEqual(third.deliver, false, 'should block at cap');
  assert(third.reason?.includes('run_cap') ?? false, 'reason should mention run_cap');
}));

tests.push(async () => test('blocks when per-account per-day cap reached', async () => {
  const counts = new Map([['account-1', 10]]);
  const guard = new TestGuard(defaultLimits, counts);
  const result = await guard.shouldDeliver('account-1', 'high');
  assertEqual(result.deliver, false, 'should block at day cap');
  assert(result.reason?.includes('day_cap') ?? false, 'reason should mention day_cap');
}));

tests.push(async () => test('batches low-priority when batchLowPriority=true', async () => {
  const guard = new TestGuard({ ...defaultLimits, batchLowPriority: true });
  const result = await guard.shouldDeliver('account-1', 'low');
  assertEqual(result.deliver, false, 'low priority should be batched');
  assertEqual(result.reason, 'alert_batched_low_priority', 'reason');
}));

tests.push(async () => test('delivers low-priority when batchLowPriority=false', async () => {
  const guard = new TestGuard({ ...defaultLimits, batchLowPriority: false });
  const result = await guard.shouldDeliver('account-1', 'low');
  assertEqual(result.deliver, true, 'should deliver when not batching low priority');
}));

tests.push(async () => test('run cap and day cap are independent', async () => {
  // Day cap not reached, but run cap is
  const guard = new TestGuard({ ...defaultLimits, maxAlertsPerRun: 1 });
  await guard.shouldDeliver('account-1', 'high');
  const second = await guard.shouldDeliver('account-1', 'high');
  assertEqual(second.deliver, false, 'blocked by run cap');

  // A fresh guard for same account — day cap not reached
  const guard2 = new TestGuard(defaultLimits);
  const result = await guard2.shouldDeliver('account-1', 'high');
  assertEqual(result.deliver, true, 'fresh guard delivers');
}));

tests.push(async () => test('alertCount matches delivered alerts', async () => {
  const guard = new TestGuard({ ...defaultLimits, maxAlertsPerRun: 10 });
  for (let i = 0; i < 5; i++) {
    await guard.shouldDeliver(`account-${i}`, 'medium');
  }
  assertEqual(guard.alertCount, 5, 'alertCount should equal delivered');
}));

// Run all tests
await Promise.all(tests.map(t => t()));

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
