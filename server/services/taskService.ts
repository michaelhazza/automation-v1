import { eq, and, isNull, desc, asc, ilike } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  tasks,
  taskActivities,
  taskDeliverables,
  boardConfigs,
  agents,
} from '../db/schema/index.js';

const POSITION_GAP = 1000;

export const taskService = {
  // ─── Tasks (Kanban Cards) ──────────────────────────────────────────────────

  async listTasks(
    organisationId: string,
    subaccountId: string,
    filters?: { status?: string; priority?: string; assignedAgentId?: string; search?: string }
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

    const items = await db
      .select({
        item: tasks,
        agentName: agents.name,
        agentSlug: agents.slug,
      })
      .from(tasks)
      .leftJoin(agents, eq(agents.id, tasks.assignedAgentId))
      .where(and(...conditions))
      .orderBy(asc(tasks.position), desc(tasks.createdAt));

    return items.map(({ item, agentName, agentSlug }) => ({
      ...item,
      assignedAgent: item.assignedAgentId ? { id: item.assignedAgentId, name: agentName, slug: agentSlug } : null,
    }));
  },

  async getTask(id: string, organisationId: string) {
    const [item] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!item) throw { statusCode: 404, message: 'Task not found' };

    const activities = await db
      .select()
      .from(taskActivities)
      .where(eq(taskActivities.taskId, id))
      .orderBy(desc(taskActivities.createdAt));

    const deliverables = await db
      .select()
      .from(taskDeliverables)
      .where(eq(taskDeliverables.taskId, id))
      .orderBy(desc(taskDeliverables.createdAt));

    // Get assigned agent info
    let assignedAgent = null;
    if (item.assignedAgentId) {
      const [agent] = await db
        .select({ id: agents.id, name: agents.name, slug: agents.slug })
        .from(agents)
        .where(eq(agents.id, item.assignedAgentId));
      assignedAgent = agent ?? null;
    }

    return { ...item, assignedAgent, activities, deliverables };
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
      createdByAgentId?: string;
      processId?: string;
      dueDate?: Date;
      handoffSourceRunId?: string;
      handoffContext?: Record<string, unknown>;
      handoffDepth?: number;
      isSubTask?: number;
      parentTaskId?: string;
    },
    userId?: string
  ) {
    const status = data.status ?? 'inbox';

    // Validate status matches a board column
    await this._validateStatus(organisationId, subaccountId, status);

    // Calculate position (append to end of column)
    const position = await this._nextPosition(subaccountId, status);

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
        assignedAgentId: data.assignedAgentId ?? null,
        createdByAgentId: data.createdByAgentId ?? null,
        processId: data.processId ?? null,
        position,
        dueDate: data.dueDate ?? null,
        handoffSourceRunId: data.handoffSourceRunId ?? null,
        handoffContext: data.handoffContext ?? null,
        handoffDepth: data.handoffDepth ?? 0,
        isSubTask: data.isSubTask ?? 0,
        parentTaskId: data.parentTaskId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Auto-create "created" activity
    await db.insert(taskActivities).values({
      taskId: item.id,
      userId: userId ?? null,
      agentId: data.createdByAgentId ?? null,
      activityType: 'created',
      message: `Task "${data.title}" created`,
      createdAt: new Date(),
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
      await this._validateStatus(organisationId, existing.subaccountId, data.status);
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) update.title = data.title;
    if (data.description !== undefined) update.description = data.description;
    if (data.brief !== undefined) update.brief = data.brief;
    if (data.status !== undefined) update.status = data.status;
    if (data.priority !== undefined) update.priority = data.priority;
    if (data.assignedAgentId !== undefined) update.assignedAgentId = data.assignedAgentId;
    if (data.processId !== undefined) update.processId = data.processId;
    if (data.dueDate !== undefined) update.dueDate = data.dueDate;

    const [updated] = await db
      .update(tasks)
      .set(update)
      .where(eq(tasks.id, id))
      .returning();

    // Auto-log status changes
    if (data.status && data.status !== existing.status) {
      await db.insert(taskActivities).values({
        taskId: id,
        userId: userId ?? null,
        activityType: 'status_changed',
        message: `Status changed from "${existing.status}" to "${data.status}"`,
        metadata: { from: existing.status, to: data.status },
        createdAt: new Date(),
      });
    }

    // Auto-log assignment changes
    if (data.assignedAgentId !== undefined && data.assignedAgentId !== existing.assignedAgentId) {
      let agentName = 'Unassigned';
      if (data.assignedAgentId) {
        const [agent] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, data.assignedAgentId));
        agentName = agent?.name ?? 'Unknown agent';
      }

      await db.insert(taskActivities).values({
        taskId: id,
        userId: userId ?? null,
        activityType: 'assigned',
        message: data.assignedAgentId ? `Assigned to ${agentName}` : 'Unassigned',
        metadata: { agentId: data.assignedAgentId },
        createdAt: new Date(),
      });
    }

    return updated;
  },

  async moveTask(id: string, organisationId: string, data: { status: string; position: number }, userId?: string) {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Task not found' };

    await this._validateStatus(organisationId, existing.subaccountId, data.status);

    const statusChanged = data.status !== existing.status;

    const [updated] = await db
      .update(tasks)
      .set({ status: data.status, position: data.position, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();

    if (statusChanged) {
      await db.insert(taskActivities).values({
        taskId: id,
        userId: userId ?? null,
        activityType: 'status_changed',
        message: `Moved from "${existing.status}" to "${data.status}"`,
        metadata: { from: existing.status, to: data.status },
        createdAt: new Date(),
      });
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

  async listActivities(taskId: string) {
    return db
      .select()
      .from(taskActivities)
      .where(eq(taskActivities.taskId, taskId))
      .orderBy(desc(taskActivities.createdAt));
  },

  async addActivity(
    taskId: string,
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

  async listDeliverables(taskId: string) {
    return db
      .select()
      .from(taskDeliverables)
      .where(eq(taskDeliverables.taskId, taskId))
      .orderBy(desc(taskDeliverables.createdAt));
  },

  async addDeliverable(
    taskId: string,
    data: { deliverableType: 'file' | 'url' | 'artifact'; title: string; path?: string; description?: string }
  ) {
    const [deliverable] = await db
      .insert(taskDeliverables)
      .values({
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

  async deleteDeliverable(id: string) {
    const [existing] = await db.select().from(taskDeliverables).where(eq(taskDeliverables.id, id));
    if (!existing) throw { statusCode: 404, message: 'Deliverable not found' };
    await db.delete(taskDeliverables).where(eq(taskDeliverables.id, id));
  },

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async _validateStatus(organisationId: string, subaccountId: string, status: string) {
    const [config] = await db
      .select()
      .from(boardConfigs)
      .where(and(eq(boardConfigs.organisationId, organisationId), eq(boardConfigs.subaccountId, subaccountId)));

    if (!config) {
      // No board config — accept any status (graceful degradation)
      return;
    }

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
