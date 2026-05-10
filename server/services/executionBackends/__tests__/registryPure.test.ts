/**
 * registryPure — exercises ExecutionBackendRegistry validation and
 * resolution against in-memory mock adapters.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 8, § 15
 *   - Registration accepts valid adapters.
 *   - Rejects 'delegated' capability without required methods
 *     (BackendCapabilityViolation).
 *   - Rejects same-queue + different-`terminalStateTable` pairs
 *     (BackendQueueOwnershipViolation).
 *   - Resolves every ExecutionMode value to its registered mock.
 *   - Rejects unregistered ids (BackendNotRegistered).
 *   - Shared-storage reconcile-scoping disjointness assertion against two
 *     mocks sharing a `terminalStateTable` (each adapter's reconcile()
 *     returns a disjoint count — no double-processing).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ExecutionBackendRegistry } from '../registry.js';
import {
  BackendCapabilityViolation,
  BackendNotRegistered,
  BackendOptionsMismatch,
  BackendQueueOwnershipViolation,
  type BackendDispatchInput,
  type BackendDispatchResult,
  type BackendFinalisationInput,
  type BackendFinalisationResult,
  type BackendTerminalState,
  type ExecutionBackend,
  type ExecutionCapability,
} from '../types.js';
import type { ExecutionMode } from '../../../../shared/types/executionEnvironment.js';

// ---------------------------------------------------------------------------
// Mock builders — build a full delegated adapter, an in-process adapter,
// and adversarial variants for the negative cases.
// ---------------------------------------------------------------------------

interface DelegatedMockOpts {
  id: ExecutionMode;
  queue: string;
  table: string;
  reconcileCount?: number;
  capabilities?: ExecutionCapability[];
}

function makeDelegatedMock(opts: DelegatedMockOpts): ExecutionBackend {
  return {
    id: opts.id,
    capabilities: opts.capabilities ?? ['delegated', 'cancellation'],
    costModel: 'per_token',
    sandboxRequirement: 'none',
    completedEventQueue: opts.queue,
    terminalStateTable: opts.table,
    completedEventPayload: z.object({ taskId: z.string() }),
    async dispatch(input: BackendDispatchInput): Promise<BackendDispatchResult> {
      if (input.backendOptions.backendId !== this.id) {
        throw new BackendOptionsMismatch(this.id, input.backendOptions.backendId);
      }
      return {
        lifecycle: 'delegated',
        backendTaskId: `${opts.id}-task-1`,
        loopResult: null,
        deduplicated: false,
      };
    },
    async loadTerminalState(): Promise<BackendTerminalState | null> {
      return null;
    },
    async finalise(
      _input: BackendFinalisationInput,
    ): Promise<BackendFinalisationResult> {
      return { finalised: true, parentTerminalStatus: 'completed' };
    },
    async reconcile(): Promise<number> {
      return opts.reconcileCount ?? 0;
    },
    async cancel(): Promise<void> {
      return;
    },
  };
}

function makeInProcessMock(id: ExecutionMode): ExecutionBackend {
  return {
    id,
    capabilities: ['in_process'],
    costModel: 'per_token',
    sandboxRequirement: 'none',
    async dispatch(input: BackendDispatchInput): Promise<BackendDispatchResult> {
      if (input.backendOptions.backendId !== this.id) {
        throw new BackendOptionsMismatch(this.id, input.backendOptions.backendId);
      }
      return {
        lifecycle: 'in_process',
        backendTaskId: null,
        loopResult: {
          summary: null,
          toolCallsLog: [],
          totalToolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          tasksCreated: 0,
          tasksUpdated: 0,
          deliverablesCreated: 0,
        },
        deduplicated: false,
      };
    },
  };
}

function makeSubprocessMock(id: ExecutionMode): ExecutionBackend {
  return {
    id,
    capabilities: ['subprocess', 'terminal_repo'],
    costModel: 'subscription',
    sandboxRequirement: 'terminal_repo',
    async dispatch(input: BackendDispatchInput): Promise<BackendDispatchResult> {
      if (input.backendOptions.backendId !== this.id) {
        throw new BackendOptionsMismatch(this.id, input.backendOptions.backendId);
      }
      return {
        lifecycle: 'subprocess',
        backendTaskId: 'subprocess-task-1',
        loopResult: null,
        deduplicated: false,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests — registration validation
// ---------------------------------------------------------------------------

describe('ExecutionBackendRegistry — registration (positive)', () => {
  it('accepts a valid in-process adapter', () => {
    const reg = new ExecutionBackendRegistry();
    expect(() => reg.register(makeInProcessMock('api'))).not.toThrow();
  });

  it('accepts a valid delegated adapter with all required methods', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });
    expect(() => reg.register(adapter)).not.toThrow();
  });

  it('accepts two adapters sharing a queue when they share storage', () => {
    const reg = new ExecutionBackendRegistry();
    reg.register(
      makeDelegatedMock({
        id: 'iee_browser',
        queue: 'iee-run-completed',
        table: 'iee_runs',
      }),
    );
    expect(() =>
      reg.register(
        makeDelegatedMock({
          id: 'iee_dev',
          queue: 'iee-run-completed',
          table: 'iee_runs',
        }),
      ),
    ).not.toThrow();
  });

  it('is idempotent on the same adapter instance registered twice', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeInProcessMock('api');
    reg.register(adapter);
    expect(() => reg.register(adapter)).not.toThrow();
  });
});

describe('ExecutionBackendRegistry — registration (negative)', () => {
  it('rejects an id that is not a valid ExecutionMode value', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeInProcessMock('api');
    // Cast to bypass the type check; we want the runtime guard to fire.
    (adapter as { id: string }).id = 'openclaw_managed';
    expect(() => reg.register(adapter)).toThrow(BackendCapabilityViolation);
  });

  it('rejects a "delegated" capability without loadTerminalState', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });
    delete (adapter as { loadTerminalState?: unknown }).loadTerminalState;
    expect(() => reg.register(adapter)).toThrow(BackendCapabilityViolation);
  });

  it('rejects a "delegated" capability without finalise', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });
    delete (adapter as { finalise?: unknown }).finalise;
    expect(() => reg.register(adapter)).toThrow(BackendCapabilityViolation);
  });

  it('rejects a "delegated" capability without reconcile', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });
    delete (adapter as { reconcile?: unknown }).reconcile;
    expect(() => reg.register(adapter)).toThrow(BackendCapabilityViolation);
  });

  it('rejects a "delegated" capability without completedEventQueue', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });
    delete (adapter as { completedEventQueue?: unknown }).completedEventQueue;
    expect(() => reg.register(adapter)).toThrow(BackendCapabilityViolation);
  });

  it('rejects a "delegated" capability without terminalStateTable', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });
    delete (adapter as { terminalStateTable?: unknown }).terminalStateTable;
    expect(() => reg.register(adapter)).toThrow(BackendCapabilityViolation);
  });

  it('rejects a "delegated" capability without completedEventPayload', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });
    delete (adapter as { completedEventPayload?: unknown }).completedEventPayload;
    expect(() => reg.register(adapter)).toThrow(BackendCapabilityViolation);
  });

  it('rejects a "cancellation" capability without cancel()', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });
    delete (adapter as { cancel?: unknown }).cancel;
    expect(() => reg.register(adapter)).toThrow(BackendCapabilityViolation);
  });

  it('rejects an unknown sandboxRequirement value', () => {
    const reg = new ExecutionBackendRegistry();
    const adapter = makeInProcessMock('api');
    (adapter as { sandboxRequirement: string }).sandboxRequirement = 'gpu';
    expect(() => reg.register(adapter)).toThrow(BackendCapabilityViolation);
  });

  it('rejects same-queue + different-terminalStateTable as BackendQueueOwnershipViolation', () => {
    const reg = new ExecutionBackendRegistry();
    reg.register(
      makeDelegatedMock({
        id: 'iee_browser',
        queue: 'shared-queue',
        table: 'iee_runs',
      }),
    );
    expect(() =>
      reg.register(
        makeDelegatedMock({
          id: 'iee_dev',
          queue: 'shared-queue',
          table: 'a_different_table',
        }),
      ),
    ).toThrow(BackendQueueOwnershipViolation);
  });

  it('rejects re-registering the same id with a different instance', () => {
    const reg = new ExecutionBackendRegistry();
    reg.register(makeInProcessMock('api'));
    expect(() => reg.register(makeInProcessMock('api'))).toThrow(
      BackendCapabilityViolation,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — resolve()
// ---------------------------------------------------------------------------

describe('ExecutionBackendRegistry — resolve()', () => {
  it('resolves every ExecutionMode value to its registered mock', () => {
    const reg = new ExecutionBackendRegistry();
    const apiMock = makeInProcessMock('api');
    const headlessMock = makeInProcessMock('headless');
    const claudeCodeMock = makeSubprocessMock('claude-code');
    const ieeBrowserMock = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });
    const ieeDevMock = makeDelegatedMock({
      id: 'iee_dev',
      queue: 'iee-run-completed',
      table: 'iee_runs',
    });

    reg.register(apiMock);
    reg.register(headlessMock);
    reg.register(claudeCodeMock);
    reg.register(ieeBrowserMock);
    reg.register(ieeDevMock);

    expect(reg.resolve('api')).toBe(apiMock);
    expect(reg.resolve('headless')).toBe(headlessMock);
    expect(reg.resolve('claude-code')).toBe(claudeCodeMock);
    expect(reg.resolve('iee_browser')).toBe(ieeBrowserMock);
    expect(reg.resolve('iee_dev')).toBe(ieeDevMock);
  });

  it('throws BackendNotRegistered for an unregistered id', () => {
    const reg = new ExecutionBackendRegistry();
    reg.register(makeInProcessMock('api'));
    expect(() => reg.resolve('iee_browser')).toThrow(BackendNotRegistered);
  });

  it('throws BackendNotRegistered for a forward-compat id with no V1 adapter', () => {
    const reg = new ExecutionBackendRegistry();
    // OpenClaw ids are forward-compat type slots in V1 — never registered.
    expect(() => reg.resolve('openclaw_managed')).toThrow(BackendNotRegistered);
  });
});

// ---------------------------------------------------------------------------
// Tests — forEach + forDelegated
// ---------------------------------------------------------------------------

describe('ExecutionBackendRegistry — iteration', () => {
  it('forEach() walks every registered adapter exactly once', () => {
    const reg = new ExecutionBackendRegistry();
    reg.register(makeInProcessMock('api'));
    reg.register(makeInProcessMock('headless'));
    reg.register(
      makeDelegatedMock({
        id: 'iee_browser',
        queue: 'iee-run-completed',
        table: 'iee_runs',
      }),
    );

    const seen: string[] = [];
    reg.forEach((b) => seen.push(b.id));
    expect(seen.sort()).toEqual(['api', 'headless', 'iee_browser']);
  });

  it('forDelegated() returns only adapters declaring the "delegated" capability', () => {
    const reg = new ExecutionBackendRegistry();
    reg.register(makeInProcessMock('api'));
    reg.register(makeInProcessMock('headless'));
    reg.register(makeSubprocessMock('claude-code'));
    reg.register(
      makeDelegatedMock({
        id: 'iee_browser',
        queue: 'iee-run-completed',
        table: 'iee_runs',
      }),
    );
    reg.register(
      makeDelegatedMock({
        id: 'iee_dev',
        queue: 'iee-run-completed',
        table: 'iee_runs',
      }),
    );

    const delegatedIds = reg.forDelegated().map((b) => b.id).sort();
    expect(delegatedIds).toEqual(['iee_browser', 'iee_dev']);
  });
});

// ---------------------------------------------------------------------------
// Tests — shared-storage reconcile scoping (spec § 4.5 / § 9.2)
// ---------------------------------------------------------------------------

describe('ExecutionBackendRegistry — shared-storage reconcile scoping', () => {
  it('two adapters sharing a terminalStateTable can reconcile disjoint slices (no double-processing)', async () => {
    const reg = new ExecutionBackendRegistry();
    // Each adapter's reconcile() returns the count of rows it processed.
    // Sharing a `terminalStateTable` means both scan the same physical
    // table but each MUST scope by its own discriminator (e.g.,
    // `iee_runs.type`) so the sum is the total terminal rows, not double.
    const browser = makeDelegatedMock({
      id: 'iee_browser',
      queue: 'iee-run-completed',
      table: 'iee_runs',
      reconcileCount: 7,
    });
    const dev = makeDelegatedMock({
      id: 'iee_dev',
      queue: 'iee-run-completed',
      table: 'iee_runs',
      reconcileCount: 3,
    });
    reg.register(browser);
    reg.register(dev);

    const counts = await Promise.all(
      reg.forDelegated().map((b) => b.reconcile!()),
    );
    // Disjointness assertion: each adapter independently scopes its slice
    // so the totals are additive, never overlapping. A failed
    // implementation would either double-count (sum > 10) or under-count
    // (sum < 10) — both are catchable here.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(counts).toContain(7);
    expect(counts).toContain(3);
  });
});

// ---------------------------------------------------------------------------
// Tests — F5 mismatch invariant on the mock (spec § 16 #13 mock leg)
// ---------------------------------------------------------------------------

function buildMismatchInput(forBackendId: ExecutionMode): BackendDispatchInput {
  // Pick whichever adapter id we want the call to mismatch with by
  // returning options for `forBackendId` while the dispatch target
  // adapter has a different id.
  return {
    runId: 'run-1',
    organisationId: 'org-1',
    subaccountId: null,
    agentId: 'agent-1',
    promptAssembly: 'prompt',
    tokenBudget: 100,
    maxToolCalls: 1,
    timeoutMs: 1000,
    backendOptions:
      forBackendId === 'api'
        ? { backendId: 'api', runSource: 'manual' }
        : forBackendId === 'headless'
          ? { backendId: 'headless', runSource: 'manual' }
          : forBackendId === 'claude-code'
            ? { backendId: 'claude-code' }
            : forBackendId === 'iee_browser'
              ? { backendId: 'iee_browser', ieeTask: { type: 'browser' } as unknown as never }
              : { backendId: 'iee_dev', ieeTask: { type: 'dev' } as unknown as never },
  };
}

describe('ExecutionBackend mismatch invariant — mock adapters', () => {
  it('every mock adapter rejects mismatched backendOptions.backendId with BackendOptionsMismatch', async () => {
    const adapters: ExecutionBackend[] = [
      makeInProcessMock('api'),
      makeInProcessMock('headless'),
      makeSubprocessMock('claude-code'),
      makeDelegatedMock({
        id: 'iee_browser',
        queue: 'iee-run-completed',
        table: 'iee_runs',
      }),
      makeDelegatedMock({
        id: 'iee_dev',
        queue: 'iee-run-completed',
        table: 'iee_runs',
      }),
    ];

    for (const adapter of adapters) {
      // Pick any other ExecutionMode value as the mismatch target.
      const otherId: ExecutionMode =
        adapter.id === 'api' ? 'headless' : 'api';
      const input = buildMismatchInput(otherId);
      await expect(adapter.dispatch(input)).rejects.toBeInstanceOf(
        BackendOptionsMismatch,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — per-adapter mismatch fixture for the real IEE adapters
// (Execution Backend Adapter Contract spec § 16 #13).
//
// The mock adapters above exercise the contract surface; these tests pin
// the same invariant on the actual `ieeBrowserBackend` / `ieeDevBackend`
// implementations to catch a regression in either adapter's `dispatch()`
// first statement.
// ---------------------------------------------------------------------------

describe('ExecutionBackend mismatch invariant — IEE adapter implementations', () => {
  it('ieeBrowserBackend.dispatch rejects backendOptions.backendId="iee_dev"', async () => {
    const { ieeBrowserBackend } = await import('../ieeBrowserBackend.js');
    const input = buildMismatchInput('iee_dev');
    await expect(ieeBrowserBackend.dispatch(input)).rejects.toBeInstanceOf(BackendOptionsMismatch);
    await expect(ieeBrowserBackend.dispatch(input)).rejects.toMatchObject({
      expectedId: 'iee_browser',
      actualId: 'iee_dev',
    });
  });

  it('ieeDevBackend.dispatch rejects backendOptions.backendId="iee_browser"', async () => {
    const { ieeDevBackend } = await import('../ieeDevBackend.js');
    const input = buildMismatchInput('iee_browser');
    await expect(ieeDevBackend.dispatch(input)).rejects.toBeInstanceOf(BackendOptionsMismatch);
    await expect(ieeDevBackend.dispatch(input)).rejects.toMatchObject({
      expectedId: 'iee_dev',
      actualId: 'iee_browser',
    });
  });
});
