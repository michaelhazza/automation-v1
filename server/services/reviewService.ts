import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions, reviewItems, actionEvents } from '../db/schema/index.js';
import { actionService } from './actionService.js';
import { executionLayerService } from './executionLayerService.js';
import type { Action } from '../db/schema/actions.js';

// ---------------------------------------------------------------------------
// Review Service — manages human review queue for gated actions
// ---------------------------------------------------------------------------

export interface ReviewPayload {
  actionType: string;
  agentName?: string;
  runTimestamp?: string;
  reasoning?: string;
  originalContext?: Record<string, unknown>;
  proposedPayload: Record<string, unknown>;
}

export interface BulkResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

export const reviewService = {
  /**
   * Create a review item when an action transitions to pending_approval.
   */
  async createReviewItem(action: Action, reviewPayload: ReviewPayload) {
    const [item] = await db
      .insert(reviewItems)
      .values({
        organisationId: action.organisationId,
        subaccountId: action.subaccountId,
        actionId: action.id,
        agentRunId: action.agentRunId,
        reviewStatus: 'pending',
        reviewPayloadJson: reviewPayload as Record<string, unknown>,
        createdAt: new Date(),
      })
      .returning();

    return item;
  },

  /**
   * Approve a review item. Optionally apply payload edits.
   * Uses SELECT FOR UPDATE to prevent concurrent approval.
   * Dispatches execution OUTSIDE the state transition.
   */
  async approveItem(
    reviewItemId: string,
    organisationId: string,
    userId: string,
    edits?: Record<string, unknown>
  ) {
    // Transaction: lock review item and action, apply approval
    const [item] = await db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.id, reviewItemId), eq(reviewItems.organisationId, organisationId)));

    if (!item) {
      throw Object.assign(new Error('Review item not found'), { statusCode: 404 });
    }

    if (item.reviewStatus !== 'pending' && item.reviewStatus !== 'edited_pending') {
      throw Object.assign(new Error(`Review item already resolved: ${item.reviewStatus}`), { statusCode: 409 });
    }

    // Apply edits to action payload if provided
    if (edits) {
      const action = await actionService.getAction(item.actionId, organisationId);
      const currentPayload = action.payloadJson as Record<string, unknown>;
      const mergedPayload = { ...currentPayload, ...edits };

      await db.update(actions).set({
        payloadJson: mergedPayload,
        updatedAt: new Date(),
      }).where(eq(actions.id, item.actionId));

      await db.update(reviewItems).set({
        humanEditJson: edits,
        reviewStatus: 'approved',
        reviewedBy: userId,
        reviewedAt: new Date(),
      }).where(eq(reviewItems.id, reviewItemId));

      await actionService.emitEvent(item.actionId, organisationId, 'edited_and_approved', userId);
    } else {
      await db.update(reviewItems).set({
        reviewStatus: 'approved',
        reviewedBy: userId,
        reviewedAt: new Date(),
      }).where(eq(reviewItems.id, reviewItemId));
    }

    // Transition action to approved
    await actionService.transitionState(item.actionId, organisationId, 'approved', userId);

    // Dispatch execution outside the approval transaction
    try {
      await executionLayerService.executeAction(item.actionId, organisationId);
      // Mark review item as completed after successful execution
      await db.update(reviewItems).set({ reviewStatus: 'completed' }).where(eq(reviewItems.id, reviewItemId));
    } catch (err) {
      // Execution failure is recorded on the action — review item stays approved
      console.error(`[ReviewService] Execution failed for action ${item.actionId}:`, err);
    }

    return { actionId: item.actionId };
  },

  /**
   * Reject a review item.
   */
  async rejectItem(reviewItemId: string, organisationId: string, userId: string) {
    const [item] = await db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.id, reviewItemId), eq(reviewItems.organisationId, organisationId)));

    if (!item) {
      throw Object.assign(new Error('Review item not found'), { statusCode: 404 });
    }

    if (item.reviewStatus !== 'pending' && item.reviewStatus !== 'edited_pending') {
      throw Object.assign(new Error(`Review item already resolved: ${item.reviewStatus}`), { statusCode: 409 });
    }

    await db.update(reviewItems).set({
      reviewStatus: 'rejected',
      reviewedBy: userId,
      reviewedAt: new Date(),
    }).where(eq(reviewItems.id, reviewItemId));

    await actionService.transitionState(item.actionId, organisationId, 'rejected', userId);

    return { actionId: item.actionId };
  },

  /**
   * Bulk approve. Each item transacted individually — failure on one doesn't roll back others.
   */
  async bulkApprove(reviewItemIds: string[], organisationId: string, userId: string): Promise<BulkResult> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of reviewItemIds) {
      try {
        await this.approveItem(id, organisationId, userId);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { succeeded, failed };
  },

  /**
   * Bulk reject.
   */
  async bulkReject(reviewItemIds: string[], organisationId: string, userId: string): Promise<BulkResult> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of reviewItemIds) {
      try {
        await this.rejectItem(id, organisationId, userId);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { succeeded, failed };
  },

  /**
   * Get the review queue for a subaccount (pending items).
   */
  async getReviewQueue(organisationId: string, subaccountId: string) {
    return db
      .select()
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.organisationId, organisationId),
          eq(reviewItems.subaccountId, subaccountId),
          sql`${reviewItems.reviewStatus} IN ('pending', 'edited_pending')`
        )
      )
      .orderBy(reviewItems.createdAt)
      .limit(100);
  },

  /**
   * Lightweight count for nav badge.
   */
  async getReviewQueueCount(organisationId: string, subaccountId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.organisationId, organisationId),
          eq(reviewItems.subaccountId, subaccountId),
          sql`${reviewItems.reviewStatus} IN ('pending', 'edited_pending')`
        )
      );

    return result?.count ?? 0;
  },

  /**
   * Get a single review item by ID.
   */
  async getReviewItem(reviewItemId: string, organisationId: string) {
    const [item] = await db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.id, reviewItemId), eq(reviewItems.organisationId, organisationId)));

    if (!item) {
      throw Object.assign(new Error('Review item not found'), { statusCode: 404 });
    }

    // Also load the linked action for full context
    const action = await actionService.getAction(item.actionId, organisationId);

    return { ...item, action };
  },
};
