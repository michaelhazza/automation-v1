import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { reviewService } from '../services/reviewService.js';
import { reviewAuditService } from '../services/reviewAuditService.js';
import { actionService } from '../services/actionService.js';
import { queueService } from '../services/queueService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { emitSubaccountUpdate } from '../websocket/emitters.js';
import { getMajorThresholds } from '../services/pulseConfigService.js';
import { buildDraftFromAction, getRunTotalCostMinor, getRunTotalCostMinorBatch } from '../services/pulseService.js';
import { classify, buildAckText } from '../services/pulseLaneClassifier.js';
import type { PulseLane, MajorReason } from '../services/pulseLaneClassifier.js';

const router = Router();

// ─── Get review queue for a subaccount ────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/review-queue',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const items = await reviewService.getReviewQueue(req.orgId!, subaccount.id);
    res.json(items);
  })
);

// ─── Get review queue count (lightweight, for nav badge) ──────────────────────

router.get(
  '/api/subaccounts/:subaccountId/review-queue/count',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const count = await reviewService.getReviewQueueCount(req.orgId!, req.params.subaccountId);
    res.json({ count });
  })
);

// ─── Get org-level review queue ──────────────────────────────────────────────

router.get(
  '/api/org/review-queue',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const items = await reviewService.getOrgReviewQueue(req.orgId!);
    res.json(items);
  })
);

router.get(
  '/api/org/review-queue/count',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const count = await reviewService.getOrgReviewQueueCount(req.orgId!);
    res.json({ count });
  })
);

// ─── Get single review item ──────────────────────────────────────────────────

router.get(
  '/api/review-items/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const item = await reviewService.getReviewItem(req.params.id, req.orgId!);
    res.json(item);
  })
);

// ─── Approve a review item ───────────────────────────────────────────────────

router.post(
  '/api/review-items/:id/approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_APPROVE),
  asyncHandler(async (req, res) => {
    const { edits, comment, majorAcknowledgment } = req.body;

    const reviewItem = await reviewService.getReviewItem(req.params.id, req.orgId!);

    const isPending =
      reviewItem.reviewStatus === 'pending' || reviewItem.reviewStatus === 'edited_pending';

    const action = await actionService.getAction(reviewItem.actionId, req.orgId!);

    // Idempotency and conflict handling is fully owned by reviewService.
    // The service returns the existing row for idempotent replays (200) and
    // throws 409 ITEM_CONFLICT for cross-terminal conflicts.
    //
    // MAJOR_ACK_REQUIRED (412) only applies to pending items — idempotent
    // replays bypass this check because the service short-circuits before any
    // audit or side-effect code runs.
    let lane: PulseLane | undefined;
    let majorReason: MajorReason | undefined;
    let ackText: string | null = null;
    let ackAmountMinor: number | null = null;
    let majorCurrencyCode: string | undefined;

    if (isPending) {
      const thresholds = await getMajorThresholds(req.orgId!);
      const runTotal = action.agentRunId
        ? await getRunTotalCostMinor(action.agentRunId, req.orgId!)
        : null;
      const draft = buildDraftFromAction(action, runTotal);
      const classified = classify(draft, thresholds);
      lane = classified.lane;
      majorReason = classified.majorReason;

      if (lane === 'major') {
        const ack = buildAckText(draft, majorReason!, thresholds.currencyCode, thresholds);
        if (majorAcknowledgment !== true) {
          res.status(412).json({
            error: { code: 'MAJOR_ACK_REQUIRED', message: 'Major-lane approval requires acknowledgment' },
            lane,
            majorReason,
            ackText: ack.text,
            ackAmountMinor: ack.amountMinor,
            ackCurrencyCode: thresholds.currencyCode,
          });
          return;
        }
        ackText = ack.text;
        ackAmountMinor = ack.amountMinor;
        majorCurrencyCode = thresholds.currencyCode;
      }
    }

    const result = await reviewService.approveItem(req.params.id, req.orgId!, req.user!.id, edits);

    // Only record audit and enqueue workflow resume on a real (non-idempotent)
    // transition. Guard using isPending to avoid double-audit on idempotent
    // replays (where the service already returned without side effects).
    if (isPending) {
      reviewAuditService.record({
        actionId: action.id,
        organisationId: req.orgId!,
        subaccountId: action.subaccountId!,
        agentRunId: action.agentRunId,
        toolSlug: action.actionType,
        agentOutput: action.payloadJson as Record<string, unknown>,
        decidedBy: req.user!.id,
        decision: edits ? 'edited' : 'approved',
        rawFeedback: comment,
        editedArgs: edits,
        proposedAt: action.createdAt,
        majorAcknowledged: lane === 'major',
        majorReason: majorReason ?? undefined,
        ackText: ackText ?? undefined,
        ackAmountMinor: ackAmountMinor ?? undefined,
        ackCurrencyCode: lane === 'major' ? majorCurrencyCode : undefined,
      }).catch((err) => console.error('[ReviewItems] Audit record failed:', err));

      // If this action was created by a workflow step, enqueue a resume job
      const meta = action.metadataJson as Record<string, unknown> | null;
      const workflowRunId = meta?.workflowRunId as string | undefined;
      if (workflowRunId) {
        queueService.enqueueWorkflowResume({
          workflowRunId,
          approvedActionId: action.id,
          organisationId: req.orgId!,
          subaccountId: action.subaccountId!,
          agentId: action.agentId,
          agentRunId: action.agentRunId ?? undefined,
        }).catch((err) => console.error('[ReviewItems] Workflow resume enqueue failed:', err));
      }

      const subaccountId = action.subaccountId;
      if (subaccountId) emitSubaccountUpdate(subaccountId, 'review:item_updated', { action: 'approved' });
    }

    res.json({ ...result, lane });
  })
);

// ─── Reject a review item ───────────────────────────────────────────────────

router.post(
  '/api/review-items/:id/reject',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_APPROVE),
  asyncHandler(async (req, res) => {
    const { comment } = req.body;

    // Comment required on rejection — enforced here before hitting the service
    if (!comment || String(comment).trim().length === 0) {
      res.status(400).json({
        error: 'A comment is required when rejecting an action.',
        code: 'COMMENT_REQUIRED',
      });
      return;
    }

    const reviewItem = await reviewService.getReviewItem(req.params.id, req.orgId!);
    const isPending =
      reviewItem.reviewStatus === 'pending' || reviewItem.reviewStatus === 'edited_pending';

    const action = await actionService.getAction(reviewItem.actionId, req.orgId!);

    const result = await reviewService.rejectItem(req.params.id, req.orgId!, req.user!.id, comment);

    // Only record audit on a real (non-idempotent) transition.
    if (isPending) {
      reviewAuditService.record({
        actionId: action.id,
        organisationId: req.orgId!,
        subaccountId: action.subaccountId!,
        agentRunId: action.agentRunId,
        toolSlug: action.actionType,
        agentOutput: action.payloadJson as Record<string, unknown>,
        decidedBy: req.user!.id,
        decision: 'rejected',
        rawFeedback: comment,
        proposedAt: action.createdAt,
      }).catch((err) => console.error('[ReviewItems] Audit record failed:', err));

      const subaccountId = action.subaccountId;
      if (subaccountId) emitSubaccountUpdate(subaccountId, 'review:item_updated', { action: 'rejected' });
    }

    res.json(result);
  })
);

// ─── Bulk approve ─────────────────────────────────────────────────────────────

router.post(
  '/api/review-items/bulk-approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_APPROVE),
  asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids (array) is required' });
      return;
    }

    const thresholds = await getMajorThresholds(req.orgId!);
    const items = await Promise.all(
      ids.map(id => reviewService.getReviewItem(id, req.orgId!).catch(() => null)),
    );

    const actionIds = items
      .filter(Boolean)
      .map(item => item!.actionId)
      .filter(Boolean) as string[];
    const actionsLoaded = actionIds.length > 0
      ? await actionService.getActionsBulk(actionIds, req.orgId!)
      : [];
    const actionMap = new Map(actionsLoaded.map(a => [a.id, a]));

    const runIds = actionsLoaded.map(a => a.agentRunId).filter(Boolean) as string[];
    const runTotalsMap = runIds.length > 0
      ? await getRunTotalCostMinorBatch(runIds, req.orgId!)
      : new Map<string, number>();

    const approvable: string[] = [];
    const blocked: Array<{ id: string; majorReason: string }> = [];
    const alreadyResolved: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      const item = items[i];
      if (!item) continue;

      if (item.reviewStatus !== 'pending' && item.reviewStatus !== 'edited_pending') {
        alreadyResolved.push(ids[i]);
        continue;
      }

      const action = actionMap.get(item.actionId);
      if (!action) continue;

      const runTotal = action.agentRunId
        ? runTotalsMap.get(action.agentRunId) ?? null
        : null;
      const draft = buildDraftFromAction(action, runTotal);
      const { lane, majorReason } = classify(draft, thresholds);

      if (lane === 'major') {
        blocked.push({ id: ids[i], majorReason: majorReason! });
      } else {
        approvable.push(ids[i]);
      }
    }

    if (approvable.length > 0) {
      await reviewService.bulkApprove(approvable, req.orgId!, req.user!.id);
    }

    console.info('[Pulse] bulk_approve_result', {
      approvedCount: approvable.length,
      blockedCount: blocked.length,
      alreadyResolvedCount: alreadyResolved.length,
    });

    res.json({
      ok: true,
      approved: approvable,
      blocked,
      alreadyResolved,
    });
  })
);

// ─── Bulk reject ──────────────────────────────────────────────────────────────

router.post(
  '/api/review-items/bulk-reject',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_APPROVE),
  asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids (array) is required' });
      return;
    }
    const result = await reviewService.bulkReject(ids, req.orgId!, req.user!.id);
    res.json(result);
  })
);

export default router;
