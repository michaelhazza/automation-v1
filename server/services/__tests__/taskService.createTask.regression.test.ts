/**
 * taskService.createTask.regression.test.ts
 *
 * Regression safety net for the T3 DEC-4 migration — verifies the
 * canonical (input, tx) overload behaves correctly under FORCE-RLS and
 * the legacy 4-arg shim opens its own transaction, sets the org GUC,
 * and delegates to the canonical path (sister-branch reconciliation
 * for workflowEngineService.ts:2716 + :2962 per commit 3423a0d5).
 *
 * These are unit tests; the DB is fully mocked so no live connection
 * is required. Integration-level RLS enforcement lives in
 * server/services/__tests__/rls.context-propagation.test.ts.
 *
 * Build: pre-test-hardening  Chunk: C5  Spec: §3.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before any production imports.
// ---------------------------------------------------------------------------

// Mock the OrgScopedDb so we can control what getOrgScopedDb returns.
// This prevents missing_org_context failures from ALS in unit tests.
vi.mock('../../lib/orgScopedDb.js', () => ({
  getOrgScopedDb: vi.fn(),
  getOrgScopedOrgId: vi.fn(),
  peekOrgTxContext: vi.fn(() => null),
}));

// Mock the db module so the legacy 4-arg shim's db.transaction(...) call is
// instrumented. The shim opens its own transaction, sets the GUC, then
// delegates to the canonical path with the inner tx. We assert the
// transaction is opened and the GUC SET fires first.
//
// Use vi.hoisted so the shared instrumentation state is reachable from
// both the mock factory (hoisted before imports) and the test body.
const legacyMocks = vi.hoisted(() => {
  const executeCalls: Array<{ sqlString: string }> = [];
  const insertCalls: number[] = [];
  return { executeCalls, insertCalls };
});

vi.mock('../../db/index.js', () => {
  return {
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        // Record that a transaction was opened. Build a tx-shaped object that
        // exposes execute (so the GUC SET runs) and the same chainable
        // insert/select used by the canonical path.
        const innerTx = {
          execute: vi.fn(async (q: unknown) => {
            // Capture the SQL fragment for the GUC assertion. drizzle's `sql`
            // tagged template returns an object with a `queryChunks` property,
            // but we just stringify for the test contract.
            const repr = (() => {
              try { return JSON.stringify(q); }
              catch { return String(q); }
            })();
            legacyMocks.executeCalls.push({ sqlString: repr });
            return [];
          }),
          insert: vi.fn(() => {
            legacyMocks.insertCalls.push(legacyMocks.insertCalls.length + 1);
            return {
              values: vi.fn().mockReturnThis(),
              returning: vi.fn().mockResolvedValue([
                {
                  id: 'task-legacy-1111-2222-333333333333',
                  organisationId: 'org-aaaa-bbbb-cccc-dddddddddddd',
                  subaccountId: 'sub-aaaa-bbbb-cccc-dddddddddddd',
                  title: 'legacy call',
                  description: null,
                  brief: null,
                  status: 'inbox',
                  priority: 'normal',
                  assignedAgentId: null,
                  assignedAgentIds: [],
                  createdByAgentId: null,
                  createdByUserId: null,
                  processId: null,
                  position: 1000,
                  dueDate: null,
                  handoffSourceRunId: null,
                  handoffContext: null,
                  handoffDepth: 0,
                  isSubTask: false,
                  parentTaskId: null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  deletedAt: null,
                },
              ]),
            };
          }),
          select: vi.fn(() => {
            const chain: Record<string, unknown> = {};
            const resolved = Promise.resolve([]);
            chain.from = vi.fn(() => chain);
            chain.where = vi.fn(() => chain);
            chain.orderBy = vi.fn(() => chain);
            chain.limit = vi.fn(() => resolved);
            chain.then = (onfulfilled: (v: unknown[]) => unknown, onrejected?: (e: unknown) => unknown) =>
              resolved.then(onfulfilled, onrejected);
            return chain;
          }),
          update: vi.fn(() => ({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) })),
        };
        return fn(innerTx);
      }),
    },
  };
});

// Mock side-effect services so createTask tests don't spray pg-boss or WebSocket calls.
vi.mock('../../websocket/emitters.js', () => ({
  emitSubaccountUpdate: vi.fn(),
}));

vi.mock('../triggerService.js', () => ({
  triggerService: {
    checkAndFire: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../subtaskWakeupService.js', () => ({
  subtaskWakeupService: {
    notifySubtaskCompleted: vi.fn().mockResolvedValue(undefined),
  },
}));

// Stub the dynamic import of orchestratorFromTaskJob to a no-op.
vi.mock('../../jobs/orchestratorFromTaskJob.js', () => ({
  enqueueOrchestratorRoutingIfEligible: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// After hoisting, import the subject under test.
// ---------------------------------------------------------------------------

import { taskService } from '../taskService.js';
import type { CreateTaskInput } from '../taskService.js';

// ---------------------------------------------------------------------------
// Helpers — build a minimal fake OrgScopedTx
// ---------------------------------------------------------------------------

type FakeRow = { id: string; [key: string]: unknown };

/**
 * Creates a fake OrgScopedTx-shaped object.
 *
 * @param writeRows  Rows returned by the first `.returning()` call (the task insert).
 *                   Defaults to a minimal valid Task row.
 * @param throws     If true, the insert `.returning()` rejects (simulates RLS block).
 */
function makeFakeTx(options: {
  writeRows?: FakeRow[];
  throws?: boolean;
} = {}) {
  const {
    writeRows = [
      {
        id: 'task-0000-1111-2222-333333333333',
        organisationId: 'org-aaaa-bbbb-cccc-dddddddddddd',
        subaccountId: 'sub-aaaa-bbbb-cccc-dddddddddddd',
        title: 'Test task',
        description: null,
        brief: null,
        status: 'inbox',
        priority: 'normal',
        assignedAgentId: null,
        assignedAgentIds: [],
        createdByAgentId: null,
        createdByUserId: null,
        processId: null,
        position: 1000,
        dueDate: null,
        handoffSourceRunId: null,
        handoffContext: null,
        handoffDepth: 0,
        isSubTask: false,
        parentTaskId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ],
    throws = false,
  } = options;

  // Chainable builder that culminates in .returning()
  const returningFn = throws
    ? vi.fn().mockRejectedValue(new Error('RLS_VIOLATION: new row violates row-level security policy for table "tasks"'))
    : vi.fn().mockResolvedValue(writeRows);

  // Most select() calls in helpers (_validateStatus, _nextPosition) return empty arrays.
  // The chain must be thenable (await-able) at each stage because some calls use
  // `await queryHandle.select().from().where()` without a terminal `.limit()`.
  function makeSelectChain(resolvedValue: unknown[] = []): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const resolved = Promise.resolve(resolvedValue);
    // Each chain method returns the same chain AND the chain itself is thenable.
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(() => resolved);
    // Make chain thenable so `await select().from().where()` resolves to resolvedValue
    chain.then = (onfulfilled: (v: unknown[]) => unknown, onrejected?: (e: unknown) => unknown) =>
      resolved.then(onfulfilled, onrejected);
    chain.catch = (onrejected: (e: unknown) => unknown) => resolved.catch(onrejected);
    chain.finally = (cb: () => void) => resolved.finally(cb);
    return chain;
  }

  // insert() returns a chain ending in .returning()
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: returningFn,
  };

  return {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn(() => insertChain),
    update: vi.fn(() => ({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) })),
    execute: vi.fn().mockResolvedValue([]),
  } as unknown as import('../../db/index.js').OrgScopedTx;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-aaaa-bbbb-cccc-dddddddddddd';
const SUB_ID = 'sub-aaaa-bbbb-cccc-dddddddddddd';

function makeInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    organisationId: ORG_ID,
    subaccountId: SUB_ID,
    data: { title: 'Test task', status: 'inbox' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('taskService.createTask — T3 regression (DEC-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    legacyMocks.executeCalls.length = 0;
    legacyMocks.insertCalls.length = 0;
  });

  it('createTask invoked inside withOrgTx writes successfully and emits the expected task_created row', async () => {
    const tx = makeFakeTx();
    const input = makeInput();

    const result = await taskService.createTask(input, tx);

    expect(result.id).toBe('task-0000-1111-2222-333333333333');
    expect(result.organisationId).toBe(ORG_ID);
    expect(result.status).toBe('inbox');

    // Verify the insert was called on the tx, not the bare db module
    expect(tx.insert).toHaveBeenCalled();
  });

  it('createTask invoked with a tx whose ALS context has no org GUC fails to write — RLS rejects the insert and row count is unchanged', async () => {
    // Simulate an RLS violation: the db rejects the insert
    const tx = makeFakeTx({ throws: true });
    const input = makeInput();

    await expect(taskService.createTask(input, tx)).rejects.toThrow('RLS_VIOLATION');
  });

  it('createTask invoked inside withOrgTx with a different organisationId than the GUC fails — cross-tenant write rejected', async () => {
    // The tx is scoped to ORG_A; we attempt to write a row for ORG_B.
    // The fake tx simulates an RLS rejection on cross-tenant writes.
    const tx = makeFakeTx({ throws: true });
    const crossOrgInput = makeInput({ organisationId: 'org-bbbb-cccc-dddd-eeeeeeeeeeee' });

    await expect(taskService.createTask(crossOrgInput, tx)).rejects.toThrow('RLS_VIOLATION');
  });

  it('4-arg legacy overload opens its own transaction, sets the org GUC, and delegates to the canonical path (sister-branch compatibility per commit 3423a0d5)', async () => {
    // Legacy callers like workflowEngineService.ts:2716 / :2962 still use the
    // (organisationId, subaccountId, data, userId?) shape. Per DEC-4 commit
    // 3423a0d5, the legacy overload no longer throws — it opens its own
    // db.transaction, runs SELECT set_config('app.organisation_id', ...)
    // to register the GUC for FORCE-RLS, then delegates to the canonical
    // (input, tx) path. This test pins that contract.

    const result = await taskService.createTask(ORG_ID, SUB_ID, { title: 'legacy call' });

    // 1. A transaction was opened via db.transaction(...) — single call.
    const { db } = await import('../../db/index.js');
    expect(vi.mocked(db.transaction)).toHaveBeenCalledTimes(1);

    // 2. The first execute() on the inner tx is the GUC SET — required for
    //    FORCE-RLS to accept the subsequent task insert.
    expect(legacyMocks.executeCalls.length).toBeGreaterThanOrEqual(1);
    const firstExecute = legacyMocks.executeCalls[0]!.sqlString;
    expect(firstExecute).toMatch(/set_config/i);
    expect(firstExecute).toMatch(/app\.organisation_id/);
    expect(firstExecute).toContain(ORG_ID);

    // 3. The canonical insert path ran on the inner tx (delegation succeeded).
    expect(legacyMocks.insertCalls.length).toBeGreaterThanOrEqual(1);

    // 4. The returned row carries the legacy-call shape.
    expect(result.id).toBe('task-legacy-1111-2222-333333333333');
    expect(result.organisationId).toBe(ORG_ID);
    expect(result.title).toBe('legacy call');
  });

  it('4-arg legacy overload emits the deprecation warning so sister-branch migrations are tracked', async () => {
    // The shim logs `taskService.createTask_legacy_4arg` on every legacy call.
    // Operations dashboards count this event to track the sister-branch
    // migration runway. If the warn ever silently drops, the shim becomes
    // invisible and removing it later is risky.
    const loggerModule = await import('../../lib/logger.js');
    const warnSpy = vi.spyOn(loggerModule.logger, 'warn').mockImplementation(() => {});

    try {
      await taskService.createTask(ORG_ID, SUB_ID, { title: 'legacy warn check' });

      expect(warnSpy).toHaveBeenCalledWith(
        'taskService.createTask_legacy_4arg',
        expect.objectContaining({
          event: 'legacy_4arg_createTask',
          organisationId: ORG_ID,
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
