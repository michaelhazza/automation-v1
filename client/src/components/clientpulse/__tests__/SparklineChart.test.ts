/**
 * SparklineChart — pure-logic tests for point computation.
 *
 * Tests the `computePoints` and `renderEmptyFallback` helpers extracted
 * from SparklineChartPure.ts. No DOM / React rendering required.
 *
 * Run via: npx tsx client/src/components/clientpulse/__tests__/SparklineChart.test.ts
 *
 * Contract under test (§3.2 of ClientPulse UI simplification spec):
 *   1. values=[]        → isEmpty=true  (component renders em-dash)
 *   2. values=[20,40,60,80] w=90 h=28 → points match formula
 *   3. values=[150]     → clamped to 100 → y=0, x=45 (single value centered)
 *   4. computePoints returns last point for terminal dot positioning
 */

import { computePoints, clampValue } from '../SparklineChartPure.js';

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
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual: number, expected: number, label: string, tolerance = 0.0001) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected}, got ${actual}`);
  }
}

// ---------------------------------------------------------------------------
// Test 1: values=[] → isEmpty=true
// ---------------------------------------------------------------------------

console.log('\n--- Test 1: empty values ---');

test('values=[] → computePoints returns isEmpty=true', () => {
  const result = computePoints([], 90, 28);
  assertEqual(result.isEmpty, true, 'isEmpty');
  assertEqual(result.points.length, 0, 'points.length');
});

// ---------------------------------------------------------------------------
// Test 2: values=[20,40,60,80] with width=90, height=28 → expected points
//   i=0, v=20: x=0,  y=28-(20/100)*28=22.4
//   i=1, v=40: x=30, y=28-(40/100)*28=16.8
//   i=2, v=60: x=60, y=28-(60/100)*28=11.2
//   i=3, v=80: x=90, y=28-(80/100)*28=5.6
// ---------------------------------------------------------------------------

console.log('\n--- Test 2: 4 evenly-spaced values ---');

test('values=[20,40,60,80] w=90 h=28 → isEmpty=false', () => {
  const result = computePoints([20, 40, 60, 80], 90, 28);
  assertEqual(result.isEmpty, false, 'isEmpty');
});

test('values=[20,40,60,80] → 4 points', () => {
  const result = computePoints([20, 40, 60, 80], 90, 28);
  assertEqual(result.points.length, 4, 'length');
});

test('i=0 v=20 → x=0 y=22.4', () => {
  const { points } = computePoints([20, 40, 60, 80], 90, 28);
  assertClose(points[0].x, 0, 'x[0]');
  assertClose(points[0].y, 22.4, 'y[0]');
});

test('i=1 v=40 → x=30 y=16.8', () => {
  const { points } = computePoints([20, 40, 60, 80], 90, 28);
  assertClose(points[1].x, 30, 'x[1]');
  assertClose(points[1].y, 16.8, 'y[1]');
});

test('i=2 v=60 → x=60 y=11.2', () => {
  const { points } = computePoints([20, 40, 60, 80], 90, 28);
  assertClose(points[2].x, 60, 'x[2]');
  assertClose(points[2].y, 11.2, 'y[2]');
});

test('i=3 v=80 → x=90 y=5.6', () => {
  const { points } = computePoints([20, 40, 60, 80], 90, 28);
  assertClose(points[3].x, 90, 'x[3]');
  assertClose(points[3].y, 5.6, 'y[3]');
});

test('polyline points string contains "0,22.4 30,16.8 60,11.2 90,5.6"', () => {
  const { pointsAttr } = computePoints([20, 40, 60, 80], 90, 28);
  // Check each pair is present in the attribute string
  for (const pair of ['0,22.4', '30,16.8', '60,11.2', '90,5.6']) {
    if (!pointsAttr.includes(pair)) {
      throw new Error(`pointsAttr missing "${pair}": got "${pointsAttr}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// Test 3: values=[150] → clamped to 100 → y=0, x=45 (single value centered)
// ---------------------------------------------------------------------------

console.log('\n--- Test 3: single out-of-range value ---');

test('clampValue(150, 0, 100) → 100', () => {
  assertEqual(clampValue(150, 0, 100), 100, 'clamped upper');
});

test('clampValue(-10, 0, 100) → 0', () => {
  assertEqual(clampValue(-10, 0, 100), 0, 'clamped lower');
});

test('clampValue(50, 0, 100) → 50', () => {
  assertEqual(clampValue(50, 0, 100), 50, 'within range');
});

test('values=[150] w=90 h=28 → single point at x=45 y=0', () => {
  const { points } = computePoints([150], 90, 28);
  assertEqual(points.length, 1, 'length');
  assertClose(points[0].x, 45, 'x — centered (width/2)');
  assertClose(points[0].y, 0, 'y — clamped 100 → y = height - (100/100)*height = 0');
});

test('values=[150] → terminal dot position is (45, 0)', () => {
  const { points } = computePoints([150], 90, 28);
  const last = points[points.length - 1];
  assertClose(last.x, 45, 'dot x');
  assertClose(last.y, 0, 'dot y');
});

// ---------------------------------------------------------------------------
// Test 4: terminalDot=false — no circle rendered (component-level concern;
//         the pure module exposes `last` point so the component can decide)
//         We verify computePoints always exposes `last` when points exist.
// ---------------------------------------------------------------------------

console.log('\n--- Test 4: terminal dot plumbing ---');

test('computePoints exposes last point for all non-empty inputs', () => {
  const { last } = computePoints([20, 40, 60, 80], 90, 28);
  if (last === undefined) throw new Error('expected last to be defined');
  assertClose(last.x, 90, 'last.x');
  assertClose(last.y, 5.6, 'last.y');
});

test('computePoints returns last=undefined for empty input', () => {
  const { last } = computePoints([], 90, 28);
  if (last !== undefined) throw new Error('expected last to be undefined for empty input');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
