import { eq, and, isNull, desc, asc, ilike } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workspaceItems,
  workspaceItemActivities,
  workspaceItemDeliverables,
  boardConfigs,
  agents,
} from '../db/schema/index.js';

const POSITION_GAP = 1000;

export const workspaceItemService = {
  // ─── Items ──────────────────────────────────────────────────────────────────

  async listItems(
    organisationId: string,
    subaccountId: string,
    filters?: { status?: string; priority?: string; assignedAgentId?: string; search?: string }
  ) {
    const conditions = [
      eq(workspaceItems.organisationId, organisationId),
      eq(workspaceItems.subaccountId, subaccountId),
      isNull(workspaceItems.deletedAt),
    ];

    if (filters?.status) conditions.push(eq(workspaceItems.status, filters.status));
    if (filters?.priority) conditions.push(eq(workspaceItems.priority, filters.priority as 'low' | 'normal' | 'high' | 'urgent'));
    if (filters?.assignedAgentId) conditions.push(eq(workspaceItems.assignedAgentId, filters.assignedAgentId));
    if (filters?.search) conditions.push(ilike(workspaceItems.title, `%${filters.search}%`));

    const items = await db
      .select({
        item: workspaceItems,
        agentName: agents.name,
        agentSlug: agents.slug,
      })
      .from(workspaceItems)
      .leftJoin(agents, eq(agents.id, workspaceItems.assignedAgentId))
      .where(and(...conditions))
      .orderBy(asc(workspaceItems.position), desc(workspaceItems.createdAt));

    return items.map(({ item, agentName, agentSlug }) => ({
      ...item,
      assignedAgent: item.assignedAgentId ? { id: item.assignedAgentId, name: agentName, slug: agentSlug } : null,
    }));
  },

  async getItem(id: string, organisationId: string) {
    const [item] = await db
      .select()
      .from(workspaceItems)
      .where(and(eq(workspaceItems.id, id), eq(workspaceItems.organisationId, organisationId), isNull(workspaceItems.deletedAt)));

    if (!item) throw { statusCode: 404, message: 'Workspace item not found' };

    const activities = await db
      .select()
      .from(workspaceItemActivities)
      .where(eq(workspaceItemActivities.workspaceItemId, id))
      .orderBy(desc(workspaceItemActivities.createdAt));

    const deliverables = await db
      .select()
      .from(workspaceItemDeliverables)
      .where(eq(workspaceItemDeliverables.workspaceItemId, id))
      .orderBy(desc(workspaceItemDeliverables.createdAt));

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

  async createItem(
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
      taskId?: string;
      dueDate?: Date;
    },
    userId?: string
  ) {
    const status = data.status ?? 'inbox';

    // Validate status matches a board column
    await this._validateStatus(organisationId, subaccountId, status);

    // Calculate position (append to end of column)
    const position = await this._nextPosition(subaccountId, status);

    const [item] = await db
      .insert(workspaceItems)
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
        taskId: data.taskId ?? null,
        position,
        dueDate: data.dueDate ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Auto-create "created" activity
    await db.insert(workspaceItemActivities).values({
      workspaceItemId: item.id,
      userId: userId ?? null,
      agentId: data.createdByAgentId ?? null,
      activityType: 'created',
      message: `Item "${data.title}" created`,
      createdAt: new Date(),
    });

    return item;
  },

  async updateItem(
    id: string,
    organisationId: string,
    data: {
      title?: string;
      description?: string;
      brief?: string;
      status?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      assignedAgentId?: string | null;
      taskId?: string | null;
      dueDate?: Date | null;
    },
    userId?: string
  ) {
    const [existing] = await db
      .select()
      .from(workspaceItems)
      .where(and(eq(workspaceItems.id, id), eq(workspaceItems.organisationId, organisationId), isNull(workspaceItems.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Workspace item not found' };

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
    if (data.taskId !== undefined) update.taskId = data.taskId;
    if (data.dueDate !== undefined) update.dueDate = data.dueDate;

    const [updated] = await db
      .update(workspaceItems)
      .set(update)
      .where(eq(workspaceItems.id, id))
      .returning();

    // Auto-log status changes
    if (data.status && data.status !== existing.status) {
      await db.insert(workspaceItemActivities).values({
        workspaceItemId: id,
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

      await db.insert(workspaceItemActivities).values({
        workspaceItemId: id,
        userId: userId ?? null,
        activityType: 'assigned',
        message: data.assignedAgentId ? `Assigned to ${agentName}` : 'Unassigned',
        metadata: { agentId: data.assignedAgentId },
        createdAt: new Date(),
      });
    }

    return updated;
  },

  async moveItem(id: string, organisationId: string, data: { status: string; position: number }, userId?: string) {
    const [existing] = await db
      .select()
      .from(workspaceItems)
      .where(and(eq(workspaceItems.id, id), eq(workspaceItems.organisationId, organisationId), isNull(workspaceItems.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Workspace item not found' };

    await this._validateStatus(organisationId, existing.subaccountId, data.status);

    const statusChanged = data.status !== existing.status;

    const [updated] = await db
      .update(workspaceItems)
      .set({ status: data.status, position: data.position, updatedAt: new Date() })
      .where(eq(workspaceItems.id, id))
      .returning();

    if (statusChanged) {
      await db.insert(workspaceItemActivities).values({
        workspaceItemId: id,
        userId: userId ?? null,
        activityType: 'status_changed',
        message: `Moved from "${existing.status}" to "${data.status}"`,
        metadata: { from: existing.status, to: data.status },
        createdAt: new Date(),
      });
    }

    return updated;
  },

  async deleteItem(id: string, organisationId: string) {
    const [existing] = await db
      .select()
      .from(workspaceItems)
      .where(and(eq(workspaceItems.id, id), eq(workspaceItems.organisationId, organisationId), isNull(workspaceItems.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Workspace item not found' };

    const now = new Date();
    await db.update(workspaceItems).set({ deletedAt: now, updatedAt: now }).where(eq(workspaceItems.id, id));
  },

  // ─── Activities ─────────────────────────────────────────────────────────────

  async listActivities(workspaceItemId: string) {
    return db
      .select()
      .from(workspaceItemActivities)
      .where(eq(workspaceItemActivities.workspaceItemId, workspaceItemId))
      .orderBy(desc(workspaceItemActivities.createdAt));
  },

  async addActivity(
    workspaceItemId: string,
    data: {
      activityType: 'created' | 'assigned' | 'status_changed' | 'progress' | 'completed' | 'note' | 'blocked';
      message: string;
      agentId?: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    const [activity] = await db
      .insert(workspaceItemActivities)
      .values({
        workspaceItemId,
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

  async listDeliverables(workspaceItemId: string) {
    return db
      .select()
      .from(workspaceItemDeliverables)
      .where(eq(workspaceItemDeliverables.workspaceItemId, workspaceItemId))
      .orderBy(desc(workspaceItemDeliverables.createdAt));
  },

  async addDeliverable(
    workspaceItemId: string,
    data: { deliverableType: 'file' | 'url' | 'artifact'; title: string; path?: string; description?: string }
  ) {
    const [deliverable] = await db
      .insert(workspaceItemDeliverables)
      .values({
        workspaceItemId,
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
    const [existing] = await db.select().from(workspaceItemDeliverables).where(eq(workspaceItemDeliverables.id, id));
    if (!existing) throw { statusCode: 404, message: 'Deliverable not found' };
    await db.delete(workspaceItemDeliverables).where(eq(workspaceItemDeliverables.id, id));
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
      .select({ position: workspaceItems.position })
      .from(workspaceItems)
      .where(and(eq(workspaceItems.subaccountId, subaccountId), eq(workspaceItems.status, status), isNull(workspaceItems.deletedAt)))
      .orderBy(desc(workspaceItems.position))
      .limit(1);

    return (last?.position ?? 0) + POSITION_GAP;
  },
};
