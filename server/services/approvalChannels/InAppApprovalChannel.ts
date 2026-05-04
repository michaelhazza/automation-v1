// ---------------------------------------------------------------------------
// InAppApprovalChannel — in-app review-queue channel adapter
//
// Delivers approval requests to the existing review queue via reviewService.
// v1's only conformant ApprovalChannel implementation.
// Future channel adapters add one file in this directory; no changes to
// approvalChannelService.ts are required (open/closed per spec §13.3).
//
// Spec: tasks/builds/agentic-commerce/spec.md §13.3
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 9
// ---------------------------------------------------------------------------

import { db } from '../../db/index.js';
import { actions, reviewItems } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { reviewService } from '../reviewService.js';
import { actionService } from '../actionService.js';
import { logger } from '../../lib/logger.js';
import type {
  ApprovalChannel,
  ApprovalRequest,
  ApprovalResponse,
  ApprovalResolution,
} from '../../../shared/types/approvalChannel.js';

export class InAppApprovalChannel implements ApprovalChannel {
  readonly channelType = 'in_app';

  /**
   * Deliver an approval request to the in-app review queue.
   *
   * The actions row already exists (created by chargeRouterService.proposeCharge).
   * This method ensures the review_items row is materialised so operators see the
   * pending spend approval in the review queue.
   */
  async sendApprovalRequest(req: ApprovalRequest): Promise<void> {
    // Fetch the action row so reviewService.createReviewItem has the full Action shape.
    const actionRow = await actionService.getAction(req.actionId, req.organisationId);

    await reviewService.createReviewItem(actionRow, {
      actionType: 'spend_approval',
      reasoning: `Spend approval required: ${req.payload.amountMinor} ${req.payload.currency} at ${req.payload.merchant.descriptor}`,
      proposedPayload: {
        chargeId: req.chargeId,
        spendingBudgetId: req.spendingBudgetId,
        merchant: req.payload.merchant,
        amountMinor: req.payload.amountMinor,
        currency: req.payload.currency,
        intent: req.payload.intent,
        sptLast4: req.payload.sptLast4,
        approvers: req.approvers,
        expiresAt: req.expiresAt.toISOString(),
      },
    });
  }

  /**
   * Parse an in-app POST body into a typed ApprovalResponse.
   * Returns null if the raw payload does not conform.
   */
  receiveResponse(raw: unknown): ApprovalResponse | null {
    if (typeof raw !== 'object' || raw === null) return null;

    const r = raw as Record<string, unknown>;

    if (
      typeof r['actionId'] !== 'string' ||
      (r['decision'] !== 'approved' && r['decision'] !== 'denied') ||
      typeof r['responderId'] !== 'string'
    ) {
      return null;
    }

    return {
      actionId: r['actionId'],
      decision: r['decision'] as 'approved' | 'denied',
      responderId: r['responderId'],
      respondedAt: r['respondedAt'] instanceof Date
        ? r['respondedAt']
        : new Date(typeof r['respondedAt'] === 'string' ? r['respondedAt'] : Date.now()),
      channelType: this.channelType,
    };
  }

  /**
   * Write a "resolved by …" notice on the review item.
   * No-op if the item is already resolved (idempotent).
   */
  async sendResolutionNotice(resolution: ApprovalResolution): Promise<void> {
    const { actionId, resolvedBy, decision } = resolution;

    // Find the review item linked to this action.
    const [reviewItem] = await db
      .select({ id: reviewItems.id, reviewStatus: reviewItems.reviewStatus })
      .from(reviewItems)
      .innerJoin(actions, eq(actions.id, reviewItems.actionId))
      .where(
        and(
          eq(actions.id, actionId),
          eq(reviewItems.reviewStatus, 'pending'),
        ),
      )
      .limit(1);

    if (!reviewItem) {
      // Already resolved or not found — no-op.
      logger.info('InAppApprovalChannel.sendResolutionNotice_noop', {
        actionId,
        reason: 'no_pending_review_item',
      });
      return;
    }

    // Mark the review item with resolution metadata so the UI can display it.
    const resolutionNote = `Resolved ${decision} by user ${resolvedBy.userId} via ${resolvedBy.channelType} at ${resolvedBy.respondedAt.toISOString()}`;

    await db
      .update(reviewItems)
      .set({
        reviewStatus: decision === 'approved' ? 'approved' : 'rejected',
        reviewedBy: resolvedBy.userId,
        reviewedAt: resolvedBy.respondedAt,
        // Store resolution note in humanEditJson so it surfaces in the audit trail.
        humanEditJson: { resolutionNote },
      })
      .where(eq(reviewItems.id, reviewItem.id));
  }
}
