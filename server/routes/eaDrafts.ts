import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { eaDraftService } from '../services/eaDrafts/eaDraftService.js';
import { actionService } from '../services/actionService.js';
import type { EADraftViewer } from '../services/eaDrafts/eaDraftServicePure.js';

const router = Router();

// ---------------------------------------------------------------------------
// Build the viewer context for redaction (spec §21.2 — admins see metadata
// only; non-owners never see the body). RLS at the DB layer already filters
// row-level visibility; this is the API-serialisation defence-in-depth.
// ---------------------------------------------------------------------------
function buildViewer(req: { user?: { id?: string; role?: string | null } }): EADraftViewer {
  return {
    userId: req.user?.id ?? '',
    role: req.user?.role ?? 'user',
  };
}

// ─── List EA drafts for the authenticated user's organisation ─────────────────

router.get(
  '/api/ea-drafts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EA_DRAFT_READ),
  asyncHandler(async (req, res) => {
    const drafts = await eaDraftService.listDrafts({
      organisationId: req.orgId!,
      viewer: buildViewer(req),
    });
    res.json({ drafts });
  }),
);

// ─── Get single EA draft ──────────────────────────────────────────────────────

router.get(
  '/api/ea-drafts/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EA_DRAFT_READ),
  asyncHandler(async (req, res) => {
    const draft = await eaDraftService.getDraft(req.params.id, {
      organisationId: req.orgId!,
      viewer: buildViewer(req),
    });
    if (!draft) {
      res.status(404).json({ error: 'EA draft not found' });
      return;
    }
    res.json(draft);
  }),
);

// ─── Approve EA draft (transitions the linked action to approved) ─────────────
//
// V1 owner-only approval (spec §18 / §21.2 / line 1573: "decidedByUserId must
// equal the draft's owner_user_id"). The admin bypass that previously existed
// was a spec violation — removed in chatgpt-pr-review round 1 (F2). Admins
// MUST NOT approve another user's drafts in V1.
//
// Dispatch (spec §11 + §24.2): the route ONLY transitions the proposal action
// to `approved`. The proposal-commit hook in actionService.transitionState
// invokes eaDraftDispatchService.dispatchAfterApproval exactly once. The
// dispatch path is awaited inside transitionState so the HTTP response is
// not sent until dispatch has been initiated and the optimistic claim has
// committed. Errors during send are recorded on ea_drafts.sendState; the
// approval transition is durable regardless of send outcome.

router.post(
  '/api/ea-drafts/:id/approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EA_DRAFT_DECIDE),
  asyncHandler(async (req, res) => {
    // Read without viewer redaction — we need the raw ownerUserId for
    // the strict owner-only check.
    const draft = await eaDraftService.getDraft(req.params.id, { organisationId: req.orgId! });
    if (!draft) {
      res.status(404).json({ error: 'EA draft not found' });
      return;
    }
    // V1 owner-only approval. No admin bypass. Spec line 1573.
    if (draft.ownerUserId !== req.user!.id) {
      res.status(403).json({ error: 'Only the draft owner may approve in V1' });
      return;
    }
    // transitionState fires the proposal commit hook on success, which
    // routes to eaDraftDispatchService for the kind-appropriate send path.
    await actionService.transitionState(
      draft.proposalActionId,
      req.orgId!,
      'approved',
      req.user!.id,
    );
    // Return the redacted draft from the viewer's perspective.
    const refreshed = await eaDraftService.getDraft(req.params.id, {
      organisationId: req.orgId!,
      viewer: buildViewer(req),
    });
    res.json(refreshed ?? draft);
  }),
);

// ─── Reject EA draft (transitions the linked action to rejected) ──────────────
//
// V1 owner-only rejection — same spec rule as approval. Admins do not
// override the operator's review decision in V1.

router.post(
  '/api/ea-drafts/:id/reject',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EA_DRAFT_DECIDE),
  asyncHandler(async (req, res) => {
    const draft = await eaDraftService.getDraft(req.params.id, { organisationId: req.orgId! });
    if (!draft) {
      res.status(404).json({ error: 'EA draft not found' });
      return;
    }
    if (draft.ownerUserId !== req.user!.id) {
      res.status(403).json({ error: 'Only the draft owner may reject in V1' });
      return;
    }
    await actionService.transitionState(
      draft.proposalActionId,
      req.orgId!,
      'rejected',
      req.user!.id,
    );
    res.json({ ok: true });
  }),
);

// ─── Retry EA draft send (from send_failed back to sending) ──────────────────

router.post(
  '/api/ea-drafts/:id/retry',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EA_DRAFT_DECIDE),
  asyncHandler(async (req, res) => {
    // Retry is also owner-only — the send is the owner's content.
    const draft = await eaDraftService.getDraft(req.params.id, { organisationId: req.orgId! });
    if (!draft) {
      res.status(404).json({ error: 'EA draft not found' });
      return;
    }
    if (draft.ownerUserId !== req.user!.id) {
      res.status(403).json({ error: 'Only the draft owner may retry in V1' });
      return;
    }
    const result = await eaDraftService.retryFromFailed(req.params.id, { organisationId: req.orgId! });
    if (!result.claimed) {
      res.status(409).json({ error: result.reason });
      return;
    }
    res.json({ ok: true });
  }),
);

export default router;
