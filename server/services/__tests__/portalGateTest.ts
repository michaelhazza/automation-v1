/**
 * portalGateTest.ts — truth table across (portalMode × portalFeatures × requiredTier)
 *
 * Spec: docs/memory-and-briefings-spec.md §6.1 (S15)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/portalGateTest.ts
 */

import {
  canRenderPortalFeature,
  resolveAllPortalFeatures,
} from '../../lib/portalGate.js';
import type { PortalMode } from '../../db/schema/subaccounts.js';

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

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label} — expected true, got false`);
}

function assertFalse(cond: boolean, label: string) {
  if (cond) throw new Error(`${label} — expected false, got true`);
}

console.log('');
console.log('portalGate — canRenderPortalFeature truth table (§6.1 S15)');
console.log('');

// ---------------------------------------------------------------------------
// hidden mode — all features blocked
// ---------------------------------------------------------------------------

console.log('hidden mode:');

test('hidden + memoryInspector (requires transparency) → false', () => {
  assertFalse(canRenderPortalFeature('hidden', 'memoryInspector'), 'hidden blocks transparency feature');
});

test('hidden + healthDigest (requires transparency) → false', () => {
  assertFalse(canRenderPortalFeature('hidden', 'healthDigest'), 'hidden blocks healthDigest');
});

test('hidden + dropZone (requires collaborative) → false', () => {
  assertFalse(canRenderPortalFeature('hidden', 'dropZone'), 'hidden blocks collaborative feature');
});

test('hidden + clarificationRouting (requires collaborative) → false', () => {
  assertFalse(canRenderPortalFeature('hidden', 'clarificationRouting'), 'hidden blocks clarificationRouting');
});

test('hidden + taskRequests (requires collaborative) → false', () => {
  assertFalse(canRenderPortalFeature('hidden', 'taskRequests'), 'hidden blocks taskRequests');
});

// ---------------------------------------------------------------------------
// transparency mode — transparency features enabled, collaborative blocked
// ---------------------------------------------------------------------------

console.log('transparency mode:');

test('transparency + memoryInspector (requires transparency) → true', () => {
  assertTrue(canRenderPortalFeature('transparency', 'memoryInspector'), 'transparency unlocks memoryInspector');
});

test('transparency + healthDigest (requires transparency) → true', () => {
  assertTrue(canRenderPortalFeature('transparency', 'healthDigest'), 'transparency unlocks healthDigest');
});

test('transparency + dropZone (requires collaborative) → false', () => {
  assertFalse(canRenderPortalFeature('transparency', 'dropZone'), 'transparency still blocks collaborative feature');
});

test('transparency + clarificationRouting (requires collaborative) → false', () => {
  assertFalse(canRenderPortalFeature('transparency', 'clarificationRouting'), 'transparency blocks clarificationRouting');
});

test('transparency + taskRequests (requires collaborative) → false', () => {
  assertFalse(canRenderPortalFeature('transparency', 'taskRequests'), 'transparency blocks taskRequests');
});

// ---------------------------------------------------------------------------
// collaborative mode — all features enabled
// ---------------------------------------------------------------------------

console.log('collaborative mode:');

test('collaborative + memoryInspector → true', () => {
  assertTrue(canRenderPortalFeature('collaborative', 'memoryInspector'), 'collaborative unlocks transparency features');
});

test('collaborative + healthDigest → true', () => {
  assertTrue(canRenderPortalFeature('collaborative', 'healthDigest'), 'collaborative unlocks healthDigest');
});

test('collaborative + dropZone → true', () => {
  assertTrue(canRenderPortalFeature('collaborative', 'dropZone'), 'collaborative unlocks dropZone');
});

test('collaborative + clarificationRouting → true', () => {
  assertTrue(canRenderPortalFeature('collaborative', 'clarificationRouting'), 'collaborative unlocks clarificationRouting');
});

test('collaborative + taskRequests → true', () => {
  assertTrue(canRenderPortalFeature('collaborative', 'taskRequests'), 'collaborative unlocks taskRequests');
});

// ---------------------------------------------------------------------------
// portalFeatures override — explicit false disables regardless of mode
// ---------------------------------------------------------------------------

console.log('portalFeatures overrides:');

test('collaborative mode + dropZone override=false → false', () => {
  assertFalse(
    canRenderPortalFeature('collaborative', 'dropZone', { dropZone: false }),
    'explicit false override disables feature even in collaborative mode',
  );
});

test('collaborative mode + dropZone override=true → true', () => {
  assertTrue(
    canRenderPortalFeature('collaborative', 'dropZone', { dropZone: true }),
    'explicit true override does not change outcome (already enabled)',
  );
});

test('transparency mode + memoryInspector override=false → false', () => {
  assertFalse(
    canRenderPortalFeature('transparency', 'memoryInspector', { memoryInspector: false }),
    'explicit false disables even when mode allows',
  );
});

test('hidden mode + memoryInspector override=true → false (mode wins)', () => {
  // override=true cannot elevate a blocked feature — mode must meet the minimum
  assertFalse(
    canRenderPortalFeature('hidden', 'memoryInspector', { memoryInspector: true }),
    'override=true cannot bypass mode requirement',
  );
});

test('portalFeatures key absent → treated as enabled', () => {
  assertTrue(
    canRenderPortalFeature('collaborative', 'dropZone', {}),
    'absent key → not disabled',
  );
});

// ---------------------------------------------------------------------------
// Unknown feature key → deny (fail-closed)
// ---------------------------------------------------------------------------

console.log('unknown key:');

test('unknown feature key → false (fail-closed)', () => {
  // @ts-expect-error intentional unknown key test
  assertFalse(canRenderPortalFeature('collaborative', 'unknownFeature'), 'unknown key → denied');
});

// ---------------------------------------------------------------------------
// resolveAllPortalFeatures
// ---------------------------------------------------------------------------

console.log('resolveAllPortalFeatures:');

test('hidden → all false', () => {
  const result = resolveAllPortalFeatures('hidden');
  const allFalse = Object.values(result).every(v => v === false);
  assertTrue(allFalse, 'hidden → all features false');
});

test('transparency → transparency features true, collaborative false', () => {
  const result = resolveAllPortalFeatures('transparency');
  assertTrue(result.memoryInspector, 'transparency.memoryInspector = true');
  assertTrue(result.healthDigest, 'transparency.healthDigest = true');
  assertFalse(result.dropZone, 'transparency.dropZone = false');
  assertFalse(result.clarificationRouting, 'transparency.clarificationRouting = false');
  assertFalse(result.taskRequests, 'transparency.taskRequests = false');
});

test('collaborative → all true', () => {
  const result = resolveAllPortalFeatures('collaborative');
  const allTrue = Object.values(result).every(v => v === true);
  assertTrue(allTrue, 'collaborative → all features true');
});

test('resolveAllPortalFeatures with override disables specific key', () => {
  const result = resolveAllPortalFeatures('collaborative', { taskRequests: false });
  assertFalse(result.taskRequests, 'taskRequests overridden to false');
  assertTrue(result.dropZone, 'other features unaffected');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
