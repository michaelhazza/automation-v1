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

import { expect, test } from 'vitest';
import {
  mapIeeStatusToAgentRunStatus,
  buildSummaryFromIeeRun,
  type SummaryInput,
} from '../agentRunFinalizationServicePure.js';

type IeeRun = SummaryInput;

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
  expect(mapIeeStatusToAgentRunStatus('completed', null), 'null reason').toBe('completed');
  expect(mapIeeStatusToAgentRunStatus('completed', 'timeout'), 'timeout reason ignored').toBe('completed');
  expect(mapIeeStatusToAgentRunStatus('completed', 'budget_exceeded'), 'budget reason ignored').toBe('completed');
});

test('cancelled iee_run → cancelled agent_run (user-initiated)', () => {
  expect(mapIeeStatusToAgentRunStatus('cancelled', null), 'null reason').toBe('cancelled');
  expect(mapIeeStatusToAgentRunStatus('cancelled', 'timeout'), 'reason ignored').toBe('cancelled');
});

test('failed + timeout → timeout', () => {
  expect(mapIeeStatusToAgentRunStatus('failed', 'timeout'), '').toBe('timeout');
});

test('failed + budget_exceeded → budget_exceeded', () => {
  expect(mapIeeStatusToAgentRunStatus('failed', 'budget_exceeded'), '').toBe('budget_exceeded');
});

test('failed + step_limit_reached → loop_detected', () => {
  expect(mapIeeStatusToAgentRunStatus('failed', 'step_limit_reached'), '').toBe('loop_detected');
});

test('failed + worker_terminated → failed (NOT cancelled — decision 1)', () => {
  // User-initiated cancellation sets iee_runs.status='cancelled'.
  // Worker-originated stoppage sets status='failed' + reason='worker_terminated'.
  // These map to DIFFERENT parent states: 'cancelled' vs 'failed'.
  expect(mapIeeStatusToAgentRunStatus('failed', 'worker_terminated'), '').toBe('failed');
});

test('failed + unknown/other reasons → generic failed', () => {
  expect(mapIeeStatusToAgentRunStatus('failed', 'auth_failure'), 'auth_failure').toBe('failed');
  expect(mapIeeStatusToAgentRunStatus('failed', 'connector_timeout'), 'connector_timeout').toBe('failed');
  expect(mapIeeStatusToAgentRunStatus('failed', 'rate_limited'), 'rate_limited').toBe('failed');
  expect(mapIeeStatusToAgentRunStatus('failed', 'data_incomplete'), 'data_incomplete').toBe('failed');
  expect(mapIeeStatusToAgentRunStatus('failed', 'execution_error'), 'execution_error').toBe('failed');
  expect(mapIeeStatusToAgentRunStatus('failed', 'environment_error'), 'environment_error').toBe('failed');
  expect(mapIeeStatusToAgentRunStatus('failed', 'internal_error'), 'internal_error').toBe('failed');
  expect(mapIeeStatusToAgentRunStatus('failed', 'unknown'), 'unknown').toBe('failed');
  expect(mapIeeStatusToAgentRunStatus('failed', null), 'null reason').toBe('failed');
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSummaryFromIeeRun — fallbacks + truncation
// ─────────────────────────────────────────────────────────────────────────────

test('uses resultSummary.output string when present', () => {
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: 'Downloaded 3 PDFs successfully' } as unknown,
  });
  expect(buildSummaryFromIeeRun(run), '').toBe('Downloaded 3 PDFs successfully');
});

test('falls back to template on completed with no resultSummary.output', () => {
  const run = makeIeeRun({ status: 'completed', resultSummary: null });
  expect(buildSummaryFromIeeRun(run), '').toBe('IEE browser task completed');
});

test('falls back to template on cancelled', () => {
  const run = makeIeeRun({ status: 'cancelled', resultSummary: null });
  expect(buildSummaryFromIeeRun(run), '').toBe('IEE browser task cancelled');
});

test('falls back to template with failure reason on failed', () => {
  const run = makeIeeRun({ status: 'failed', failureReason: 'timeout', resultSummary: null });
  expect(buildSummaryFromIeeRun(run), '').toBe('IEE browser task failed (timeout)');
});

test('falls back to "unknown" reason on failed with no failureReason', () => {
  const run = makeIeeRun({ status: 'failed', failureReason: null, resultSummary: null });
  expect(buildSummaryFromIeeRun(run), '').toBe('IEE browser task failed (unknown)');
});

test('dev task type is reflected in fallback summary', () => {
  const run = makeIeeRun({ type: 'dev', status: 'completed', resultSummary: null });
  expect(buildSummaryFromIeeRun(run), '').toBe('IEE dev task completed');
});

test('truncates output strings longer than 500 chars with ellipsis', () => {
  const longOutput = 'x'.repeat(600);
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: longOutput } as unknown,
  });
  const result = buildSummaryFromIeeRun(run);
  expect(result.length, 'truncated to exactly 500 chars').toBe(500);
  expect(result.endsWith('...'), 'ends with ellipsis').toBe(true);
  expect(result.slice(0, 497), 'first 497 chars preserved').toEqual('x'.repeat(497));
});

test('does NOT truncate output strings of exactly 500 chars', () => {
  const exact = 'y'.repeat(500);
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: exact } as unknown,
  });
  expect(buildSummaryFromIeeRun(run), 'passed through unchanged').toEqual(exact);
});

test('ignores unknown-shape object resultSummary.output (falls back to template)', () => {
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: { nested: 'object' } } as unknown,
  });
  expect(buildSummaryFromIeeRun(run), 'template fallback').toBe('IEE browser task completed');
});

test('formats login_test object output using validation fields', () => {
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: {
      output: {
        mode: 'login_test',
        screenshotPath: '/tmp/ss.png',
        validation: {
          finalUrl: 'https://example.com/dashboard',
          navigatedToContentUrl: true,
          urlChangedFromLogin: true,
          successSelectorFound: true,
        },
      },
    } as unknown,
  });
  expect(buildSummaryFromIeeRun(run), 'login_test validation summary').toBe('Login test: URL changed, content URL reached, success selector found');
});

test('formats login_test object output when selector missing', () => {
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: {
      output: {
        mode: 'login_test',
        screenshotPath: '/tmp/ss.png',
        validation: {
          finalUrl: 'https://example.com/login',
          navigatedToContentUrl: false,
          urlChangedFromLogin: false,
          successSelectorFound: false,
        },
      },
    } as unknown,
  });
  expect(buildSummaryFromIeeRun(run), 'login_test soft-failure summary').toBe('Login test: no URL change, success selector missing');
});

test('formats capture_video object output with size', () => {
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: {
      output: {
        mode: 'capture_video',
        artifactId: 'art-1',
        source: 'mediasoup',
        sizeBytes: 12345,
        contentHash: 'sha256:abc',
      },
    } as unknown,
  });
  expect(buildSummaryFromIeeRun(run), 'capture_video summary').toBe('Video captured from mediasoup (12345 bytes)');
});

test('ignores empty-string resultSummary.output (falls back to template)', () => {
  const run = makeIeeRun({
    status: 'completed',
    resultSummary: { output: '' } as unknown,
  });
  expect(buildSummaryFromIeeRun(run), 'empty string falls back').toBe('IEE browser task completed');
});

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────
