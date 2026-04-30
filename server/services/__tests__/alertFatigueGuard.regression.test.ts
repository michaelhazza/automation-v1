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

import { expect, test } from 'vitest';
import { AlertFatigueGuardBase } from '../alertFatigueGuardBase.js';
import type { AlertLimits } from '../orgConfigService.js';

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



test('delivers first alert for high severity', async () => {
  const guard = new TestGuard(defaultLimits);
  const result = await guard.shouldDeliver('account-1', 'high');
  expect(result.deliver, 'should deliver').toBe(true);
  expect(result.reason, 'no suppress reason').toBe(undefined);
});

test('increments alertsThisRun counter', async () => {
  const guard = new TestGuard(defaultLimits);
  await guard.shouldDeliver('account-1', 'high');
  await guard.shouldDeliver('account-1', 'medium');
  expect(guard.alertCount, 'counter should be 2').toBe(2);
});

test('blocks when per-run cap reached', async () => {
  const guard = new TestGuard({ ...defaultLimits, maxAlertsPerRun: 2 });
  await guard.shouldDeliver('a', 'high');
  await guard.shouldDeliver('b', 'high');
  const third = await guard.shouldDeliver('c', 'high');
  expect(third.deliver, 'should block at cap').toBe(false);
  expect(third.reason?.includes('run_cap') ?? false, 'reason should mention run_cap').toBeTruthy();
});

test('blocks when per-account per-day cap reached', async () => {
  const counts = new Map([['account-1', 10]]);
  const guard = new TestGuard(defaultLimits, counts);
  const result = await guard.shouldDeliver('account-1', 'high');
  expect(result.deliver, 'should block at day cap').toBe(false);
  expect(result.reason?.includes('day_cap') ?? false, 'reason should mention day_cap').toBeTruthy();
});

test('batches low-priority when batchLowPriority=true', async () => {
  const guard = new TestGuard({ ...defaultLimits, batchLowPriority: true });
  const result = await guard.shouldDeliver('account-1', 'low');
  expect(result.deliver, 'low priority should be batched').toBe(false);
  expect(result.reason, 'reason').toBe('alert_batched_low_priority');
});

test('delivers low-priority when batchLowPriority=false', async () => {
  const guard = new TestGuard({ ...defaultLimits, batchLowPriority: false });
  const result = await guard.shouldDeliver('account-1', 'low');
  expect(result.deliver, 'should deliver when not batching low priority').toBe(true);
});

test('run cap and day cap are independent', async () => {
  // Day cap not reached, but run cap is
  const guard = new TestGuard({ ...defaultLimits, maxAlertsPerRun: 1 });
  await guard.shouldDeliver('account-1', 'high');
  const second = await guard.shouldDeliver('account-1', 'high');
  expect(second.deliver, 'blocked by run cap').toBe(false);

  // A fresh guard for same account — day cap not reached
  const guard2 = new TestGuard(defaultLimits);
  const result = await guard2.shouldDeliver('account-1', 'high');
  expect(result.deliver, 'fresh guard delivers').toBe(true);
});

test('alertCount matches delivered alerts', async () => {
  const guard = new TestGuard({ ...defaultLimits, maxAlertsPerRun: 10 });
  for (let i = 0; i < 5; i++) {
    await guard.shouldDeliver(`account-${i}`, 'medium');
  }
  expect(guard.alertCount, 'alertCount should equal delivered').toBe(5);
});

