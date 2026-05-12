import { eq, and, lt, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { withAdminConnection } from '../../lib/adminDbConnection.js';
import { eaDrafts } from '../../db/schema/eaDrafts.js';
import { actionService } from '../actionService.js';
import type { EADraftKind } from '../../../shared/types/eaDraft.js';

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
   * in one transaction. The action row is created first via actionService.proposeAction,
   * then the draft FK'd to it.
   */
  async createDraftWithProposal(
    input: CreateDraftInput,
    ctx: { organisationId: string },
  ): Promise<CreateDraftResult> {
    const actionType = KIND_TO_ACTION_TYPE[input.kind];
    const idempotencyKey = `ea_draft:${input.agentRunId}:${input.kind}:${input.ownerUserId}`;

    const proposalResult = await actionService.proposeAction({
      organisationId: ctx.organisationId,
      subaccountId: input.subaccountId,
      agentId: input.agentId,
      agentRunId: input.agentRunId,
      actionType,
      idempotencyKey,
      payload: { ...input.body, targetRef: input.targetRef ?? null, kind: input.kind },
      metadata: { kind: 'ea_draft' },
      gateOverride: 'review',
    });

    const [draft] = await db
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
    const rows = await db
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
    await db
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
    await db
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
    const rows = await db
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
   */
  async listDrafts(ctx: { organisationId: string }) {
    return db
      .select()
      .from(eaDrafts)
      .where(eq(eaDrafts.organisationId, ctx.organisationId))
      .orderBy(sql`${eaDrafts.createdAt} DESC`)
      .limit(50);
  },

  /**
   * Get a single draft by ID, scoped to the organisation.
   */
  async getDraft(draftId: string, ctx: { organisationId: string }) {
    const [draft] = await db
      .select()
      .from(eaDrafts)
      .where(
        and(
          eq(eaDrafts.id, draftId),
          eq(eaDrafts.organisationId, ctx.organisationId),
        ),
      );
    return draft ?? null;
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
