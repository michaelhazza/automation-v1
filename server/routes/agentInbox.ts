// ---------------------------------------------------------------------------
// Agent Inbox — pending_approval actions with workflow context.
//
// Extends the existing review queue with workflow run details so the UI
// can render the full workflow context panel alongside the action card.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { actionService } from '../services/actionService.js';

const router = Router();

// ─── GET /api/subaccounts/:subaccountId/agent-inbox ──────────────────────────
//
// Returns all pending_approval actions for this subaccount, enriched with
// workflow run context when the action was triggered from a workflow step.

router.get(
  '/api/subaccounts/:subaccountId/agent-inbox',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const organisationId = req.orgId!;
    await resolveSubaccount(subaccountId, organisationId);

    const enriched = await actionService.listPendingWithWorkflowContext(organisationId, subaccountId);
    res.json(enriched);
  }),
);

export default router;
