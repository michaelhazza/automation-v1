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

import { expect, test } from 'vitest';
import { computeRunResultStatus } from '../agentExecutionServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('');
console.log('Phase B §6.3 — computeRunResultStatus truth table (H3: hasSummary removed):');

// ── completed + no error + no uncertainty → success (summary absence no longer demotes)
test('completed + clean signals → success', () => {
  expect(computeRunResultStatus('completed', false, false), 'status').toBe('success');
});

// ── completed + error → partial
test('completed + error → partial', () => {
  expect(computeRunResultStatus('completed', true, false), 'status').toBe('partial');
});
test('completed + hadUncertainty → partial', () => {
  expect(computeRunResultStatus('completed', false, true), 'status').toBe('partial');
});
// H3: summary absence no longer demotes to partial — it's a side-channel signal
test('completed + clean signals (no summary) → success (H3: summary absence does NOT demote)', () => {
  expect(computeRunResultStatus('completed', false, false), 'status').toBe('success');
});
test('completed + error + hadUncertainty → partial', () => {
  expect(computeRunResultStatus('completed', true, true), 'status').toBe('partial');
});

// ── completed_with_uncertainty → partial (always)
test('completed_with_uncertainty (clean signals) → partial', () => {
  expect(computeRunResultStatus('completed_with_uncertainty', false, false), 'status').toBe('partial');
});
test('completed_with_uncertainty (demotion signals) → partial', () => {
  expect(computeRunResultStatus('completed_with_uncertainty', true, true), 'status').toBe('partial');
});

// ── failure statuses → failed
for (const s of ['failed', 'timeout', 'loop_detected', 'budget_exceeded', 'cancelled']) {
  test(`${s} → failed (regardless of other signals)`, () => {
    expect(computeRunResultStatus(s, false, false), 'status').toBe('failed');
    expect(computeRunResultStatus(s, true, true), 'status-inverted').toBe('failed');
  });
}

// ── non-terminal statuses → null
for (const s of ['pending', 'running', 'delegated', 'awaiting_clarification', 'waiting_on_clarification']) {
  test(`${s} → null (non-terminal, caller must not write)`, () => {
    expect(computeRunResultStatus(s, false, false), 'status').toBe(null);
    expect(computeRunResultStatus(s, true, true), 'status-inverted').toBe(null);
  });
}

// ── unknown status → null (defensive)
test('unknown status → null', () => {
  expect(computeRunResultStatus('future_status', false, false), 'status').toBe(null);
});

console.log('');
console.log('');
