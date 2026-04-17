/**
 * beliefConflictServicePure.test.ts
 *
 * Conflict-detection + supersession decision truth table tests.
 * Spec: docs/memory-and-briefings-spec.md §4.3 (S3)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/beliefConflictServicePure.test.ts
 */

import {
  computeConflictResolution,
  type ConflictResolutionDecision,
} from '../../services/beliefConflictServicePure.js';
import { CONFLICT_CONFIDENCE_GAP } from '../../config/limits.js';

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

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, label: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label} — expected ~${expected} (±${tolerance}), got ${actual}`,
    );
  }
}

console.log('');
console.log('beliefConflictServicePure — conflict resolution truth table (§4.3 S3)');
console.log(`CONFLICT_CONFIDENCE_GAP = ${CONFLICT_CONFIDENCE_GAP}`);
console.log('');

// ---------------------------------------------------------------------------
// Gap > threshold → auto-supersede
// ---------------------------------------------------------------------------

test('new belief clearly better → auto_supersede_existing', () => {
  const decision = computeConflictResolution({
    newConfidence: 0.9,
    existingConfidence: 0.5,
    gapThreshold: CONFLICT_CONFIDENCE_GAP,
  });
  assertEqual(decision.action, 'auto_supersede_existing', 'action');
  assertApprox(decision.confidenceGap, 0.4, 0.001, 'gap');
});

test('existing belief clearly better → auto_supersede_new', () => {
  const decision = computeConflictResolution({
    newConfidence: 0.5,
    existingConfidence: 0.9,
    gapThreshold: CONFLICT_CONFIDENCE_GAP,
  });
  assertEqual(decision.action, 'auto_supersede_new', 'action');
  assertApprox(decision.confidenceGap, 0.4, 0.001, 'gap');
});

test('gap exactly above threshold → auto_supersede_existing', () => {
  // gap = CONFLICT_CONFIDENCE_GAP + small epsilon > threshold
  const delta = CONFLICT_CONFIDENCE_GAP + 0.001;
  const decision = computeConflictResolution({
    newConfidence: 0.5 + delta,
    existingConfidence: 0.5,
    gapThreshold: CONFLICT_CONFIDENCE_GAP,
  });
  assertEqual(decision.action, 'auto_supersede_existing', 'just-above-threshold → auto');
});

// ---------------------------------------------------------------------------
// Gap ≤ threshold → queue for review
// ---------------------------------------------------------------------------

test('gap exactly at threshold → queue_for_review', () => {
  const decision = computeConflictResolution({
    newConfidence: 0.5 + CONFLICT_CONFIDENCE_GAP,
    existingConfidence: 0.5,
    gapThreshold: CONFLICT_CONFIDENCE_GAP,
  });
  assertEqual(decision.action, 'queue_for_review', 'gap === threshold → review');
});

test('gap slightly below threshold → queue_for_review', () => {
  const decision = computeConflictResolution({
    newConfidence: 0.5 + CONFLICT_CONFIDENCE_GAP - 0.001,
    existingConfidence: 0.5,
    gapThreshold: CONFLICT_CONFIDENCE_GAP,
  });
  assertEqual(decision.action, 'queue_for_review', 'just below → review');
});

test('equal confidence (gap 0) → queue_for_review', () => {
  const decision = computeConflictResolution({
    newConfidence: 0.7,
    existingConfidence: 0.7,
    gapThreshold: CONFLICT_CONFIDENCE_GAP,
  });
  assertEqual(decision.action, 'queue_for_review', 'equal → review');
  assertApprox(decision.confidenceGap, 0, 0.001, 'gap = 0');
});

test('both at 1.0 → queue_for_review', () => {
  const decision = computeConflictResolution({
    newConfidence: 1.0,
    existingConfidence: 1.0,
    gapThreshold: CONFLICT_CONFIDENCE_GAP,
  });
  assertEqual(decision.action, 'queue_for_review', 'both 1.0 → review');
});

test('both at 0.0 → queue_for_review', () => {
  const decision = computeConflictResolution({
    newConfidence: 0.0,
    existingConfidence: 0.0,
    gapThreshold: CONFLICT_CONFIDENCE_GAP,
  });
  assertEqual(decision.action, 'queue_for_review', 'both 0.0 → review');
});

// ---------------------------------------------------------------------------
// confidenceGap always reflects the absolute difference
// ---------------------------------------------------------------------------

test('confidenceGap is always non-negative', () => {
  const decision = computeConflictResolution({
    newConfidence: 0.3,
    existingConfidence: 0.8,
    gapThreshold: CONFLICT_CONFIDENCE_GAP,
  });
  if (decision.confidenceGap < 0) {
    throw new Error(`confidenceGap must be ≥ 0, got ${decision.confidenceGap}`);
  }
  assertApprox(decision.confidenceGap, 0.5, 0.001, 'gap magnitude');
});

test('confidenceGap matches |new - existing| regardless of direction', () => {
  const d1 = computeConflictResolution({ newConfidence: 0.9, existingConfidence: 0.5, gapThreshold: 0.1 });
  const d2 = computeConflictResolution({ newConfidence: 0.5, existingConfidence: 0.9, gapThreshold: 0.1 });
  assertApprox(d1.confidenceGap, d2.confidenceGap, 0.001, 'symmetric gap');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
