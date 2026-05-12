// ---------------------------------------------------------------------------
// EA Draft Dispatch Service — commit-hook-owned post-approval send path.
//
// Spec: 2026-05-12-personal-assistant-v1-spec.md §11 + §24.2.
// On approval, the proposal primitive's commit hook (registered into
// actionService.transitionState) invokes dispatchAfterApproval with the
// approved action. This service:
//   1. Loads the linked ea_drafts row.
//   2. Routes to slack / calendar action handlers based on draft.kind.
//   3. The action handlers themselves own the optimistic claim
//      (`UPDATE ea_drafts SET send_state='sending' WHERE send_state='idle'`)
//      via eaDraftService.claimSend, and mark sent / send_failed.
//   4. Errors are logged + swallowed — the optimistic claim guarantees
//      exactly-once across retries, and the stall-reset job recovers
//      drafts stuck in 'sending'. Approval is not undone on send failure.
//
// Exactly-once guarantee: dispatch is invoked exactly once from
// actionService.transitionState's 'approved' branch. The HTTP route only
// calls transitionState — it does NOT call dispatch directly.
// ---------------------------------------------------------------------------

import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { eaDrafts } from '../../db/schema/eaDrafts.js';
import { actions } from '../../db/schema/actions.js';
import type {
  CalendarCreateEventInput,
  CalendarUpdateEventInput,
  CalendarRespondToInviteInput,
} from '../../../shared/types/calendarAction.js';

interface DispatchCtx {
  organisationId: string;
  subaccountId: string;
  ownerUserId: string;
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
    const [row] = await db
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
      console.warn('[ea-draft-dispatch] draft has no ownerUserId', { draftId: row.id });
      return;
    }

    const ctx: DispatchCtx = {
      organisationId,
      subaccountId: row.subaccountId,
      ownerUserId: row.ownerUserId,
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

        case 'gmail_reply':
        case 'gmail_new': {
          // Email send path deferred to V1.5 per spec §26.
          // The draft remains in 'idle' state; no send is attempted.
          return;
        }

        default: {
          // Exhaustiveness guard.
          const _exhaustive: never = row.kind;
          void _exhaustive;
          console.warn('[ea-draft-dispatch] unknown draft kind', { draftId: row.id, kind: row.kind });
          return;
        }
      }
    } catch (err) {
      // Action handlers already mark the draft `send_failed` on error and
      // emit a Run Trace event. The stall-reset job recovers anything stuck
      // in 'sending'. We log here for greppable observability but do not
      // throw — the approval transition is already committed.
      console.warn('[ea-draft-dispatch] dispatch failed', {
        draftId: row.id,
        kind: row.kind,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /**
   * Probe helper for actionService.transitionState — returns true when the
   * action's metadata indicates it backs an EA draft proposal. Read-only.
   */
  async isEADraftAction(actionId: string, organisationId: string): Promise<boolean> {
    const [row] = await db
      .select({ metadataJson: actions.metadataJson })
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)))
      .limit(1);
    if (!row) return false;
    const meta = (row.metadataJson ?? {}) as Record<string, unknown>;
    return meta['kind'] === 'ea_draft';
  },
};
