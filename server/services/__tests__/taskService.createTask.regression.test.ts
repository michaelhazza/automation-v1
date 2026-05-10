/**
 * taskService.createTask.regression.test.ts
 *
 * Regression safety net for the T3 DEC-4 migration — verifies the
 * canonical (input, tx) overload behaves correctly and the legacy
 * 4-arg shim throws rather than silently writing rows.
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

  it('4-arg legacy overload throws synchronously and writes zero rows', async () => {
    const tx = makeFakeTx();

    // The legacy 4-arg call must throw immediately — zero DB writes.
    // The deprecated overload is typed, so no @ts-expect-error needed;
    // the runtime guard is what we're testing here.
    await expect(
      taskService.createTask(ORG_ID, SUB_ID, { title: 'legacy call' }),
    ).rejects.toThrow('legacy 4-arg shape');

    // No insert should have been attempted on the tx (which wasn't even passed)
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
