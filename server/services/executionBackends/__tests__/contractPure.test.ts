/**
 * contractPure — exercises the ExecutionBackend contract surface against an
 * in-memory mock adapter.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 15
 *   - Capability-validation positive + negative cases.
 *   - Mismatch invariant on the mock: dispatch() throws
 *     BackendOptionsMismatch when input.backendOptions.backendId !== this.id.
 *   - Module-source assertion that types.ts does NOT import from
 *     agentExecutionService.ts (acceptance criterion § 16 #12).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BackendOptionsMismatch,
  type BackendDispatchInput,
  type BackendDispatchResult,
  type BackendFinalisationInput,
  type BackendFinalisationResult,
  type BackendTerminalState,
  type ExecutionBackend,
} from '../types.js';
import type { Transaction } from '../../../db/index.js';

// ---------------------------------------------------------------------------
// In-memory mock adapter — implements every shape exhaustively so the test
// can exercise capability gating, dispatch invariants, and the delegated
// lifecycle hook surface.
// ---------------------------------------------------------------------------

function makeMockAdapter(): ExecutionBackend {
  return {
    id: 'iee_browser',
    capabilities: ['delegated', 'browser_automation', 'cancellation'],
    costModel: 'per_token',
    sandboxRequirement: 'browser',
    completedEventQueue: 'mock-run-completed',
    terminalStateTable: 'mock_runs',
    completedEventPayload: z.object({ runId: z.string() }),
    async dispatch(input: BackendDispatchInput): Promise<BackendDispatchResult> {
      if (input.backendOptions.backendId !== this.id) {
        throw new BackendOptionsMismatch(this.id, input.backendOptions.backendId);
      }
      return {
        lifecycle: 'delegated',
        backendTaskId: 'mock-task-1',
        loopResult: null,
        deduplicated: false,
      };
    },
    async loadTerminalState(
      _tx: Transaction,
      backendTaskId: string,
    ): Promise<BackendTerminalState | null> {
      return {
        agentRunId: 'mock-run-1',
        backendTaskId,
        status: 'completed',
        failureReason: null,
        completedAt: new Date(0),
        eventEmittedAt: null,
        resultSummary: null,
        raw: { mock: true },
      };
    },
    async finalise(
      _input: BackendFinalisationInput,
    ): Promise<BackendFinalisationResult> {
      return { finalised: true, parentTerminalStatus: 'completed' };
    },
    async reconcile(): Promise<number> {
      return 0;
    },
    async cancel(_input): Promise<void> {
      return;
    },
  };
}

// Minimal dispatch input fixture; only the fields dispatch() reads on
// the happy path are populated. The mismatch test rebuilds the
// `backendOptions` slot to induce the failure.
function buildDispatchInput(
  backendId: 'iee_browser' | 'iee_dev' = 'iee_browser',
): BackendDispatchInput {
  return {
    runId: 'run-1',
    organisationId: 'org-1',
    subaccountId: null,
    agentId: 'agent-1',
    promptAssembly: 'system prompt',
    tokenBudget: 1000,
    maxToolCalls: 10,
    timeoutMs: 60_000,
    backendOptions:
      backendId === 'iee_browser'
        ? {
            backendId: 'iee_browser',
            // Smallest possible BrowserTaskPayload-shaped value the mock
            // never actually reads — typed via an `as unknown as` cast so
            // the test does not need to construct a fully validated
            // BrowserTaskPayload.
            ieeTask: { type: 'browser' } as unknown as never,
          }
        : {
            backendId: 'iee_dev',
            ieeTask: { type: 'dev' } as unknown as never,
          },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionBackend contract — mock adapter', () => {
  it('exposes the full contract surface (identity + capability metadata)', () => {
    const adapter = makeMockAdapter();
    expect(adapter.id).toBe('iee_browser');
    expect(adapter.capabilities).toContain('delegated');
    expect(adapter.capabilities).toContain('cancellation');
    expect(adapter.costModel).toBe('per_token');
    expect(adapter.sandboxRequirement).toBe('browser');
    expect(adapter.completedEventQueue).toBe('mock-run-completed');
    expect(adapter.terminalStateTable).toBe('mock_runs');
    expect(adapter.completedEventPayload).toBeDefined();
    expect(typeof adapter.loadTerminalState).toBe('function');
    expect(typeof adapter.finalise).toBe('function');
    expect(typeof adapter.reconcile).toBe('function');
    expect(typeof adapter.cancel).toBe('function');
  });

  it('dispatch() returns the declared BackendDispatchResult shape on the happy path', async () => {
    const adapter = makeMockAdapter();
    const result = await adapter.dispatch(buildDispatchInput('iee_browser'));
    expect(result.lifecycle).toBe('delegated');
    expect(result.backendTaskId).toBe('mock-task-1');
    expect(result.loopResult).toBeNull();
    expect(result.deduplicated).toBe(false);
  });

  it('dispatch() throws BackendOptionsMismatch when backendOptions.backendId !== adapter.id (negative)', async () => {
    const adapter = makeMockAdapter();
    // Adapter id is 'iee_browser'; build options for 'iee_dev' to trigger the mismatch.
    const mismatchedInput = buildDispatchInput('iee_dev');
    await expect(adapter.dispatch(mismatchedInput)).rejects.toBeInstanceOf(
      BackendOptionsMismatch,
    );
    await expect(adapter.dispatch(mismatchedInput)).rejects.toMatchObject({
      expectedId: 'iee_browser',
      actualId: 'iee_dev',
    });
  });

  it('dispatch() does not throw when backendOptions.backendId === adapter.id (positive)', async () => {
    const adapter = makeMockAdapter();
    await expect(adapter.dispatch(buildDispatchInput('iee_browser'))).resolves.toBeDefined();
  });

  it('loadTerminalState() returns a BackendTerminalState shape with mandatory fields populated', async () => {
    const adapter = makeMockAdapter();
    const state = await adapter.loadTerminalState!(
      // tx is never read by the mock; cast to any to avoid constructing a
      // real Drizzle handle in a pure test.
      undefined as unknown as Transaction,
      'mock-task-1',
    );
    expect(state).not.toBeNull();
    expect(state!.agentRunId).toBe('mock-run-1');
    expect(state!.backendTaskId).toBe('mock-task-1');
    expect(typeof state!.status).toBe('string');
  });

  it('finalise() returns the declared BackendFinalisationResult shape', async () => {
    const adapter = makeMockAdapter();
    const result = await adapter.finalise!({
      tx: undefined as unknown as Transaction,
      terminalState: {
        agentRunId: 'mock-run-1',
        backendTaskId: 'mock-task-1',
        status: 'completed',
        failureReason: null,
        completedAt: new Date(0),
        eventEmittedAt: null,
        resultSummary: null,
        raw: {},
      },
      parentRun: { id: 'mock-run-1', status: 'delegated' },
    });
    expect(result.finalised).toBe(true);
    expect(result.parentTerminalStatus).toBe('completed');
  });
});

describe('ExecutionBackend contract — module-source guard (acceptance § 16 #12)', () => {
  it('types.ts does NOT import from agentExecutionService.ts (cycle prevention)', () => {
    // Resolve types.ts path relative to this test file. import.meta.url is
    // `.../__tests__/contractPure.test.ts`; the parent directory holds
    // types.ts.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const typesPath = path.resolve(here, '..', 'types.ts');
    const typesSource = readFileSync(typesPath, 'utf8');

    // Strip JSDoc comments so a literal mention of the filename inside a
    // comment ("MUST NOT import from ...") does not falsely trip the
    // assertion. Match `from <quote>...agentExecutionService<quote>` —
    // the module-specifier shape — outside comments.
    //
    // Comment-strip is line-by-line: drop content from `//` and from `/*`
    // through the matching `*/`.
    const sourceWithoutComments = typesSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const offendingImport =
      /from\s+['"][^'"]*agentExecutionService[^'"]*['"]/.exec(sourceWithoutComments);

    expect(
      offendingImport,
      `executionBackends/types.ts MUST NOT import from agentExecutionService.ts ` +
        `(spec § 16 #12 — cycle prevention). Found: ${offendingImport?.[0] ?? '<none>'}`,
    ).toBeNull();
  });
});
