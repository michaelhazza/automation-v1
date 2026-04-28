import { eq, and, or, desc, sql, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions, reviewItems, actionEvents, actionResumeEvents } from '../db/schema/index.js';
import { actionService } from './actionService.js';
import { executionLayerService } from './executionLayerService.js';
import { hitlService } from './hitlService.js';
import { auditService } from './auditService.js';
import { emitSubaccountUpdate, emitOrgUpdate } from '../websocket/emitters.js';
import type { Action } from '../db/schema/actions.js';
import { postReviewItemToSlack } from './slackConversationService.js';
import { checkIdempotency, type ReviewStatus } from './reviewServicePure.js';

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
        reviewPayloadJson: reviewPayload as unknown as Record<string, unknown>,
        createdAt: new Date(),
      })
      .returning();

    // Emit real-time update so the review queue badge increments
    if (action.subaccountId) {
      emitSubaccountUpdate(action.subaccountId, 'review:item_created', {
        reviewItemId: item.id, actionType: reviewPayload.actionType,
      });
    } else {
      emitOrgUpdate(action.organisationId, 'review:item_created', {
        reviewItemId: item.id, actionType: reviewPayload.actionType,
      });
    }

    // Home dashboard live-update — `action: 'new'` path from spec §5.1.
    // Emitted from the service (not a route) because review items are created
    // from many call sites (flowExecutor, skillExecutor, configUpdateOrganisationService,
    // clientPulseInterventionContextService) — emitting once here covers them all.
    emitOrgUpdate(action.organisationId, 'dashboard.approval.changed', {
      action: 'new',
      subaccountId: action.subaccountId ?? null,
    });

    // Feature 4 — optionally post to Slack if org has a review channel configured
    postReviewItemToSlack(item.id, action.organisationId).catch((err) => {
      console.warn('[ReviewService] Slack posting failed (non-blocking):', err instanceof Error ? err.message : err);
    });

    return item;
  },

  /**
   * Approve a review item. Optionally apply payload edits.
   * Uses SELECT FOR UPDATE to prevent concurrent approval.
   * Dispatches execution OUTSIDE the state transition.
   *
   * Idempotency (spec §6.2.1):
   *   - Item already approved/completed → return existing row, no side effects.
   *   - Item already rejected → throw 409 ITEM_CONFLICT.
   */
  async approveItem(
    reviewItemId: string,
    organisationId: string,
    userId: string,
    edits?: Record<string, unknown>
  ) {
    // ── Idempotency pre-check (outside the write transaction) ────────────────
    // Read the current status first. If the item is already in a terminal
    // state, resolve without entering the write path so no audit row,
    // no resume event, and no pgBoss job are emitted.
    const [preCheck] = await db
      .select({ id: reviewItems.id, reviewStatus: reviewItems.reviewStatus, actionId: reviewItems.actionId })
      .from(reviewItems)
      .where(and(eq(reviewItems.id, reviewItemId), eq(reviewItems.organisationId, organisationId)));

    const idempotencyOutcome = checkIdempotency(
      // Drizzle schema and ReviewStatus union are identical; cast is a TS narrowing assist
      preCheck?.reviewStatus as ReviewStatus | undefined,
      'approve',
    );

    if (idempotencyOutcome === 'not_found') {
      throw Object.assign(new Error('Review item not found'), { statusCode: 404 });
    }

    if (idempotencyOutcome === 'idempotent') {
      // Already approved (or completed after execution). Return the current row
      // as-is — no audit, no workflow resume, no socket emit.
      return { actionId: preCheck.actionId, wasIdempotent: true as const };
    }

    if (idempotencyOutcome === 'conflict') {
      throw Object.assign(
        new Error('Item was already processed with a different outcome'),
        { statusCode: 409, errorCode: 'ITEM_CONFLICT' },
      );
    }

    // idempotencyOutcome === 'proceed' — run the normal write path.

    const pendingGuard = and(
      eq(reviewItems.id, reviewItemId),
      eq(reviewItems.organisationId, organisationId),
      or(
        eq(reviewItems.reviewStatus, 'pending'),
        eq(reviewItems.reviewStatus, 'edited_pending'),
      ),
    );

    const item = await db.transaction(async (tx) => {
      const setFields: Record<string, unknown> = {
        reviewStatus: 'approved',
        reviewedBy: userId,
        reviewedAt: new Date(),
      };
      if (edits) setFields.humanEditJson = edits;

      const [updated] = await tx.update(reviewItems)
        .set(setFields)
        .where(pendingGuard)
        .returning();

      if (!updated) {
        // Another process may have raced us — re-check and apply idempotency.
        const [raceCheck] = await tx
          .select({ id: reviewItems.id, reviewStatus: reviewItems.reviewStatus, actionId: reviewItems.actionId })
          .from(reviewItems)
          .where(and(eq(reviewItems.id, reviewItemId), eq(reviewItems.organisationId, organisationId)));

        if (!raceCheck) {
          throw Object.assign(new Error('Review item not found'), { statusCode: 404 });
        }

        const raceOutcome = checkIdempotency(
          // Drizzle schema and ReviewStatus union are identical; cast is a TS narrowing assist
          raceCheck.reviewStatus as ReviewStatus,
          'approve',
        );

        if (raceOutcome === 'idempotent') {
          // Concurrent approve won the race — treat as idempotent.
          return { kind: 'idempotent_race' as const, row: raceCheck };
        }

        throw Object.assign(
          new Error('Item was already processed with a different outcome'),
          { statusCode: 409, errorCode: 'ITEM_CONFLICT' },
        );
      }

      if (edits) {
        const action = await actionService.getAction(updated.actionId, organisationId);
        const currentPayload = action.payloadJson as Record<string, unknown>;
        const mergedPayload = { ...currentPayload, ...edits };

        await tx.update(actions).set({
          payloadJson: mergedPayload,
          updatedAt: new Date(),
        }).where(eq(actions.id, updated.actionId));
      }

      // Test seam: allow integration tests to inject a pause so concurrent
      // callers can enter the race window before this transaction commits.
      if (__testHooks.delayBetweenClaimAndCommit) {
        await __testHooks.delayBetweenClaimAndCommit();
      }

      return { kind: 'updated' as const, row: updated };
    });

    // If the race produced an idempotent result, short-circuit here too.
    if (item.kind === 'idempotent_race') {
      return { actionId: item.row.actionId, wasIdempotent: true as const };
    }

    // item.kind === 'updated' from here onward
    const updatedRow = item.row;

    if (edits) {
      await actionService.emitEvent(updatedRow.actionId, organisationId, 'edited_and_approved', userId);
    }

    // Transition action to approved
    await actionService.transitionState(updatedRow.actionId, organisationId, 'approved', userId);

    auditService.log({
      organisationId,
      actorId: userId,
      actorType: 'user',
      action: 'agent_approved',
      entityType: 'review_item',
      entityId: reviewItemId,
      metadata: { actionId: updatedRow.actionId, edited: !!edits },
    });

    // Dispatch execution outside the approval transaction
    let execResult;
    // ─── Workflow action_call HITL resumption branch (spec §4.7) ──────────
    // When the action was proposed by a Workflow's action_call step, route
    // execution through the Workflow resumption path instead of the default
    // adapter-based executionLayerService. The resumption path invokes the
    // raw config_* skill handler (bypassing a duplicate audit row), marks
    // the action completed / failed on the same row, and resumes the
    // Workflow step run via the engine.
    const actionForBranch = await actionService.getAction(updatedRow.actionId, organisationId);
    const branchMeta = (actionForBranch.metadataJson ?? null) as Record<string, unknown> | null;
    const isWorkflowActionCall = branchMeta?.source === 'workflow_action_call';
    try {
      if (isWorkflowActionCall) {
        const { resumeActionCallAfterApproval } = await import('./workflowActionCallExecutor.js');
        const resumed = await resumeActionCallAfterApproval({
          action: actionForBranch,
          approverUserId: userId,
        });
        execResult = resumed ?? null;
        await db.update(reviewItems).set({ reviewStatus: 'completed' }).where(eq(reviewItems.id, reviewItemId));
      } else {
        execResult = await executionLayerService.executeAction(updatedRow.actionId, organisationId);
        // Mark review item as completed after successful execution
        await db.update(reviewItems).set({ reviewStatus: 'completed' }).where(eq(reviewItems.id, reviewItemId));
      }
    } catch (err) {
      // Execution failure is recorded on the action — review item stays approved
      console.error(`[ReviewService] Execution failed for action ${updatedRow.actionId}:`, err);
    }

    // Write durable resume event
    const action = await actionService.getAction(updatedRow.actionId, organisationId);
    await db.insert(actionResumeEvents).values({
      actionId: updatedRow.actionId,
      organisationId,
      subaccountId: action.subaccountId!,
      eventType: edits ? 'edited' : 'approved',
      resolvedBy: userId,
      payload: { result: execResult, edits: edits ?? null },
      createdAt: new Date(),
    });

    // Unblock the agent's awaiting promise (if still in-process)
    hitlService.resolveDecision(updatedRow.actionId, {
      approved: true,
      result: execResult,
      editedArgs: edits,
    });

    return { actionId: updatedRow.actionId, wasIdempotent: false as const };
  },

  /**
   * Reject a review item. A comment is required — no silent rejections.
   *
   * Idempotency (spec §6.2.1):
   *   - Item already rejected → return existing row, no side effects.
   *   - Item already approved/completed → throw 409 ITEM_CONFLICT.
   */
  async rejectItem(
    reviewItemId: string,
    organisationId: string,
    userId: string,
    comment?: string,
  ) {
    const rejectionComment = comment?.trim() || 'No reason provided';

    // ── Idempotency pre-check (outside the write transaction) ────────────────
    const [preCheck] = await db
      .select({ id: reviewItems.id, reviewStatus: reviewItems.reviewStatus, actionId: reviewItems.actionId })
      .from(reviewItems)
      .where(and(eq(reviewItems.id, reviewItemId), eq(reviewItems.organisationId, organisationId)));

    const idempotencyOutcome = checkIdempotency(
      // Drizzle schema and ReviewStatus union are identical; cast is a TS narrowing assist
      preCheck?.reviewStatus as ReviewStatus | undefined,
      'reject',
    );

    if (idempotencyOutcome === 'not_found') {
      throw Object.assign(new Error('Review item not found'), { statusCode: 404 });
    }

    if (idempotencyOutcome === 'idempotent') {
      // Already rejected. Return the current row as-is — no audit, no
      // regression-capture enqueue, no socket emit.
      return { actionId: preCheck.actionId, wasIdempotent: true as const };
    }

    if (idempotencyOutcome === 'conflict') {
      throw Object.assign(
        new Error('Item was already processed with a different outcome'),
        { statusCode: 409, errorCode: 'ITEM_CONFLICT' },
      );
    }

    // idempotencyOutcome === 'proceed' — run the normal write path.

    const pendingGuard = and(
      eq(reviewItems.id, reviewItemId),
      eq(reviewItems.organisationId, organisationId),
      or(
        eq(reviewItems.reviewStatus, 'pending'),
        eq(reviewItems.reviewStatus, 'edited_pending'),
      ),
    );

    const item = await db.transaction(async (tx) => {
      const [updated] = await tx.update(reviewItems).set({
        reviewStatus: 'rejected',
        reviewedBy: userId,
        reviewedAt: new Date(),
      }).where(pendingGuard).returning();

      if (!updated) {
        // Another process may have raced us — re-check and apply idempotency.
        const [raceCheck] = await tx
          .select({ id: reviewItems.id, reviewStatus: reviewItems.reviewStatus, actionId: reviewItems.actionId })
          .from(reviewItems)
          .where(and(eq(reviewItems.id, reviewItemId), eq(reviewItems.organisationId, organisationId)));

        if (!raceCheck) {
          throw Object.assign(new Error('Review item not found'), { statusCode: 404 });
        }

        const raceOutcome = checkIdempotency(
          // Drizzle schema and ReviewStatus union are identical; cast is a TS narrowing assist
          raceCheck.reviewStatus as ReviewStatus,
          'reject',
        );

        if (raceOutcome === 'idempotent') {
          return { kind: 'idempotent_race' as const, row: raceCheck };
        }

        throw Object.assign(
          new Error('Item was already processed with a different outcome'),
          { statusCode: 409, errorCode: 'ITEM_CONFLICT' },
        );
      }

      await tx.update(actions).set({
        rejectionComment,
        updatedAt: new Date(),
      }).where(eq(actions.id, updated.actionId));

      // Test seam: allow integration tests to inject a pause so concurrent
      // callers can enter the race window before this transaction commits.
      if (__testHooks.delayBetweenClaimAndCommit) {
        await __testHooks.delayBetweenClaimAndCommit();
      }

      return { kind: 'updated' as const, row: updated };
    });

    // If the race produced an idempotent result, short-circuit here too.
    if (item.kind === 'idempotent_race') {
      return { actionId: item.row.actionId, wasIdempotent: true as const };
    }

    // item.kind === 'updated' from here onward
    const updatedRow = item.row;

    await actionService.transitionState(updatedRow.actionId, organisationId, 'rejected', userId);

    auditService.log({
      organisationId,
      actorId: userId,
      actorType: 'user',
      action: 'agent_rejected',
      entityType: 'review_item',
      entityId: reviewItemId,
      metadata: { actionId: updatedRow.actionId, comment: rejectionComment },
    });

    // Write durable resume event
    const action = await actionService.getAction(updatedRow.actionId, organisationId);
    await db.insert(actionResumeEvents).values({
      actionId: updatedRow.actionId,
      organisationId,
      subaccountId: action.subaccountId!,
      eventType: 'rejected',
      resolvedBy: userId,
      payload: { comment: rejectionComment },
      createdAt: new Date(),
    });

    // Unblock the agent's awaiting promise with the denial
    hitlService.resolveDecision(updatedRow.actionId, {
      approved: false,
      comment: rejectionComment,
    });

    // Sprint 2 P1.2 — enqueue a regression capture. Best-effort:
    // failures are logged by queueService, never surfaced to the
    // user's rejection flow.
    const { queueService } = await import('./queueService.js');
    queueService
      .enqueueRegressionCapture({ reviewItemId, organisationId })
      .catch(() => {
        /* queueService already logs */
      });

    return { actionId: updatedRow.actionId, wasIdempotent: false as const };
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
   * Get org-level review queue (items where subaccountId IS NULL).
   */
  async getOrgReviewQueue(organisationId: string) {
    return db
      .select()
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.organisationId, organisationId),
          isNull(reviewItems.subaccountId),
          sql`${reviewItems.reviewStatus} IN ('pending', 'edited_pending')`
        )
      )
      .orderBy(reviewItems.createdAt)
      .limit(100);
  },

  /**
   * Org-level review queue count.
   */
  async getOrgReviewQueueCount(organisationId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.organisationId, organisationId),
          isNull(reviewItems.subaccountId),
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

// ── Test seam ──────────────────────────────────────────────────────────────
// Allows integration tests to inject a pause between the claim UPDATE and the
// transaction COMMIT so the race window is opened deterministically. Production
// behaviour is unchanged when this hook is unset (production-safety contract).
export const __testHooks: {
  delayBetweenClaimAndCommit?: () => Promise<void>;
} = { delayBetweenClaimAndCommit: undefined };
