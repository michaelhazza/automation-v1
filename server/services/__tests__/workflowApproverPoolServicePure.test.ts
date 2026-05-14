// Must be set before any module imports so env-based config is picked up.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { expect, test, vi } from 'vitest';
import {
  userInPool,
} from '../workflowApproverPoolServicePure.js';

// ─── task_requester resolver (mocked DB) ─────────────────────────────────────
//
// The task_requester group resolves to tasks.created_by_user_id via a join
// through workflow_runs.task_id. This test verifies that for system-initiated
// runs (started_by_user_id = system principal, not the human requester),
// the resolver returns the task creator, not the run's starter.

// Mock the Drizzle query builder chain used by the task_requester case.
// The chain is: db.select().from(tasks).innerJoin(...).where(...) → row[]
let mockSelectResult: { createdByUserId: string | null }[] = [];

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(async () => mockSelectResult),
        })),
      })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  },
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── userInPool ───────────────────────────────────────────────────────────────

test('userInPool: returns true when userId is in snapshot', () => {
  const snapshot = ['user-1', 'user-2', 'user-3'];
  expect(userInPool(snapshot, 'user-2')).toBe(true);
});

test('userInPool: returns false when userId is not in snapshot', () => {
  const snapshot = ['user-1', 'user-2'];
  expect(userInPool(snapshot, 'user-99')).toBe(false);
});

test('userInPool: returns false when snapshot is null', () => {
  expect(userInPool(null, 'user-1')).toBe(false);
});

test('userInPool: returns false when snapshot is empty array', () => {
  expect(userInPool([], 'user-1')).toBe(false);
});

test('userInPool: returns false when userId is empty string and not in snapshot', () => {
  const snapshot = ['user-1', 'user-2'];
  expect(userInPool(snapshot, '')).toBe(false);
});

test('userInPool: returns false when userId is empty string and snapshot is empty', () => {
  expect(userInPool([], '')).toBe(false);
});

// ─── task_requester resolution — system-initiated run ─────────────────────────

const RUN_CONTEXT = {
  runId: '00000000-0000-0000-0000-000000000001',
  organisationId: '00000000-0000-0000-0000-000000000002',
  subaccountId: null,
};

test('task_requester: returns task creator (created_by_user_id), not the system run starter', async () => {
  // task.created_by_user_id = 'user-A'; run.started_by_user_id = 'system-principal-id'
  mockSelectResult = [{ createdByUserId: 'user-A' }];

  const { WorkflowApproverPoolService } = await import('../workflowApproverPoolService.js');
  const pool = await WorkflowApproverPoolService.resolvePool(
    { kind: 'task_requester' },
    RUN_CONTEXT,
  );

  expect(pool).toEqual(['user-A']);
});

test('task_requester: returns empty array when no task row found (run not linked to a task)', async () => {
  mockSelectResult = [];

  const { WorkflowApproverPoolService } = await import('../workflowApproverPoolService.js');
  const pool = await WorkflowApproverPoolService.resolvePool(
    { kind: 'task_requester' },
    RUN_CONTEXT,
  );

  expect(pool).toEqual([]);
});

test('task_requester: returns empty array when task has no created_by_user_id (agent-created task)', async () => {
  mockSelectResult = [{ createdByUserId: null }];

  const { WorkflowApproverPoolService } = await import('../workflowApproverPoolService.js');
  const pool = await WorkflowApproverPoolService.resolvePool(
    { kind: 'task_requester' },
    RUN_CONTEXT,
  );

  expect(pool).toEqual([]);
});

