/**
 * agentRunFinalizationServicePure.test.ts — pure-logic tests for the
 * IEE Phase 0 finalisation service.
 *
 * Covers:
 *   - mapIeeStatusToAgentRunStatus Appendix A mapping table
 *   - buildSummaryFromIeeRun fallbacks + truncation
 *   - F2 legacy-fallback: `finaliseAgentRunFromIeeRun` correctly derives
 *     `backendId` from `ieeRun.type` and forwards to
 *     `finaliseAgentRunFromBackend`. (Execution Backend Adapter Contract
 *     spec § 16 #14.)
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/agentRunFinalizationServicePure.test.ts
 *
 * Spec: docs/iee-delegation-lifecycle-spec.md §Tests, Appendix A;
 *       tasks/builds/execution-backend-adapter-contract/spec.md § 16.
 *
 * The DB-touching `finaliseAgentRunFromBackend` orchestrator is not
 * exercised end-to-end here (it requires a test Postgres). The F2 case
 * targets the alias's translation logic only — the orchestrator is
 * stubbed via a mock registry adapter so the test stays pure.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
// F2 — legacy-fallback alias translation (Execution Backend Adapter Contract
// spec § 16 #14)
//
// `finaliseAgentRunFromIeeRun` is the legacy alias retained for one chunk
// (Chunk 3 → Chunk 5 cleanup). Its only job is to derive `backendId` from
// `ieeRun.type` and forward to `finaliseAgentRunFromBackend`. The pre-cutover
// scenario the alias exists for: a parent `agent_runs` row whose
// `backendId IS NULL` (legacy run from before migration 0313). The alias must
// derive the adapter id from the `iee_runs.type` discriminator alone — never
// read from `agent_runs.backendId` — so legacy parents finalise correctly.
//
// This test stubs the registry + db so the adapter's `finalise()` is a
// recording mock. It does NOT seed an `agent_runs.backendId` value — exactly
// the "pre-cutover state" the spec calls for.
// ─────────────────────────────────────────────────────────────────────────────

describe('F2 — finaliseAgentRunFromIeeRun legacy-fallback alias', () => {
  let resolveCalls: Array<{ id: string }>;
  let finaliseInvocations: Array<{ backendTaskId: string }>;

  beforeEach(() => {
    resolveCalls = [];
    finaliseInvocations = [];

    // Stub `db.transaction(cb)` to invoke the callback with a no-op tx.
    // The adapter mock below short-circuits before any tx writes, so the
    // tx handle is never read.
    vi.doMock('../../db/index.js', () => ({
      db: {
        transaction: async <T,>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
          return cb({} as unknown);
        },
      },
    }));

    // Stub the registry so resolve(id) returns a delegated mock adapter
    // whose `loadTerminalState` returns `null` (early-exit for "no row").
    // This lets us assert the dispatch path took the correct backendId
    // without exercising any DB-touching adapter logic.
    vi.doMock('../executionBackends/registry.js', () => ({
      executionBackendRegistry: {
        resolve: (id: string) => {
          resolveCalls.push({ id });
          return {
            id,
            capabilities: ['delegated', 'cancellation'],
            costModel: 'per_token',
            sandboxRequirement: 'browser',
            async loadTerminalState(_tx: unknown, backendTaskId: string) {
              finaliseInvocations.push({ backendTaskId });
              return null;
            },
            async finalise() {
              return { finalised: false, parentTerminalStatus: '' };
            },
            async reconcile() {
              return 0;
            },
            async dispatch() {
              return { lifecycle: 'delegated', backendTaskId: null, loopResult: null, deduplicated: false };
            },
          };
        },
        forDelegated: () => [],
      },
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../db/index.js');
    vi.doUnmock('../executionBackends/registry.js');
  });

  test('ieeRun.type=browser → derives backendId="iee_browser" (legacy parent has backendId IS NULL)', async () => {
    const { finaliseAgentRunFromIeeRun } = await import('../agentRunFinalizationService.js');
    // Fixture: minimal terminal iee_runs row of type 'browser'. The parent
    // agent_runs row is intentionally NOT seeded with `backendId` — that's
    // the pre-cutover state.
    const ieeRun = {
      id: 'iee-run-browser-1',
      type: 'browser',
      status: 'completed',
      failureReason: null,
      eventEmittedAt: null,
      agentRunId: 'parent-agent-run-1',
    } as unknown as Parameters<typeof finaliseAgentRunFromIeeRun>[0];

    await finaliseAgentRunFromIeeRun(ieeRun);

    expect(resolveCalls.map((c) => c.id), 'alias resolved iee_browser adapter').toEqual(['iee_browser']);
    expect(finaliseInvocations.map((i) => i.backendTaskId), 'forwarded ieeRun.id as backendTaskId').toEqual(['iee-run-browser-1']);
  });

  test('ieeRun.type=dev → derives backendId="iee_dev" (legacy parent has backendId IS NULL)', async () => {
    const { finaliseAgentRunFromIeeRun } = await import('../agentRunFinalizationService.js');
    const ieeRun = {
      id: 'iee-run-dev-1',
      type: 'dev',
      status: 'completed',
      failureReason: null,
      eventEmittedAt: null,
      agentRunId: 'parent-agent-run-2',
    } as unknown as Parameters<typeof finaliseAgentRunFromIeeRun>[0];

    await finaliseAgentRunFromIeeRun(ieeRun);

    expect(resolveCalls.map((c) => c.id), 'alias resolved iee_dev adapter').toEqual(['iee_dev']);
    expect(finaliseInvocations.map((i) => i.backendTaskId), 'forwarded ieeRun.id as backendTaskId').toEqual(['iee-run-dev-1']);
  });

  test('non-terminal iee_run short-circuits without registry resolution', async () => {
    const { finaliseAgentRunFromIeeRun } = await import('../agentRunFinalizationService.js');
    const ieeRun = {
      id: 'iee-run-running-1',
      type: 'browser',
      status: 'running',  // non-terminal
      failureReason: null,
      eventEmittedAt: null,
      agentRunId: 'parent-agent-run-3',
    } as unknown as Parameters<typeof finaliseAgentRunFromIeeRun>[0];

    const result = await finaliseAgentRunFromIeeRun(ieeRun);

    expect(result, 'non-terminal returns false').toBe(false);
    expect(resolveCalls, 'registry not consulted on non-terminal').toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────
