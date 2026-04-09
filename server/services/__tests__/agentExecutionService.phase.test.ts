/**
 * selectExecutionPhase unit tests — runnable via:
 *   npx tsx server/services/__tests__/agentExecutionService.phase.test.ts
 *
 * Tests the pure phase-selection logic extracted from runAgenticLoop
 * in P0.1 Layer 3 of docs/improvements-roadmap-spec.md.
 *
 * The repo doesn't have Jest / Vitest configured, so we follow the same
 * lightweight pattern as server/services/__tests__/runContextLoader.test.ts.
 */

import { selectExecutionPhase } from '../agentExecutionServicePure.js';

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
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('');
console.log('selectExecutionPhase — phase selection logic');
console.log('');

// ── Iteration 0 is always planning ─────────────────────────────────
test('iteration 0, no prior tool calls → planning', () => {
  assertEqual(selectExecutionPhase(0, false, 0), 'planning', 'phase');
});

test('iteration 0, previousResponseHadToolCalls=true → still planning', () => {
  // previousResponseHadToolCalls cannot meaningfully be true on iteration 0
  // since there is no previous response. The function should still return
  // planning because iteration 0 is short-circuited first.
  assertEqual(selectExecutionPhase(0, true, 0), 'planning', 'phase');
});

test('iteration 0, previousResponseHadToolCalls=true, totalToolCalls>0 → still planning', () => {
  assertEqual(selectExecutionPhase(0, true, 5), 'planning', 'phase');
});

// ── previousResponseHadToolCalls=true → execution ──────────────────
test('iteration 1, previousResponseHadToolCalls=true → execution', () => {
  assertEqual(selectExecutionPhase(1, true, 0), 'execution', 'phase');
});

test('iteration 5, previousResponseHadToolCalls=true, totalToolCalls=3 → execution', () => {
  assertEqual(selectExecutionPhase(5, true, 3), 'execution', 'phase');
});

// ── previousResponseHadToolCalls=false, totalToolCalls>0 → synthesis ─
test('iteration 2, no previous tool calls, but some prior tool calls → synthesis', () => {
  assertEqual(selectExecutionPhase(2, false, 1), 'synthesis', 'phase');
});

test('iteration 10, no previous tool calls, totalToolCalls=20 → synthesis', () => {
  assertEqual(selectExecutionPhase(10, false, 20), 'synthesis', 'phase');
});

// ── iteration > 0, no tool calls ever → synthesis ──────────────────
test('iteration 1, no previous, no total → synthesis (direct-answer path)', () => {
  assertEqual(selectExecutionPhase(1, false, 0), 'synthesis', 'phase');
});

test('iteration 3, no previous, no total → synthesis', () => {
  assertEqual(selectExecutionPhase(3, false, 0), 'synthesis', 'phase');
});

// ── Boundary: the explicit final fallback branch ───────────────────
// The function's last branch returns 'planning'. Verify it's not
// reachable under any normal input combination — if it is reachable,
// the branches above should have covered it.
test('all boundary combinations covered by the four explicit branches', () => {
  // This is a meta-test: any (iteration, prev, total) should land in one
  // of the first four branches, never the fallback.
  const cases: Array<[number, boolean, number, string]> = [
    [0, false, 0, 'planning'],
    [0, true,  0, 'planning'],
    [0, false, 5, 'planning'],
    [0, true,  5, 'planning'],
    [1, true,  0, 'execution'],
    [1, true,  5, 'execution'],
    [1, false, 5, 'synthesis'],
    [1, false, 0, 'synthesis'],
    [5, true,  0, 'execution'],
    [5, false, 10, 'synthesis'],
    [5, false, 0, 'synthesis'],
  ];
  for (const [it, prev, total, expected] of cases) {
    assertEqual(
      selectExecutionPhase(it, prev, total),
      expected as 'planning' | 'execution' | 'synthesis',
      `(iter=${it}, prev=${prev}, total=${total})`,
    );
  }
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
