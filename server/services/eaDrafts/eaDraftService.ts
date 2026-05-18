import { eq, and, lt, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { withAdminConnection } from '../../lib/adminDbConnection.js';
import { eaDrafts } from '../../db/schema/eaDrafts.js';
import { actions, actionEvents } from '../../db/schema/index.js';
import { actionService } from '../actionService.js';
import { canonicaliseJson } from '../../lib/canonicalJsonPure.js';
import type { EADraftKind } from '../../../shared/types/eaDraft.js';
import { redactDraftForViewer, type EADraftViewer } from './eaDraftServicePure.js';

// ---------------------------------------------------------------------------
// Kind -> actionType mapping
// ---------------------------------------------------------------------------

const KIND_TO_ACTION_TYPE: Record<EADraftKind, string> = {
  gmail_reply: 'send_email',
  gmail_new: 'send_email',
  slack_post: 'slack.post_message',
  slack_dm: 'slack.post_dm',
  calendar_create: 'calendar.create_event',
  calendar_update: 'calendar.update_event',
  calendar_respond: 'calendar.respond_to_invite',
};

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface CreateDraftInput {
  kind: EADraftKind;
  body: Record<string, unknown>;
  targetRef?: string;
  agentId: string;
  agentRunId: string;
  ownerUserId: string;
  subaccountId: string;
  proposalActionDescription?: string;
}

export interface CreateDraftResult {
  draftId: string;
  actionId: string;
}

// ---------------------------------------------------------------------------
// eaDraftService
// ---------------------------------------------------------------------------

export const eaDraftService = {
  /**
   * Creates both the actions row (pending_approval) and the ea_drafts row (idle)
   * in one transaction. The action row is created first via
   * actionService.proposeAction; both inserts share a single db.transaction so
   * a failure on the draft insert rolls back the action row (no orphaned
   * pending_approval action). See actionService.proposeAction doc-comment for
   * the atomicity contract.
   *
   * **Idempotency-key shape (REVIEW-F2 from ChatGPT PR #296 round 2 review,
   * 2026-05-13).** The key includes a stable per-call discriminator:
   * `targetRef` when supplied, otherwise a SHA-1 of the canonical-JSON of
   * `{ kind, body }`. Two drafts of the same kind from the same agent run +
   * owner produce DIFFERENT keys when their target or body differ — e.g. an
   * agent that legitimately drafts a Slack post to channel A and a follow-up
   * Slack post to channel B in the same run no longer collapses onto a
   * single `actions` row. The pre-amendment shape was
   * `ea_draft:${agentRunId}:${kind}:${ownerUserId}`, which silently reused
   * the first proposal action id and left the second draft permanently
   * stuck in `idle` (per `EA-V1-FOLLOWUP-1` in `tasks/todo.md`). The retry
   * vs replay contract on `actionService.buildActionIdempotencyKey` is
   * preserved: a same-attempt retry (same run, same target, same body)
   * still resolves to the same key, so `actionService.proposeAction` still
   * returns `isNew: false` and re-uses the existing row. Defence-in-depth:
   * migration 0344 adds `UNIQUE(proposal_action_id)` on `ea_drafts` so any
   * future collision (e.g. a caller adds a new field to `body` but forgets
   * to include it in the hash) becomes a loud DB error instead of a silent
   * stuck draft.
   */
  async createDraftWithProposal(
    input: CreateDraftInput,
    ctx: { organisationId: string },
  ): Promise<CreateDraftResult> {
    const actionType = KIND_TO_ACTION_TYPE[input.kind];
    // Stable per-call discriminator. Prefer the caller's `targetRef` when
    // supplied (most call sites: Gmail thread id, Calendar event id, Slack
    // channel id + thread ts). Fall back to a hash of the canonical-JSON of
    // `{ kind, body }` so even purely-generative draft kinds (e.g. a brand-new
    // Slack DM where targetRef is omitted) get a unique key per logically
    // distinct draft.
    const draftDiscriminator =
      input.targetRef ??
      createHash('sha1')
        .update(canonicaliseJson({ kind: input.kind, body: input.body }))
        .digest('hex')
        .slice(0, 12);
    const idempotencyKey = `ea_draft:${input.agentRunId}:${input.kind}:${input.ownerUserId}:${draftDiscriminator}`;

    const scopedDb = getOrgScopedDb('eaDraftService.createDraftWithProposal');
    return scopedDb.transaction(async (tx) => {
      const proposalResult = await actionService.proposeAction(
        {
          organisationId: ctx.organisationId,
          subaccountId: input.subaccountId,
          agentId: input.agentId,
          agentRunId: input.agentRunId,
          actionType,
          idempotencyKey,
          payload: { ...input.body, targetRef: input.targetRef ?? null, kind: input.kind },
          metadata: { kind: 'ea_draft' },
          gateOverride: 'review',
        },
        { tx },
      );

      const [draft] = await tx
        .insert(eaDrafts)
        .values({
          organisationId: ctx.organisationId,
          subaccountId: input.subaccountId,
          ownerUserId: input.ownerUserId,
          agentId: input.agentId,
          runId: input.agentRunId,
          proposalActionId: proposalResult.actionId,
          kind: input.kind,
          targetRef: input.targetRef ? { ref: input.targetRef } : {},
          body: input.body,
          sendState: 'idle',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: eaDrafts.id });

      return { draftId: draft.id, actionId: proposalResult.actionId };
    });
  },

  /**
   * Optimistic claim: UPDATE ea_drafts SET send_state='sending' WHERE id=$1 AND send_state='idle'
   * Returns { claimed: true } if the row was updated,
   * { claimed: false, reason: 'DRAFT_SEND_IN_FLIGHT' | 'DRAFT_NOT_FOUND' } otherwise.
   */
  async claimSend(
    draftId: string,
    ctx: { organisationId: string },
  ): Promise<{ claimed: true } | { claimed: false; reason: 'DRAFT_SEND_IN_FLIGHT' | 'DRAFT_NOT_FOUND' }> {
    const scopedDb = getOrgScopedDb('eaDraftService.claimSend');
    const rows = await scopedDb
      .update(eaDrafts)
      .set({ sendState: 'sending', updatedAt: new Date() })
      .where(
        and(
          eq(eaDrafts.id, draftId),
          eq(eaDrafts.organisationId, ctx.organisationId),
          eq(eaDrafts.sendState, 'idle'),
        ),
      )
      .returning({ id: eaDrafts.id });

    if (rows.length > 0) {
      return { claimed: true };
    }

    return { claimed: false, reason: 'DRAFT_SEND_IN_FLIGHT' };
  },

  /**
   * Mark a draft's send as complete; writes externalResultId.
   */
  async markSent(
    draftId: string,
    externalResultId: string,
    ctx: { organisationId: string },
  ): Promise<void> {
    const scopedDb = getOrgScopedDb('eaDraftService.markSent');
    await scopedDb
      .update(eaDrafts)
      .set({ sendState: 'sent', externalResultId, updatedAt: new Date() })
      .where(
        and(
          eq(eaDrafts.id, draftId),
          eq(eaDrafts.organisationId, ctx.organisationId),
        ),
      );
  },

  /**
   * Mark a draft send as failed.
   */
  async markSendFailed(
    draftId: string,
    ctx: { organisationId: string },
  ): Promise<void> {
    const scopedDb = getOrgScopedDb('eaDraftService.markSendFailed');
    await scopedDb
      .update(eaDrafts)
      .set({ sendState: 'send_failed', updatedAt: new Date() })
      .where(
        and(
          eq(eaDrafts.id, draftId),
          eq(eaDrafts.organisationId, ctx.organisationId),
        ),
      );
  },

  /**
   * Retry from send_failed -> sending (same optimistic predicate).
   */
  async retryFromFailed(
    draftId: string,
    ctx: { organisationId: string },
  ): Promise<{ claimed: true } | { claimed: false; reason: string }> {
    const scopedDb = getOrgScopedDb('eaDraftService.retryFromFailed');
    const rows = await scopedDb
      .update(eaDrafts)
      .set({ sendState: 'sending', updatedAt: new Date() })
      .where(
        and(
          eq(eaDrafts.id, draftId),
          eq(eaDrafts.organisationId, ctx.organisationId),
          eq(eaDrafts.sendState, 'send_failed'),
        ),
      )
      .returning({ id: eaDrafts.id });

    if (rows.length > 0) {
      return { claimed: true };
    }

    return { claimed: false, reason: 'DRAFT_NOT_IN_FAILED_STATE' };
  },

  /**
   * List drafts for an organisation, ordered by createdAt DESC, limit 50.
   *
   * Admin redaction (spec §21.2): when `viewer` is supplied, the body field
   * is redacted to `{}` for any viewer that is not the draft owner. RLS
   * already filters rows at the DB layer; this is field-level redaction
   * on rows the viewer is allowed to see at the row level.
   *
   * Callers MUST pass `viewer` from authenticated routes — only internal
   * dispatchers (stall jobs, commit hooks) may omit it. When omitted the
   * raw rows are returned UNREDACTED; that path is for trusted server
   * code only.
   */
  async listDrafts(ctx: { organisationId: string; viewer?: EADraftViewer }) {
    const scopedDb = getOrgScopedDb('eaDraftService.listDrafts');
    const rows = await scopedDb
      .select()
      .from(eaDrafts)
      .where(eq(eaDrafts.organisationId, ctx.organisationId))
      .orderBy(sql`${eaDrafts.createdAt} DESC`)
      .limit(50);

    if (!ctx.viewer) return rows;

    return rows.map((row) => redactDraftForViewer(row, ctx.viewer!));
  },

  /**
   * Get a single draft by ID, scoped to the organisation.
   *
   * Admin redaction (spec §21.2): see listDrafts. When `viewer` is supplied,
   * the body field is redacted to `{}` for any viewer that is not the
   * draft owner.
   */
  async getDraft(draftId: string, ctx: { organisationId: string; viewer?: EADraftViewer }) {
    const scopedDb = getOrgScopedDb('eaDraftService.getDraft');
    const [draft] = await scopedDb
      .select()
      .from(eaDrafts)
      .where(
        and(
          eq(eaDrafts.id, draftId),
          eq(eaDrafts.organisationId, ctx.organisationId),
        ),
      );
    if (!draft) return null;
    if (!ctx.viewer) return draft;
    return redactDraftForViewer(draft, ctx.viewer);
  },

  /**
   * 7-day proposal sweep for EA-linked drafts (spec §5.1 entry for
   * `workflowGateStallNotifyJob`, §20.4 / §22.2). Scans `actions` rows that:
   *   - are still `pending_approval`,
   *   - carry `metadata_json.kind = 'ea_draft'`,
   *   - have `created_at < NOW() - INTERVAL '7 days'` (DB-time predicate so
   *     the cutoff matches the same clock that wrote `created_at`),
   * and transitions them to `rejected` with `metadata_json.expired_after_7d =
   * true` + `metadata_json.systemExpired = true` plus a `rejected` event row
   * carrying `actorId: null` and `metadata { reason: 'expired_after_7d',
   * systemExpired: true }`.
   *
   * **Naming note (REVIEW-F1, 2026-05-13).** The `actions` primitive does NOT
   * carry an `expired` status — its enum is `proposed | pending_approval |
   * approved | executing | completed | failed | rejected | blocked | skipped`.
   * The `action_events` event_type enum likewise has no `expired` value. The
   * spec previously described the terminal state as "the proposal row
   * transitions to `expired`" / "emits `proposal.expired`"; the as-built
   * primitive collapses both system-expiry and user-rejection onto the same
   * `rejected` status + `rejected` event. The honest framing is:
   * **system-rejected due to expiry**, distinguishable from operator
   * rejection by `metadata_json.systemExpired = true` + `actorId IS NULL` on
   * the event row. Callers that need to surface "expired" to the operator
   * UI must read the metadata flag, not assume a separate enum value.
   *
   * The linked `ea_drafts.send_state` stays `idle` per spec (approval-state is
   * owned by the proposal primitive; sweep hides the draft from the
   * Workspace tab but does NOT touch the draft row itself).
   *
   * Returns the list of swept action IDs (cross-org). Cross-org sweep so
   * uses `withAdminConnection` + `SET LOCAL ROLE admin_role` (BYPASSRLS).
   * Pre-2026-05-13 the sweep path did not exist — this closes REQ-M9.
   */
  async expireOldEADraftProposals(): Promise<string[]> {
    return withAdminConnection(
      {
        source: 'eaDraftService.expireOldEADraftProposals',
        reason: 'cross-org 7-day proposal sweep for EA-linked drafts',
      },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        // Single UPDATE with COALESCE-merge on metadata_json — preserves any
        // existing metadata keys (riskTier, gateLevelSource, kind=ea_draft).
        // Cutoff uses DB-time `NOW() - INTERVAL '7 days'` so the predicate
        // compares against the same wall clock that wrote `created_at`.
        const expired = await tx.execute(sql`
          UPDATE actions
             SET status = 'rejected',
                 metadata_json = COALESCE(metadata_json, '{}'::jsonb)
                                 || jsonb_build_object(
                                      'expired_after_7d', true,
                                      'systemExpired', true,
                                      'expired_at', to_jsonb(NOW())
                                    ),
                 updated_at = NOW()
           WHERE status = 'pending_approval'
             AND metadata_json->>'kind' = 'ea_draft'
             AND created_at < NOW() - INTERVAL '7 days'
           RETURNING id, organisation_id
        `);

        const rows = (expired as unknown as { rows?: Array<{ id: string; organisation_id: string }> }).rows
          ?? (expired as unknown as Array<{ id: string; organisation_id: string }>);

        for (const row of rows) {
          await tx.insert(actionEvents).values({
            organisationId: row.organisation_id,
            actionId: row.id,
            eventType: 'rejected',
            actorId: null,
            metadataJson: { reason: 'expired_after_7d', systemExpired: true },
            createdAt: new Date(),
          });
        }

        // Touch `actions` import — drizzle treats the schema as the typed
        // surface, but the UPDATE above uses raw SQL so the imported `actions`
        // symbol is otherwise unused. Keep it referenced so future Drizzle
        // refactors can swap back without re-adding the import.
        void actions;

        return rows.map((r) => r.id);
      },
    );
  },

  /**
   * Stall-reset: move sending -> idle for drafts stuck in sending longer than 30 minutes.
   * Called by the stall job.
   */
  async resetStalledSendingDrafts(): Promise<string[]> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);

    // Cross-org stall reset requires admin bypass — ea_drafts has FORCE RLS
    // and the stall job runs without a per-org session variable. We must
    // explicitly switch to admin_role so the UPDATE is not silently no-op'd.
    return withAdminConnection(
      { source: 'eaDraftService.resetStalledSendingDrafts', reason: 'cross-org stall recovery' },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        const rows = await tx
          .update(eaDrafts)
          .set({ sendState: 'idle', updatedAt: new Date() })
          .where(
            and(
              eq(eaDrafts.sendState, 'sending'),
              lt(eaDrafts.updatedAt, cutoff),
            ),
          )
          .returning({ id: eaDrafts.id });
        return rows.map((r) => r.id);
      },
    );
  },
};
