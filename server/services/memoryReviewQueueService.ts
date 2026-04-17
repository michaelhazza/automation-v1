/**
 * memoryReviewQueueService — HITL queue read + resolve
 *
 * Owns reads and resolutions for the `memory_review_queue` table. Writes come
 * from the producers: beliefConflictService (conflicts), clarificationService
 * (clarifications), and memoryBlockSynthesisService (block proposals).
 *
 * Approve semantics by itemType:
 *   - belief_conflict     — resolves by superseding the chosen belief
 *   - block_proposal      — activates the proposed block (status='active')
 *   - clarification_pending — returns 400; clarifications resolve via
 *                             the dedicated `clarificationService.resolveClarification`
 *                             path, not this route.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.3 (S7)
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  memoryReviewQueue,
  agentBeliefs,
  memoryBlocks,
} from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewQueueFilters {
  status?: 'pending' | 'approved' | 'rejected' | 'auto_applied' | 'expired';
  itemType?: 'belief_conflict' | 'block_proposal' | 'clarification_pending';
  limit?: number;
  offset?: number;
}

export interface ReviewQueueItem {
  id: string;
  subaccountId: string;
  itemType: string;
  payload: Record<string, unknown>;
  confidence: number;
  status: string;
  createdAt: Date;
  expiresAt: Date | null;
  createdByAgentId: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listQueue(
  subaccountId: string,
  organisationId: string,
  filters: ReviewQueueFilters = {},
): Promise<ReviewQueueItem[]> {
  const conditions = [
    eq(memoryReviewQueue.subaccountId, subaccountId),
    eq(memoryReviewQueue.organisationId, organisationId),
  ];
  if (filters.status) conditions.push(eq(memoryReviewQueue.status, filters.status));
  if (filters.itemType) conditions.push(eq(memoryReviewQueue.itemType, filters.itemType));

  const rows = await db
    .select()
    .from(memoryReviewQueue)
    .where(and(...conditions))
    .orderBy(desc(memoryReviewQueue.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  return rows.map((r) => ({
    id: r.id,
    subaccountId: r.subaccountId,
    itemType: r.itemType,
    payload: (r.payload as Record<string, unknown>) ?? {},
    confidence: r.confidence ?? 0,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt ?? null,
    createdByAgentId: r.createdByAgentId ?? null,
    resolvedAt: r.resolvedAt ?? null,
    resolvedByUserId: r.resolvedByUserId ?? null,
  }));
}

export async function orgRollupCounts(
  organisationId: string,
): Promise<Record<string, Record<string, number>>> {
  const rows = (await db.execute(sql`
    SELECT subaccount_id, item_type, COUNT(*)::int AS count
    FROM memory_review_queue
    WHERE organisation_id = ${organisationId}
      AND status = 'pending'
    GROUP BY subaccount_id, item_type
  `)) as unknown as Array<{ subaccount_id: string; item_type: string; count: number }> | {
    rows?: Array<{ subaccount_id: string; item_type: string; count: number }>;
  };

  const list = Array.isArray(rows) ? rows : rows.rows ?? [];
  const out: Record<string, Record<string, number>> = {};
  for (const row of list) {
    if (!out[row.subaccount_id]) out[row.subaccount_id] = {};
    out[row.subaccount_id][row.item_type] = Number(row.count);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Approve / reject
// ---------------------------------------------------------------------------

export interface ResolveInput {
  itemId: string;
  organisationId: string;
  resolvedByUserId: string;
  /** Which side to accept for belief conflicts. 'new' supersedes the existing belief. */
  acceptSide?: 'new' | 'existing';
}

export async function approveItem(input: ResolveInput): Promise<ReviewQueueItem> {
  const [row] = await db
    .select()
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.id, input.itemId),
        eq(memoryReviewQueue.organisationId, input.organisationId),
      ),
    )
    .limit(1);

  if (!row) throw { statusCode: 404, message: 'Queue item not found' };
  if (row.status !== 'pending') {
    throw { statusCode: 409, message: `Item already ${row.status}` };
  }
  if (row.itemType === 'clarification_pending') {
    throw {
      statusCode: 400,
      message: 'Use POST /api/clarifications/:id/respond to resolve clarifications',
      errorCode: 'NOT_RESOLVABLE_HERE',
    };
  }

  const now = new Date();
  const payload = (row.payload as Record<string, unknown>) ?? {};

  if (row.itemType === 'belief_conflict') {
    const side: 'new' | 'existing' = input.acceptSide ?? 'new';
    const keeperId = side === 'new' ? payload.newBeliefId : payload.existingBeliefId;
    const loserId = side === 'new' ? payload.existingBeliefId : payload.newBeliefId;
    if (typeof keeperId !== 'string' || typeof loserId !== 'string') {
      throw { statusCode: 400, message: 'Conflict payload missing belief IDs' };
    }
    await db
      .update(agentBeliefs)
      .set({ supersededBy: keeperId, supersededAt: now, updatedAt: now })
      .where(eq(agentBeliefs.id, loserId));

    logger.info('memoryReviewQueue.belief_conflict_resolved', {
      itemId: row.id,
      keeperId,
      loserId,
      resolvedByUserId: input.resolvedByUserId,
    });
  } else if (row.itemType === 'block_proposal') {
    const blockId = payload.blockId;
    if (typeof blockId !== 'string') {
      throw { statusCode: 400, message: 'block_proposal payload missing blockId' };
    }
    await db
      .update(memoryBlocks)
      .set({ status: 'active', updatedAt: now })
      .where(eq(memoryBlocks.id, blockId));

    logger.info('memoryReviewQueue.block_proposal_activated', {
      itemId: row.id,
      blockId,
      resolvedByUserId: input.resolvedByUserId,
    });
  }

  const [updated] = await db
    .update(memoryReviewQueue)
    .set({
      status: 'approved',
      resolvedAt: now,
      resolvedByUserId: input.resolvedByUserId,
      payload: {
        ...payload,
        acceptSide: input.acceptSide ?? null,
        resolvedAt: now.toISOString(),
      },
    })
    .where(eq(memoryReviewQueue.id, input.itemId))
    .returning();

  return rowToItem(updated);
}

export async function rejectItem(input: ResolveInput): Promise<ReviewQueueItem> {
  const [row] = await db
    .select()
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.id, input.itemId),
        eq(memoryReviewQueue.organisationId, input.organisationId),
      ),
    )
    .limit(1);

  if (!row) throw { statusCode: 404, message: 'Queue item not found' };
  if (row.status !== 'pending') {
    throw { statusCode: 409, message: `Item already ${row.status}` };
  }
  if (row.itemType === 'clarification_pending') {
    throw {
      statusCode: 400,
      message: 'Use POST /api/clarifications/:id/respond to resolve clarifications',
      errorCode: 'NOT_RESOLVABLE_HERE',
    };
  }

  const now = new Date();
  const payload = (row.payload as Record<string, unknown>) ?? {};

  // For block_proposal rejections, mark the block as rejected so it's never injected
  if (row.itemType === 'block_proposal' && typeof payload.blockId === 'string') {
    await db
      .update(memoryBlocks)
      .set({ status: 'rejected', updatedAt: now })
      .where(eq(memoryBlocks.id, payload.blockId as string));
  }

  const [updated] = await db
    .update(memoryReviewQueue)
    .set({
      status: 'rejected',
      resolvedAt: now,
      resolvedByUserId: input.resolvedByUserId,
      payload: {
        ...payload,
        resolvedAt: now.toISOString(),
      },
    })
    .where(eq(memoryReviewQueue.id, input.itemId))
    .returning();

  logger.info('memoryReviewQueue.rejected', {
    itemId: row.id,
    itemType: row.itemType,
    resolvedByUserId: input.resolvedByUserId,
  });

  return rowToItem(updated);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function rowToItem(row: typeof memoryReviewQueue.$inferSelect): ReviewQueueItem {
  return {
    id: row.id,
    subaccountId: row.subaccountId,
    itemType: row.itemType,
    payload: (row.payload as Record<string, unknown>) ?? {},
    confidence: row.confidence ?? 0,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt ?? null,
    createdByAgentId: row.createdByAgentId ?? null,
    resolvedAt: row.resolvedAt ?? null,
    resolvedByUserId: row.resolvedByUserId ?? null,
  };
}
