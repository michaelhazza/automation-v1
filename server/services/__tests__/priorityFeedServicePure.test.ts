/**
 * priorityFeedServicePure.test.ts — Feature 2
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/priorityFeedServicePure.test.ts
 */

import { scoreEntry, rankFeed, type FeedEntry } from '../priorityFeedServicePure.js';

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

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} — expected ~${expected}, got ${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('');
console.log('priorityFeedServicePure');
console.log('');

// ── scoreEntry ──────────────────────────────────────────────

const caller = { subaccountId: 'sub-1' };

test('critical item at t=0, same subaccount → score = 1.0', () => {
  const entry: FeedEntry = {
    source: 'health_finding', id: '1', subaccountId: 'sub-1',
    severity: 'critical', ageHours: 0, metadata: {},
  };
  assertClose(scoreEntry(entry, caller), 1.0, 0.001, 'score');
});

test('warning item at t=0, same subaccount → score = 0.6', () => {
  const entry: FeedEntry = {
    source: 'review_item', id: '2', subaccountId: 'sub-1',
    severity: 'warning', ageHours: 0, metadata: {},
  };
  assertClose(scoreEntry(entry, caller), 0.6, 0.001, 'score');
});

test('info item at t=0, same subaccount → score = 0.3', () => {
  const entry: FeedEntry = {
    source: 'task', id: '3', subaccountId: 'sub-1',
    severity: 'info', ageHours: 0, metadata: {},
  };
  assertClose(scoreEntry(entry, caller), 0.3, 0.001, 'score');
});

test('critical item at 7 days (168h), same subaccount → score = 2.0', () => {
  const entry: FeedEntry = {
    source: 'health_finding', id: '4', subaccountId: 'sub-1',
    severity: 'critical', ageHours: 168, metadata: {},
  };
  assertClose(scoreEntry(entry, caller), 2.0, 0.001, 'score');
});

test('age factor caps at 2.0 beyond 7 days', () => {
  const entry: FeedEntry = {
    source: 'health_finding', id: '5', subaccountId: 'sub-1',
    severity: 'critical', ageHours: 500, metadata: {},
  };
  assertClose(scoreEntry(entry, caller), 2.0, 0.001, 'score');
});

test('cross-subaccount → 0.1 relevance', () => {
  const entry: FeedEntry = {
    source: 'health_finding', id: '6', subaccountId: 'sub-2',
    severity: 'critical', ageHours: 0, assignedSubaccountId: 'sub-2',
    metadata: {},
  };
  assertClose(scoreEntry(entry, caller), 0.1, 0.001, 'score');
});

test('org-wide (no assignedSubaccountId) → 0.5 relevance', () => {
  const entry: FeedEntry = {
    source: 'health_finding', id: '7', subaccountId: 'sub-2',
    severity: 'critical', ageHours: 0, metadata: {},
  };
  assertClose(scoreEntry(entry, caller), 0.5, 0.001, 'score');
});

// ── rankFeed ────────────────────────────────────────────────

test('empty feed returns empty', () => {
  assertEqual(rankFeed([], caller), [], 'empty');
});

test('rankFeed sorts by score descending', () => {
  const entries: FeedEntry[] = [
    { source: 'task', id: 'a', subaccountId: 'sub-1', severity: 'info', ageHours: 0, metadata: {} },
    { source: 'health_finding', id: 'b', subaccountId: 'sub-1', severity: 'critical', ageHours: 48, metadata: {} },
    { source: 'review_item', id: 'c', subaccountId: 'sub-1', severity: 'warning', ageHours: 24, metadata: {} },
  ];
  const ranked = rankFeed(entries, caller);
  assertEqual(ranked.map((e) => e.id), ['b', 'c', 'a'], 'order');
});

test('rankFeed with mixed subaccounts ranks same-subaccount higher', () => {
  const entries: FeedEntry[] = [
    { source: 'health_finding', id: 'x', subaccountId: 'sub-2', severity: 'critical', ageHours: 0, assignedSubaccountId: 'sub-2', metadata: {} },
    { source: 'review_item', id: 'y', subaccountId: 'sub-1', severity: 'warning', ageHours: 0, metadata: {} },
  ];
  const ranked = rankFeed(entries, caller);
  // warning(0.6) * same-sub(1.0) = 0.6 > critical(1.0) * cross-sub(0.1) = 0.1
  assertEqual(ranked.map((e) => e.id), ['y', 'x'], 'order');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
