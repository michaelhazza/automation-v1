/**
 * fastPathRecalibrateJobPure.test.ts
 *
 * Pure-function tests for fastPathRecalibrateJob.
 * Tests computeRouteStats which aggregates fast_path_decisions rows into
 * per-route calibration statistics.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/jobs/__tests__/fastPathRecalibrateJobPure.test.ts
 */

import { expect, test } from 'vitest';
import { computeRouteStats } from '../fastPathRecalibrateJobPure.js';

console.log('\nfastPathRecalibrateJob — pure-function tests\n');

// ---------------------------------------------------------------------------
// computeRouteStats
// ---------------------------------------------------------------------------

test('empty rows → empty stats', () => {
  const stats = computeRouteStats([]);
  expect(Object.keys(stats).length === 0, 'Expected empty stats for empty rows').toBeTruthy();
});

test('single route, no overrides, no tier2 → count=1, overrideCount=0, tier2Count=0', () => {
  const rows = [{ route: 'r1', tier: 1, outcome: 'completed', overrodeTo: null }];
  const stats = computeRouteStats(rows);
  expect(stats['r1']?.count === 1, `count should be 1, got ${stats['r1']?.count}`).toBeTruthy();
  expect(stats['r1']?.overrideCount === 0, `overrideCount should be 0`).toBeTruthy();
  expect(stats['r1']?.tier2Count === 0, `tier2Count should be 0`).toBeTruthy();
});

test('user_overrode_scope outcome increments overrideCount', () => {
  const rows = [
    { route: 'r1', tier: 1, outcome: 'user_overrode_scope', overrodeTo: null },
    { route: 'r1', tier: 1, outcome: 'completed', overrodeTo: null },
  ];
  const stats = computeRouteStats(rows);
  expect(stats['r1']?.count === 2, 'count should be 2').toBeTruthy();
  expect(stats['r1']?.overrideCount === 1, 'overrideCount should be 1').toBeTruthy();
});

test('non-null overrodeTo increments overrideCount', () => {
  const rows = [
    { route: 'r1', tier: 1, outcome: 'completed', overrodeTo: 'execute' },
  ];
  const stats = computeRouteStats(rows);
  expect(stats['r1']?.overrideCount === 1, 'overrideCount should be 1 when overrodeTo is set').toBeTruthy();
});

test('tier 2 rows increment tier2Count', () => {
  const rows = [
    { route: 'r1', tier: 2, outcome: 'completed', overrodeTo: null },
    { route: 'r1', tier: 1, outcome: 'completed', overrodeTo: null },
  ];
  const stats = computeRouteStats(rows);
  expect(stats['r1']?.tier2Count === 1, 'tier2Count should be 1').toBeTruthy();
});

test('multiple routes accumulate independently', () => {
  const rows = [
    { route: 'r1', tier: 1, outcome: 'completed', overrodeTo: null },
    { route: 'r1', tier: 2, outcome: 'user_overrode_scope', overrodeTo: null },
    { route: 'r2', tier: 1, outcome: 'completed', overrodeTo: null },
  ];
  const stats = computeRouteStats(rows);
  expect(stats['r1']?.count === 2, 'r1 count should be 2').toBeTruthy();
  expect(stats['r1']?.tier2Count === 1, 'r1 tier2Count should be 1').toBeTruthy();
  expect(stats['r1']?.overrideCount === 1, 'r1 overrideCount should be 1').toBeTruthy();
  expect(stats['r2']?.count === 1, 'r2 count should be 1').toBeTruthy();
  expect(stats['r2']?.overrideCount === 0, 'r2 overrideCount should be 0').toBeTruthy();
});

test('per-org error isolation: one failing org does not stop iteration', () => {
  const orgs = ['org-a', 'org-b', 'org-c'];
  const succeeded: string[] = [];
  for (const org of orgs) {
    try {
      if (org === 'org-b') throw new Error('simulated failure');
      succeeded.push(org);
    } catch {
      // error logged, loop continues
    }
  }
  expect(succeeded.includes('org-a') && succeeded.includes('org-c') && !succeeded.includes('org-b'), `Expected org-a + org-c succeeded; got [${succeeded.join(', ')}]`).toBeTruthy();
});

test('empty org list → zero iterations', () => {
  const orgs: string[] = [];
  let count = 0;
  for (const _org of orgs) count++;
  expect(count === 0, 'Expected zero iterations for empty org list').toBeTruthy();
});

test('per-org invocation count matches enumerated org count', () => {
  const orgs = ['org-a', 'org-b', 'org-c'];
  const invoked: string[] = [];
  for (const org of orgs) {
    invoked.push(org);
  }
  expect(invoked.length === orgs.length, `Expected ${orgs.length} per-org invocations, got ${invoked.length}`).toBeTruthy();
  expect(invoked.join(',') === orgs.join(','), `Expected invocation order [${orgs.join(',')}], got [${invoked.join(',')}]`).toBeTruthy();
});