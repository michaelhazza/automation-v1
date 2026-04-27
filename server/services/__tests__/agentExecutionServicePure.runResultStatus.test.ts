/**
 * agentExecutionServicePure — runResultStatus derivation tests.
 *
 * Spec: tasks/hermes-audit-tier-1-spec.md §6.3, §6.3.1, §9.2 (Phase B).
 * H3 amendment: hasSummary removed from computeRunResultStatus; partial is
 * reachable ONLY from per-step aggregation per invariant 6.3. Summary absence
 * is surfaced via the summaryMissing side-channel, NOT via 'partial' status.
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
console.log('Phase B §6.3 — computeRunResultStatus truth table (H3: hasSummary removed):');

// ── completed + no error + no uncertainty → success (summary absence no longer demotes)
test('completed + clean signals → success', () => {
  assertEqual(computeRunResultStatus('completed', false, false), 'success', 'status');
});

// ── completed + error → partial
test('completed + error → partial', () => {
  assertEqual(computeRunResultStatus('completed', true, false), 'partial', 'status');
});
test('completed + hadUncertainty → partial', () => {
  assertEqual(computeRunResultStatus('completed', false, true), 'partial', 'status');
});
// H3: summary absence no longer demotes to partial — it's a side-channel signal
test('completed + clean signals (no summary) → success (H3: summary absence does NOT demote)', () => {
  assertEqual(computeRunResultStatus('completed', false, false), 'success', 'status');
});
test('completed + error + hadUncertainty → partial', () => {
  assertEqual(computeRunResultStatus('completed', true, true), 'partial', 'status');
});

// ── completed_with_uncertainty → partial (always)
test('completed_with_uncertainty (clean signals) → partial', () => {
  assertEqual(computeRunResultStatus('completed_with_uncertainty', false, false), 'partial', 'status');
});
test('completed_with_uncertainty (demotion signals) → partial', () => {
  assertEqual(computeRunResultStatus('completed_with_uncertainty', true, true), 'partial', 'status');
});

// ── failure statuses → failed
for (const s of ['failed', 'timeout', 'loop_detected', 'budget_exceeded', 'cancelled']) {
  test(`${s} → failed (regardless of other signals)`, () => {
    assertEqual(computeRunResultStatus(s, false, false), 'failed', 'status');
    assertEqual(computeRunResultStatus(s, true, true), 'failed', 'status-inverted');
  });
}

// ── non-terminal statuses → null
for (const s of ['pending', 'running', 'delegated', 'awaiting_clarification', 'waiting_on_clarification']) {
  test(`${s} → null (non-terminal, caller must not write)`, () => {
    assertEqual(computeRunResultStatus(s, false, false), null, 'status');
    assertEqual(computeRunResultStatus(s, true, true), null, 'status-inverted');
  });
}

// ── unknown status → null (defensive)
test('unknown status → null', () => {
  assertEqual(computeRunResultStatus('future_status', false, false), null, 'status');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
