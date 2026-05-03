/**
 * Workflow Drafts routes — draft lifecycle for Studio canvas hydration.
 *
 * Spec: tasks/Workflows-spec.md §3.3, §10.7.
 *
 * GET  /api/workflow-drafts/:draftId
 *   200  { id, payload, sessionId, subaccountId, draftSource, createdAt, updatedAt, consumedAt }
 *   404  { error: 'draft_not_found' }
 *   410  { error: 'draft_consumed', consumed_at: string }
 *
 * POST /api/workflow-drafts/:draftId/discard
 *   200  { discarded: true }
 *   410  { error: 'draft_consumed', consumed_at: string }
 *   404  { error: 'draft_not_found' }
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { WorkflowDraftService } from '../services/workflowDraftService.js';
import { decideDraftAccessOutcome } from '../services/workflowDraftServicePure.js';

const router = Router();

// ─── GET /api/workflow-drafts/:draftId ────────────────────────────────────────

router.get(
  '/api/workflow-drafts/:draftId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { draftId } = req.params;
    const organisationId = req.orgId!;

    const draft = await WorkflowDraftService.findById(draftId, organisationId);
    const outcome = decideDraftAccessOutcome({
      exists: draft !== null,
      consumedAt: draft?.consumedAt,
    });

    if (outcome === 'not_found') {
      res.status(404).json({ error: 'draft_not_found' });
      return;
    }
    if (outcome === 'already_consumed') {
      res.status(410).json({
        error: 'draft_consumed',
        consumed_at: draft!.consumedAt!.toISOString(),
      });
      return;
    }

    res.json({
      id: draft!.id,
      payload: draft!.payload,
      sessionId: draft!.sessionId,
      subaccountId: draft!.subaccountId,
      draftSource: draft!.draftSource,
      createdAt: draft!.createdAt,
      updatedAt: draft!.updatedAt,
      consumedAt: draft!.consumedAt,
    });
  })
);

// ─── POST /api/workflow-drafts/:draftId/discard ───────────────────────────────

router.post(
  '/api/workflow-drafts/:draftId/discard',
  authenticate,
  asyncHandler(async (req, res) => {
    const { draftId } = req.params;
    const organisationId = req.orgId!;

    // Check existence first so we can distinguish 404 from 410.
    const draft = await WorkflowDraftService.findById(draftId, organisationId);
    if (!draft) {
      res.status(404).json({ error: 'draft_not_found' });
      return;
    }

    if (draft.consumedAt !== null) {
      res.status(410).json({
        error: 'draft_consumed',
        consumed_at: draft.consumedAt.toISOString(),
      });
      return;
    }

    await WorkflowDraftService.markConsumed(draftId, organisationId);
    res.json({ discarded: true });
  })
);

export default router;
