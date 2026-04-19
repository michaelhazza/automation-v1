/**
 * agentRunFinalizationServicePure.test.ts — pure-logic tests for the
 * IEE Phase 0 finalisation service.
 *
 * Covers:
 *   - mapIeeStatusToAgentRunStatus Appendix A mapping table
 *   - buildSummaryFromIeeRun fallbacks + truncation
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentRunFinalizationServicePure.test.ts
 *
 * Spec: docs/iee-delegation-lifecycle-spec.md §Tests, Appendix A.
 *
 * The DB-touching `finaliseAgentRunFromIeeRun` and `reconcileStuckDelegated
 * Runs` functions are not covered here — they require integration tests
 * against a test Postgres and are tracked as a remaining gap in the spec.
 */

import {
  mapIeeStatusToAgentRunStatus,
  buildSummaryFromIeeRun,
  type SummaryInput,
} from '../agentRunFinalizationServicePure.js';

type IeeRun = SummaryInput;

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Minimal IeeRun builder — SummaryInput only reads 4 fields.
function makeIeeRun(overrides: Partial<IeeRun> = {}): IeeRun {
  return {
    type: 'browser',
    status: 'completed',
    failureReason: null,
    resultSummary: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// mapIeeStatusToAgentRunStatus — Appendix A mapping table coverage
// ─────────────────────────────────────────────────────────────────────────────

test('completed iee_run → completed agent_run regardless of failureReason', () => {
  assertEqual(mapIeeStatusToAgentRunStatus('completed', null), 'completed', 'null reason');
  assertEqual(mapIeeStatusToAgentRunStatus('completed', 'timeout'), 'completed', 'timeout reason ignored');
  assertEqual(mapIeeStatusToAgentRunStatus('completed', 'budget_exceeded'), 'completed', 'budget reason ignored');
});

test('cancelled iee_run → cancelled agent_run (user-initiated)', () => {
  assertEqual(mapIeeStatusToAgentRunStatus('cancelled', null), 'cancelled', 'null reason');
  assertEqual(mapIeeStatusToAgentRunStatus('cancelled', 'timeout'), 'cancelled', 'reason ignored');
});

test('failed + timeout → timeout', () => {
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'timeout'), 'timeout', '');
});

test('failed + budget_exceeded → budget_exceeded', () => {
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'budget_exceeded'), 'budget_exceeded', '');
});

test('failed + step_limit_reached → loop_detected', () => {
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'step_limit_reached'), 'loop_detected', '');
});

test('failed + worker_terminated → failed (NOT cancelled — decision 1)', () => {
  // User-initiated cancellation sets iee_runs.status='cancelled'.
  // Worker-originated stoppage sets status='failed' + reason='worker_terminated'.
  // These map to DIFFERENT parent states: 'cancelled' vs 'failed'.
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'worker_terminated'), 'failed', '');
});

test('failed + unknown/other reasons → generic failed', () => {
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'auth_failure'), 'failed', 'auth_failure');
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'connector_timeout'), 'failed', 'connector_timeout');
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'rate_limited'), 'failed', 'rate_limited');
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'data_incomplete'), 'failed', 'data_incomplete');
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'execution_error'), 'failed', 'execution_error');
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'environment_error'), 'failed', 'environment_error');
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'internal_error'), 'failed', 'internal_error');
  assertEqual(mapIeeStatusToAgentRunStatus('failed', 'unknown'), 'failed', 'unknown');
  assertEqual(mapIeeStatusToAgentRunStatus('failed', null), 'failed', 'null reason');
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSummaryFromIeeRun — fallbacks + truncation
// ─────────────────────────────────────────────────────────────────────────────

test('uses resultSummary.output string when present', () => {
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: 'Downloaded 3 PDFs successfully' } as unknown,
  });
  assertEqual(buildSummaryFromIeeRun(run), 'Downloaded 3 PDFs successfully', '');
});

test('falls back to template on completed with no resultSummary.output', () => {
  const run = makeIeeRun({ status: 'completed', resultSummary: null });
  assertEqual(buildSummaryFromIeeRun(run), 'IEE browser task completed', '');
});

test('falls back to template on cancelled', () => {
  const run = makeIeeRun({ status: 'cancelled', resultSummary: null });
  assertEqual(buildSummaryFromIeeRun(run), 'IEE browser task cancelled', '');
});

test('falls back to template with failure reason on failed', () => {
  const run = makeIeeRun({ status: 'failed', failureReason: 'timeout', resultSummary: null });
  assertEqual(buildSummaryFromIeeRun(run), 'IEE browser task failed (timeout)', '');
});

test('falls back to "unknown" reason on failed with no failureReason', () => {
  const run = makeIeeRun({ status: 'failed', failureReason: null, resultSummary: null });
  assertEqual(buildSummaryFromIeeRun(run), 'IEE browser task failed (unknown)', '');
});

test('dev task type is reflected in fallback summary', () => {
  const run = makeIeeRun({ type: 'dev', status: 'completed', resultSummary: null });
  assertEqual(buildSummaryFromIeeRun(run), 'IEE dev task completed', '');
});

test('truncates output strings longer than 500 chars with ellipsis', () => {
  const longOutput = 'x'.repeat(600);
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: longOutput } as unknown,
  });
  const result = buildSummaryFromIeeRun(run);
  assertEqual(result.length, 500, 'truncated to exactly 500 chars');
  assertEqual(result.endsWith('...'), true, 'ends with ellipsis');
  assertEqual(result.slice(0, 497), 'x'.repeat(497), 'first 497 chars preserved');
});

test('does NOT truncate output strings of exactly 500 chars', () => {
  const exact = 'y'.repeat(500);
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: exact } as unknown,
  });
  assertEqual(buildSummaryFromIeeRun(run), exact, 'passed through unchanged');
});

test('ignores non-string resultSummary.output (falls back to template)', () => {
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: { nested: 'object' } } as unknown,
  });
  assertEqual(buildSummaryFromIeeRun(run), 'IEE browser task completed', 'template fallback');
});

test('ignores empty-string resultSummary.output (falls back to template)', () => {
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: '' } as unknown,
  });
  assertEqual(buildSummaryFromIeeRun(run), 'IEE browser task completed', 'empty string falls back');
});

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\nagentRunFinalizationServicePure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
