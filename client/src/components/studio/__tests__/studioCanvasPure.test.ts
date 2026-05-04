/**
 * studioCanvasPure.test.ts — unit tests for groupStepsByLayer and hasBackEdge.
 *
 * Runnable via:
 *   npx tsx client/src/components/studio/__tests__/studioCanvasPure.test.ts
 */

import { groupStepsByLayer, hasBackEdge, type CanvasStep } from '../studioCanvasPure.js';

// ─── Minimal test harness ────────────────────────────────────────────────────

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
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function step(id: string, dependsOn: string[] = []): CanvasStep {
  return { id, name: `Step ${id}`, type: 'agent', dependsOn, sideEffectType: 'none' };
}

// ─── groupStepsByLayer tests ─────────────────────────────────────────────────

console.log('');
console.log('studioCanvasPure — groupStepsByLayer');
console.log('');

test('empty input → empty output', () => {
  assertEqual(groupStepsByLayer([]), [], 'layers');
});

test('single step with no deps → layer 0', () => {
  const result = groupStepsByLayer([step('a')]);
  assertEqual(result.length, 1, 'layer count');
  assertEqual(result[0].map((s) => s.id), ['a'], 'layer 0 ids');
});

test('3-step linear chain → 3 separate layers', () => {
  const steps = [
    step('a'),
    step('b', ['a']),
    step('c', ['b']),
  ];
  const result = groupStepsByLayer(steps);
  assertEqual(result.length, 3, 'layer count');
  assertEqual(result[0].map((s) => s.id), ['a'], 'layer 0');
  assertEqual(result[1].map((s) => s.id), ['b'], 'layer 1');
  assertEqual(result[2].map((s) => s.id), ['c'], 'layer 2');
});

test('parallel steps (same dependsOn) → same layer', () => {
  const steps = [
    step('a'),
    step('b', ['a']),
    step('c', ['a']),
    step('d', ['b', 'c']),
  ];
  const result = groupStepsByLayer(steps);
  // a → [b, c] → d
  assertEqual(result.length, 3, 'layer count');
  assertEqual(result[0].map((s) => s.id), ['a'], 'layer 0');
  // b and c are parallel — both in layer 1 (order not guaranteed, so sort)
  assertEqual(result[1].map((s) => s.id).sort(), ['b', 'c'], 'layer 1');
  assertEqual(result[2].map((s) => s.id), ['d'], 'layer 2');
});

test('steps submitted in reverse order still produce correct layers', () => {
  const steps = [
    step('c', ['b']),
    step('b', ['a']),
    step('a'),
  ];
  const result = groupStepsByLayer(steps);
  assertEqual(result.length, 3, 'layer count');
  assertEqual(result[0].map((s) => s.id), ['a'], 'layer 0');
  assertEqual(result[1].map((s) => s.id), ['b'], 'layer 1');
  assertEqual(result[2].map((s) => s.id), ['c'], 'layer 2');
});

test('step with missing dep → placed in overflow layer without throwing', () => {
  const steps = [
    step('a'),
    step('b', ['missing-dep']),
  ];
  const result = groupStepsByLayer(steps);
  // 'a' goes into layer 0; 'b' has an unresolvable dep and ends in overflow
  assertTrue(result.length >= 2, 'at least 2 layers');
  assertTrue(result[0].some((s) => s.id === 'a'), 'a in first layer');
  const allIds = result.flat().map((s) => s.id);
  assertTrue(allIds.includes('b'), 'b appears somewhere');
});

// ─── hasBackEdge tests ────────────────────────────────────────────────────────

console.log('');
console.log('studioCanvasPure — hasBackEdge');
console.log('');

test('step with params.onReject pointing to prior step → true', () => {
  const steps: CanvasStep[] = [
    step('a'),
    { ...step('b', ['a']), params: { onReject: 'a' } },
  ];
  assertTrue(hasBackEdge(steps, 'b', 'a'), 'back edge b→a');
});

test('step with onReject pointing to itself → false (not a back edge to toId)', () => {
  const steps: CanvasStep[] = [
    step('a'),
    { ...step('b', ['a']), params: { onReject: 'b' } },
  ];
  assertFalse(hasBackEdge(steps, 'b', 'a'), 'no back edge when onReject points elsewhere');
});

test('step with no onReject → false', () => {
  const steps: CanvasStep[] = [step('a'), step('b', ['a'])];
  assertFalse(hasBackEdge(steps, 'b', 'a'), 'no back edge without onReject');
});

test('fromId not found → false', () => {
  const steps: CanvasStep[] = [step('a')];
  assertFalse(hasBackEdge(steps, 'nonexistent', 'a'), 'false for nonexistent fromId');
});

test('top-level onReject field (not inside params) → true', () => {
  const steps: CanvasStep[] = [
    step('a'),
    { ...step('b', ['a']), onReject: 'a' },
  ];
  assertTrue(hasBackEdge(steps, 'b', 'a'), 'top-level onReject back edge');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) process.exit(1);
