import { eq, and, isNull, desc, asc, ilike, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  tasks,
  taskActivities,
  taskDeliverables,
  boardConfigs,
  agents,
} from '../db/schema/index.js';
import { emitSubaccountUpdate } from '../websocket/emitters.js';
import { triggerService } from './triggerService.js';
import { subtaskWakeupService } from './subtaskWakeupService.js';
import { logger } from '../lib/logger.js';

const POSITION_GAP = 1000;

// Resolve an array of agent IDs to full agent objects in one query
async function resolveAgents(ids: string[]): Promise<Array<{ id: string; name: string | null; slug: string | null }>> {
  if (!ids.length) return [];
  return db
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

export const taskService = {
  // ─── Tasks (Kanban Cards) ──────────────────────────────────────────────────

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

    if (filters?.status) conditions.push(eq(tasks.status, filters.status));
    if (filters?.priority) conditions.push(eq(tasks.priority, filters.priority as 'low' | 'normal' | 'high' | 'urgent'));
    if (filters?.assignedAgentId) conditions.push(eq(tasks.assignedAgentId, filters.assignedAgentId));
    if (filters?.search) conditions.push(ilike(tasks.title, `%${filters.search}%`));
    if (filters?.projectId) conditions.push(eq(tasks.projectId, filters.projectId));

    const rows = await db
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
    const [item] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!item) throw { statusCode: 404, message: 'Task not found' };

    const [activitiesRows, deliverablesRows] = await Promise.all([
      db.select().from(taskActivities).where(and(eq(taskActivities.taskId, id), eq(taskActivities.organisationId, organisationId))).orderBy(desc(taskActivities.createdAt)),
      db.select().from(taskDeliverables).where(and(eq(taskDeliverables.taskId, id), eq(taskDeliverables.organisationId, organisationId), isNull(taskDeliverables.deletedAt))).orderBy(desc(taskDeliverables.createdAt)),
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

  async createTask(
    organisationId: string,
    subaccountId: string,
    data: {
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
    },
    userId?: string
  ) {
    const status = data.status ?? 'inbox';

    await this._validateStatus(organisationId, subaccountId, status);
    const position = await this._nextPosition(subaccountId, status);

    const { agentId, agentIds } = mergeAgentIds(data.assignedAgentId, data.assignedAgentIds);

    const [item] = await db
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

    await db.insert(taskActivities).values({
      organisationId,
      taskId: item.id,
      userId: userId ?? null,
      agentId: data.createdByAgentId ?? null,
      activityType: 'created',
      message: `Task "${data.title}" created`,
      createdAt: new Date(),
    });

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

    return item;
  },

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
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Task not found' };

    if (data.status && data.status !== existing.status) {
      await this._validateStatus(organisationId, existing.subaccountId!, data.status);
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
        await db.insert(taskActivities).values({
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

    const [updated] = await db
      .update(tasks)
      .set(update)
      .where(eq(tasks.id, id))
      .returning();

    if (data.status && data.status !== existing.status) {
      await db.insert(taskActivities).values({
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
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Task not found' };

    await this._validateStatus(organisationId, existing.subaccountId!, data.status);

    const statusChanged = data.status !== existing.status;

    const [updated] = await db
      .update(tasks)
      .set({ status: data.status, position: data.position, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();

    if (statusChanged) {
      await db.insert(taskActivities).values({
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
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Task not found' };

    const now = new Date();
    await db.update(tasks).set({ deletedAt: now, updatedAt: now }).where(eq(tasks.id, id));
  },

  // ─── Activities ─────────────────────────────────────────────────────────────

  async listActivities(taskId: string, organisationId: string) {
    return db
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
    const [activity] = await db
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
    return db
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
    const [deliverable] = await db
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
    const [existing] = await db.select().from(taskDeliverables).where(and(
      eq(taskDeliverables.id, id),
      eq(taskDeliverables.organisationId, organisationId),
      isNull(taskDeliverables.deletedAt),
    ));
    if (!existing) throw { statusCode: 404, message: 'Deliverable not found' };
    await db.update(taskDeliverables).set({ deletedAt: new Date() }).where(
      and(eq(taskDeliverables.id, id), eq(taskDeliverables.organisationId, organisationId)),
    );
  },

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async _validateStatus(organisationId: string, subaccountId: string, status: string) {
    const [config] = await db
      .select()
      .from(boardConfigs)
      .where(and(eq(boardConfigs.organisationId, organisationId), eq(boardConfigs.subaccountId, subaccountId)));

    if (!config) return;

    const columns = config.columns as Array<{ key: string }>;
    if (!columns.some(c => c.key === status)) {
      const validKeys = columns.map(c => c.key).join(', ');
      throw { statusCode: 400, message: `Invalid status "${status}". Valid statuses: ${validKeys}` };
    }
  },

  async _nextPosition(subaccountId: string, status: string) {
    const [last] = await db
      .select({ position: tasks.position })
      .from(tasks)
      .where(and(eq(tasks.subaccountId, subaccountId), eq(tasks.status, status), isNull(tasks.deletedAt)))
      .orderBy(desc(tasks.position))
      .limit(1);

    return (last?.position ?? 0) + POSITION_GAP;
  },
};
