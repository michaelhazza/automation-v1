// Support Agent execution loop — orchestrates classify → draft → approval per ticket.
// Spec: tasks/builds/phase-1-showcase-mvps/spec.md §5.2, §5.3.3, §5.3.4, §5.3.7, §5.4.2, §5.4.4
//
// Invariants honoured:
//   INV-8: agent_runs.controller_style = 'native' (set at run create)
//   INV-11: never writes canonical_ticket_messages directly — only via supportDraftDispatchService
//   INV-16: event types verbatim from spec §3.5

import { sql, eq, and } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { db } from '../db/index.js';
import {
  canonicalInboxes,
} from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { classifyTicket } from './skillHandlers/supportClassifyTicket.js';
import { proposeReplyForTicket } from './skillHandlers/supportProposeReply.js';
import { findCustomerHistory } from './skillHandlers/supportFindCustomerHistory.js';
import { approveDraft } from './supportDraftDispatchService.js';
import {
  isHumanActivityTooRecent,
  minutesSinceHumanActivity,
  buildClaimPredicateSql,
  buildTerminalEventPredicateSql,
  requiresCustomerHistory,
  DEFAULT_CLAIM_TTL_MINUTES,
} from './supportAgentExecutionServicePure.js';
import type { SupportInboxAgentConfig } from '../../shared/types/supportInboxAgentConfig.js';
import type { PrincipalContext } from './principal/types.js';

// ---------------------------------------------------------------------------
// tryClaimTicket — optimistic claim via atomic UPDATE
// ---------------------------------------------------------------------------

interface ClaimResult {
  claimed: boolean;
  lastHumanActivityAt: Date | null;
}

/**
 * Attempts to claim a ticket for the agent run.
 * Returns the fresh last_human_activity_at via RETURNING to eliminate TOCTOU
 * between listOpenTickets and the human-activity collision check.
 *
 * Uses database-side now() for clock-skew safety (spec §5.3.4).
 */
export async function tryClaimTicket(
  runId: string,
  ticketId: string,
  orgId: string,
  claimTtlMinutes: number = DEFAULT_CLAIM_TTL_MINUTES,
): Promise<ClaimResult> {
  const claimPredicate = buildClaimPredicateSql(claimTtlMinutes);
  const claimResult = await db.transaction(async (tx) => {
    return tx.execute(sql`
      UPDATE canonical_tickets
      SET    bot_claimed_at = now(),
             bot_claimed_by_run_id = ${runId}::uuid
      WHERE  id = ${ticketId}::uuid
        AND  organisation_id = ${orgId}::uuid
        AND  (${sql.raw(claimPredicate)})
      RETURNING id, last_human_activity_at
    `);
  });

  const rows = Array.isArray(claimResult)
    ? claimResult
    : Array.isArray((claimResult as { rows?: unknown[] }).rows)
      ? (claimResult as { rows: unknown[] }).rows
      : [];

  if (rows.length === 0) {
    return { claimed: false, lastHumanActivityAt: null };
  }

  const row = rows[0] as Record<string, unknown>;
  const lastHumanActivityAt = row.last_human_activity_at
    ? new Date(row.last_human_activity_at as string)
    : null;

  return { claimed: true, lastHumanActivityAt };
}

// ---------------------------------------------------------------------------
// releaseTicketClaim — clear bot_claimed_at on terminal verdict
// ---------------------------------------------------------------------------

async function releaseTicketClaim(ticketId: string, orgId: string): Promise<void> {
  await db.execute(sql`
    UPDATE canonical_tickets
    SET    bot_claimed_at = NULL,
           bot_claimed_by_run_id = NULL
    WHERE  id = ${ticketId}::uuid
      AND  organisation_id = ${orgId}::uuid
  `);
}

// ---------------------------------------------------------------------------
// listOpenTickets — idempotency-guarded ticket list
// ---------------------------------------------------------------------------

interface OpenTicketRow {
  id: string;
  subject: string;
  customerEmail: string | null;
  lastHumanActivityAt: Date | null;
  lastCustomerMessageAt: Date | null;
  createdAt: Date;
}

async function listOpenTickets(
  organisationId: string,
  inboxId: string,
): Promise<OpenTicketRow[]> {
  const terminalEventPredicate = buildTerminalEventPredicateSql();

  const result = await db.execute(sql`
    SELECT
      id,
      subject,
      customer_email,
      last_human_activity_at,
      last_customer_message_at,
      created_at
    FROM canonical_tickets
    WHERE organisation_id = ${organisationId}::uuid
      AND inbox_id = ${inboxId}::uuid
      AND status = ANY(ARRAY['open','pending_internal'])
      AND provider_deleted = false
      AND ${sql.raw(terminalEventPredicate)}
    ORDER BY COALESCE(last_customer_message_at, created_at) ASC
    LIMIT 50
  `);

  const rows = Array.isArray(result)
    ? result
    : Array.isArray((result as { rows?: unknown[] }).rows)
      ? (result as { rows: unknown[] }).rows
      : [];

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    subject: r.subject as string,
    customerEmail: (r.customer_email as string | null) ?? null,
    lastHumanActivityAt: r.last_human_activity_at ? new Date(r.last_human_activity_at as string) : null,
    lastCustomerMessageAt: r.last_customer_message_at ? new Date(r.last_customer_message_at as string) : null,
    createdAt: new Date(r.created_at as string),
  }));
}

// ---------------------------------------------------------------------------
// processInbox — main execution loop
// ---------------------------------------------------------------------------

export interface ProcessInboxOptions {
  subaccountAgentRunId: string;
  inboxId: string;
  organisationId: string;
  subaccountId: string | null;
}

export async function processInbox(options: ProcessInboxOptions): Promise<void> {
  const { subaccountAgentRunId, inboxId, organisationId, subaccountId } = options;

  // Load inbox config
  const orgDb = getOrgScopedDb('supportAgentExecutionService.processInbox');
  const [inboxRow] = await orgDb
    .select({ agentConfig: canonicalInboxes.agentConfig })
    .from(canonicalInboxes)
    .where(
      and(
        eq(canonicalInboxes.id, inboxId),
        eq(canonicalInboxes.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!inboxRow) {
    logger.warn('support.execution.inbox_not_found', { inboxId, organisationId });
    return;
  }

  const inboxConfig = inboxRow.agentConfig as SupportInboxAgentConfig;

  if (inboxConfig.mode === 'disabled') {
    logger.info('support.execution.inbox_disabled', { inboxId, organisationId });
    return;
  }

  // Service principal for calls into supportDraftDispatchService
  const principalCtx: PrincipalContext = {
    type: 'service',
    id: 'supportAgentExecutionService',
    organisationId,
    subaccountId,
    serviceId: 'supportAgentExecutionService',
    teamIds: [],
  };

  const tickets = await listOpenTickets(organisationId, inboxId);

  logger.info('phase1.support.execution_loop_started', {
    subaccountAgentRunId,
    inboxId,
    organisationId,
    ticketCount: tickets.length,
  });

  for (const ticket of tickets) {
    await processTicket({
      ticket,
      runId: subaccountAgentRunId,
      inboxConfig,
      organisationId,
      subaccountId,
      principalCtx,
    });
  }

  logger.info('phase1.support.execution_loop_completed', {
    subaccountAgentRunId,
    inboxId,
    organisationId,
    ticketCount: tickets.length,
  });
}

// ---------------------------------------------------------------------------
// processTicket — per-ticket execution logic
// ---------------------------------------------------------------------------

interface ProcessTicketOptions {
  ticket: OpenTicketRow;
  runId: string;
  inboxConfig: SupportInboxAgentConfig;
  organisationId: string;
  subaccountId: string | null;
  principalCtx: PrincipalContext;
}

async function processTicket(options: ProcessTicketOptions): Promise<void> {
  const { ticket, runId, inboxConfig, organisationId, principalCtx } = options;
  const ticketId = ticket.id;
  const nowMs = Date.now();

  // ── Step 1: Atomic claim ────────────────────────────────────────────────
  // RETURNING last_human_activity_at eliminates TOCTOU between listOpenTickets
  // and the human-activity check below.
  const { claimed, lastHumanActivityAt } = await tryClaimTicket(runId, ticketId, organisationId);

  if (!claimed) {
    logger.info('phase1.support.collision_skipped', {
      ticketId,
      reason: 'concurrent_claim',
      perTicketVerdict: 'skipped_collision',
    });
    return;
  }

  // ── Step 2: Human-activity collision check (fresh value from claim RETURNING)
  const humanActivityRecent = isHumanActivityTooRecent(
    lastHumanActivityAt,
    inboxConfig.collisionWindow.minMinutesSinceHumanActivity,
    nowMs,
  );

  if (humanActivityRecent) {
    await releaseTicketClaim(ticketId, organisationId);
    const lastHumanActivityAgo = minutesSinceHumanActivity(lastHumanActivityAt, nowMs);
    logger.info('phase1.support.collision_skipped', {
      ticketId,
      reason: 'human_active',
      lastHumanActivityAgo: lastHumanActivityAgo ?? undefined,
      perTicketVerdict: 'skipped_collision',
    });
    return;
  }

  // ── Steps 3–8: Classify, draft, route ──────────────────────────────────
  try {
    await executeTicketPipeline({
      ticket,
      runId,
      inboxConfig,
      organisationId,
      principalCtx,
    });
  } catch (err) {
    // Skill error — escalate, emit terminal, release claim
    const claimReleasedAt = new Date().toISOString();
    await releaseTicketClaim(ticketId, organisationId);
    logger.info('phase1.support.ticket_terminal', {
      ticketId,
      perTicketVerdict: 'escalated_to_human',
      reason: 'skill_error',
      claimReleasedAt,
    });
    logger.warn('support.execution.ticket_pipeline_error', {
      ticketId,
      runId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// executeTicketPipeline — classify → draft → approve (no error handling here;
// processTicket catches and releases claim)
// ---------------------------------------------------------------------------

interface ExecuteTicketPipelineOptions {
  ticket: OpenTicketRow;
  runId: string;
  inboxConfig: SupportInboxAgentConfig;
  organisationId: string;
  principalCtx: PrincipalContext;
}

async function executeTicketPipeline(options: ExecuteTicketPipelineOptions): Promise<void> {
  const { ticket, runId, inboxConfig, organisationId, principalCtx } = options;
  const ticketId = ticket.id;

  // ── Step 3: Classify ────────────────────────────────────────────────────
  const classification = await classifyTicket({
    organisationId,
    ticketId,
    runId,
  });

  const minConfidence = inboxConfig.minConfidence ?? 0.8;

  // ── Step 4: Confidence check ────────────────────────────────────────────
  if (classification.confidence < minConfidence) {
    const claimReleasedAt = new Date().toISOString();
    await releaseTicketClaim(ticketId, organisationId);
    logger.info('phase1.support.ticket_terminal', {
      ticketId,
      perTicketVerdict: 'escalated_to_human',
      reason: `low_confidence:${classification.confidence}`,
      claimReleasedAt,
    });
    return;
  }

  // ── Step 5: Customer history lookup (account-issue intents) ─────────────
  let customerHistoryContext: string | undefined;
  if (requiresCustomerHistory(classification.intent)) {
    const historyResult = await findCustomerHistory({
      organisationId,
      ticketId,
      runId,
      customerEmail: ticket.customerEmail,
    });
    customerHistoryContext = historyResult.summary;
  }

  // ── Step 6: Draft via supportProposeReply ──────────────────────────────
  const recentMessages: string[] = [];
  const draftResult = await proposeReplyForTicket(
    {
      organisationId,
      ticketId,
      runId,
      ticketSubject: ticket.subject,
      recentMessages,
      intent: classification.intent,
      urgency: classification.urgency,
      confidence: classification.confidence,
      voiceProfile: inboxConfig.voiceProfile ?? 'neutral',
      customerHistoryContext,
    },
    principalCtx,
  );

  const draftId = draftResult.draftId;

  // ── Step 7: Approval routing (single conditional — spec §5.4.2) ─────────
  if (inboxConfig.mode === 'autonomous') {
    await approveDraft(draftId, principalCtx);
    logger.info('phase1.support.draft_proposed', {
      ticketId,
      draftId,
      controllerStyleAtPropose: 'native',
      riskTierResolved: 6,
      perTicketVerdict: 'drafted_and_dispatched',
    });
  } else {
    // assisted: leave draft in awaiting_review; human reviews via existing review queue + Slack Block Kit
    logger.info('phase1.support.draft_proposed', {
      ticketId,
      draftId,
      controllerStyleAtPropose: 'native',
      riskTierResolved: 6,
      perTicketVerdict: 'drafted_for_review',
    });
  }

  // ── Step 8: Release claim on terminal verdict ──────────────────────────
  await releaseTicketClaim(ticketId, organisationId);
}
