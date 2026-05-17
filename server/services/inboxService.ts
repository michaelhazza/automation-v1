import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { tasks, reviewItems, agentRuns, actions, inboxReadStates, subaccounts } from '../db/schema/index.js';
import { eq, and, or, isNull, desc, asc, gte, ilike, inArray, sql } from 'drizzle-orm';
import { auditService } from './auditService.js';
import { deriveBand, filterByQ, type InboxBand, type InboxKind } from './inboxServicePure.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityType = 'task' | 'review_item' | 'agent_run';

interface InboxItemRef {
  entityType: EntityType;
  entityId: string;
}

interface BandedInboxItemRef {
  /**
   * Logical kind used for band-derivation and action routing.
   * 'approval' maps to actions rows (status='pending_approval').
   */
  kind: InboxKind;
  entityId: string;
}

interface ListInboxByBandFilters {
  band?: InboxBand;
  q?: string;
  subaccountId?: string;
}

interface InboxActionResult {
  ok: boolean;
  alreadyApplied: boolean;
}

type SortField = 'updatedAt' | 'priority' | 'type' | 'subaccount';
type SortDirection = 'asc' | 'desc';

interface InboxFilters {
  tab?: 'all' | 'tasks' | 'reviews' | 'failed_runs';
  search?: string;
  // Subaccount filtering
  subaccountId?: string;          // filter to specific subaccount (subaccount-level view)
  subaccountIds?: string[];       // filter to multiple subaccounts
  // Sorting
  sortBy?: SortField;
  sortDirection?: SortDirection;
  // Only include subaccounts that opted in to org inbox (for org-wide view)
  orgWide?: boolean;
  /**
   * When true, archived items are included in the result set (skipped otherwise).
   * Used by listInboxByBand when band=previous so archived items surface correctly.
   */
  includeArchived?: boolean;
}

// Hard upper bounds to prevent expensive queries
const MAX_ITEMS_PER_SOURCE = 50;
const MAX_TOTAL_ITEMS = 100;

interface UnifiedInboxItem {
  entityType: EntityType;
  /** Logical kind for band derivation and action routing. */
  kind: InboxKind;
  entityId: string;
  title: string;
  status: string;
  isRead: boolean;
  isArchived: boolean;
  readAt: Date | null;
  updatedAt: Date;
  /** Due date for high-band proximity check. */
  dueAt?: Date | null;
  /** Severity string (critical/urgent → high band when unread). */
  severity?: string | null;
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
    const unifiedScopedDb = getOrgScopedDb('inboxService.getUnifiedInbox');
    let allowedSubaccountIds: string[] | null = null;
    if (filters.orgWide) {
      const saRows = await unifiedScopedDb
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
      const saRows = await unifiedScopedDb
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

      const taskRows = await unifiedScopedDb
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          updatedAt: tasks.updatedAt,
          subaccountId: tasks.subaccountId,
          priority: tasks.priority,
          dueDate: tasks.dueDate,
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
        if (!filters.includeArchived && row.isArchived) continue;
        // Map tasks.priority='urgent' → severity='urgent' so deriveBand can classify correctly.
        // Tasks cannot reach the 'high' band (HIGH_ELIGIBLE_KINDS excludes 'task'), but the
        // signals are plumbed for completeness and future band-rule extensions.
        const taskSeverity = row.priority === 'urgent' ? 'urgent' : undefined;
        items.push({
          entityType: 'task',
          kind: 'task',
          entityId: row.id,
          title: row.title,
          status: row.status,
          isRead: row.isRead ?? false,
          isArchived: row.isArchived ?? false,
          readAt: row.readAt ?? null,
          updatedAt: row.updatedAt,
          dueAt: row.dueDate ?? undefined,
          severity: taskSeverity,
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

      const reviewRows = await unifiedScopedDb
        .select({
          id: reviewItems.id,
          reviewStatus: reviewItems.reviewStatus,
          createdAt: reviewItems.createdAt,
          subaccountId: reviewItems.subaccountId,
          actionId: reviewItems.actionId,
          // suspendUntil from the linked action serves as the approval window deadline (dueAt proxy).
          // This is the timestamp after which the approval request times out, giving deriveBand
          // a concrete signal to classify the item as 'high' when the window is within 24 h.
          actionSuspendUntil: actions.suspendUntil,
          isRead: inboxReadStates.isRead,
          isArchived: inboxReadStates.isArchived,
          readAt: inboxReadStates.readAt,
        })
        .from(reviewItems)
        .leftJoin(
          actions,
          eq(actions.id, reviewItems.actionId)
        )
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
        if (!filters.includeArchived && row.isArchived) continue;
        // If search is specified, filter by a simple text match on status (reviews lack a title)
        if (search && !row.reviewStatus.includes(search.toLowerCase())) continue;
        items.push({
          entityType: 'review_item',
          kind: 'review_item',
          entityId: row.id,
          title: `Review: ${row.reviewStatus}`,
          status: row.reviewStatus,
          isRead: row.isRead ?? false,
          isArchived: row.isArchived ?? false,
          readAt: row.readAt ?? null,
          updatedAt: row.createdAt,
          // Use the linked action's suspension deadline as due-date signal for band derivation.
          // When suspendUntil is within 24 h, deriveBand classifies this as 'high'.
          dueAt: row.actionSuspendUntil ?? undefined,
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

      const runRows = await unifiedScopedDb
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
        if (!filters.includeArchived && row.isArchived) continue;
        // agent_runs are not high-eligible: dueAt and severity are intentionally not set.
        items.push({
          entityType: 'agent_run',
          kind: 'agent_run',
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
      const saRows = await unifiedScopedDb
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

    await getOrgScopedDb('inboxService.markRead').transaction(async (tx) => {
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

    await getOrgScopedDb('inboxService.markUnread').transaction(async (tx) => {
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

    await getOrgScopedDb('inboxService.archiveItems').transaction(async (tx) => {
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

  // ---------------------------------------------------------------------------
  // Band-filtered listing (spec §4.2)
  // ---------------------------------------------------------------------------

  /**
   * List inbox items for a specific priority band.
   * Calls the existing union-fetchers and applies deriveBand() in JS.
   */
  async listInboxByBand(
    userId: string,
    orgId: string,
    filters: ListInboxByBandFilters
  ): Promise<Array<UnifiedInboxItem & { band: InboxBand }>> {
    // Reuse getUnifiedInbox to fetch all items across all tabs (no tab filter).
    // When band=previous (or no band filter — caller may want all bands including previous),
    // pass includeArchived=true so archived items reach deriveBand and surface as 'previous'.
    // Without this flag, getUnifiedInbox skips archived rows and the 'previous' band is
    // only populated by items that are read-but-not-archived.
    const includeArchived = !filters.band || filters.band === 'previous';
    const all = await inboxService.getUnifiedInbox(userId, orgId, {
      tab: 'all',
      subaccountId: filters.subaccountId,
      // Pass orgWide when no subaccount filter
      orgWide: !filters.subaccountId,
      includeArchived,
    });

    const now = new Date();
    const result: Array<UnifiedInboxItem & { band: InboxBand }> = [];

    for (const item of all) {
      // Apply q filter on the title
      if (!filterByQ(item.title, filters.q)) continue;

      const band = deriveBand({
        isRead: item.isRead,
        isArchived: item.isArchived,
        dueAt: item.dueAt,
        severity: item.severity,
        kind: item.kind,
      }, now);

      if (filters.band && band !== filters.band) continue;

      result.push({ ...item, band });
    }

    return result;
  },

  // ---------------------------------------------------------------------------
  // Per-kind action methods (spec §4.2 + §6 idempotency)
  // ---------------------------------------------------------------------------

  /**
   * Approve a review_item or approval-kind inbox item.
   * Idempotent: if the predicate doesn't match (already applied), returns alreadyApplied=true.
   * Returns 400-equivalent data when the kind doesn't support approve (agent_run, task).
   */
  async approveItem(
    orgId: string,
    userId: string,
    ref: BandedInboxItemRef
  ): Promise<InboxActionResult & { notApplicable?: boolean }> {
    if (ref.kind === 'review_item') {
      // UPDATE review_items SET reviewStatus='approved' WHERE id=? AND reviewStatus IN ('pending','edited_pending')
      const updated = await getOrgScopedDb('inboxService.approveItem')
        .update(reviewItems)
        .set({ reviewStatus: 'approved', reviewedBy: userId, reviewedAt: new Date() })
        .where(and(
          eq(reviewItems.id, ref.entityId),
          eq(reviewItems.organisationId, orgId),
          or(
            eq(reviewItems.reviewStatus, 'pending'),
            eq(reviewItems.reviewStatus, 'edited_pending')
          )
        ))
        .returning({ id: reviewItems.id });

      const alreadyApplied = updated.length === 0;

      await auditService.log({
        actorId: userId,
        actorType: 'user',
        action: 'inbox.item.approved',
        organisationId: orgId,
        entityType: 'review_item',
        entityId: ref.entityId,
        metadata: { alreadyApplied },
      });

      return { ok: true, alreadyApplied };
    }

    if (ref.kind === 'approval') {
      // approval kind maps to actions rows with status='pending_approval'
      const updated = await getOrgScopedDb('inboxService.approveItem')
        .update(actions)
        .set({ status: 'approved', approvedBy: userId, approvedAt: new Date() })
        .where(and(
          eq(actions.id, ref.entityId),
          eq(actions.organisationId, orgId),
          eq(actions.status, 'pending_approval')
        ))
        .returning({ id: actions.id });

      const alreadyApplied = updated.length === 0;

      await auditService.log({
        actorId: userId,
        actorType: 'user',
        action: 'inbox.item.approved',
        organisationId: orgId,
        entityType: 'action',
        entityId: ref.entityId,
        metadata: { alreadyApplied },
      });

      return { ok: true, alreadyApplied };
    }

    // agent_run and task kinds do not support approve
    return { ok: false, alreadyApplied: false, notApplicable: true };
  },

  /**
   * Reject a review_item or approval-kind inbox item.
   * Reason is persisted for approval kind (actions.rejectionComment).
   * For review_item: review_items has no reviewerComment column — reason is
   * captured in the audit log only (silent drop from DB).
   * Idempotent: 0 rows updated → alreadyApplied=true.
   */
  async rejectItem(
    orgId: string,
    userId: string,
    ref: BandedInboxItemRef,
    reason?: string
  ): Promise<InboxActionResult & { notApplicable?: boolean }> {
    if (ref.kind === 'review_item') {
      // review_items has no reviewerComment column — reason dropped silently from DB
      const updated = await getOrgScopedDb('inboxService.rejectItem')
        .update(reviewItems)
        .set({ reviewStatus: 'rejected', reviewedBy: userId, reviewedAt: new Date() })
        .where(and(
          eq(reviewItems.id, ref.entityId),
          eq(reviewItems.organisationId, orgId),
          or(
            eq(reviewItems.reviewStatus, 'pending'),
            eq(reviewItems.reviewStatus, 'edited_pending')
          )
        ))
        .returning({ id: reviewItems.id });

      const alreadyApplied = updated.length === 0;

      await auditService.log({
        actorId: userId,
        actorType: 'user',
        action: 'inbox.item.rejected',
        organisationId: orgId,
        entityType: 'review_item',
        entityId: ref.entityId,
        metadata: { alreadyApplied, reason: reason ?? null },
      });

      return { ok: true, alreadyApplied };
    }

    if (ref.kind === 'approval') {
      const updated = await getOrgScopedDb('inboxService.rejectItem')
        .update(actions)
        .set({
          status: 'rejected',
          rejectionComment: reason ?? null,
        })
        .where(and(
          eq(actions.id, ref.entityId),
          eq(actions.organisationId, orgId),
          eq(actions.status, 'pending_approval')
        ))
        .returning({ id: actions.id });

      const alreadyApplied = updated.length === 0;

      await auditService.log({
        actorId: userId,
        actorType: 'user',
        action: 'inbox.item.rejected',
        organisationId: orgId,
        entityType: 'action',
        entityId: ref.entityId,
        metadata: { alreadyApplied, reason: reason ?? null },
      });

      return { ok: true, alreadyApplied };
    }

    // agent_run and task kinds do not support reject
    return { ok: false, alreadyApplied: false, notApplicable: true };
  },

  /**
   * Archive a single inbox item by entityId.
   * Idempotent: returns alreadyApplied=true when the item is already archived in
   * inbox_read_states. Delegates to the existing bulk archiveItems otherwise.
   *
   * kindToEntityType mapping:
   *   task        → 'task'      (entityId = tasks.id)
   *   review_item → 'review_item' (entityId = review_items.id)
   *   agent_run   → 'agent_run'  (entityId = agent_runs.id)
   *   approval    → NOT YET SUPPORTED — see guard below
   *
   * IMPORTANT: the caller's entityId MUST match the entityId that getUnifiedInbox
   * uses for that kind when writing inbox_read_states rows. For approval-kind items
   * the listing side has not yet settled on a canonical entityId (actions.id vs
   * review_items.id), so archive is blocked until that is defined to prevent
   * silently archiving under the wrong key.
   */
  async archiveItem(
    userId: string,
    orgId: string,
    ref: BandedInboxItemRef
  ): Promise<InboxActionResult & { errorCode?: string }> {
    // approval-kind archive is not yet implemented: getUnifiedInbox does not emit
    // approval-kind items, so there is no canonical entityId for this kind in
    // inbox_read_states. Block it now rather than silently archive under the wrong key.
    if (ref.kind === 'approval') {
      throw { statusCode: 400, errorCode: 'inbox_action_not_implemented', message: 'Archive for approval-kind items is not yet supported' };
    }

    // Map kind → entityType for inboxReadStates
    const kindToEntityType: Record<Exclude<InboxKind, 'approval'>, EntityType> = {
      task: 'task',
      review_item: 'review_item',
      agent_run: 'agent_run',
    };
    const entityType = kindToEntityType[ref.kind as Exclude<InboxKind, 'approval'>];

    // Idempotency check: if the row already exists with isArchived=true, skip the upsert.
    const existing = await getOrgScopedDb('inboxService.archiveItem')
      .select({ isArchived: inboxReadStates.isArchived })
      .from(inboxReadStates)
      .where(and(
        eq(inboxReadStates.userId, userId),
        eq(inboxReadStates.entityType, entityType),
        eq(inboxReadStates.entityId, ref.entityId),
        eq(inboxReadStates.isArchived, true),
      ))
      .limit(1);

    if (existing.length > 0) {
      return { ok: true, alreadyApplied: true };
    }

    await inboxService.archiveItems(userId, orgId, [{ entityType, entityId: ref.entityId }]);
    return { ok: true, alreadyApplied: false };
  },

  /**
   * Unread counts per category for the current user and org.
   */
  async getCounts(userId: string, orgId: string, filters?: { subaccountId?: string; subaccountIds?: string[]; orgWide?: boolean }): Promise<InboxCounts> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Resolve allowed subaccount IDs (same logic as getUnifiedInbox)
    const countsScopedDb = getOrgScopedDb('inboxService.getCounts');
    let allowedSaIds: string[] | null = null;
    if (filters?.orgWide) {
      const saRows = await countsScopedDb.select({ id: subaccounts.id }).from(subaccounts)
        .where(and(eq(subaccounts.organisationId, orgId), eq(subaccounts.includeInOrgInbox, true), isNull(subaccounts.deletedAt)));
      allowedSaIds = saRows.map(r => r.id);
      if (allowedSaIds.length === 0) return { tasks: 0, reviews: 0, failedRuns: 0, total: 0 };
    } else if (filters?.subaccountIds && filters.subaccountIds.length > 0) {
      const saRows = await countsScopedDb.select({ id: subaccounts.id }).from(subaccounts)
        .where(and(eq(subaccounts.organisationId, orgId), inArray(subaccounts.id, filters.subaccountIds), isNull(subaccounts.deletedAt)));
      allowedSaIds = saRows.map(r => r.id);
      if (allowedSaIds.length === 0) return { tasks: 0, reviews: 0, failedRuns: 0, total: 0 };
    } else if (filters?.subaccountId) {
      allowedSaIds = [filters.subaccountId];
    }

    const saFilterTask = allowedSaIds ? inArray(tasks.subaccountId, allowedSaIds) : undefined;
    const saFilterReview = allowedSaIds ? inArray(reviewItems.subaccountId, allowedSaIds) : undefined;
    const saFilterRun = allowedSaIds ? inArray(agentRuns.subaccountId, allowedSaIds) : undefined;

    const [taskCount, reviewCount, runCount] = await Promise.all([
      countsScopedDb.select({ count: sql<number>`count(*)::int` }).from(tasks)
        .leftJoin(inboxReadStates, and(eq(inboxReadStates.entityType, 'task'), eq(inboxReadStates.entityId, tasks.id), eq(inboxReadStates.userId, userId)))
        .where(and(
          eq(tasks.organisationId, orgId), eq(tasks.status, 'inbox'), isNull(tasks.deletedAt),
          or(isNull(inboxReadStates.isRead), eq(inboxReadStates.isRead, false)),
          or(isNull(inboxReadStates.isArchived), eq(inboxReadStates.isArchived, false)),
          ...(saFilterTask ? [saFilterTask] : []),
        )),

      countsScopedDb.select({ count: sql<number>`count(*)::int` }).from(reviewItems)
        .leftJoin(inboxReadStates, and(eq(inboxReadStates.entityType, 'review_item'), eq(inboxReadStates.entityId, reviewItems.id), eq(inboxReadStates.userId, userId)))
        .where(and(
          eq(reviewItems.organisationId, orgId),
          or(eq(reviewItems.reviewStatus, 'pending'), eq(reviewItems.reviewStatus, 'edited_pending')),
          or(isNull(inboxReadStates.isRead), eq(inboxReadStates.isRead, false)),
          or(isNull(inboxReadStates.isArchived), eq(inboxReadStates.isArchived, false)),
          ...(saFilterReview ? [saFilterReview] : []),
        )),

      countsScopedDb.select({ count: sql<number>`count(*)::int` }).from(agentRuns)
        .leftJoin(inboxReadStates, and(eq(inboxReadStates.entityType, 'agent_run'), eq(inboxReadStates.entityId, agentRuns.id), eq(inboxReadStates.userId, userId)))
        .where(and(
          eq(agentRuns.organisationId, orgId),
          or(eq(agentRuns.status, 'failed'), eq(agentRuns.status, 'timeout'), eq(agentRuns.status, 'budget_exceeded')),
          gte(agentRuns.createdAt, sevenDaysAgo),
          or(isNull(inboxReadStates.isRead), eq(inboxReadStates.isRead, false)),
          or(isNull(inboxReadStates.isArchived), eq(inboxReadStates.isArchived, false)),
          ...(saFilterRun ? [saFilterRun] : []),
        )),
    ]);

    const t = taskCount[0]?.count ?? 0;
    const r = reviewCount[0]?.count ?? 0;
    const f = runCount[0]?.count ?? 0;

    return { tasks: t, reviews: r, failedRuns: f, total: t + r + f };
  },
};

// ---------------------------------------------------------------------------
// Runtime check fail inbox notification
// ---------------------------------------------------------------------------
//
// Creates a task with status='inbox' so org/subaccount reviewers see an
// actionable notification when an external-blast-radius skill check fails or
// is inconclusive. This is fire-and-forget from runtimeCheckService — errors
// here must never propagate to the caller.

export async function createRuntimeCheckFailItem(input: {
  runId: string;
  skillSlug: string;
  sequenceNumber: number;
  state: 'fail' | 'inconclusive';
  reasonText: string;
  reasonCode: string;
  organisationId: string;
  subaccountId: string | null;
}): Promise<void> {
  const stateLabel = input.state === 'fail' ? 'Failed' : 'Inconclusive';
  await getOrgScopedDb('inboxService.createRuntimeCheckFailItem').insert(tasks).values({
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    title: `Runtime check ${stateLabel.toLowerCase()}: ${input.skillSlug} (step ${input.sequenceNumber})`,
    description: `A runtime check for skill "${input.skillSlug}" at step ${input.sequenceNumber} returned ${input.state}.\n\nReason: ${input.reasonText}\n\nRun ID: ${input.runId}\nCode: ${input.reasonCode}`,
    status: 'inbox',
    priority: input.state === 'fail' ? 'high' : 'normal',
    position: 0,
  });
}
