import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { eaDraftService } from '../services/eaDrafts/eaDraftService.js';
import { actionService } from '../services/actionService.js';

const router = Router();

// ─── List EA drafts for the authenticated user's organisation ─────────────────

router.get(
  '/api/ea-drafts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EA_DRAFT_READ),
  asyncHandler(async (req, res) => {
    const drafts = await eaDraftService.listDrafts({ organisationId: req.orgId! });
    res.json({ drafts });
  }),
);

// ─── Get single EA draft ──────────────────────────────────────────────────────

router.get(
  '/api/ea-drafts/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EA_DRAFT_READ),
  asyncHandler(async (req, res) => {
    const draft = await eaDraftService.getDraft(req.params.id, { organisationId: req.orgId! });
    if (!draft) {
      res.status(404).json({ error: 'EA draft not found' });
      return;
    }
    res.json(draft);
  }),
);

// ─── Approve EA draft (transitions the linked action to approved) ─────────────

router.post(
  '/api/ea-drafts/:id/approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EA_DRAFT_DECIDE),
  asyncHandler(async (req, res) => {
    const draft = await eaDraftService.getDraft(req.params.id, { organisationId: req.orgId! });
    if (!draft) {
      res.status(404).json({ error: 'EA draft not found' });
      return;
    }
    // Owner check: only the draft's owner (or an admin) may approve their own drafts.
    const isAdmin = ['org_admin', 'system_admin'].includes(req.user!.role ?? '');
    if (!isAdmin && draft.ownerUserId !== req.user!.id) {
      res.status(403).json({ error: 'Cannot approve another user\'s draft' });
      return;
    }
    await actionService.transitionState(
      draft.proposalActionId,
      req.orgId!,
      'approved',
      req.user!.id,
    );

    // Dispatch send after approval — fire-and-forget; stall-reset job recovers on failure
    const sendCtx = {
      organisationId: req.orgId!,
      subaccountId: draft.subaccountId ?? '',
      ownerUserId: draft.ownerUserId ?? '',
    };
    if (draft.ownerUserId && (draft.kind === 'slack_post' || draft.kind === 'slack_dm')) {
      import('../services/slack/slackActionService.js').then(({ slackActionService }) =>
        slackActionService.executeApprovedDraftSend(draft.id, sendCtx).catch((err: unknown) =>
          console.warn('[ea-draft-approve] slack send failed', { draftId: draft.id, err: String(err) })
        )
      ).catch(() => undefined);
    } else if (draft.ownerUserId && (draft.kind === 'calendar_create' || draft.kind === 'calendar_update' || draft.kind === 'calendar_respond')) {
      import('../services/calendar/calendarActionService.js').then(({ calendarActionService }) => {
        const body = draft.body as Record<string, unknown>;
        const kind = draft.kind as string;
        let sendPromise: Promise<unknown>;
        if (kind === 'calendar_create') {
          sendPromise = calendarActionService.createEvent(
            { ...(body as import('../../shared/types/calendarAction.js').CalendarCreateEventInput), eaDraftId: draft.id },
            sendCtx,
          );
        } else if (kind === 'calendar_update') {
          sendPromise = calendarActionService.updateEvent(
            { ...(body as import('../../shared/types/calendarAction.js').CalendarUpdateEventInput), eaDraftId: draft.id },
            sendCtx,
          );
        } else {
          sendPromise = calendarActionService.respondToInvite(
            { ...(body as import('../../shared/types/calendarAction.js').CalendarRespondToInviteInput), eaDraftId: draft.id, ownerEmail: (body.ownerEmail as string) ?? '' },
            sendCtx,
          );
        }
        return sendPromise.catch((err: unknown) =>
          console.warn('[ea-draft-approve] calendar send failed', { draftId: draft.id, err: String(err) })
        );
      }).catch(() => undefined);
    }
    // gmail_reply, gmail_new: existing email send path; deferred in V1

    res.json(draft);
  }),
);

// ─── Reject EA draft (transitions the linked action to rejected) ──────────────

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
    const isAdmin = ['org_admin', 'system_admin'].includes(req.user!.role ?? '');
    if (!isAdmin && draft.ownerUserId !== req.user!.id) {
      res.status(403).json({ error: 'Cannot reject another user\'s draft' });
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
    const result = await eaDraftService.retryFromFailed(req.params.id, { organisationId: req.orgId! });
    if (!result.claimed) {
      res.status(409).json({ error: result.reason });
      return;
    }
    res.json({ ok: true });
  }),
);

export default router;
