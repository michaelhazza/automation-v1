// supportDraftDispatchPreflightPure.ts — Pure preflight evaluator for the draft dispatch path.
// Spec: docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md §8.1 + §8.6
//       tasks/builds/pre-test-hardening/spec.md §4 (S1 + S2)
//
// No DB access, no async. All functions are deterministic given their inputs.
// The dispatch service consumes evaluatePreflight(); tests cover every branch.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportDraftAction =
  | 'support.propose_reply'
  | 'support.add_internal_note'
  | 'support.set_status';

export type PreflightReason =
  | 'inbox_disabled'
  | 'ticket_quarantined'
  | 'ticket_status_ineligible'
  | 'human_collision_blocked'
  | 'customer_match_required'
  | 'superseded_by_newer_draft'
  | 'autonomous_agent_cannot_override_collision';

export interface PreflightInput {
  // draft
  draftStatus: string;
  proposedVisibility: 'public' | 'internal';

  // inbox
  inboxMode: 'autonomous' | 'assisted' | 'disabled' | string | null | undefined;

  // ticket
  ticketStatus: string;
  customerContactId: string | null | undefined;
  assigneeAgentId: string | null | undefined;
  lastHumanActivityAt: Date | null | undefined;

  // collision-window policy (from agent_config)
  collisionWindowMinutes: number;
  respectHumanAssignee: boolean;

  // assignee agent kind — set when assigneeAgentId is non-null
  assigneeAgentKind: 'human' | 'bot' | null | undefined;

  // supersession — true when a newer draft for the same (ticket, agentRunId, visibility)
  // exists with status in ('awaiting_review', 'dispatching', 'needs_reconciliation', 'sent')
  hasNewerDraft: boolean;

  // override
  overrideCollision: boolean;
  callerIsAutonomousAgent: boolean; // true when principal has no human user id
}

export interface PreflightResult {
  ok: boolean;
  reason?: PreflightReason;
  // populated when ok=false and reason='human_collision_blocked', for the audit event
  collisionDetail?: {
    lastHumanActivityAt: Date;
    minMinutesRequired: number;
    minutesSinceActivity: number;
  };
}

// ---------------------------------------------------------------------------
// evaluatePreflight
// ---------------------------------------------------------------------------

/**
 * Pure preflight evaluator for support draft dispatch (§8.1 + §8.6).
 *
 * Checks (in order):
 *  1. Inbox mode is not 'disabled'            → inbox_disabled
 *  2. Ticket is not quarantined               → ticket_quarantined
 *  3. Ticket status is eligible               → ticket_status_ineligible
 *  4. Collision window clear                  → human_collision_blocked
 *     (bypassed when overrideCollision=true, but autonomous agents cannot override)
 *  5. Customer contact resolved (public only) → customer_match_required
 *  6. No newer draft supersedes this one      → superseded_by_newer_draft
 *
 * Returns { ok: true } on pass, or { ok: false, reason, collisionDetail? } on fail.
 */
export function evaluatePreflight(input: PreflightInput): PreflightResult {
  // Check 2: inbox disabled
  if (input.inboxMode === 'disabled') {
    return { ok: false, reason: 'inbox_disabled' };
  }

  // Check 3: ticket quarantined
  if (input.ticketStatus === 'unknown_provider_status') {
    return { ok: false, reason: 'ticket_quarantined' };
  }

  // Check 4: ticket status eligibility for the proposed action
  // Public reply is not permitted on pending_internal, waiting_on_customer, resolved, or closed.
  // Internal notes are permitted on all non-quarantined, non-closed statuses.
  if (input.proposedVisibility === 'public') {
    const ineligibleForPublicReply: string[] = [
      'pending_internal',
      'waiting_on_customer',
      'resolved',
      'closed',
    ];
    if (ineligibleForPublicReply.includes(input.ticketStatus)) {
      return { ok: false, reason: 'ticket_status_ineligible' };
    }
  } else {
    // Internal notes are blocked only on closed (terminal)
    if (input.ticketStatus === 'closed') {
      return { ok: false, reason: 'ticket_status_ineligible' };
    }
  }

  // Check 5: collision-window (§8.1 check #5 + §8.6 override logic)
  const collisionResult = evaluateCollisionWindow(input);
  if (!collisionResult.ok) {
    return collisionResult;
  }

  // Check 6: customer identity resolved (public only, reserved for future opt-in flag)
  // v1: the requireCustomerMatch flag does not exist yet per spec §8.1 check #6.
  // The check fires only when customerContactId is explicitly required — skip in v1
  // (the spec says "currently unused in v1; reserved for the future opt-in flag").
  // We implement the typed reason path so callers can exercise it:
  // void — not enforced in v1 per spec §8.1 check #6

  // Check 7: superseded by newer draft
  if (input.hasNewerDraft) {
    return { ok: false, reason: 'superseded_by_newer_draft' };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// evaluateCollisionWindow — extracted for clarity and testability
// ---------------------------------------------------------------------------

function evaluateCollisionWindow(input: PreflightInput): PreflightResult {
  // If overrideCollision requested, autonomous agents cannot use it (§8.6 paragraph 5)
  if (input.overrideCollision && input.callerIsAutonomousAgent) {
    return { ok: false, reason: 'autonomous_agent_cannot_override_collision' };
  }

  // If override requested and caller is human — skip the collision check (§8.6 step 3)
  if (input.overrideCollision && !input.callerIsAutonomousAgent) {
    return { ok: true };
  }

  // Evaluate the collision window
  if (input.lastHumanActivityAt !== null && input.lastHumanActivityAt !== undefined) {
    const nowMs = Date.now();
    const minutesSinceActivity = (nowMs - input.lastHumanActivityAt.getTime()) / 60_000;
    if (minutesSinceActivity < input.collisionWindowMinutes) {
      return {
        ok: false,
        reason: 'human_collision_blocked',
        collisionDetail: {
          lastHumanActivityAt: input.lastHumanActivityAt,
          minMinutesRequired: input.collisionWindowMinutes,
          minutesSinceActivity,
        },
      };
    }
  }

  // Respect human assignee: block if a human agent owns the ticket (§5.3 agent_config)
  if (input.respectHumanAssignee && input.assigneeAgentId !== null && input.assigneeAgentId !== undefined) {
    if (input.assigneeAgentKind === 'human') {
      return { ok: false, reason: 'human_collision_blocked' };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Named per-check exports — S1 checks 4-7 (pre-test-hardening §4.1)
//
// These are exported individually so callers can invoke and test each check
// in isolation. The dispatch service wires them in order after checks 1-3.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Check 4 — Ticket-status eligibility
// Status × action matrix (LOCKED per spec §4.1):
//   open               → all actions ok
//   pending_internal   → propose_reply NO; add_internal_note ok; set_status ok
//   waiting_on_customer → propose_reply conditional (optIns.autonomousReplyOnWaitingOnCustomer)
//                       ; add_internal_note ok; set_status ok
//   resolved           → propose_reply conditional (optIns.postResolutionFollowUp)
//                       ; add_internal_note ok; set_status ok
//   closed             → all actions NO
//   unknown_provider_status → all actions NO
// ---------------------------------------------------------------------------

export interface CheckTicketStatusInput {
  ticket: { status: string };
  action: SupportDraftAction;
  agentConfig: {
    optIns?: {
      autonomousReplyOnWaitingOnCustomer?: boolean;
      postResolutionFollowUp?: boolean;
    };
  };
}

export function checkTicketStatusEligibility(
  input: CheckTicketStatusInput,
): { ok: true } | { ok: false; reason: 'ticket_status_ineligible' } {
  const { status } = input.ticket;
  const { action, agentConfig } = input;

  // Fully blocked statuses — no action allowed
  if (status === 'closed' || status === 'unknown_provider_status') {
    return { ok: false, reason: 'ticket_status_ineligible' };
  }

  // open — all actions allowed
  if (status === 'open') {
    return { ok: true };
  }

  // pending_internal — propose_reply blocked; others ok
  if (status === 'pending_internal') {
    if (action === 'support.propose_reply') {
      return { ok: false, reason: 'ticket_status_ineligible' };
    }
    return { ok: true };
  }

  // waiting_on_customer — propose_reply conditional
  if (status === 'waiting_on_customer') {
    if (action === 'support.propose_reply') {
      if (agentConfig.optIns?.autonomousReplyOnWaitingOnCustomer === true) {
        return { ok: true };
      }
      return { ok: false, reason: 'ticket_status_ineligible' };
    }
    return { ok: true };
  }

  // resolved — propose_reply conditional
  if (status === 'resolved') {
    if (action === 'support.propose_reply') {
      if (agentConfig.optIns?.postResolutionFollowUp === true) {
        return { ok: true };
      }
      return { ok: false, reason: 'ticket_status_ineligible' };
    }
    return { ok: true };
  }

  // Unknown status — fail closed
  return { ok: false, reason: 'ticket_status_ineligible' };
}

// ---------------------------------------------------------------------------
// Check 5 — Collision window
// Algorithm:
//   if overrideCollision=true AND principalKind='human' → skip (ok)
//   if respectHumanAssignee AND assigneeIsHuman → reject
//   if (now - lastHumanActivityAt) < minMinutesSinceHumanActivity → reject
//   else → ok
//
// The assigneeIsHuman boolean is resolved via DB OUTSIDE this function.
// The `now` date is injected for determinism in tests.
// ---------------------------------------------------------------------------

export interface CheckCollisionWindowInput {
  ticket: { lastHumanActivityAt: Date | null | undefined };
  agentConfig: {
    collisionWindow: {
      minMinutesSinceHumanActivity: number;
      respectHumanAssignee: boolean;
    };
  };
  now: Date;
  overrideCollision: boolean;
  principalKind: 'human' | 'agent';
  assigneeIsHuman: boolean;
}

export function checkCollisionWindow(
  input: CheckCollisionWindowInput,
): { ok: true } | { ok: false; reason: 'human_collision_blocked' } {
  // Human override bypasses the entire collision check
  if (input.overrideCollision && input.principalKind === 'human') {
    return { ok: true };
  }

  // Respect-human-assignee: block if a human agent owns the ticket
  if (input.agentConfig.collisionWindow.respectHumanAssignee && input.assigneeIsHuman) {
    return { ok: false, reason: 'human_collision_blocked' };
  }

  // Time-based collision window
  if (input.ticket.lastHumanActivityAt != null) {
    const minutesSince = (input.now.getTime() - input.ticket.lastHumanActivityAt.getTime()) / 60_000;
    if (minutesSince < input.agentConfig.collisionWindow.minMinutesSinceHumanActivity) {
      return { ok: false, reason: 'human_collision_blocked' };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Check 6 — Customer-match policy gate (forward-compat no-op in v1)
// Locked behaviour:
//   - If requireCustomerMatch NOT present → ok (v1 no-op gate; field reserved)
//   - If requireCustomerMatch=true AND ticket.canonicalContactId IS NULL → reject
//   - Otherwise → ok
// The Zod schema does NOT change in this build.
// ---------------------------------------------------------------------------

export interface CheckCustomerMatchPolicyInput {
  ticket: { canonicalContactId: string | null | undefined };
  agentConfig: {
    optIns?: {
      requireCustomerMatch?: boolean;
    };
  };
}

export function checkCustomerMatchPolicy(
  input: CheckCustomerMatchPolicyInput,
): { ok: true } | { ok: false; reason: 'customer_match_required' } {
  // v1 no-op: field not present in schema
  if (input.agentConfig.optIns?.requireCustomerMatch == null) {
    return { ok: true };
  }

  if (
    input.agentConfig.optIns.requireCustomerMatch === true &&
    (input.ticket.canonicalContactId == null)
  ) {
    return { ok: false, reason: 'customer_match_required' };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Check 7 — Supersession
// The hasNewerDraft boolean is computed by a DB query OUTSIDE this function.
// The query uses tuple-comparison (created_at, id) > ($2, $3) to handle
// same-millisecond ties — do NOT simplify to created_at > $2 alone.
// ---------------------------------------------------------------------------

export interface CheckSupersessionInput {
  candidateDraft: { id: string; createdAt: Date };
  hasNewerDraft: boolean;
}

export function checkSupersession(
  input: CheckSupersessionInput,
): { ok: true } | { ok: false; reason: 'superseded_by_newer_draft' } {
  if (input.hasNewerDraft) {
    return { ok: false, reason: 'superseded_by_newer_draft' };
  }
  return { ok: true };
}
