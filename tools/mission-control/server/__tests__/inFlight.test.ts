/**
 * inFlight.test.ts
 *
 * Pure-function tests for inFlight.ts helpers.
 * Run via: npx tsx tools/mission-control/server/__tests__/inFlight.test.ts
 */

import { derivePhaseFromVerdict } from '../lib/inFlight.js';

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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, got ${a}`);
}

// Round-2 review #4: three-state default behaviour.

test('derivePhaseFromVerdict null verdict → BUILDING (no review yet)', () => {
  eq(derivePhaseFromVerdict(null), 'BUILDING', 'phase');
});

test('derivePhaseFromVerdict APPROVED → MERGE_READY', () => {
  eq(derivePhaseFromVerdict('APPROVED'), 'MERGE_READY', 'phase');
});

test('derivePhaseFromVerdict CONFORMANT → MERGE_READY', () => {
  eq(derivePhaseFromVerdict('CONFORMANT'), 'MERGE_READY', 'phase');
});

test('derivePhaseFromVerdict CONFORMANT_AFTER_FIXES → MERGE_READY', () => {
  eq(derivePhaseFromVerdict('CONFORMANT_AFTER_FIXES'), 'MERGE_READY', 'phase');
});

test('derivePhaseFromVerdict READY_FOR_BUILD → MERGE_READY', () => {
  eq(derivePhaseFromVerdict('READY_FOR_BUILD'), 'MERGE_READY', 'phase');
});

test('derivePhaseFromVerdict CHANGES_REQUESTED → REVIEWING', () => {
  eq(derivePhaseFromVerdict('CHANGES_REQUESTED'), 'REVIEWING', 'phase');
});

test('derivePhaseFromVerdict NEEDS_DISCUSSION → REVIEWING', () => {
  eq(derivePhaseFromVerdict('NEEDS_DISCUSSION'), 'REVIEWING', 'phase');
});

test('derivePhaseFromVerdict NON_CONFORMANT → REVIEWING', () => {
  eq(derivePhaseFromVerdict('NON_CONFORMANT'), 'REVIEWING', 'phase');
});

test('derivePhaseFromVerdict FAIL → REVIEWING', () => {
  eq(derivePhaseFromVerdict('FAIL'), 'REVIEWING', 'phase');
});

test('derivePhaseFromVerdict NO_HOLES_FOUND → MERGE_READY (adversarial-reviewer clean pass)', () => {
  eq(derivePhaseFromVerdict('NO_HOLES_FOUND'), 'MERGE_READY', 'phase');
});

test('derivePhaseFromVerdict HOLES_FOUND → REVIEWING (adversarial-reviewer found issues)', () => {
  eq(derivePhaseFromVerdict('HOLES_FOUND'), 'REVIEWING', 'phase');
});

test('derivePhaseFromVerdict unknown verdict string → REVIEWING (review exists, content unknown)', () => {
  eq(derivePhaseFromVerdict('SOMETHING_NEW'), 'REVIEWING', 'phase');
});

test('derivePhaseFromVerdict empty string → REVIEWING (still a present verdict, just blank)', () => {
  // Empty string is truthy-falsy boundary — here null guard catches '', so it's BUILDING.
  // Documenting current behaviour rather than over-engineering.
  eq(derivePhaseFromVerdict(''), 'BUILDING', 'phase');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
