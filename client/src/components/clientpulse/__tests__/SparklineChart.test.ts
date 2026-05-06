/**
 * SparklineChart — pure-logic tests for point computation.
 *
 * Tests the `computePoints` and `clampValue` helpers extracted
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

import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import SparklineChart from '../SparklineChart.js';
import { computePoints, clampValue } from '../SparklineChartPure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Test 1: values=[] → isEmpty=true
// ---------------------------------------------------------------------------

console.log('\n--- Test 1: empty values ---');

test('values=[] → computePoints returns isEmpty=true', () => {
  const result = computePoints([], 90, 28);
  expect(result.isEmpty, 'isEmpty').toBe(true);
  expect(result.points.length, 'points.length').toBe(0);
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
  expect(result.isEmpty, 'isEmpty').toBe(false);
});

test('values=[20,40,60,80] → 4 points', () => {
  const result = computePoints([20, 40, 60, 80], 90, 28);
  expect(result.points.length, 'length').toBe(4);
});

test('i=0 v=20 → x=0 y=22.4', () => {
  const { points } = computePoints([20, 40, 60, 80], 90, 28);
  expect(points[0].x).toBeCloseTo(0, 4);
  expect(points[0].y).toBeCloseTo(22.4, 4);
});

test('i=1 v=40 → x=30 y=16.8', () => {
  const { points } = computePoints([20, 40, 60, 80], 90, 28);
  expect(points[1].x).toBeCloseTo(30, 4);
  expect(points[1].y).toBeCloseTo(16.8, 4);
});

test('i=2 v=60 → x=60 y=11.2', () => {
  const { points } = computePoints([20, 40, 60, 80], 90, 28);
  expect(points[2].x).toBeCloseTo(60, 4);
  expect(points[2].y).toBeCloseTo(11.2, 4);
});

test('i=3 v=80 → x=90 y=5.6', () => {
  const { points } = computePoints([20, 40, 60, 80], 90, 28);
  expect(points[3].x).toBeCloseTo(90, 4);
  expect(points[3].y).toBeCloseTo(5.6, 4);
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
  expect(clampValue(150, 0, 100), 'clamped upper').toBe(100);
});

test('clampValue(-10, 0, 100) → 0', () => {
  expect(clampValue(-10, 0, 100), 'clamped lower').toBe(0);
});

test('clampValue(50, 0, 100) → 50', () => {
  expect(clampValue(50, 0, 100), 'within range').toBe(50);
});

test('values=[150] w=90 h=28 → single point at x=45 y=0', () => {
  const { points } = computePoints([150], 90, 28);
  expect(points.length, 'length').toBe(1);
  expect(points[0].x).toBeCloseTo(45, 4);
  expect(points[0].y).toBeCloseTo(0, 4);
});

test('values=[150] → terminal dot position is (45, 0)', () => {
  const { points } = computePoints([150], 90, 28);
  const last = points[points.length - 1];
  expect(last.x).toBeCloseTo(45, 4);
  expect(last.y).toBeCloseTo(0, 4);
});

test('values=[50] w=90 h=28 → single point at x=45 y=14', () => {
  const { points } = computePoints([50], 90, 28);
  expect(points.length, 'length').toBe(1);
  expect(points[0].x).toBeCloseTo(45, 4);
  expect(points[0].y).toBeCloseTo(14, 4);
});

test('values=[0] w=90 h=28 → y=28 (bottom of SVG)', () => {
  const { points } = computePoints([0], 90, 28);
  expect(points[0].y).toBeCloseTo(28, 4);
});

test('values=[100] w=90 h=28 → y=0 (top of SVG)', () => {
  const { points } = computePoints([100], 90, 28);
  expect(points[0].y).toBeCloseTo(0, 4);
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
  expect(last.x).toBeCloseTo(90, 4);
  expect(last.y).toBeCloseTo(5.6, 4);
});

test('computePoints returns last=undefined for empty input', () => {
  const { last } = computePoints([], 90, 28);
  if (last !== undefined) throw new Error('expected last to be undefined for empty input');
});

// ---------------------------------------------------------------------------
// Test 5: terminalDot=false → no <circle> in rendered output
// ---------------------------------------------------------------------------

console.log('\n--- Test 5: terminalDot prop ---');

test('terminalDot=false → no <circle> rendered', () => {
  const html = renderToStaticMarkup(
    React.createElement(SparklineChart, { values: [20, 40, 60, 80], colour: 'text-rose-500', terminalDot: false })
  );
  if (html.includes('<circle')) {
    throw new Error(`expected no <circle> when terminalDot=false, but found one in: ${html}`);
  }
});

test('terminalDot=true (default) → <circle> rendered at last point', () => {
  const html = renderToStaticMarkup(
    React.createElement(SparklineChart, { values: [20, 40, 60, 80], colour: 'text-rose-500' })
  );
  if (!html.includes('<circle')) {
    throw new Error(`expected a <circle> when terminalDot=true, but none found in: ${html}`);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');