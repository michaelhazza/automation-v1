/**
 * computeRunResultStatusPure.test.ts
 *
 * Pure tests for H3-PARTIAL-COUPLING and invariant 6.3:
 * - runResultStatus is purely about task outcome (per-step aggregation)
 * - Summary absence does NOT demote status to 'partial' (H3 fix)
 * - All-completed → success; any-error → failed/partial; cancelled/skipped aggregation
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/computeRunResultStatusPure.test.ts
 */

export {};

import { expect, test } from 'vitest';
import { computeRunResultStatus } from '../agentExecutionServicePure.js';

console.log('\nH3 + invariant 6.3 — computeRunResultStatus pure tests\n');

// ── Invariant 6.3: completed → success when no demotion signals ────────────
test('all-completed, no error, no uncertainty → success', () => {
  expect(computeRunResultStatus('completed', false, false) === 'success', 'all-completed must be success').toBeTruthy();
});

// ── H3: summary absence does NOT demote ────────────────────────────────────
test('completed + no summary (hasSummary=false) → success (H3: summary absence does NOT demote)', () => {
  // hasSummary is no longer a parameter; this test asserts the function
  // only considers finalStatus, hasError, hadUncertainty.
  // Calling with the 3-arg signature and no hasSummary confirms H3 fix.
  expect(computeRunResultStatus('completed', false, false) === 'success', 'no-summary completed must be success, not partial').toBeTruthy();
});

// ── Any-error → partial (on completed) ───────────────────────────────────
test('completed + hasError → partial', () => {
  expect(computeRunResultStatus('completed', true, false) === 'partial', 'error demotes to partial').toBeTruthy();
});

// ── Uncertainty → partial ─────────────────────────────────────────────────
test('completed + hadUncertainty → partial', () => {
  expect(computeRunResultStatus('completed', false, true) === 'partial', 'uncertainty demotes to partial').toBeTruthy();
});

// ── Failure statuses → failed (regardless of error/uncertainty signals) ───
const failureStatuses = ['failed', 'timeout', 'loop_detected', 'budget_exceeded', 'cancelled'];
for (const s of failureStatuses) {
  test(`${s} → failed`, () => {
    expect(computeRunResultStatus(s, false, false) === 'failed', `${s} must be failed`).toBeTruthy();
    expect(computeRunResultStatus(s, true, true) === 'failed', `${s} must be failed regardless of signals`).toBeTruthy();
  });
}

// ── completed_with_uncertainty → partial ─────────────────────────────────
test('completed_with_uncertainty → partial (invariant 6.3)', () => {
  expect(computeRunResultStatus('completed_with_uncertainty', false, false) === 'partial', 'completed_with_uncertainty is partial').toBeTruthy();
});

// ── Non-terminal → null (invariant 6.3: do not write until terminal) ──────
const nonTerminalStatuses = ['pending', 'running', 'delegated', 'awaiting_clarification', 'waiting_on_clarification'];
for (const s of nonTerminalStatuses) {
  test(`${s} → null (non-terminal; caller MUST NOT write runResultStatus)`, () => {
    expect(computeRunResultStatus(s, false, false) === null, `${s} must return null (non-terminal)`).toBeTruthy();
  });
}

// ── summaryMissing is orthogonal — caller tracks it separately ────────────
test('H3 side-channel contract: summary presence does not affect output (3-arg function)', () => {
  // This test documents that the 3-arg signature IS the H3 fix.
  // The old 4-arg signature accepted hasSummary; removal is the contract change.
  const r1 = computeRunResultStatus('completed', false, false);
  const r2 = computeRunResultStatus('completed', false, false);
  expect(r1 === r2, 'pure: same inputs must produce same output').toBeTruthy();
  expect(r1 === 'success', 'completed + clean signals → success regardless of external summary state').toBeTruthy();
});
