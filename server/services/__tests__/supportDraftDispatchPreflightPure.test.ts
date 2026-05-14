// supportDraftDispatchPreflightPure.test.ts — Vitest tests for pure preflight evaluator.
// Spec: docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md §8.1 + §8.6
//
// Tests only deterministic pure functions; no DB, no mocking needed.

import { describe, it, expect } from 'vitest';
import { evaluatePreflight, type PreflightInput } from '../supportDraftDispatchPreflightPure.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    draftStatus: 'awaiting_review',
    proposedVisibility: 'public',
    inboxMode: 'assisted',
    ticketStatus: 'open',
    customerContactId: 'contact-uuid',
    assigneeAgentId: null,
    lastHumanActivityAt: null,
    collisionWindowMinutes: 30,
    respectHumanAssignee: true,
    assigneeAgentKind: null,
    hasNewerDraft: false,
    overrideCollision: false,
    callerIsAutonomousAgent: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('evaluatePreflight — happy path', () => {
  it('returns ok=true for a fully eligible draft', () => {
    const result = evaluatePreflight(makeInput());
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns ok=true for an internal draft on a pending_internal ticket', () => {
    const result = evaluatePreflight(makeInput({ proposedVisibility: 'internal', ticketStatus: 'pending_internal' }));
    expect(result.ok).toBe(true);
  });

  it('returns ok=true when lastHumanActivityAt is null (no prior human activity)', () => {
    const result = evaluatePreflight(makeInput({ lastHumanActivityAt: null }));
    expect(result.ok).toBe(true);
  });

  it('returns ok=true when lastHumanActivityAt is older than the collision window', () => {
    const old = new Date(Date.now() - 45 * 60_000); // 45 minutes ago
    const result = evaluatePreflight(makeInput({ lastHumanActivityAt: old, collisionWindowMinutes: 30 }));
    expect(result.ok).toBe(true);
  });

  it('returns ok=true when assignee is a bot (respectHumanAssignee=true)', () => {
    const result = evaluatePreflight(makeInput({
      assigneeAgentId: 'agent-uuid',
      assigneeAgentKind: 'bot',
      respectHumanAssignee: true,
    }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Check 2: inbox disabled
// ---------------------------------------------------------------------------

describe('evaluatePreflight — inbox_disabled', () => {
  it('rejects when inbox mode is disabled', () => {
    const result = evaluatePreflight(makeInput({ inboxMode: 'disabled' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('inbox_disabled');
  });
});

// ---------------------------------------------------------------------------
// Check 3: ticket quarantined
// ---------------------------------------------------------------------------

describe('evaluatePreflight — ticket_quarantined', () => {
  it('rejects when ticket status is unknown_provider_status', () => {
    const result = evaluatePreflight(makeInput({ ticketStatus: 'unknown_provider_status' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ticket_quarantined');
  });
});

// ---------------------------------------------------------------------------
// Check 4: ticket status eligibility
// ---------------------------------------------------------------------------

describe('evaluatePreflight — ticket_status_ineligible', () => {
  it.each<string>([
    'pending_internal',
    'waiting_on_customer',
    'resolved',
    'closed',
  ])('rejects public reply on %s ticket', (ticketStatus) => {
    const result = evaluatePreflight(makeInput({ proposedVisibility: 'public', ticketStatus }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ticket_status_ineligible');
  });

  it('allows public reply on open ticket', () => {
    const result = evaluatePreflight(makeInput({ proposedVisibility: 'public', ticketStatus: 'open' }));
    expect(result.ok).toBe(true);
  });

  it('rejects internal note on closed ticket', () => {
    const result = evaluatePreflight(makeInput({ proposedVisibility: 'internal', ticketStatus: 'closed' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ticket_status_ineligible');
  });

  it('allows internal note on open ticket', () => {
    const result = evaluatePreflight(makeInput({ proposedVisibility: 'internal', ticketStatus: 'open' }));
    expect(result.ok).toBe(true);
  });

  it('allows internal note on waiting_on_customer ticket', () => {
    const result = evaluatePreflight(makeInput({ proposedVisibility: 'internal', ticketStatus: 'waiting_on_customer' }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Check 5: collision window
// ---------------------------------------------------------------------------

describe('evaluatePreflight — human_collision_blocked (time-based)', () => {
  it('rejects when human activity is within the collision window', () => {
    const recent = new Date(Date.now() - 10 * 60_000); // 10 minutes ago
    const result = evaluatePreflight(makeInput({
      lastHumanActivityAt: recent,
      collisionWindowMinutes: 30,
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('human_collision_blocked');
    expect(result.collisionDetail).toBeDefined();
    expect(result.collisionDetail!.minMinutesRequired).toBe(30);
  });

  it('includes collisionDetail with lastHumanActivityAt', () => {
    const recent = new Date(Date.now() - 5 * 60_000);
    const result = evaluatePreflight(makeInput({
      lastHumanActivityAt: recent,
      collisionWindowMinutes: 30,
    }));
    expect(result.collisionDetail!.lastHumanActivityAt).toEqual(recent);
    expect(result.collisionDetail!.minutesSinceActivity).toBeLessThan(30);
  });

  it('rejects when a human agent is assigned and respectHumanAssignee=true', () => {
    const result = evaluatePreflight(makeInput({
      assigneeAgentId: 'human-agent-uuid',
      assigneeAgentKind: 'human',
      respectHumanAssignee: true,
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('human_collision_blocked');
  });

  it('allows when respectHumanAssignee=false even if human agent assigned', () => {
    const result = evaluatePreflight(makeInput({
      assigneeAgentId: 'human-agent-uuid',
      assigneeAgentKind: 'human',
      respectHumanAssignee: false,
    }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Check 5: collision override
// ---------------------------------------------------------------------------

describe('evaluatePreflight — collision override (§8.6)', () => {
  it('allows when overrideCollision=true and caller is human', () => {
    const recent = new Date(Date.now() - 5 * 60_000);
    const result = evaluatePreflight(makeInput({
      lastHumanActivityAt: recent,
      overrideCollision: true,
      callerIsAutonomousAgent: false,
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects autonomous agent attempting to override collision', () => {
    const recent = new Date(Date.now() - 5 * 60_000);
    const result = evaluatePreflight(makeInput({
      lastHumanActivityAt: recent,
      overrideCollision: true,
      callerIsAutonomousAgent: true,
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('autonomous_agent_cannot_override_collision');
  });

  it('autonomous agent without collision is still blocked by autonomous_agent_cannot_override_collision when override is set', () => {
    // Even if there is no actual collision, the autonomous guard fires first
    const result = evaluatePreflight(makeInput({
      lastHumanActivityAt: null,
      overrideCollision: true,
      callerIsAutonomousAgent: true,
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('autonomous_agent_cannot_override_collision');
  });
});

// ---------------------------------------------------------------------------
// Check 7: superseded by newer draft
// ---------------------------------------------------------------------------

describe('evaluatePreflight — superseded_by_newer_draft', () => {
  it('rejects when a newer draft exists', () => {
    const result = evaluatePreflight(makeInput({ hasNewerDraft: true }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('superseded_by_newer_draft');
  });
});

// ---------------------------------------------------------------------------
// Check ordering: inbox_disabled fires before ticket_quarantined
// ---------------------------------------------------------------------------

describe('evaluatePreflight — check ordering', () => {
  it('inbox_disabled is checked before ticket_quarantined', () => {
    const result = evaluatePreflight(makeInput({
      inboxMode: 'disabled',
      ticketStatus: 'unknown_provider_status',
    }));
    expect(result.reason).toBe('inbox_disabled');
  });

  it('ticket_quarantined is checked before ticket_status_ineligible', () => {
    const result = evaluatePreflight(makeInput({
      ticketStatus: 'unknown_provider_status',
      proposedVisibility: 'public',
    }));
    expect(result.reason).toBe('ticket_quarantined');
  });
});
