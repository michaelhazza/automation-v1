import { db } from '../db/index.js';
import { tasks, reviewItems, agentRuns, inboxReadStates, subaccounts } from '../db/schema/index.js';
import { eq, and, or, isNull, desc, asc, gte, ilike, inArray, sql } from 'drizzle-orm';
import { auditService } from './auditService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityType = 'task' | 'review_item' | 'agent_run';

interface InboxItemRef {
  entityType: EntityType;
  entityId: string;
}

type SortField = 'updatedAt' | 'priority' | 'type' | 'subaccount';
type SortDirection = 'asc' | 'desc';

interface InboxFilters {
  tab?: 'all' | 'tasks' | 'reviews' | 'failed_runs';
  search?: string;
  limit?: number;
  // Subaccount filtering
  subaccountId?: string;          // filter to specific subaccount (subaccount-level view)
  subaccountIds?: string[];       // filter to multiple subaccounts
  // Sorting
  sortBy?: SortField;
  sortDirection?: SortDirection;
  // Only include subaccounts that opted in to org inbox (for org-wide view)
  orgWide?: boolean;
}

// Hard upper bounds to prevent expensive queries
const MAX_ITEMS_PER_SOURCE = 50;
const MAX_TOTAL_ITEMS = 100;

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

// Priority ordering for sort
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const TYPE_ORDER: Record<string, number> = { review_item: 0, task: 1, agent_run: 2 };

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
    const { tab = 'all' } = filters;
    // Sanitize search: escape SQL LIKE wildcards, limit length
    const search = filters.search
      ? filters.search.slice(0, 200).replace(/%/g, '\\%').replace(/_/g, '\\_')
      : undefined;

    // ── Resolve allowed subaccount IDs for org-wide view ────────────────
    // If org-wide, only include subaccounts that have opted in to org inbox
    let allowedSubaccountIds: string[] | null = null;
    if (filters.orgWide) {
      const saRows = await db
        .select({ id: subaccounts.id })
        .from(subaccounts)
        .where(and(
          eq(subaccounts.organisationId, orgId),
          eq(subaccounts.includeInOrgInbox, true),
          isNull(subaccounts.deletedAt),
        ));
      allowedSubaccountIds = saRows.map(r => r.id);
      if (allowedSubaccountIds.length === 0) return []; // No subaccounts opted in
    } else if (filters.subaccountIds && filters.subaccountIds.length > 0) {
      // Validate subaccountIds belong to this org (prevent IDOR)
      const saRows = await db
        .select({ id: subaccounts.id })
        .from(subaccounts)
        .where(and(
          eq(subaccounts.organisationId, orgId),
          inArray(subaccounts.id, filters.subaccountIds),
          isNull(subaccounts.deletedAt),
        ));
      allowedSubaccountIds = saRows.map(r => r.id);
      if (allowedSubaccountIds.length === 0) return [];
    }

    // Helper to add subaccount filter condition
    const subaccountFilter = (subaccountIdCol: any) => {
      if (filters.subaccountId) return eq(subaccountIdCol, filters.subaccountId);
      if (allowedSubaccountIds) return inArray(subaccountIdCol, allowedSubaccountIds);
      return undefined;
    };

    // ── Tasks with status='inbox' ────────────────────────────────────────
    if (tab === 'all' || tab === 'tasks') {
      const taskConditions: any[] = [
        eq(tasks.organisationId, orgId),
        eq(tasks.status, 'inbox'),
        isNull(tasks.deletedAt),
      ];
      const saFilter = subaccountFilter(tasks.subaccountId);
      if (saFilter) taskConditions.push(saFilter);
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
        .limit(MAX_ITEMS_PER_SOURCE);

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
      const reviewConditions: any[] = [
        eq(reviewItems.organisationId, orgId),
        or(
          eq(reviewItems.reviewStatus, 'pending'),
          eq(reviewItems.reviewStatus, 'edited_pending')
        ),
      ];
      const saFilterReview = subaccountFilter(reviewItems.subaccountId);
      if (saFilterReview) reviewConditions.push(saFilterReview);

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
        .limit(MAX_ITEMS_PER_SOURCE);

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

      const runConditions: any[] = [
        eq(agentRuns.organisationId, orgId),
        or(
          eq(agentRuns.status, 'failed'),
          eq(agentRuns.status, 'timeout'),
          eq(agentRuns.status, 'budget_exceeded')
        ),
        gte(agentRuns.createdAt, sevenDaysAgo),
      ];
      const saFilterRuns = subaccountFilter(agentRuns.subaccountId);
      if (saFilterRuns) runConditions.push(saFilterRuns);

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
        .limit(MAX_ITEMS_PER_SOURCE);

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

    // ── Enrich with subaccount names ──────────────────────────────────────
    const uniqueSaIds = [...new Set(items.map(i => i.meta.subaccountId as string).filter(Boolean))];
    if (uniqueSaIds.length > 0) {
      const saRows = await db
        .select({ id: subaccounts.id, name: subaccounts.name })
        .from(subaccounts)
        .where(and(
          inArray(subaccounts.id, uniqueSaIds),
          eq(subaccounts.organisationId, orgId),
          isNull(subaccounts.deletedAt),
        ));
      const saMap = new Map(saRows.map(r => [r.id, r.name]));
      for (const item of items) {
        const saId = item.meta.subaccountId as string;
        if (saId && saMap.has(saId)) {
          item.meta.subaccountName = saMap.get(saId);
        }
      }
    }

    // ── Sort ──────────────────────────────────────────────────────────────
    const sortBy = filters.sortBy || 'updatedAt';
    const sortDir = filters.sortDirection || 'desc';
    const dirMul = sortDir === 'asc' ? 1 : -1;

    items.sort((a, b) => {
      // Unread always first regardless of sort field
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;

      switch (sortBy) {
        case 'priority': {
          const pa = PRIORITY_ORDER[(a.meta.priority as string) ?? 'normal'] ?? 2;
          const pb = PRIORITY_ORDER[(b.meta.priority as string) ?? 'normal'] ?? 2;
          if (pa !== pb) return (pa - pb) * dirMul;
          return b.updatedAt.getTime() - a.updatedAt.getTime(); // tiebreak by recency
        }
        case 'type': {
          const ta = TYPE_ORDER[a.entityType] ?? 9;
          const tb = TYPE_ORDER[b.entityType] ?? 9;
          if (ta !== tb) return (ta - tb) * dirMul;
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        }
        case 'subaccount': {
          const sa = ((a.meta.subaccountName as string) ?? '').toLowerCase();
          const sb = ((b.meta.subaccountName as string) ?? '').toLowerCase();
          const cmp = sa.localeCompare(sb);
          if (cmp !== 0) return cmp * dirMul;
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        }
        case 'updatedAt':
        default:
          return (b.updatedAt.getTime() - a.updatedAt.getTime()) * dirMul;
      }
    });

    // Hard cap total items returned to prevent oversized responses
    return items.slice(0, MAX_TOTAL_ITEMS);
  },

  /**
   * Mark items as read — upserts into inboxReadStates.
   */
  async markRead(userId: string, orgId: string, items: InboxItemRef[]): Promise<void> {
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
      organisationId: orgId,
      entityType: 'inbox',
      metadata: { items, count: items.length },
    });
  },

  /**
   * Mark items as unread — upserts into inboxReadStates.
   */
  async markUnread(userId: string, orgId: string, items: InboxItemRef[]): Promise<void> {
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

    await auditService.log({
      actorId: userId,
      actorType: 'user',
      action: 'inbox.item.unread',
      organisationId: orgId,
      entityType: 'inbox',
      metadata: { items, count: items.length },
    });
  },

  /**
   * Archive items — sets isArchived=true in inboxReadStates.
   */
  async archiveItems(userId: string, orgId: string, items: InboxItemRef[]): Promise<void> {
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
      organisationId: orgId,
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
