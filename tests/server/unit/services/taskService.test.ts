import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Build a flexible DB mock that supports arbitrary Drizzle-style chaining.
// Each method returns `this` so any chain works: select().from().where().orderBy().limit()
// The terminal call can be configured per-test via mockDbResult.
// ---------------------------------------------------------------------------
const { mockDbResults, mockInsertResults, mockUpdateResults } = vi.hoisted(() => {
  const mockDbResults: unknown[][] = [];
  const mockInsertResults: unknown[][] = [];
  const mockUpdateResults: unknown[][] = [];
  return { mockDbResults, mockInsertResults, mockUpdateResults };
});

vi.mock('../../../../server/db/index.js', () => {
  // Helper: build a chainable object that resolves (as thenable) to the next queued result
  function chainable(resultQueue: unknown[][]) {
    const obj: Record<string, unknown> = {};
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === 'then') {
          // Make it thenable — drizzle awaits the chain
          const result = resultQueue.shift() ?? [];
          return (resolve: (v: unknown) => void) => resolve(result);
        }
        // Every other property returns a function that returns the proxy again
        return (..._args: unknown[]) => new Proxy({}, handler);
      },
    };
    return new Proxy(obj, handler);
  }

  return {
    db: {
      select: () => chainable(mockDbResults),
      insert: () => chainable(mockInsertResults),
      update: () => chainable(mockUpdateResults),
    },
  };
});

vi.mock('../../../../server/websocket/emitters.js', () => ({
  emitSubaccountUpdate: vi.fn(),
}));

vi.mock('../../../../server/services/triggerService.js', () => ({
  triggerService: { checkAndFire: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../server/services/subtaskWakeupService.js', () => ({
  subtaskWakeupService: { notifySubtaskCompleted: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../server/lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { taskService } from '../../../../server/services/taskService.js';

// Helper to queue results
function queueSelect(...results: unknown[][]) {
  results.forEach(r => mockDbResults.push(r));
}
function queueInsert(...results: unknown[][]) {
  results.forEach(r => mockInsertResults.push(r));
}
function queueUpdate(...results: unknown[][]) {
  results.forEach(r => mockUpdateResults.push(r));
}

describe('taskService', () => {
  beforeEach(() => {
    mockDbResults.length = 0;
    mockInsertResults.length = 0;
    mockUpdateResults.length = 0;
  });

  // ── listTasks ──────────────────────────────────────────────────────────────

  describe('listTasks', () => {
    it('returns tasks filtered by org and subaccount', async () => {
      // Main query: select tasks
      queueSelect(
        [{ item: { id: 't-1', title: 'Task 1', assignedAgentIds: null, assignedAgentId: null } }],
        // resolveAgents (no agent IDs to resolve)
        [],
      );

      const result = await taskService.listTasks('org-1', 'sa-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t-1');
    });

    it('returns empty array when no tasks match', async () => {
      queueSelect([]);
      const result = await taskService.listTasks('org-1', 'sa-1');
      expect(result).toEqual([]);
    });

    it('applies optional filters without error', async () => {
      queueSelect([]);
      const result = await taskService.listTasks('org-1', 'sa-1', {
        status: 'inbox', priority: 'high', assignedAgentId: 'a-1', search: 'test',
      });
      expect(result).toEqual([]);
    });
  });

  // ── getTask ────────────────────────────────────────────────────────────────

  describe('getTask', () => {
    it('returns task with activities, deliverables, and agents', async () => {
      queueSelect(
        // 1. Task lookup
        [{ id: 't-1', title: 'Found Task', assignedAgentIds: ['a-1'], assignedAgentId: 'a-1' }],
        // 2. Activities (Promise.all first)
        [{ id: 'act-1', activityType: 'created' }],
        // 3. Deliverables (Promise.all second)
        [],
        // 4. resolveAgents
        [{ id: 'a-1', name: 'Agent One', slug: 'agent-one' }],
      );

      const result = await taskService.getTask('t-1', 'org-1');
      expect(result.id).toBe('t-1');
      expect(result.activities).toHaveLength(1);
      expect(result.deliverables).toHaveLength(0);
      expect(result.assignedAgents).toHaveLength(1);
    });

    it('throws 404 when task not found', async () => {
      queueSelect([]);
      await expect(taskService.getTask('missing', 'org-1')).rejects.toMatchObject({
        statusCode: 404,
        message: 'Task not found',
      });
    });
  });

  // ── createTask ─────────────────────────────────────────────────────────────

  describe('createTask', () => {
    it('creates a task with correct org/subaccount scoping', async () => {
      const createdTask = { id: 't-new', title: 'New Task', priority: 'normal', status: 'inbox' };
      // _validateStatus: boardConfigs select (no config = all statuses valid)
      queueSelect([], []);
      // insert task, insert activity
      queueInsert([createdTask], [{ id: 'act-1' }]);

      const result = await taskService.createTask('org-1', 'sa-1', { title: 'New Task' });
      expect(result.id).toBe('t-new');
    });

    it('defaults status to inbox and priority to normal', async () => {
      const createdTask = { id: 't-2', title: 'Task', status: 'inbox', priority: 'normal' };
      queueSelect([], []);
      queueInsert([createdTask], [{}]);

      const result = await taskService.createTask('org-1', 'sa-1', { title: 'Task' });
      expect(result.status).toBe('inbox');
      expect(result.priority).toBe('normal');
    });

    it('throws 400 when status is invalid per board config', async () => {
      // _validateStatus finds config with columns that don't include the requested status
      queueSelect([{
        columns: [{ key: 'inbox' }, { key: 'done' }],
      }]);

      await expect(
        taskService.createTask('org-1', 'sa-1', { title: 'Task', status: 'nonexistent' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // ── updateTask ─────────────────────────────────────────────────────────────

  describe('updateTask', () => {
    it('updates fields and returns updated record', async () => {
      const existing = { id: 't-1', status: 'inbox', subaccountId: 'sa-1', assignedAgentIds: null, assignedAgentId: null };
      const updated = { ...existing, title: 'Updated' };
      queueSelect([existing]);
      queueUpdate([updated]);

      const result = await taskService.updateTask('t-1', 'org-1', { title: 'Updated' });
      expect(result.title).toBe('Updated');
    });

    it('throws 404 when task not found', async () => {
      queueSelect([]);
      await expect(
        taskService.updateTask('missing', 'org-1', { title: 'X' })
      ).rejects.toMatchObject({ statusCode: 404, message: 'Task not found' });
    });

    it('logs status change activity when status changes', async () => {
      const existing = { id: 't-1', status: 'inbox', subaccountId: 'sa-1', assignedAgentIds: null, assignedAgentId: null };
      const updated = { ...existing, status: 'in_progress' };
      // _validateStatus: no config
      queueSelect([existing], []);
      queueUpdate([updated]);
      // insert activity for status change
      queueInsert([{}]);

      const result = await taskService.updateTask('t-1', 'org-1', { status: 'in_progress' });
      expect(result.status).toBe('in_progress');
    });
  });

  // ── moveTask ───────────────────────────────────────────────────────────────

  describe('moveTask', () => {
    it('moves task to new status and position', async () => {
      const existing = { id: 't-1', status: 'inbox', subaccountId: 'sa-1', organisationId: 'org-1' };
      const updated = { id: 't-1', status: 'in_progress', position: 500 };
      // Select existing, _validateStatus (no config)
      queueSelect([existing], []);
      // update task
      queueUpdate([updated]);
      // insert activity (status changed)
      queueInsert([{}]);

      const result = await taskService.moveTask('t-1', 'org-1', { status: 'in_progress', position: 500 });
      expect(result.status).toBe('in_progress');
    });

    it('throws 404 when task not found', async () => {
      queueSelect([]);
      await expect(
        taskService.moveTask('missing', 'org-1', { status: 'done', position: 0 })
      ).rejects.toMatchObject({ statusCode: 404, message: 'Task not found' });
    });
  });

  // ── deleteTask ─────────────────────────────────────────────────────────────

  describe('deleteTask', () => {
    it('soft-deletes task by setting deletedAt', async () => {
      queueSelect([{ id: 't-1' }]);
      queueUpdate([undefined]);

      await expect(taskService.deleteTask('t-1', 'org-1')).resolves.toBeUndefined();
    });

    it('throws 404 when task not found', async () => {
      queueSelect([]);
      await expect(taskService.deleteTask('missing', 'org-1')).rejects.toMatchObject({
        statusCode: 404, message: 'Task not found',
      });
    });
  });

  // ── addActivity ────────────────────────────────────────────────────────────

  describe('addActivity', () => {
    it('creates an activity record and returns it', async () => {
      const activity = { id: 'act-1', taskId: 't-1', activityType: 'note', message: 'Test note' };
      queueInsert([activity]);

      const result = await taskService.addActivity('t-1', {
        activityType: 'note',
        message: 'Test note',
      });
      expect(result.id).toBe('act-1');
      expect(result.activityType).toBe('note');
    });
  });
});
