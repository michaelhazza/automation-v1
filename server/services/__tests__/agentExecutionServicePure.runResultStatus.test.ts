/**
 * agentExecutionServicePure — runResultStatus derivation tests.
 *
 * Spec: tasks/hermes-audit-tier-1-spec.md §6.3, §6.3.1, §9.2 (Phase B).
 *
 * Pins the full truth table plus two edge cases that were surfaced
 * during spec review:
 *   - completed + empty summary → partial
 *   - completed + hadUncertainty → partial
 *
 * The helper returns `null` for non-terminal statuses — callers must
 * NOT write the column while the run is still in flight.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentExecutionServicePure.runResultStatus.test.ts
 */

import { computeRunResultStatus } from '../agentExecutionServicePure.js';

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
console.log('Phase B §6.3 — computeRunResultStatus truth table:');

// ── completed + no error + no uncertainty + non-empty summary → success
test('completed + clean signals → success', () => {
  assertEqual(computeRunResultStatus('completed', false, false, true), 'success', 'status');
});

// ── completed + any demotion signal → partial
test('completed + error → partial', () => {
  assertEqual(computeRunResultStatus('completed', true, false, true), 'partial', 'status');
});
test('completed + hadUncertainty → partial (edge case)', () => {
  assertEqual(computeRunResultStatus('completed', false, true, true), 'partial', 'status');
});
test('completed + empty summary → partial (edge case)', () => {
  assertEqual(computeRunResultStatus('completed', false, false, false), 'partial', 'status');
});
test('completed + all demotion signals → partial', () => {
  assertEqual(computeRunResultStatus('completed', true, true, false), 'partial', 'status');
});

// ── completed_with_uncertainty → partial (always)
test('completed_with_uncertainty (clean signals) → partial', () => {
  assertEqual(computeRunResultStatus('completed_with_uncertainty', false, false, true), 'partial', 'status');
});
test('completed_with_uncertainty (demotion signals) → partial', () => {
  assertEqual(computeRunResultStatus('completed_with_uncertainty', true, true, false), 'partial', 'status');
});

// ── failure statuses → failed
for (const s of ['failed', 'timeout', 'loop_detected', 'budget_exceeded', 'cancelled']) {
  test(`${s} → failed (regardless of other signals)`, () => {
    assertEqual(computeRunResultStatus(s, false, false, true), 'failed', 'status');
    assertEqual(computeRunResultStatus(s, true,  true,  false), 'failed', 'status-inverted');
  });
}

// ── non-terminal statuses → null
for (const s of ['pending', 'running', 'delegated', 'awaiting_clarification', 'waiting_on_clarification']) {
  test(`${s} → null (non-terminal, caller must not write)`, () => {
    assertEqual(computeRunResultStatus(s, false, false, true), null, 'status');
    assertEqual(computeRunResultStatus(s, true,  true,  false), null, 'status-inverted');
  });
}

// ── unknown status → null (defensive)
test('unknown status → null', () => {
  assertEqual(computeRunResultStatus('future_status', false, false, true), null, 'status');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
