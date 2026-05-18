// supportDraftDispatchService — DB-coupled dispatch logic for support reply drafts.
// Spec: tasks/builds/support-desk-canonical/spec.md §8, §14.1, §14.7
//
// All DB access uses getOrgScopedDb(). Pure helpers live in supportDraftDispatchServicePure.ts.
// Preflight pure evaluator in supportDraftDispatchPreflightPure.ts.

import { eq, and, inArray, or, sql, notInArray } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  canonicalTickets,
  canonicalTicketDrafts,
  canonicalSupportAgents,
  connectorConfigs,
  integrationConnections,
  canonicalInboxes,
  actionAttempts,
} from '../db/schema/index.js';
import type { CanonicalTicketDraft } from '../db/schema/canonicalTicketDrafts.js';
import type { PrincipalContext } from './principal/types.js';
import {
  deriveActionIdempotencyKey,
  planSameRunSupersession,
} from './supportDraftDispatchServicePure.js';
import {
  evaluatePreflight,
  checkTicketStatusEligibility,
  checkCollisionWindow,
  checkCustomerMatchPolicy,
  checkSupersession,
} from './supportDraftDispatchPreflightPure.js';
import type { SupportProposedActions } from '../../shared/types/supportProposedActions.js';
import type { SupportInboxAgentConfig } from '../../shared/types/supportInboxAgentConfig.js';
import { adapters } from '../adapters/index.js';
import { classifyAdapterError } from '../adapters/integrationAdapter.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { logger } from '../lib/logger.js';
import { SUPPORT_LOG_CODES } from '../../shared/types/supportObservability.js';
import { auditService } from './auditService.js';

// ---------------------------------------------------------------------------
// Internal error helpers
// ---------------------------------------------------------------------------

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404, message });
}

function forbiddenError(errorCode: string, message?: string): Error {
  return Object.assign(new Error(message ?? errorCode), { statusCode: 403, errorCode });
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
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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

  // Load inbox agent_config to choose initial draft state per spec §8 / §934:
  //   assisted  → 'awaiting_review' (so the human-review queue surfaces it)
  //   autonomous → 'draft' (proceeds without the review queue gate)
  //   disabled  → 'awaiting_review' (treated as assisted: caller must approve)
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [inboxRow] = await db
    .select({ agentConfig: canonicalInboxes.agentConfig })
    .from(canonicalInboxes)
    .where(
      and(
        eq(canonicalInboxes.id, ticket.inboxId),
        eq(canonicalInboxes.organisationId, principalCtx.organisationId),
      ),
    )
    .limit(1);
  const inboxMode =
    (inboxRow?.agentConfig as SupportInboxAgentConfig | null | undefined)?.mode ?? 'assisted';
  const initialStatus: 'draft' | 'awaiting_review' =
    inboxMode === 'autonomous' ? 'draft' : 'awaiting_review';

  // Load any existing active draft for this (ticketId, runId, visibility)
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
      status: initialStatus,
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
  options?: { reviewNotes?: string; overrideCollision?: boolean },
): Promise<{ status: string; messageId?: string }> {
  // ── S2 guard: overrideCollision requires a human principal (§4.2) ────────
  // This check fires BEFORE any DB read. No audit row is written on this path.
  if (options?.overrideCollision === true && principalCtx.type !== 'user') {
    throw forbiddenError(
      'support.draft.override_collision_human_only',
      'overrideCollision requires a human principal',
    );
  }

  const db = getOrgScopedDb('supportDraftDispatchService.approveDraft');

  // ── Phase 1: Preflight ───────────────────────────────────────────────────

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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

  // Subaccount scope assertion: principal scoped to a subaccount must not mutate
  // drafts whose ticket belongs to a different subaccount.
  if (principalCtx.subaccountId !== null && ticket.subaccountId !== principalCtx.subaccountId) {
    throw forbiddenError('support.draft.scope_mismatch');
  }

  // Load inbox agentConfig
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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

  // Resolve assignee agent kind when a human-assignee check is needed
  let assigneeAgentKind: 'human' | 'bot' | null = null;
  if (ticket.assigneeAgentId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [assignee] = await db
      .select({ agentKind: canonicalSupportAgents.agentKind })
      .from(canonicalSupportAgents)
      .where(
        and(
          eq(canonicalSupportAgents.id, ticket.assigneeAgentId),
          eq(canonicalSupportAgents.organisationId, principalCtx.organisationId),
        ),
      )
      .limit(1);
    assigneeAgentKind = assignee?.agentKind ?? null;
  }

  const agentConfig = inbox?.agentConfig as SupportInboxAgentConfig | null | undefined;
  const callerIsAutonomousAgent = principalCtx.type !== 'user';

  // ── Checks 1–3: inbox mode + ticket quarantine + subaccount scope ────────
  // Checks 1-2 are evaluated via the shared evaluatePreflight helper.
  // Check 3 (subaccount scope) is the scope_mismatch guard already applied above.
  const legacyPreflight = evaluatePreflight({
    draftStatus: draft.status,
    proposedVisibility: draft.proposedVisibility as 'public' | 'internal',
    inboxMode: agentConfig?.mode ?? null,
    ticketStatus: ticket.status,
    customerContactId: ticket.canonicalContactId,
    assigneeAgentId: ticket.assigneeAgentId,
    lastHumanActivityAt: ticket.lastHumanActivityAt ?? null,
    collisionWindowMinutes: agentConfig?.collisionWindow?.minMinutesSinceHumanActivity ?? 30,
    respectHumanAssignee: agentConfig?.collisionWindow?.respectHumanAssignee ?? true,
    assigneeAgentKind,
    hasNewerDraft: false, // supersession re-checked below with tuple comparison
    overrideCollision: false, // collision re-checked below with named function
    callerIsAutonomousAgent: false, // S2 already enforced above before any DB read
  });

  // Only propagate inbox_disabled and ticket_quarantined from the legacy helper
  // (checks 4-7 are handled by the named functions below per S1 spec §4.1)
  if (!legacyPreflight.ok && (legacyPreflight.reason === 'inbox_disabled' || legacyPreflight.reason === 'ticket_quarantined')) {
    throw preflightError('support.draft.preflight_failed', legacyPreflight.reason);
  }

  // ── Check 4: Ticket-status eligibility ──────────────────────────────────
  // Map proposedVisibility to the action type for the eligibility matrix.
  // set_status is handled by a separate code path; approveDraft only handles reply drafts.
  const draftAction =
    (draft.proposedVisibility as string) === 'public'
      ? 'support.propose_reply' as const
      : 'support.add_internal_note' as const;

  const check4 = checkTicketStatusEligibility({
    ticket: { status: ticket.status },
    action: draftAction,
    agentConfig: {
      optIns: {
        autonomousReplyOnWaitingOnCustomer:
          agentConfig?.optIns?.autonomousReplyOnWaitingOnCustomer,
        postResolutionFollowUp:
          agentConfig?.optIns?.postResolutionFollowUp,
      },
    },
  });
  if (!check4.ok) {
    throw forbiddenError(
      'support.draft.preflight.ticket_status_ineligible',
      'support.draft.preflight_failed: ticket_status_ineligible',
    );
  }

  // ── Check 5: Collision window ────────────────────────────────────────────
  // Skip when overrideCollision=true AND human principal (S2 already enforced).
  const isHumanOverride = options?.overrideCollision === true && !callerIsAutonomousAgent;

  const check5 = checkCollisionWindow({
    ticket: { lastHumanActivityAt: ticket.lastHumanActivityAt ?? null },
    agentConfig: {
      collisionWindow: {
        minMinutesSinceHumanActivity: agentConfig?.collisionWindow?.minMinutesSinceHumanActivity ?? 30,
        respectHumanAssignee: agentConfig?.collisionWindow?.respectHumanAssignee ?? true,
      },
    },
    now: new Date(),
    overrideCollision: options?.overrideCollision === true,
    principalKind: callerIsAutonomousAgent ? 'agent' : 'human',
    assigneeIsHuman: assigneeAgentKind === 'human',
  });
  if (!check5.ok) {
    logger.info(SUPPORT_LOG_CODES.TICKET_HUMAN_COLLISION_BLOCKED, {
      organisationId: principalCtx.organisationId,
      connectorConfigId: draft.connectorConfigId,
      ticketId: draft.ticketId,
      draftId: draft.id,
      inboxId: ticket.inboxId,
      lastHumanActivityAt: ticket.lastHumanActivityAt,
      minMinutesRequired: agentConfig?.collisionWindow?.minMinutesSinceHumanActivity ?? 30,
    });
    throw forbiddenError(
      'support.draft.preflight.human_collision_blocked',
      'support.draft.preflight_failed: human_collision_blocked',
    );
  }

  // ── Check 6: Customer-match policy gate (forward-compat no-op in v1) ────
  const check6 = checkCustomerMatchPolicy({
    ticket: { canonicalContactId: ticket.canonicalContactId },
    agentConfig: {
      optIns: {
        requireCustomerMatch: (agentConfig?.optIns as { requireCustomerMatch?: boolean } | undefined)?.requireCustomerMatch,
      },
    },
  });
  if (!check6.ok) {
    throw forbiddenError(
      'support.draft.preflight.customer_match_required',
      'support.draft.preflight_failed: customer_match_required',
    );
  }

  // ── Check 7: Supersession — newer draft query with tuple comparison ──────
  // Uses (created_at, id) > ($2, $3) to handle same-millisecond ties correctly.
  // IMPORTANT: do NOT simplify to created_at > $2 alone (per spec §4.1 check 7).
  // NOTE: proposedVisibility is intentionally NOT filtered — any newer draft for
  // the same ticket supersedes regardless of visibility (spec §4.1 check 7, plan §C6 step 7).
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [newerDraftRow] = await db
    .select({ id: canonicalTicketDrafts.id })
    .from(canonicalTicketDrafts)
    .where(
      and(
        eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
        eq(canonicalTicketDrafts.ticketId, draft.ticketId),
        sql`(${canonicalTicketDrafts.createdAt}, ${canonicalTicketDrafts.id}) > (${draft.createdAt.toISOString()}, ${draft.id})`,
        inArray(canonicalTicketDrafts.status, ['awaiting_review', 'dispatching', 'needs_reconciliation', 'sent']),
      ),
    )
    .limit(1);

  const check7 = checkSupersession({
    candidateDraft: { id: draft.id, createdAt: draft.createdAt },
    hasNewerDraft: newerDraftRow !== undefined,
  });
  if (!check7.ok) {
    throw forbiddenError(
      'support.draft.preflight.superseded_by_newer_draft',
      'support.draft.preflight_failed: superseded_by_newer_draft',
    );
  }

  // Collision override: if the caller is a human and overrideCollision was set, write audit event (§8.6 #2)
  // S2 already enforced above: if we reach here with isHumanOverride=true, the principal is human.
  if (isHumanOverride) {
    const actorUserId = principalCtx.type === 'user' ? principalCtx.id : undefined;
    await auditService.log({
      organisationId: principalCtx.organisationId,
      actorId: actorUserId,
      actorType: 'user',
      action: 'support.draft.collision_override',
      entityType: 'canonical_ticket_drafts',
      entityId: draft.id,
      metadata: {
        draftId: draft.id,
        ticketId: draft.ticketId,
        reviewNote: options.reviewNotes ?? null,
        lastHumanActivityAt: ticket.lastHumanActivityAt ?? null,
        minMinutesRequired: agentConfig?.collisionWindow?.minMinutesSinceHumanActivity ?? 30,
      },
    });
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

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
        // PTH-ADV-1 defence-in-depth: explicit org-id filter per DEVELOPMENT_GUIDELINES §1.
        // FORCE-RLS on canonical_ticket_drafts is the primary boundary; this filter is
        // a redundant guard so a future RLS-bypass path (admin role escalation, missing
        // GUC) cannot mutate another org's draft on the durable state-claim transition.
        eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
        inArray(canonicalTicketDrafts.status, ['draft', 'awaiting_review']),
      ),
    )
    .returning();

  // First-commit-wins: if 0 rows returned, another process beat us
  if (updated.length === 0) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [current] = await db
      .select({ status: canonicalTicketDrafts.status, sentMessageId: canonicalTicketDrafts.sentMessageId })
      .from(canonicalTicketDrafts)
      .where(
        and(
          eq(canonicalTicketDrafts.id, draftId),
          // PTH-ADV-1 defence-in-depth: see UPDATE clause above for rationale.
          eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
        ),
      )
      .limit(1);
    return { status: current?.status ?? 'unknown', messageId: current?.sentMessageId ?? undefined };
  }

  // ── Phase 3: Adapter call ────────────────────────────────────────────────

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'failed', updatedAt: sql`NOW()` })
      .where(eq(canonicalTicketDrafts.id, draftId));
    logger.error(SUPPORT_LOG_CODES.DRAFT_FAILED, { draftId, reason: 'missing_connector_config' });
    return { status: 'failed' };
  }

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, config.connectionId), eq(integrationConnections.organisationId, principalCtx.organisationId)))
    .limit(1);

  const adapter = adapters[config.connectorType];

  if (!connection || !adapter?.ticketing) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'failed', updatedAt: sql`NOW()` })
      .where(eq(canonicalTicketDrafts.id, draftId));
    logger.error(SUPPORT_LOG_CODES.DRAFT_FAILED, { draftId, reason: 'missing_adapter_or_connection' });
    return { status: 'failed' };
  }

  // ── action_attempts ledger (§14.1 + OQ-3 closure: no native idempotency) ──
  // Lookup-then-insert before the adapter call to prevent duplicate provider sends.
  const actionType = draft.proposedVisibility === 'public' ? 'reply' : 'internal_note';

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [existingAttempt] = await db
    .select()
    .from(actionAttempts)
    .where(
      and(
        eq(actionAttempts.connectorConfigId, draft.connectorConfigId),
        eq(actionAttempts.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (existingAttempt?.attemptStatus === 'succeeded') {
    // Already dispatched successfully on a prior attempt. The provider has
    // acknowledged the send, but the canonical message row may not yet exist
    // (or may already have been back-linked). Park in needs_reconciliation and
    // let the back-link / reconciliation routine resolve to terminal `sent` —
    // never fabricate a UUID for `sent_message_id` from the provider response id.
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'needs_reconciliation', updatedAt: sql`NOW()` })
      .where(
        and(
          eq(canonicalTicketDrafts.id, draftId),
          inArray(canonicalTicketDrafts.status, ['draft', 'awaiting_review', 'dispatching']),
        ),
      );
    const boss = await getPgBoss();
    await boss.send('support-draft-reconciliation', {
      draftId,
      organisationId: principalCtx.organisationId,
    }, getJobConfig('support-draft-reconciliation'));
    logger.info(SUPPORT_LOG_CODES.ACTION_RETRY_IDEMPOTENT, {
      draftId,
      idempotencyKey,
      providerResponseId: existingAttempt.providerResponseId,
    });
    return { status: 'needs_reconciliation' };
  }

  // Insert in_flight row if absent (UNIQUE constraint handles concurrent races).
  if (!existingAttempt) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .insert(actionAttempts)
      .values({
        organisationId: principalCtx.organisationId,
        connectorConfigId: draft.connectorConfigId,
        idempotencyKey,
        actionType,
        attemptStatus: 'in_flight',
        attemptedAt: new Date(),
      })
      .onConflictDoNothing();
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

    // Mark the ledger row as succeeded — providerResponseId carries the provider's
    // (non-UUID) message id for retry idempotency lookup. The canonical_ticket_messages
    // UUID is resolved later by webhook back-link or polling reconciliation (per spec
    // §11.7 invariant: sent_message_id is a FK to canonical_ticket_messages.id).
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(actionAttempts)
      .set({ attemptStatus: 'succeeded', succeededAt: new Date(), providerResponseId: replyId })
      .where(
        and(
          eq(actionAttempts.connectorConfigId, draft.connectorConfigId),
          eq(actionAttempts.idempotencyKey, idempotencyKey),
        ),
      );

    // Provider has acknowledged the send, but the canonical message row has not yet
    // landed (ingest will create it via webhook or poll). Park the draft in
    // needs_reconciliation so the back-link routine (or the reconciliation worker)
    // can transition it to terminal `sent` once `canonical_ticket_messages.id` is
    // known. Marking `sent` here would either violate the FK on sent_message_id or
    // the `sent ⇒ sent_message_id IS NOT NULL` CHECK constraint.
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'needs_reconciliation', updatedAt: sql`NOW()` })
      .where(eq(canonicalTicketDrafts.id, draftId));

    const boss = await getPgBoss();
    await boss.send('support-draft-reconciliation', {
      draftId,
      organisationId: principalCtx.organisationId,
    }, getJobConfig('support-draft-reconciliation'));

    logger.info(SUPPORT_LOG_CODES.ACTION_RETRY_IDEMPOTENT, {
      draftId,
      providerResponseId: replyId,
      transition: 'dispatching_to_needs_reconciliation_post_provider_ack',
    });
    return { status: 'needs_reconciliation' };
  } catch (err: unknown) {
    const adapterError = classifyAdapterError(err, config.connectorType, 'addReply');

    if (adapterError.retryable) {
      // Leave the ledger row in 'in_flight' — reconciliation worker will update it.
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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

    // Terminal failure — mark ledger row failed
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(actionAttempts)
      .set({ attemptStatus: 'failed' })
      .where(
        and(
          eq(actionAttempts.connectorConfigId, draft.connectorConfigId),
          eq(actionAttempts.idempotencyKey, idempotencyKey),
        ),
      );

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(canonicalTicketDrafts)
      .set({ status: 'failed', updatedAt: sql`NOW()` })
      .where(eq(canonicalTicketDrafts.id, draftId));

    logger.error(SUPPORT_LOG_CODES.DRAFT_FAILED, { draftId, errorCode: adapterError.code });
    return { status: 'failed' };
  }
}

// ---------------------------------------------------------------------------
// listDraftsForReview
// ---------------------------------------------------------------------------

export async function listDraftsForReview(
  filter: { ticketId?: string },
  principalCtx: PrincipalContext,
): Promise<CanonicalTicketDraft[]> {
  const db = getOrgScopedDb('supportDraftDispatchService.listDraftsForReview');
  const draftConditions = [
    eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
    or(
      inArray(canonicalTicketDrafts.status, ['awaiting_review', 'needs_reconciliation']),
      sql`${canonicalTicketDrafts.status} = 'dispatching' AND ${canonicalTicketDrafts.dispatchingStartedAt} < NOW() - INTERVAL '30 seconds'`,
    ),
  ];
  if (filter.ticketId) {
    draftConditions.push(eq(canonicalTicketDrafts.ticketId, filter.ticketId));
  }

  if (principalCtx.subaccountId !== null) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rows = await db
      .select({ draft: canonicalTicketDrafts })
      .from(canonicalTicketDrafts)
      .innerJoin(canonicalTickets, eq(canonicalTicketDrafts.ticketId, canonicalTickets.id))
      .where(and(...draftConditions, eq(canonicalTickets.subaccountId, principalCtx.subaccountId)))
      .orderBy(canonicalTicketDrafts.createdAt);
    return rows.map(r => r.draft);
  }

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  return db
    .select()
    .from(canonicalTicketDrafts)
    .where(and(...draftConditions))
    .orderBy(canonicalTicketDrafts.createdAt);
}

// ---------------------------------------------------------------------------
// getDraftById
// ---------------------------------------------------------------------------

export async function getDraftById(
  draftId: string,
  principalCtx: PrincipalContext,
): Promise<CanonicalTicketDraft> {
  const db = getOrgScopedDb('supportDraftDispatchService.getDraftById');

  if (principalCtx.subaccountId !== null) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [row] = await db
      .select({ draft: canonicalTicketDrafts })
      .from(canonicalTicketDrafts)
      .innerJoin(canonicalTickets, eq(canonicalTicketDrafts.ticketId, canonicalTickets.id))
      .where(
        and(
          eq(canonicalTicketDrafts.id, draftId),
          eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
          eq(canonicalTickets.subaccountId, principalCtx.subaccountId),
        ),
      )
      .limit(1);
    if (!row) {
      throw notFoundError('support.draft.not_found');
    }
    return row.draft;
  }

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
  return draft;
}

// ---------------------------------------------------------------------------
// editDraft
// ---------------------------------------------------------------------------

export async function editDraft(
  draftId: string,
  proposedBodyText: string,
  principalCtx: PrincipalContext,
): Promise<CanonicalTicketDraft> {
  const db = getOrgScopedDb('supportDraftDispatchService.editDraft');

  // Subaccount scope assertion: load the draft and its ticket before mutating.
  if (principalCtx.subaccountId !== null) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [draftRow] = await db
      .select({ ticketId: canonicalTicketDrafts.ticketId })
      .from(canonicalTicketDrafts)
      .where(
        and(
          eq(canonicalTicketDrafts.id, draftId),
          eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
        ),
      )
      .limit(1);
    if (!draftRow) {
      throw Object.assign(new Error('support.draft.not_found_or_wrong_status'), { statusCode: 422, message: 'support.draft.not_found_or_wrong_status' });
    }
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [ticket] = await db
      .select({ subaccountId: canonicalTickets.subaccountId })
      .from(canonicalTickets)
      .where(
        and(
          eq(canonicalTickets.id, draftRow.ticketId),
          eq(canonicalTickets.organisationId, principalCtx.organisationId),
        ),
      )
      .limit(1);
    if (!ticket || ticket.subaccountId !== principalCtx.subaccountId) {
      throw forbiddenError('support.draft.scope_mismatch');
    }
  }

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [updated] = await db
    .update(canonicalTicketDrafts)
    .set({ proposedBodyText, updatedAt: new Date() })
    .where(
      and(
        eq(canonicalTicketDrafts.id, draftId),
        eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
        inArray(canonicalTicketDrafts.status, ['draft', 'awaiting_review']),
      ),
    )
    .returning();
  if (!updated) {
    throw Object.assign(new Error('support.draft.not_found_or_wrong_status'), { statusCode: 422, message: 'support.draft.not_found_or_wrong_status' });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// manualResolveDraft
// ---------------------------------------------------------------------------

export async function manualResolveDraft(
  draftId: string,
  action: 'mark_sent' | 'mark_failed' | 'retry_reconciliation',
  principalCtx: PrincipalContext,
  options?: { notes?: string },
): Promise<void> {
  const db = getOrgScopedDb('supportDraftDispatchService.manualResolveDraft');
  const now = new Date();

  // Subaccount scope assertion: load the draft and its ticket before mutating.
  if (principalCtx.subaccountId !== null) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [draftRow] = await db
      .select({ ticketId: canonicalTicketDrafts.ticketId })
      .from(canonicalTicketDrafts)
      .where(
        and(
          eq(canonicalTicketDrafts.id, draftId),
          eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
        ),
      )
      .limit(1);
    if (!draftRow) {
      throw Object.assign(new Error('support.draft.not_found_or_wrong_status'), { statusCode: 422, message: 'support.draft.not_found_or_wrong_status' });
    }
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [ticket] = await db
      .select({ subaccountId: canonicalTickets.subaccountId })
      .from(canonicalTickets)
      .where(
        and(
          eq(canonicalTickets.id, draftRow.ticketId),
          eq(canonicalTickets.organisationId, principalCtx.organisationId),
        ),
      )
      .limit(1);
    if (!ticket || ticket.subaccountId !== principalCtx.subaccountId) {
      throw forbiddenError('support.draft.scope_mismatch');
    }
  }

  if (action === 'mark_sent') {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const result = await db
      .update(canonicalTicketDrafts)
      .set({ status: 'manually_marked_sent', updatedAt: now })
      .where(
        and(
          eq(canonicalTicketDrafts.id, draftId),
          eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
          eq(canonicalTicketDrafts.status, 'needs_reconciliation'),
        ),
      )
      .returning({ id: canonicalTicketDrafts.id });
    if (result.length === 0) {
      throw Object.assign(new Error('support.draft.not_found_or_wrong_status'), { statusCode: 422, message: 'support.draft.not_found_or_wrong_status' });
    }

  } else if (action === 'mark_failed') {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const result = await db
      .update(canonicalTicketDrafts)
      .set({ status: 'failed', updatedAt: now })
      .where(
        and(
          eq(canonicalTicketDrafts.id, draftId),
          eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
          eq(canonicalTicketDrafts.status, 'needs_reconciliation'),
        ),
      )
      .returning({ id: canonicalTicketDrafts.id });
    if (result.length === 0) {
      throw Object.assign(new Error('support.draft.not_found_or_wrong_status'), { statusCode: 422, message: 'support.draft.not_found_or_wrong_status' });
    }

  } else if (action === 'retry_reconciliation') {
    // Spec §1014: "resets the reconciliation budget and re-enqueues the draft
    // for the §8.4 worker." The worker only processes drafts in
    // `needs_reconciliation` status — keep the state, reset the attempt count,
    // and preserve `dispatching_started_at` so the back-link timestamp match
    // (which compares against the original send time) still works.
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const result = await db
      .update(canonicalTicketDrafts)
      .set({ reconciliationAttemptCount: 0, updatedAt: now })
      .where(
        and(
          eq(canonicalTicketDrafts.id, draftId),
          eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
          eq(canonicalTicketDrafts.status, 'needs_reconciliation'),
        ),
      )
      .returning({ id: canonicalTicketDrafts.id });
    if (result.length === 0) {
      throw Object.assign(new Error('support.draft.not_found_or_wrong_status'), { statusCode: 422, message: 'support.draft.not_found_or_wrong_status' });
    }
    const boss = await getPgBoss();
    await boss.send('support-draft-reconciliation', { organisationId: principalCtx.organisationId, draftId }, getJobConfig('support-draft-reconciliation'));
  } else {
    throw Object.assign(new Error('support.draft.invalid_action'), { statusCode: 422, message: 'support.draft.invalid_action' });
  }

  void options; // notes param reserved for future audit log integration
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

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [draft] = await db
    .select({ status: canonicalTicketDrafts.status, ticketId: canonicalTicketDrafts.ticketId })
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

  // Subaccount scope assertion: load ticket to confirm the draft belongs to the
  // principal's subaccount before allowing the mutation.
  if (principalCtx.subaccountId !== null) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [ticket] = await db
      .select({ subaccountId: canonicalTickets.subaccountId })
      .from(canonicalTickets)
      .where(
        and(
          eq(canonicalTickets.id, draft.ticketId),
          eq(canonicalTickets.organisationId, principalCtx.organisationId),
        ),
      )
      .limit(1);
    if (!ticket || ticket.subaccountId !== principalCtx.subaccountId) {
      throw forbiddenError('support.draft.scope_mismatch');
    }
  }

  // Idempotent: already in a terminal/rejected state (dispatching → rejected is forbidden)
  if (['rejected', 'sent', 'failed', 'expired', 'superseded', 'dispatching'].includes(draft.status)) {
    return;
  }

  const reviewerUserId =
    principalCtx.type === 'user' ? principalCtx.id : null;

  // Use notInArray to prevent race-condition overwrites of terminal states
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
