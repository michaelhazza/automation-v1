import { eq, and, isNull, desc, asc, ilike, inArray, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import type { OrgScopedTx } from '../db/index.js';
import {
  tasks,
  taskActivities,
  taskDeliverables,
  boardConfigs,
  agents,
} from '../db/schema/index.js';
import { assertActive } from '../lib/queryHelpers.js';
import type { Task } from '../db/schema/tasks.js';

type TaskStatus = Task['status'];
import { emitSubaccountUpdate } from '../websocket/emitters.js';
import { triggerService } from './triggerService.js';
import { subtaskWakeupService } from './subtaskWakeupService.js';
import { logger } from '../lib/logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CreateTaskData = {
  title: string;
  description?: string;
  brief?: string;
  status?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  assignedAgentId?: string;
  assignedAgentIds?: string[];
  createdByAgentId?: string;
  processId?: string;
  dueDate?: Date;
  handoffSourceRunId?: string;
  handoffContext?: Record<string, unknown>;
  handoffDepth?: number;
  isSubTask?: boolean;
  parentTaskId?: string;
};

export type CreateTaskInput = {
  organisationId: string;
  subaccountId: string;
  data: CreateTaskData;
  userId?: string;
};

const POSITION_GAP = 1000;

// Resolve an array of agent IDs to full agent objects in one query
async function resolveAgents(ids: string[]): Promise<Array<{ id: string; name: string | null; slug: string | null }>> {
  if (!ids.length) return [];
  return getOrgScopedDb('taskService.resolveAgents')
    .select({ id: agents.id, name: agents.name, slug: agents.slug })
    .from(agents)
    .where(inArray(agents.id, ids));
}

// Build the assignedAgents array and keep assignedAgentId in sync (first element = primary)
function mergeAgentIds(
  assignedAgentId: string | undefined | null,
  assignedAgentIds: string[] | undefined | null
): { agentId: string | null; agentIds: string[] } {
  const ids = assignedAgentIds ?? (assignedAgentId ? [assignedAgentId] : []);
  const deduped = [...new Set(ids.filter(Boolean))];
  const primary = deduped[0] ?? null;
  return { agentId: primary, agentIds: deduped };
}

// ─── createTask — overloaded standalone (DEC-4 / spec §3.3) ─────────────────
//
// TypeScript does not support overloads on object literal methods, so
// `createTask` is declared as a module-level function and then assigned to
// `taskService.createTask`. Callers import via `taskService` as before.

/**
 * Canonical — required for all in-scope callers.
 * Must be called with a caller-supplied `OrgScopedTx` obtained from
 * `getOrgScopedDb()` inside an active `withOrgTx(...)` block.
 */
function _createTask(input: CreateTaskInput, tx: OrgScopedTx): Promise<Task>;
/**
 * @deprecated transitional shim for sister-branch reconciliation — do NOT call from new code.
 * Throws at runtime. Sister branch removes this overload when it lands its own
 * withOrgTx wrappers.
 */
function _createTask(
  organisationId: string,
  subaccountId: string,
  data: CreateTaskData,
  userId?: string,
): Promise<Task>;
async function _createTask(
  arg1: CreateTaskInput | string,
  arg2: OrgScopedTx | string,
  arg3?: CreateTaskData,
  arg4?: string,
): Promise<Task> {
  if (typeof arg1 === 'string') {
    // Transitional shim for sister-branch callers (workflowEngineService) that have not yet
    // migrated to (input, tx). Opens its own transaction and sets the org GUC so RLS passes.
    // DEC-4 / spec §3.3 — remove once sister branch lands its withOrgTx wrappers.
    // PTH-CGT-R6-F2: emit side effects AFTER the inner tx commits, not before.
    // Previously this called _createTask recursively which fired emit inline,
    // meaning side effects fired while the inner tx was still uncommitted.
    const organisationId = arg1;
    const subaccountId = arg2 as string;
    const data = arg3!;
    const userId = arg4;
    const input: CreateTaskInput = { organisationId, subaccountId, data, userId };
    logger.warn('taskService.createTask_legacy_4arg', {
      event: 'legacy_4arg_createTask',
      organisationId,
      note: 'DEC-4: migrate to (input, tx) shape with withOrgTx',
    });
    const item = await getOrgScopedDb('taskService.createTask.legacy').transaction(async (innerTx) => {
      await innerTx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
      return _createTaskCore(input, innerTx);
    });
    emitCreateTaskSideEffects(item, input);
    return item;
  }

  // Canonical implementation — arg1 is CreateTaskInput, arg2 is OrgScopedTx.
  // PTH-CGT-R5-F1: split into createTaskCore (DB-only writes) + emitCreateTaskSideEffects
  // (websocket + triggers + orchestrator enqueue). The public createTask wrapper keeps the
  // old behaviour (DB writes + immediate side effects) for backwards compatibility, but
  // callers that need post-commit semantics now use createTaskCore + explicitly run
  // emitCreateTaskSideEffects after their outer transaction commits.
  const item = await _createTaskCore(arg1, arg2 as OrgScopedTx);
  emitCreateTaskSideEffects(item, arg1);
  return item;
}

/**
 * PTH-CGT-R5-F1 — DB writes only. No websocket, no trigger fire, no orchestrator
 * enqueue. Callers that wrap createTaskCore in a transaction that can roll back
 * downstream MUST defer side effects until after their outer commit by calling
 * `emitCreateTaskSideEffects(item, input)`.
 */
async function _createTaskCore(input: CreateTaskInput, tx: OrgScopedTx): Promise<Task> {
  const { organisationId, subaccountId, data, userId } = input;

  const status = (data.status ?? 'inbox') as TaskStatus;

  await _validateStatus(organisationId, subaccountId, status, tx);
  const position = await _nextPosition(subaccountId, status, tx);

  const { agentId, agentIds } = mergeAgentIds(data.assignedAgentId, data.assignedAgentIds);

  if (agentId) {
    const [assignedAgent] = await tx
      .select({ id: agents.id, deletedAt: agents.deletedAt })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId)))
      .limit(1);
    assertActive(assignedAgent, 'Agent');
  }

  const [item] = await tx
    .insert(tasks)
    .values({
      organisationId,
      subaccountId,
      title: data.title,
      description: data.description ?? null,
      brief: data.brief ?? null,
      status,
      priority: data.priority ?? 'normal',
      assignedAgentId: agentId,
      assignedAgentIds: agentIds,
      createdByAgentId: data.createdByAgentId ?? null,
      createdByUserId: userId ?? null,
      processId: data.processId ?? null,
      position,
      dueDate: data.dueDate ?? null,
      handoffSourceRunId: data.handoffSourceRunId ?? null,
      handoffContext: data.handoffContext ?? null,
      handoffDepth: data.handoffDepth ?? 0,
      isSubTask: data.isSubTask ?? false,
      parentTaskId: data.parentTaskId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  await tx.insert(taskActivities).values({
    organisationId,
    taskId: item.id,
    userId: userId ?? null,
    agentId: data.createdByAgentId ?? null,
    activityType: 'created',
    message: `Task "${data.title}" created`,
    createdAt: new Date(),
  });

  return item;
}

/**
 * PTH-CGT-R5-F1 — non-blocking side effects fired after a successful createTaskCore
 * write. Callers that pass the returned `item` from `createTaskCore` directly to this
 * function get the same behaviour as the legacy inline-side-effects path. Callers
 * inside a transaction that can fail downstream MUST defer this call until AFTER
 * their outer commit so observers don't see events for rolled-back rows.
 */
function emitCreateTaskSideEffects(item: Task, input: CreateTaskInput): void {
  const { organisationId, subaccountId, data } = input;
  const status = (data.status ?? 'inbox') as TaskStatus;

  emitSubaccountUpdate(subaccountId, 'task:created', {
    taskId: item.id, title: data.title, status,
  });

  // Fire task_created triggers (non-blocking)
  triggerService.checkAndFire(subaccountId, organisationId, 'task_created', {
    taskId: item.id,
    title: data.title,
    status,
    priority: item.priority,
    agentId: data.createdByAgentId ?? null,
  }).catch((err: unknown) => {
    logger.error('task.trigger_failed', {
      subaccountId,
      eventType: 'task_created',
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Orchestrator capability-aware routing (docs/orchestrator-capability-routing-spec.md §7).
  // Enqueue the Orchestrator-from-task job when the task meets the eligibility
  // predicate. Non-blocking; the handler performs its own guards and silently
  // no-ops when the Orchestrator agent is not linked in this org.
  import('../jobs/orchestratorFromTaskJob.js').then(({ enqueueOrchestratorRoutingIfEligible }) =>
    enqueueOrchestratorRoutingIfEligible({
      id: item.id,
      organisationId,
      status: item.status,
      assignedAgentId: item.assignedAgentId ?? null,
      isSubTask: item.isSubTask,
      createdByAgentId: item.createdByAgentId ?? null,
      description: item.description ?? null,
    }),
  ).catch((err: unknown) => {
    logger.error('task.orchestrator_enqueue_failed', {
      taskId: item.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

// ─── Standalone helpers (also used internally by createTask) ─────────────────

async function _validateStatus(organisationId: string, subaccountId: string, status: string, tx?: OrgScopedTx): Promise<void> {
  // When tx is supplied (createTask path), use it. When undefined (updateTask/moveTask paths),
  // fall back to getOrgScopedDb.
  const queryHandle = tx ?? getOrgScopedDb('taskService._validateStatus');
  const [config] = await queryHandle
    .select()
    .from(boardConfigs)
    .where(and(eq(boardConfigs.organisationId, organisationId), eq(boardConfigs.subaccountId, subaccountId)));

  if (!config) return;

  const columns = config.columns as Array<{ key: string }>;
  if (!columns.some(c => c.key === status)) {
    const validKeys = columns.map(c => c.key).join(', ');
    throw { statusCode: 400, message: `Invalid status "${status}". Valid statuses: ${validKeys}` };
  }
}

async function _nextPosition(subaccountId: string, status: TaskStatus, tx?: OrgScopedTx): Promise<number> {
  // When tx is supplied (createTask path), use it. When undefined (updateTask/moveTask paths),
  // fall back to getOrgScopedDb.
  const queryHandle = tx ?? getOrgScopedDb('taskService._nextPosition');
  const [last] = await queryHandle
    .select({ position: tasks.position })
    .from(tasks)
    .where(and(eq(tasks.subaccountId, subaccountId), eq(tasks.status, status), isNull(tasks.deletedAt)))
    .orderBy(desc(tasks.position))
    .limit(1);

  return (last?.position ?? 0) + POSITION_GAP;
}

export const taskService = {
  // ─── Tasks (Kanban Cards) ──────────────────────────────────────────────────

  /**
   * Returns true iff a task with the given id exists in the org. Soft-deleted
   * tasks are still considered owned (for audit / replay paths). Routes use
   * this to scope task-id paths without leaking existence across orgs.
   *
   * Per DEVELOPMENT_GUIDELINES §2 routes never import `db` directly — call
   * this from the route layer instead of inlining a select.
   */
  async assertOrgOwnsTask(taskId: string, organisationId: string): Promise<boolean> {
    const [row] = await getOrgScopedDb('taskService.assertOrgOwnsTask')
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, organisationId)))
      .limit(1);
    return row != null;
  },

  async listTasks(
    organisationId: string,
    subaccountId: string,
    filters?: { status?: string; priority?: string; assignedAgentId?: string; search?: string; projectId?: string }
  ) {
    const conditions = [
      eq(tasks.organisationId, organisationId),
      eq(tasks.subaccountId, subaccountId),
      isNull(tasks.deletedAt),
    ];

    if (filters?.status) conditions.push(eq(tasks.status, filters.status as TaskStatus));
    if (filters?.priority) conditions.push(eq(tasks.priority, filters.priority as 'low' | 'normal' | 'high' | 'urgent'));
    if (filters?.assignedAgentId) conditions.push(eq(tasks.assignedAgentId, filters.assignedAgentId));
    if (filters?.search) conditions.push(ilike(tasks.title, `%${filters.search}%`));
    if (filters?.projectId) conditions.push(eq(tasks.projectId, filters.projectId));

    const rows = await getOrgScopedDb('taskService.listTasks')
      .select({ item: tasks })
      .from(tasks)
      .where(and(...conditions))
      .orderBy(asc(tasks.position), desc(tasks.createdAt));

    // Collect all unique agent IDs across all tasks in one query
    const rawAllIds = rows.flatMap(r => {
      const ids = r.item.assignedAgentIds as string[] | null;
      return ids?.length ? ids : r.item.assignedAgentId ? [r.item.assignedAgentId] : [];
    }) as string[];
    const allIds = [...new Set(rawAllIds)];
    const agentMap = new Map((await resolveAgents(allIds)).map(a => [a.id, a]));

    return rows.map(({ item }) => {
      const rawIds = item.assignedAgentIds as string[] | null;
      const ids = rawIds?.length ? rawIds : item.assignedAgentId ? [item.assignedAgentId] : [];
      const assignedAgents = ids.map(id => agentMap.get(id)).filter(Boolean) as Array<{ id: string; name: string | null; slug: string | null }>;
      return {
        ...item,
        assignedAgents,
        // Keep legacy singular field for backward compat
        assignedAgent: assignedAgents[0] ?? null,
      };
    });
  },

  async getTask(id: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('taskService.getTask');
    const [item] = await scopedDb
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!item) throw { statusCode: 404, message: 'Task not found' };

    const [activitiesRows, deliverablesRows] = await Promise.all([
      scopedDb.select().from(taskActivities).where(and(eq(taskActivities.taskId, id), eq(taskActivities.organisationId, organisationId))).orderBy(desc(taskActivities.createdAt)),
      scopedDb.select().from(taskDeliverables).where(and(eq(taskDeliverables.taskId, id), eq(taskDeliverables.organisationId, organisationId), isNull(taskDeliverables.deletedAt))).orderBy(desc(taskDeliverables.createdAt)),
    ]);

    const ids = (item.assignedAgentIds as string[] | null) ?? (item.assignedAgentId ? [item.assignedAgentId] : []);
    const assignedAgents = await resolveAgents(ids);

    return {
      ...item,
      assignedAgents,
      assignedAgent: assignedAgents[0] ?? null,
      activities: activitiesRows,
      deliverables: deliverablesRows,
    };
  },

  createTask: _createTask,
  // PTH-CGT-R5-F1 — DB-only writes; caller responsible for emitCreateTaskSideEffects after commit.
  createTaskCore: _createTaskCore,
  emitCreateTaskSideEffects,

  async updateTask(
    id: string,
    organisationId: string,
    data: {
      title?: string;
      description?: string;
      brief?: string;
      status?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      assignedAgentId?: string | null;
      assignedAgentIds?: string[] | null;
      processId?: string | null;
      dueDate?: Date | null;
    },
    userId?: string
  ) {
    const scopedDb = getOrgScopedDb('taskService.updateTask');
    const [existing] = await scopedDb
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Task not found' };

    if (data.status && data.status !== existing.status) {
      await _validateStatus(organisationId, existing.subaccountId!, data.status);
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) update.title = data.title;
    if (data.description !== undefined) update.description = data.description;
    if (data.brief !== undefined) update.brief = data.brief;
    if (data.status !== undefined) update.status = data.status;
    if (data.priority !== undefined) update.priority = data.priority;
    if (data.processId !== undefined) update.processId = data.processId;
    if (data.dueDate !== undefined) update.dueDate = data.dueDate;

    // Agent assignment — handle both singular and plural
    const agentIdsChanging = data.assignedAgentIds !== undefined || data.assignedAgentId !== undefined;
    if (agentIdsChanging) {
      const { agentId, agentIds } = mergeAgentIds(
        data.assignedAgentId,
        data.assignedAgentIds
      );
      update.assignedAgentId = agentId;
      update.assignedAgentIds = agentIds;

      // Log assignment change if the agent list actually changed
      const prevIds = (existing.assignedAgentIds as string[] | null) ?? (existing.assignedAgentId ? [existing.assignedAgentId] : []);
      const newIdsStr = JSON.stringify(agentIds.sort());
      const prevIdsStr = JSON.stringify(prevIds.sort());
      if (newIdsStr !== prevIdsStr) {
        const agentObjs = await resolveAgents(agentIds);
        const names = agentObjs.map(a => a.name ?? 'Unknown').join(', ');
        await scopedDb.insert(taskActivities).values({
          organisationId,
          taskId: id,
          userId: userId ?? null,
          activityType: 'assigned',
          message: agentIds.length ? `Assigned to ${names}` : 'Unassigned',
          metadata: { agentIds },
          createdAt: new Date(),
        });
      }
    }

    const [updated] = await scopedDb
      .update(tasks)
      .set(update)
      // guard-ignore-next-line: org-scoped-writes reason="existing task was fetched above with and(eq(tasks.id, id), eq(tasks.organisationId, organisationId)) — org membership already verified"
      .where(eq(tasks.id, id))
      .returning();

    if (data.status && data.status !== existing.status) {
      await scopedDb.insert(taskActivities).values({
        organisationId,
        taskId: id,
        userId: userId ?? null,
        activityType: 'status_changed',
        message: `Status changed from "${existing.status}" to "${data.status}"`,
        metadata: { from: existing.status, to: data.status },
        createdAt: new Date(),
      });

      emitSubaccountUpdate(existing.subaccountId!, 'task:status_changed', {
        taskId: id, from: existing.status, to: data.status,
      });

      // Wake the orchestrator when a subtask reaches a terminal or blocked state (non-blocking)
      if (data.status === 'done' || data.status === 'blocked') {
        subtaskWakeupService.notifySubtaskCompleted(id, existing.subaccountId!, existing.organisationId, data.status).catch((err: unknown) => {
          logger.error('task.subtask_wakeup_failed', { taskId: id, error: err instanceof Error ? err.message : String(err) });
        });
      }
    }

    return updated;
  },

  async moveTask(id: string, organisationId: string, data: { status: string; position: number }, userId?: string) {
    const scopedDb = getOrgScopedDb('taskService.moveTask');
    const [existing] = await scopedDb
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Task not found' };

    await _validateStatus(organisationId, existing.subaccountId!, data.status);

    const statusChanged = data.status !== existing.status;

    const [updated] = await scopedDb
      .update(tasks)
      .set({ status: data.status as TaskStatus, position: data.position, updatedAt: new Date() })
      // guard-ignore-next-line: org-scoped-writes reason="existing task was fetched above with and(eq(tasks.id, id), eq(tasks.organisationId, organisationId)) — org membership already verified"
      .where(eq(tasks.id, id))
      .returning();

    if (statusChanged) {
      await scopedDb.insert(taskActivities).values({
        organisationId: existing.organisationId,
        taskId: id,
        userId: userId ?? null,
        activityType: 'status_changed',
        message: `Moved from "${existing.status}" to "${data.status}"`,
        metadata: { from: existing.status, to: data.status },
        createdAt: new Date(),
      });

      // Fire task_moved triggers (non-blocking)
      triggerService.checkAndFire(existing.subaccountId!, existing.organisationId, 'task_moved', {
        taskId: id,
        from: existing.status,
        to: data.status,
        column: data.status,
      }).catch((err: unknown) => {
        logger.error('task.trigger_failed', {
          subaccountId: existing.subaccountId,
          eventType: 'task_moved',
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Wake the orchestrator when a subtask reaches a terminal or blocked state (non-blocking)
      if (data.status === 'done' || data.status === 'blocked') {
        subtaskWakeupService.notifySubtaskCompleted(id, existing.subaccountId!, existing.organisationId, data.status).catch((err: unknown) => {
          logger.error('task.subtask_wakeup_failed', { taskId: id, error: err instanceof Error ? err.message : String(err) });
        });
      }
    }

    return updated;
  },

  async deleteTask(id: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('taskService.deleteTask');
    const [existing] = await scopedDb
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Task not found' };

    const now = new Date();
    // guard-ignore-next-line: org-scoped-writes reason="existing task was fetched above with and(eq(tasks.id, id), eq(tasks.organisationId, organisationId)) — org membership already verified"
    await scopedDb.update(tasks).set({ deletedAt: now, updatedAt: now }).where(eq(tasks.id, id));
  },

  // ─── Activities ─────────────────────────────────────────────────────────────

  async listActivities(taskId: string, organisationId: string) {
    return getOrgScopedDb('taskService.listActivities')
      .select()
      .from(taskActivities)
      .where(and(eq(taskActivities.taskId, taskId), eq(taskActivities.organisationId, organisationId)))
      .orderBy(desc(taskActivities.createdAt));
  },

  async addActivity(
    taskId: string,
    organisationId: string,
    data: {
      activityType: 'created' | 'assigned' | 'status_changed' | 'progress' | 'completed' | 'note' | 'blocked' | 'deliverable_added';
      message: string;
      agentId?: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    const [activity] = await getOrgScopedDb('taskService.addActivity')
      .insert(taskActivities)
      .values({
        organisationId,
        taskId,
        agentId: data.agentId ?? null,
        userId: data.userId ?? null,
        activityType: data.activityType,
        message: data.message,
        metadata: data.metadata ?? null,
        createdAt: new Date(),
      })
      .returning();

    return activity;
  },

  // ─── Deliverables ───────────────────────────────────────────────────────────

  async listDeliverables(taskId: string, organisationId: string) {
    return getOrgScopedDb('taskService.listDeliverables')
      .select()
      .from(taskDeliverables)
      .where(and(eq(taskDeliverables.taskId, taskId), eq(taskDeliverables.organisationId, organisationId), isNull(taskDeliverables.deletedAt)))
      .orderBy(desc(taskDeliverables.createdAt));
  },

  async addDeliverable(
    taskId: string,
    organisationId: string,
    data: { deliverableType: 'file' | 'url' | 'artifact'; title: string; path?: string; description?: string }
  ) {
    const [deliverable] = await getOrgScopedDb('taskService.addDeliverable')
      .insert(taskDeliverables)
      .values({
        organisationId,
        taskId,
        deliverableType: data.deliverableType,
        title: data.title,
        path: data.path ?? null,
        description: data.description ?? null,
        createdAt: new Date(),
      })
      .returning();

    return deliverable;
  },

  async deleteDeliverable(id: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('taskService.deleteDeliverable');
    const [existing] = await scopedDb.select().from(taskDeliverables).where(and(
      eq(taskDeliverables.id, id),
      eq(taskDeliverables.organisationId, organisationId),
      isNull(taskDeliverables.deletedAt),
    ));
    if (!existing) throw { statusCode: 404, message: 'Deliverable not found' };
    await scopedDb.update(taskDeliverables).set({ deletedAt: new Date() }).where(
      and(eq(taskDeliverables.id, id), eq(taskDeliverables.organisationId, organisationId)),
    );
  },

  // ─── Helpers (delegating to module-level functions) ──────────────────────────
  // These remain on the object for callers (e.g. skillExecutor) that reference
  // them directly as `taskService._nextPosition`.

  _nextPosition,
  _validateStatus,
};
