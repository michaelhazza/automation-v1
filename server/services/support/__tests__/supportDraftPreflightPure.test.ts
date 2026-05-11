// supportDraftPreflightPure.test.ts — Unit tests for named preflight pure functions.
// Spec: tasks/builds/pre-test-hardening/spec.md §4.1 (S1 checks 4-7)
//
// Tests only deterministic pure functions; no DB, no mocking needed.

import { describe, it, expect } from 'vitest';
import {
  checkTicketStatusEligibility,
  checkCollisionWindow,
  checkCustomerMatchPolicy,
  checkSupersession,
  type CheckTicketStatusInput,
  type CheckCollisionWindowInput,
  type CheckCustomerMatchPolicyInput,
  type CheckSupersessionInput,
} from '../../supportDraftDispatchPreflightPure.js';

// ---------------------------------------------------------------------------
// Check 4 — Ticket-status eligibility
// Status × action matrix (LOCKED per spec §4.1):
// ---------------------------------------------------------------------------

describe('checkTicketStatusEligibility', () => {
  // open — all actions allowed
  it('open + propose_reply → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'open' },
      action: 'support.propose_reply',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  it('open + add_internal_note → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'open' },
      action: 'support.add_internal_note',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  it('open + set_status → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'open' },
      action: 'support.set_status',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  // pending_internal — propose_reply blocked; others ok
  it('pending_internal + propose_reply → reject ticket_status_ineligible', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'pending_internal' },
      action: 'support.propose_reply',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ticket_status_ineligible');
  });

  it('pending_internal + add_internal_note → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'pending_internal' },
      action: 'support.add_internal_note',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  it('pending_internal + set_status → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'pending_internal' },
      action: 'support.set_status',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  // waiting_on_customer — propose_reply conditional
  it('waiting_on_customer + propose_reply with autonomousReplyOnWaitingOnCustomer=false → reject', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'waiting_on_customer' },
      action: 'support.propose_reply',
      agentConfig: { optIns: { autonomousReplyOnWaitingOnCustomer: false } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ticket_status_ineligible');
  });

  it('waiting_on_customer + propose_reply with autonomousReplyOnWaitingOnCustomer=true → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'waiting_on_customer' },
      action: 'support.propose_reply',
      agentConfig: { optIns: { autonomousReplyOnWaitingOnCustomer: true } },
    });
    expect(result.ok).toBe(true);
  });

  it('waiting_on_customer + propose_reply with optIn absent → reject', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'waiting_on_customer' },
      action: 'support.propose_reply',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(false);
  });

  it('waiting_on_customer + support.add_internal_note → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'waiting_on_customer' },
      action: 'support.add_internal_note',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  it('waiting_on_customer + support.set_status → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'waiting_on_customer' },
      action: 'support.set_status',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  // resolved — propose_reply conditional
  it('resolved + propose_reply with postResolutionFollowUp=false → reject', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'resolved' },
      action: 'support.propose_reply',
      agentConfig: { optIns: { postResolutionFollowUp: false } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ticket_status_ineligible');
  });

  it('resolved + propose_reply with postResolutionFollowUp=true → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'resolved' },
      action: 'support.propose_reply',
      agentConfig: { optIns: { postResolutionFollowUp: true } },
    });
    expect(result.ok).toBe(true);
  });

  it('resolved + add_internal_note → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'resolved' },
      action: 'support.add_internal_note',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  it('resolved + set_status → ok', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'resolved' },
      action: 'support.set_status',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  // closed — all actions blocked
  it('closed + propose_reply → reject', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'closed' },
      action: 'support.propose_reply',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ticket_status_ineligible');
  });

  it('closed + add_internal_note → reject', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'closed' },
      action: 'support.add_internal_note',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ticket_status_ineligible');
  });

  it('closed + set_status → reject', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'closed' },
      action: 'support.set_status',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ticket_status_ineligible');
  });

  // unknown_provider_status — all actions blocked
  it('unknown_provider_status + propose_reply → reject', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'unknown_provider_status' },
      action: 'support.propose_reply',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ticket_status_ineligible');
  });

  it('unknown_provider_status + add_internal_note → reject', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'unknown_provider_status' },
      action: 'support.add_internal_note',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ticket_status_ineligible');
  });

  it('unknown_provider_status + set_status → reject', () => {
    const result = checkTicketStatusEligibility({
      ticket: { status: 'unknown_provider_status' },
      action: 'support.set_status',
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ticket_status_ineligible');
  });
});

// ---------------------------------------------------------------------------
// Check 5 — Collision window
// ---------------------------------------------------------------------------

describe('checkCollisionWindow', () => {
  const baseCollisionConfig = {
    collisionWindow: {
      minMinutesSinceHumanActivity: 30,
      respectHumanAssignee: true,
    },
  };

  it('now - lastHumanActivityAt below threshold → reject human_collision_blocked', () => {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000);
    const result = checkCollisionWindow({
      ticket: { lastHumanActivityAt: tenMinutesAgo },
      agentConfig: baseCollisionConfig,
      now,
      overrideCollision: false,
      principalKind: 'agent',
      assigneeIsHuman: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('human_collision_blocked');
  });

  it('now - lastHumanActivityAt above threshold → ok', () => {
    const now = new Date();
    const fortyFiveMinutesAgo = new Date(now.getTime() - 45 * 60_000);
    const result = checkCollisionWindow({
      ticket: { lastHumanActivityAt: fortyFiveMinutesAgo },
      agentConfig: baseCollisionConfig,
      now,
      overrideCollision: false,
      principalKind: 'agent',
      assigneeIsHuman: false,
    });
    expect(result.ok).toBe(true);
  });

  it('lastHumanActivityAt is null → ok (no human activity)', () => {
    const now = new Date();
    const result = checkCollisionWindow({
      ticket: { lastHumanActivityAt: null },
      agentConfig: baseCollisionConfig,
      now,
      overrideCollision: false,
      principalKind: 'agent',
      assigneeIsHuman: false,
    });
    expect(result.ok).toBe(true);
  });

  it('respectHumanAssignee=true AND human assignee → reject', () => {
    const now = new Date();
    const result = checkCollisionWindow({
      ticket: { lastHumanActivityAt: null },
      agentConfig: { collisionWindow: { minMinutesSinceHumanActivity: 30, respectHumanAssignee: true } },
      now,
      overrideCollision: false,
      principalKind: 'agent',
      assigneeIsHuman: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('human_collision_blocked');
  });

  it('respectHumanAssignee=false AND human assignee AND lastHumanActivityAt OUTSIDE collision window → ok (delta wins)', () => {
    const now = new Date();
    const fortyFiveMinutesAgo = new Date(now.getTime() - 45 * 60_000);
    const result = checkCollisionWindow({
      ticket: { lastHumanActivityAt: fortyFiveMinutesAgo },
      agentConfig: { collisionWindow: { minMinutesSinceHumanActivity: 30, respectHumanAssignee: false } },
      now,
      overrideCollision: false,
      principalKind: 'agent',
      assigneeIsHuman: true,
    });
    expect(result.ok).toBe(true);
  });

  it('respectHumanAssignee=false AND human assignee AND lastHumanActivityAt INSIDE collision window → reject', () => {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000);
    const result = checkCollisionWindow({
      ticket: { lastHumanActivityAt: tenMinutesAgo },
      agentConfig: { collisionWindow: { minMinutesSinceHumanActivity: 30, respectHumanAssignee: false } },
      now,
      overrideCollision: false,
      principalKind: 'agent',
      assigneeIsHuman: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('human_collision_blocked');
  });

  it('overrideCollision=true AND principalKind=human → ok (skipped)', () => {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000);
    const result = checkCollisionWindow({
      ticket: { lastHumanActivityAt: tenMinutesAgo },
      agentConfig: baseCollisionConfig,
      now,
      overrideCollision: true,
      principalKind: 'human',
      assigneeIsHuman: true,
    });
    expect(result.ok).toBe(true);
  });

  it('overrideCollision=true AND principalKind=agent → does NOT skip (agent override already blocked by S2)', () => {
    // The S2 guard in approveDraft prevents agent + overrideCollision=true from reaching here.
    // The pure function itself: overrideCollision=true + principalKind='agent' does NOT skip.
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000);
    const result = checkCollisionWindow({
      ticket: { lastHumanActivityAt: tenMinutesAgo },
      agentConfig: baseCollisionConfig,
      now,
      overrideCollision: true,
      principalKind: 'agent',
      assigneeIsHuman: false,
    });
    // Agent + overrideCollision does not bypass the window; the collision check still fires
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('human_collision_blocked');
  });
});

// ---------------------------------------------------------------------------
// Check 6 — Customer-match policy gate (forward-compat no-op in v1)
// ---------------------------------------------------------------------------

describe('checkCustomerMatchPolicy', () => {
  it('agentConfig has no requireCustomerMatch flag → ok (forward-compat no-op)', () => {
    const result = checkCustomerMatchPolicy({
      ticket: { canonicalContactId: null },
      agentConfig: { optIns: {} },
    });
    expect(result.ok).toBe(true);
  });

  it('agentConfig.optIns is absent → ok (forward-compat no-op)', () => {
    const result = checkCustomerMatchPolicy({
      ticket: { canonicalContactId: null },
      agentConfig: {},
    });
    expect(result.ok).toBe(true);
  });

  it('requireCustomerMatch=true AND ticket.canonicalContactId IS NULL → reject customer_match_required', () => {
    const result = checkCustomerMatchPolicy({
      ticket: { canonicalContactId: null },
      agentConfig: { optIns: { requireCustomerMatch: true } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('customer_match_required');
  });

  it('requireCustomerMatch=true AND ticket.canonicalContactId is set → ok', () => {
    const result = checkCustomerMatchPolicy({
      ticket: { canonicalContactId: 'contact-uuid-123' },
      agentConfig: { optIns: { requireCustomerMatch: true } },
    });
    expect(result.ok).toBe(true);
  });

  it('requireCustomerMatch=false → ok', () => {
    const result = checkCustomerMatchPolicy({
      ticket: { canonicalContactId: null },
      agentConfig: { optIns: { requireCustomerMatch: false } },
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Check 7 — Supersession
// ---------------------------------------------------------------------------

describe('checkSupersession', () => {
  const candidateDraft = {
    id: 'draft-aaa',
    createdAt: new Date('2026-05-10T10:00:00.000Z'),
  };

  it('hasNewerDraft=false → ok', () => {
    const result = checkSupersession({
      candidateDraft,
      hasNewerDraft: false,
    });
    expect(result.ok).toBe(true);
  });

  it('hasNewerDraft=true → reject superseded_by_newer_draft', () => {
    const result = checkSupersession({
      candidateDraft,
      hasNewerDraft: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('superseded_by_newer_draft');
  });
});
