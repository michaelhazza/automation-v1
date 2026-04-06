import { db } from '../db/index.js';
import { tasks, reviewItems, agentRuns, inboxReadStates } from '../db/schema/index.js';
import { eq, and, or, isNull, desc, sql, gte, ilike } from 'drizzle-orm';
import { auditService } from './auditService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityType = 'task' | 'review_item' | 'agent_run';

interface InboxItemRef {
  entityType: EntityType;
  entityId: string;
}

interface InboxFilters {
  tab?: 'all' | 'tasks' | 'reviews' | 'failed_runs';
  search?: string;
}

interface UnifiedInboxItem {
  entityType: EntityType;
  entityId: string;
  title: string;
  status: string;
  isRead: boolean;
  isArchived: boolean;
  readAt: Date | null;
  updatedAt: Date;
  meta: Record<string, unknown>;
}

interface InboxCounts {
  tasks: number;
  reviews: number;
  failedRuns: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const inboxService = {
  /**
   * Aggregated inbox across tasks (status='inbox'), review items (pending),
   * and failed/timeout/budget_exceeded agent runs from the last 7 days.
   */
  async getUnifiedInbox(
    userId: string,
    orgId: string,
    filters: InboxFilters
  ): Promise<UnifiedInboxItem[]> {
    const items: UnifiedInboxItem[] = [];
    const { tab = 'all', search } = filters;

    // ── Tasks with status='inbox' ────────────────────────────────────────
    if (tab === 'all' || tab === 'tasks') {
      const taskConditions = [
        eq(tasks.organisationId, orgId),
        eq(tasks.status, 'inbox'),
        isNull(tasks.deletedAt),
      ];
      if (search) {
        taskConditions.push(ilike(tasks.title, `%${search}%`));
      }

      const taskRows = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          updatedAt: tasks.updatedAt,
          subaccountId: tasks.subaccountId,
          priority: tasks.priority,
          isRead: inboxReadStates.isRead,
          isArchived: inboxReadStates.isArchived,
          readAt: inboxReadStates.readAt,
        })
        .from(tasks)
        .leftJoin(
          inboxReadStates,
          and(
            eq(inboxReadStates.entityType, 'task'),
            eq(inboxReadStates.entityId, tasks.id),
            eq(inboxReadStates.userId, userId)
          )
        )
        .where(and(...taskConditions))
        .orderBy(desc(tasks.updatedAt))
        .limit(50);

      for (const row of taskRows) {
        if (row.isArchived) continue;
        items.push({
          entityType: 'task',
          entityId: row.id,
          title: row.title,
          status: row.status,
          isRead: row.isRead ?? false,
          isArchived: row.isArchived ?? false,
          readAt: row.readAt ?? null,
          updatedAt: row.updatedAt,
          meta: { subaccountId: row.subaccountId, priority: row.priority },
        });
      }
    }

    // ── Review items (pending / edited_pending) ──────────────────────────
    if (tab === 'all' || tab === 'reviews') {
      const reviewConditions = [
        eq(reviewItems.organisationId, orgId),
        or(
          eq(reviewItems.reviewStatus, 'pending'),
          eq(reviewItems.reviewStatus, 'edited_pending')
        ),
      ];

      const reviewRows = await db
        .select({
          id: reviewItems.id,
          reviewStatus: reviewItems.reviewStatus,
          createdAt: reviewItems.createdAt,
          subaccountId: reviewItems.subaccountId,
          actionId: reviewItems.actionId,
          isRead: inboxReadStates.isRead,
          isArchived: inboxReadStates.isArchived,
          readAt: inboxReadStates.readAt,
        })
        .from(reviewItems)
        .leftJoin(
          inboxReadStates,
          and(
            eq(inboxReadStates.entityType, 'review_item'),
            eq(inboxReadStates.entityId, reviewItems.id),
            eq(inboxReadStates.userId, userId)
          )
        )
        .where(and(...reviewConditions))
        .orderBy(desc(reviewItems.createdAt))
        .limit(50);

      for (const row of reviewRows) {
        if (row.isArchived) continue;
        // If search is specified, filter by a simple text match on status (reviews lack a title)
        if (search && !row.reviewStatus.includes(search.toLowerCase())) continue;
        items.push({
          entityType: 'review_item',
          entityId: row.id,
          title: `Review: ${row.reviewStatus}`,
          status: row.reviewStatus,
          isRead: row.isRead ?? false,
          isArchived: row.isArchived ?? false,
          readAt: row.readAt ?? null,
          updatedAt: row.createdAt,
          meta: { subaccountId: row.subaccountId, actionId: row.actionId },
        });
      }
    }

    // ── Failed / timeout / budget_exceeded agent runs (last 7 days) ──────
    if (tab === 'all' || tab === 'failed_runs') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const runConditions = [
        eq(agentRuns.organisationId, orgId),
        or(
          eq(agentRuns.status, 'failed'),
          eq(agentRuns.status, 'timeout'),
          eq(agentRuns.status, 'budget_exceeded')
        ),
        gte(agentRuns.createdAt, sevenDaysAgo),
      ];

      if (search) {
        runConditions.push(ilike(agentRuns.errorMessage, `%${search}%`));
      }

      const runRows = await db
        .select({
          id: agentRuns.id,
          status: agentRuns.status,
          errorMessage: agentRuns.errorMessage,
          updatedAt: agentRuns.updatedAt,
          subaccountId: agentRuns.subaccountId,
          agentId: agentRuns.agentId,
          isRead: inboxReadStates.isRead,
          isArchived: inboxReadStates.isArchived,
          readAt: inboxReadStates.readAt,
        })
        .from(agentRuns)
        .leftJoin(
          inboxReadStates,
          and(
            eq(inboxReadStates.entityType, 'agent_run'),
            eq(inboxReadStates.entityId, agentRuns.id),
            eq(inboxReadStates.userId, userId)
          )
        )
        .where(and(...runConditions))
        .orderBy(desc(agentRuns.updatedAt))
        .limit(20);

      for (const row of runRows) {
        if (row.isArchived) continue;
        items.push({
          entityType: 'agent_run',
          entityId: row.id,
          title: row.errorMessage ?? `Agent run ${row.status}`,
          status: row.status,
          isRead: row.isRead ?? false,
          isArchived: row.isArchived ?? false,
          readAt: row.readAt ?? null,
          updatedAt: row.updatedAt,
          meta: { subaccountId: row.subaccountId, agentId: row.agentId },
        });
      }
    }

    // ── Sort: unread first, then by updatedAt DESC ───────────────────────
    items.sort((a, b) => {
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    return items;
  },

  /**
   * Mark items as read — upserts into inboxReadStates.
   */
  async markRead(userId: string, items: InboxItemRef[]): Promise<void> {
    if (items.length === 0) return;

    await db.transaction(async (tx) => {
      const now = new Date();
      for (const item of items) {
        await tx
          .insert(inboxReadStates)
          .values({
            userId,
            entityType: item.entityType,
            entityId: item.entityId,
            isRead: true,
            readAt: now,
          })
          .onConflictDoUpdate({
            target: [inboxReadStates.userId, inboxReadStates.entityType, inboxReadStates.entityId],
            set: { isRead: true, readAt: now },
          });
      }
    });

    await auditService.log({
      actorId: userId,
      actorType: 'user',
      action: 'inbox.item.read',
      entityType: 'inbox',
      metadata: { items, count: items.length },
    });
  },

  /**
   * Mark items as unread — upserts into inboxReadStates.
   */
  async markUnread(userId: string, items: InboxItemRef[]): Promise<void> {
    if (items.length === 0) return;

    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .insert(inboxReadStates)
          .values({
            userId,
            entityType: item.entityType,
            entityId: item.entityId,
            isRead: false,
            readAt: null,
          })
          .onConflictDoUpdate({
            target: [inboxReadStates.userId, inboxReadStates.entityType, inboxReadStates.entityId],
            set: { isRead: false, readAt: null },
          });
      }
    });
  },

  /**
   * Archive items — sets isArchived=true in inboxReadStates.
   */
  async archiveItems(userId: string, items: InboxItemRef[]): Promise<void> {
    if (items.length === 0) return;

    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .insert(inboxReadStates)
          .values({
            userId,
            entityType: item.entityType,
            entityId: item.entityId,
            isArchived: true,
            isRead: true,
            readAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [inboxReadStates.userId, inboxReadStates.entityType, inboxReadStates.entityId],
            set: { isArchived: true },
          });
      }
    });

    await auditService.log({
      actorId: userId,
      actorType: 'user',
      action: 'inbox.item.archived',
      entityType: 'inbox',
      metadata: { items, count: items.length },
    });
  },

  /**
   * Unread counts per category for the current user and org.
   */
  async getCounts(userId: string, orgId: string): Promise<InboxCounts> {
    // Run the three count queries in parallel
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [taskCount, reviewCount, runCount] = await Promise.all([
      // Tasks with status='inbox'
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .leftJoin(
          inboxReadStates,
          and(
            eq(inboxReadStates.entityType, 'task'),
            eq(inboxReadStates.entityId, tasks.id),
            eq(inboxReadStates.userId, userId)
          )
        )
        .where(
          and(
            eq(tasks.organisationId, orgId),
            eq(tasks.status, 'inbox'),
            isNull(tasks.deletedAt),
            or(isNull(inboxReadStates.isRead), eq(inboxReadStates.isRead, false)),
            or(isNull(inboxReadStates.isArchived), eq(inboxReadStates.isArchived, false))
          )
        ),

      // Pending review items
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(reviewItems)
        .leftJoin(
          inboxReadStates,
          and(
            eq(inboxReadStates.entityType, 'review_item'),
            eq(inboxReadStates.entityId, reviewItems.id),
            eq(inboxReadStates.userId, userId)
          )
        )
        .where(
          and(
            eq(reviewItems.organisationId, orgId),
            or(
              eq(reviewItems.reviewStatus, 'pending'),
              eq(reviewItems.reviewStatus, 'edited_pending')
            ),
            or(isNull(inboxReadStates.isRead), eq(inboxReadStates.isRead, false)),
            or(isNull(inboxReadStates.isArchived), eq(inboxReadStates.isArchived, false))
          )
        ),

      // Failed agent runs (last 7 days)
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(agentRuns)
        .leftJoin(
          inboxReadStates,
          and(
            eq(inboxReadStates.entityType, 'agent_run'),
            eq(inboxReadStates.entityId, agentRuns.id),
            eq(inboxReadStates.userId, userId)
          )
        )
        .where(
          and(
            eq(agentRuns.organisationId, orgId),
            or(
              eq(agentRuns.status, 'failed'),
              eq(agentRuns.status, 'timeout'),
              eq(agentRuns.status, 'budget_exceeded')
            ),
            gte(agentRuns.createdAt, sevenDaysAgo),
            or(isNull(inboxReadStates.isRead), eq(inboxReadStates.isRead, false)),
            or(isNull(inboxReadStates.isArchived), eq(inboxReadStates.isArchived, false))
          )
        ),
    ]);

    const t = taskCount[0]?.count ?? 0;
    const r = reviewCount[0]?.count ?? 0;
    const f = runCount[0]?.count ?? 0;

    return {
      tasks: t,
      reviews: r,
      failedRuns: f,
      total: t + r + f,
    };
  },
};
