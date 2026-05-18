// ---------------------------------------------------------------------------
// EA Draft Dispatch Service — commit-hook-owned post-approval send path.
//
// Spec: 2026-05-12-personal-assistant-v1-spec.md §11 + §24.2.
// On approval, the proposal primitive's commit hook (registered into
// actionService.transitionState) invokes dispatchAfterApproval with the
// approved action. This service:
//   1. Loads the linked ea_drafts row.
//   2. Claims the draft (idle → sending) via eaDraftService.claimSend
//      BEFORE routing — guarantees that any routing failure (dynamic
//      import error, body shape mismatch, missing provider module,
//      unknown kind, etc.) is paired with markSendFailed so the draft
//      never gets stuck in `approved` / `idle`.
//      (chatgpt-pr-review R2 F2.)
//   3. Routes to slack / calendar action handlers based on draft.kind,
//      passing `_dispatchPreClaimed: true` so the handler skips its own
//      claim. The handler still owns the final mark-sent on success and
//      mark-send_failed on its own internal failures.
//   4. On any error thrown from routing, calls markSendFailed.
//      Approval is not undone — the stall-reset job is a safety net for
//      drafts stuck in 'sending' that never reached markSent/markFailed.
//
// Exactly-once guarantee: dispatch is invoked exactly once from
// actionService.transitionState's 'approved' branch. The HTTP route only
// calls transitionState — it does NOT call dispatch directly.
// ---------------------------------------------------------------------------

import { and, eq } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { logger } from '../../lib/logger.js';
import { eaDrafts } from '../../db/schema/eaDrafts.js';
import { actions } from '../../db/schema/actions.js';
import { eaDraftService } from './eaDraftService.js';
import type {
  CalendarCreateEventInput,
  CalendarUpdateEventInput,
  CalendarRespondToInviteInput,
} from '../../../shared/types/calendarAction.js';

interface DispatchCtx {
  organisationId: string;
  subaccountId: string;
  ownerUserId: string;
  /**
   * Internal flag — `dispatchAfterApproval` claims the draft before
   * routing and passes this flag to the action handlers so they skip
   * their own redundant `claimSend`. See module docs above.
   */
  _dispatchPreClaimed?: boolean;
}

export const eaDraftDispatchService = {
  /**
   * Invoked from actionService.transitionState's `approved` branch when the
   * action's metadata indicates it backs an EA draft (`metadata.kind === 'ea_draft'`).
   *
   * Loads the linked ea_drafts row and dispatches to the kind-appropriate
   * action handler. The handler owns the optimistic claim + mark-sent /
   * mark-failed lifecycle. Errors here are logged but do NOT propagate
   * back to the caller — the approval state is already committed; the
   * stall-reset job recovers any draft stuck in 'sending'.
   */
  async dispatchAfterApproval(actionId: string, organisationId: string): Promise<void> {
    // Look up the linked draft via proposal_action_id.
    const scopedDb = getOrgScopedDb('eaDraftDispatchService.dispatchAfterApproval');
    const [row] = await scopedDb
      .select()
      .from(eaDrafts)
      .where(
        and(
          eq(eaDrafts.proposalActionId, actionId),
          eq(eaDrafts.organisationId, organisationId),
        ),
      )
      .limit(1);

    if (!row) {
      // No linked draft — not an EA-draft proposal. Silent no-op.
      return;
    }

    if (!row.ownerUserId) {
      // Defensive — owner_user_id is NOT NULL in the schema, but log + return
      // if somehow encountered (e.g. legacy row).
      logger.warn('ea_draft_dispatch.draft_missing_owner', { draftId: row.id });
      return;
    }

    // Gmail-kind drafts are deferred to V1.5 per spec §26 — the draft stays
    // in `idle` and no claim is taken. Return before claiming.
    if (row.kind === 'gmail_reply' || row.kind === 'gmail_new') {
      return;
    }

    // ── Claim first (chatgpt-pr-review R2 F2) ────────────────────────────
    // Move idle → sending BEFORE any dynamic import / routing. If the claim
    // returns `{claimed: false}` (already in-flight from a duplicate
    // dispatch invocation), exit silently — the in-flight path will mark
    // sent/failed. If the claim succeeds, any subsequent failure (including
    // before the handler runs) is paired with markSendFailed so the draft
    // never gets stuck in approved+idle.
    const claim = await eaDraftService.claimSend(row.id, { organisationId });
    if (!claim.claimed) {
      logger.info('ea_draft_dispatch.claim_skipped', {
        draftId: row.id,
        reason: claim.reason,
      });
      return;
    }

    const ctx: DispatchCtx = {
      organisationId,
      subaccountId: row.subaccountId,
      ownerUserId: row.ownerUserId,
      _dispatchPreClaimed: true,
    };

    try {
      switch (row.kind) {
        case 'slack_post':
        case 'slack_dm': {
          const { slackActionService } = await import('../slack/slackActionService.js');
          await slackActionService.executeApprovedDraftSend(row.id, ctx);
          return;
        }

        case 'calendar_create': {
          const { calendarActionService } = await import('../calendar/calendarActionService.js');
          const body = row.body as Record<string, unknown>;
          await calendarActionService.createEvent(
            { ...(body as CalendarCreateEventInput), eaDraftId: row.id },
            ctx,
          );
          return;
        }

        case 'calendar_update': {
          const { calendarActionService } = await import('../calendar/calendarActionService.js');
          const body = row.body as Record<string, unknown>;
          await calendarActionService.updateEvent(
            { ...(body as CalendarUpdateEventInput), eaDraftId: row.id },
            ctx,
          );
          return;
        }

        case 'calendar_respond': {
          const { calendarActionService } = await import('../calendar/calendarActionService.js');
          const body = row.body as Record<string, unknown>;
          await calendarActionService.respondToInvite(
            {
              ...(body as CalendarRespondToInviteInput),
              eaDraftId: row.id,
              ownerEmail: (body['ownerEmail'] as string) ?? '',
            },
            ctx,
          );
          return;
        }

        default: {
          // Exhaustiveness guard. Gmail kinds are handled above.
          const _exhaustive: never = row.kind;
          void _exhaustive;
          logger.warn('ea_draft_dispatch.unknown_kind', { draftId: row.id, kind: row.kind });
          // Unknown kind: nothing to send, but the claim is still held.
          // Mark failed so a stall-reset isn't needed to recover.
          await eaDraftService.markSendFailed(row.id, { organisationId });
          return;
        }
      }
    } catch (err) {
      // Routing or handler threw. Mark send_failed so manual retry
      // (POST /api/ea-drafts/:id/retry) can pick this up from send_failed.
      // The action handlers also mark send_failed on their own internal
      // failures; calling markSendFailed twice is idempotent (it sets the
      // same state) so the dispatch-level catch is a safety net for
      // failures that happen before the handler's try/catch covers them.
      logger.warn('ea_draft_dispatch.failed_marking_send_failed', {
        draftId: row.id,
        kind: row.kind,
        err: err instanceof Error ? err.message : String(err),
      });
      try {
        await eaDraftService.markSendFailed(row.id, { organisationId });
      } catch (markErr) {
        logger.error('ea_draft_dispatch.mark_send_failed_threw', {
          draftId: row.id,
          err: markErr instanceof Error ? markErr.message : String(markErr),
        });
      }
    }
  },

  /**
   * Probe helper for actionService.transitionState — returns true when the
   * action's metadata indicates it backs an EA draft proposal. Read-only.
   */
  async isEADraftAction(actionId: string, organisationId: string): Promise<boolean> {
    const scopedDb = getOrgScopedDb('eaDraftDispatchService.isEADraftAction');
    const [row] = await scopedDb
      .select({ metadataJson: actions.metadataJson })
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)))
      .limit(1);
    if (!row) return false;
    const meta = (row.metadataJson ?? {}) as Record<string, unknown>;
    return meta['kind'] === 'ea_draft';
  },
};
