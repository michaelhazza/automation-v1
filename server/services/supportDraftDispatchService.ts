// supportDraftDispatchService — DB-coupled dispatch logic for support reply drafts.
// Spec: tasks/builds/support-desk-canonical/spec.md §8, §14.1, §14.7
//
// All DB access uses getOrgScopedDb(). Pure helpers live in supportDraftDispatchServicePure.ts.

import { eq, and, inArray, sql, notInArray } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  canonicalTickets,
  canonicalTicketDrafts,
  connectorConfigs,
  integrationConnections,
  canonicalInboxes,
} from '../db/schema/index.js';
import type { CanonicalTicketDraft } from '../db/schema/canonicalTicketDrafts.js';
import type { PrincipalContext } from './principal/types.js';
import {
  deriveActionIdempotencyKey,
  planSameRunSupersession,
} from './supportDraftDispatchServicePure.js';
import type { SupportProposedActions } from '../../shared/types/supportProposedActions.js';
import { adapters } from '../adapters/index.js';
import { classifyAdapterError } from '../adapters/integrationAdapter.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { logger } from '../lib/logger.js';
import { SUPPORT_LOG_CODES } from '../../shared/types/supportObservability.js';

// ---------------------------------------------------------------------------
// Internal error helpers
// ---------------------------------------------------------------------------

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404, message });
}

function preflightError(message: string, errorCode: string): Error {
  return Object.assign(new Error(message), { statusCode: 422, message, errorCode });
}

// ---------------------------------------------------------------------------
// proposeReply
// ---------------------------------------------------------------------------

export async function proposeReply(
  input: {
    ticketId: string;
    body: string;
    visibility: 'public' | 'internal';
    proposedActions?: SupportProposedActions;
    runId: string;
  },
  principalCtx: PrincipalContext,
): Promise<CanonicalTicketDraft> {
  const db = getOrgScopedDb('supportDraftDispatchService.proposeReply');

  // Load the ticket
  const [ticket] = await db
    .select()
    .from(canonicalTickets)
    .where(
      and(
        eq(canonicalTickets.id, input.ticketId),
        eq(canonicalTickets.organisationId, principalCtx.organisationId),
      ),
    )
    .limit(1);

  if (!ticket) {
    throw notFoundError('support.ticket.not_found');
  }

  // Load any existing active draft for this (ticketId, runId, visibility)
  const [existingDraft] = await db
    .select({ status: canonicalTicketDrafts.status })
    .from(canonicalTicketDrafts)
    .where(
      and(
        eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
        eq(canonicalTicketDrafts.ticketId, input.ticketId),
        eq(canonicalTicketDrafts.createdByAgentRunId, input.runId),
        eq(canonicalTicketDrafts.proposedVisibility, input.visibility),
        inArray(canonicalTicketDrafts.status, ['draft', 'awaiting_review']),
      ),
    )
    .limit(1);

  const plan = planSameRunSupersession({
    existingDraft: existingDraft ?? null,
    newProposal: { visibility: input.visibility },
  });

  if (plan.action === 'supersede_then_insert') {
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'superseded', updatedAt: sql`NOW()` })
      .where(
        and(
          eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
          eq(canonicalTicketDrafts.ticketId, input.ticketId),
          eq(canonicalTicketDrafts.createdByAgentRunId, input.runId),
          eq(canonicalTicketDrafts.proposedVisibility, input.visibility),
          inArray(canonicalTicketDrafts.status, ['draft', 'awaiting_review']),
        ),
      );
  }

  const [inserted] = await db
    .insert(canonicalTicketDrafts)
    .values({
      organisationId: principalCtx.organisationId,
      subaccountId: principalCtx.subaccountId ?? null,
      connectorConfigId: ticket.connectorConfigId,
      ticketId: input.ticketId,
      proposedBodyText: input.body,
      proposedVisibility: input.visibility,
      proposedActions: input.proposedActions ?? null,
      status: 'draft',
      createdByAgentRunId: input.runId,
      reconciliationAttemptCount: 0,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    })
    .returning();

  return inserted;
}

// ---------------------------------------------------------------------------
// approveDraft
// ---------------------------------------------------------------------------

export async function approveDraft(
  draftId: string,
  principalCtx: PrincipalContext,
  options?: { reviewNotes?: string },
): Promise<{ status: string; messageId?: string }> {
  const db = getOrgScopedDb('supportDraftDispatchService.approveDraft');

  // ── Phase 1: Preflight ───────────────────────────────────────────────────

  const [draft] = await db
    .select()
    .from(canonicalTicketDrafts)
    .where(
      and(
        eq(canonicalTicketDrafts.id, draftId),
        eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
      ),
    )
    .limit(1);

  if (!draft) {
    throw notFoundError('support.draft.not_found');
  }

  // Idempotent: already processed
  if (!['draft', 'awaiting_review'].includes(draft.status)) {
    return { status: draft.status };
  }

  // Load ticket
  const [ticket] = await db
    .select()
    .from(canonicalTickets)
    .where(
      and(
        eq(canonicalTickets.id, draft.ticketId),
        eq(canonicalTickets.organisationId, principalCtx.organisationId),
      ),
    )
    .limit(1);

  if (!ticket) {
    throw notFoundError('support.ticket.not_found');
  }

  if (ticket.status === 'unknown_provider_status') {
    throw preflightError('support.draft.preflight_failed', 'ticket_quarantined');
  }

  // Load inbox agentConfig
  const [inbox] = await db
    .select({ agentConfig: canonicalInboxes.agentConfig })
    .from(canonicalInboxes)
    .where(
      and(
        eq(canonicalInboxes.id, ticket.inboxId),
        eq(canonicalInboxes.organisationId, principalCtx.organisationId),
      ),
    )
    .limit(1);

  if (inbox?.agentConfig?.mode === 'disabled') {
    throw preflightError('support.draft.preflight_failed', 'inbox_disabled');
  }

  // ── Phase 2: Durable transition ─────────────────────────────────────────

  const idempotencyKey = deriveActionIdempotencyKey({
    connectorConfigId: draft.connectorConfigId,
    ticketId: draft.ticketId,
    actionType: draft.proposedVisibility === 'public' ? 'reply' : 'internal_note',
    draftId: draft.id,
  });

  const reviewerUserId =
    principalCtx.type === 'user' ? principalCtx.id : null;

  const updated = await db
    .update(canonicalTicketDrafts)
    .set({
      status: 'dispatching',
      actionIdempotencyKey: idempotencyKey,
      dispatchingStartedAt: sql`NOW()`,
      reviewerUserId,
      reviewedAt: sql`NOW()`,
      reviewNotes: options?.reviewNotes ?? null,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(canonicalTicketDrafts.id, draftId),
        inArray(canonicalTicketDrafts.status, ['draft', 'awaiting_review']),
      ),
    )
    .returning();

  // First-commit-wins: if 0 rows returned, another process beat us
  if (updated.length === 0) {
    const [current] = await db
      .select({ status: canonicalTicketDrafts.status, sentMessageId: canonicalTicketDrafts.sentMessageId })
      .from(canonicalTicketDrafts)
      .where(eq(canonicalTicketDrafts.id, draftId))
      .limit(1);
    return { status: current?.status ?? 'unknown', messageId: current?.sentMessageId ?? undefined };
  }

  // ── Phase 3: Adapter call ────────────────────────────────────────────────

  const [config] = await db
    .select()
    .from(connectorConfigs)
    .where(
      and(
        eq(connectorConfigs.id, draft.connectorConfigId),
        eq(connectorConfigs.organisationId, principalCtx.organisationId),
      ),
    )
    .limit(1);

  if (!config?.connectionId) {
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'failed', updatedAt: sql`NOW()` })
      .where(eq(canonicalTicketDrafts.id, draftId));
    logger.error(SUPPORT_LOG_CODES.DRAFT_FAILED, { draftId, reason: 'missing_connector_config' });
    return { status: 'failed' };
  }

  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, config.connectionId))
    .limit(1);

  const adapter = adapters[config.connectorType];

  if (!connection || !adapter?.ticketing) {
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'failed', updatedAt: sql`NOW()` })
      .where(eq(canonicalTicketDrafts.id, draftId));
    logger.error(SUPPORT_LOG_CODES.DRAFT_FAILED, { draftId, reason: 'missing_adapter_or_connection' });
    return { status: 'failed' };
  }

  try {
    let replyId: string;

    if (draft.proposedVisibility === 'public') {
      const result = await adapter.ticketing.addReply(
        connection,
        ticket.externalId,
        draft.proposedBodyText,
        { idempotencyKey },
      );
      if (!result.success) {
        throw new Error(result.error?.message ?? 'adapter returned success: false');
      }
      replyId = result.replyId;
    } else {
      const result = await adapter.ticketing.addInternalNote(
        connection,
        ticket.externalId,
        draft.proposedBodyText,
        { idempotencyKey },
      );
      if (!result.success) {
        throw new Error(result.error?.message ?? 'adapter returned success: false');
      }
      replyId = result.replyId;
    }

    const messageId = replyId || draft.id;
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'sent', sentMessageId: messageId, updatedAt: sql`NOW()` })
      .where(eq(canonicalTicketDrafts.id, draftId));

    logger.info(SUPPORT_LOG_CODES.DRAFT_SENT, { draftId, messageId });
    return { status: 'sent', messageId };
  } catch (err: unknown) {
    const adapterError = classifyAdapterError(err, config.connectorType, 'addReply');

    if (adapterError.retryable) {
      await db
        .update(canonicalTicketDrafts)
        .set({ status: 'needs_reconciliation', updatedAt: sql`NOW()` })
        .where(eq(canonicalTicketDrafts.id, draftId));

      const boss = await getPgBoss();
      await boss.send('support-draft-reconciliation', {
        draftId,
        organisationId: principalCtx.organisationId,
      }, getJobConfig('support-draft-reconciliation'));
      return { status: 'needs_reconciliation' };
    }

    // Terminal failure
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'failed', updatedAt: sql`NOW()` })
      .where(eq(canonicalTicketDrafts.id, draftId));

    logger.error(SUPPORT_LOG_CODES.DRAFT_FAILED, { draftId, errorCode: adapterError.code });
    return { status: 'failed' };
  }
}

// ---------------------------------------------------------------------------
// rejectDraft
// ---------------------------------------------------------------------------

export async function rejectDraft(
  draftId: string,
  principalCtx: PrincipalContext,
  reason: string,
): Promise<void> {
  const db = getOrgScopedDb('supportDraftDispatchService.rejectDraft');

  const [draft] = await db
    .select({ status: canonicalTicketDrafts.status })
    .from(canonicalTicketDrafts)
    .where(
      and(
        eq(canonicalTicketDrafts.id, draftId),
        eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
      ),
    )
    .limit(1);

  if (!draft) {
    throw notFoundError('support.draft.not_found');
  }

  // Idempotent: already in a terminal/rejected state (dispatching → rejected is forbidden)
  if (['rejected', 'sent', 'failed', 'expired', 'superseded', 'dispatching'].includes(draft.status)) {
    return;
  }

  const reviewerUserId =
    principalCtx.type === 'user' ? principalCtx.id : null;

  // Use notInArray to prevent race-condition overwrites of terminal states
  await db
    .update(canonicalTicketDrafts)
    .set({
      status: 'rejected',
      reviewNotes: reason,
      reviewerUserId,
      reviewedAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(canonicalTicketDrafts.id, draftId),
        eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
        notInArray(canonicalTicketDrafts.status, ['rejected', 'sent', 'failed', 'expired', 'superseded', 'dispatching']),
      ),
    );

  logger.info(SUPPORT_LOG_CODES.DRAFT_REJECTED, { draftId, reason });
}
