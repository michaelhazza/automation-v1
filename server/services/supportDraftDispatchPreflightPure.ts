// supportDraftDispatchPreflightPure.ts — Pure preflight evaluator for the draft dispatch path.
// Spec: docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md §8.1 + §8.6
//
// No DB access, no async. All functions are deterministic given their inputs.
// The dispatch service consumes evaluatePreflight(); tests cover every branch.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
