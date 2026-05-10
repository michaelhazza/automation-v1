import { Router } from 'express';
import { authenticate, requireOrgPermission, hasOrgPermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import type { PrincipalContext } from '../../services/principal/types.js';
import { resolveSubaccount } from '../../lib/resolveSubaccount.js';
import {
  listDraftsForReview,
  getDraftById,
  approveDraft,
  rejectDraft,
  editDraft,
  manualResolveDraft,
} from '../../services/supportDraftDispatchService.js';

const router = Router({ mergeParams: true });

async function makePrincipal(req: Express.Request & { user?: import('../../middleware/auth.js').JwtPayload; orgId?: string; params: Record<string, string> }): Promise<PrincipalContext> {
  const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
  return {
    type: 'user',
    id: req.user!.id,
    organisationId: req.orgId!,
    subaccountId: subaccount.id,
    teamIds: [],
  };
}

router.get('/drafts', authenticate, asyncHandler(async (req, res) => {
  const ticketId = req.query.ticketId as string | undefined;
  const drafts = await listDraftsForReview({ ticketId }, await makePrincipal(req));
  res.json({ drafts });
}));

router.get('/drafts/:id', authenticate, asyncHandler(async (req, res) => {
  const draft = await getDraftById(req.params.id, await makePrincipal(req));
  res.json({ draft });
}));

router.post('/drafts/:id/approve', authenticate, requireOrgPermission('support.draft.approve'), asyncHandler(async (req, res) => {
  const { overrideCollision, reviewNotes } = req.body as { overrideCollision?: boolean; reviewNotes?: string };
  if (overrideCollision && !(await hasOrgPermission(req, 'support.draft.override_collision'))) {
    res.status(403).json({ message: 'support.draft.override_collision permission required' });
    return;
  }
  const result = await approveDraft(req.params.id, await makePrincipal(req), { reviewNotes, overrideCollision });
  res.json(result);
}));

router.post('/drafts/:id/reject', authenticate, requireOrgPermission('support.draft.reject'), asyncHandler(async (req, res) => {
  const { reason } = req.body as { reason: string };
  await rejectDraft(req.params.id, await makePrincipal(req), reason ?? '');
  res.json({ ok: true });
}));

router.post('/drafts/:id/edit', authenticate, requireOrgPermission('support.draft.approve'), asyncHandler(async (req, res) => {
  const { proposedBodyText } = req.body;
  if (!proposedBodyText?.trim()) {
    return res.status(422).json({ message: 'proposedBodyText is required' });
  }
  const draft = await editDraft(req.params.id, proposedBodyText, await makePrincipal(req));
  res.json({ draft });
}));

router.post('/drafts/:id/manual-resolve', authenticate, asyncHandler(async (req, res) => {
  const { action, notes } = req.body as { action: 'mark_sent' | 'mark_failed' | 'retry_reconciliation'; notes?: string };

  if (action === 'mark_sent' || action === 'retry_reconciliation') {
    if (!(await hasOrgPermission(req, 'support.draft.approve'))) {
      res.status(403).json({ message: 'support.draft.approve permission required' });
      return;
    }
  } else if (action === 'mark_failed') {
    if (!(await hasOrgPermission(req, 'support.draft.reject'))) {
      res.status(403).json({ message: 'support.draft.reject permission required' });
      return;
    }
  } else {
    res.status(400).json({ message: 'support.draft.invalid_action' });
    return;
  }

  await manualResolveDraft(req.params.id, action, await makePrincipal(req), { notes });
  res.json({ ok: true });
}));

export default router;
