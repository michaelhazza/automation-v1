/**
 * workflowDrafts.ts — workflow draft fetch + discard routes.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14b.
 *
 * GET  /api/workflow-drafts/:draftId
 * POST /api/workflow-drafts/:draftId/discard
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { userCanAccessSubaccount, type UserDbRole } from '../lib/userSubaccountAccess.js';
import { workflowDraftService } from '../services/workflowDraftService.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/workflow-drafts/:draftId
// ---------------------------------------------------------------------------

router.get(
  '/api/workflow-drafts/:draftId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { draftId } = req.params;
    const organisationId = req.orgId!;

    const draft = await workflowDraftService.findById(draftId, organisationId);

    if (!draft) {
      res.status(404).json({ error: 'draft_not_found' });
      return;
    }

    // S-P0-3: subaccount guard verified — returns 404 (not 403) on cross-subaccount access
    // Spec §3.3 — RLS only enforces org scope; a same-org cross-subaccount
    // read by ID would otherwise leak. Verify caller has access to the draft's
    // subaccount. 404 (not 403) so an attacker cannot enumerate which draft
    // IDs exist in subaccounts they cannot access.
    const hasAccess = await userCanAccessSubaccount(
      req.user!.id,
      req.user!.role as UserDbRole,
      draft.subaccountId,
    );
    if (!hasAccess) {
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

    res.json({
      id: draft.id,
      payload: draft.payload,
      sessionId: draft.sessionId,
      subaccountId: draft.subaccountId,
      draftSource: draft.draftSource,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      consumedAt: draft.consumedAt,
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/workflow-drafts/:draftId/discard
// ---------------------------------------------------------------------------

router.post(
  '/api/workflow-drafts/:draftId/discard',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { draftId } = req.params;
    const organisationId = req.orgId!;

    // Read first to check subaccount access — same disclosure-prevention
    // contract as the GET endpoint above.
    const existing = await workflowDraftService.findById(draftId, organisationId);
    if (!existing) {
      res.status(404).json({ error: 'draft_not_found' });
      return;
    }

    const hasAccess = await userCanAccessSubaccount(
      req.user!.id,
      req.user!.role as UserDbRole,
      existing.subaccountId,
    );
    if (!hasAccess) {
      res.status(404).json({ error: 'draft_not_found' });
      return;
    }

    const result = await workflowDraftService.markConsumed(draftId, organisationId);

    if (result === null) {
      // Already consumed (the access check above already passed; this path is
      // a same-tx race or pre-existing consumed state).
      res.status(410).json({
        error: 'draft_consumed',
        consumed_at: existing.consumedAt!.toISOString(),
      });
      return;
    }

    res.json({ discarded: true });
  }),
);

export default router;
