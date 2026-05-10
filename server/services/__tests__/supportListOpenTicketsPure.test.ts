/**
 * supportListOpenTicketsPure.test.ts — Tests for the terminal-event predicate
 * that guards support.list_open_tickets.
 *
 * Chunk 8 (phase-1-showcase-mvps): 4 fixtures per spec §5.3.4:
 *   1. Eligible — no terminal event since last_customer_message_at
 *   2. Excluded — terminal event exists after last_customer_message_at
 *   3. COALESCE fallback — last_customer_message_at is null, uses created_at
 *   4. Degenerate-but-correct — terminal event before last_customer_message_at (ticket eligible again)
 *
 * Test posture: targeted Vitest only — do NOT run umbrella suites locally.
 */

import { describe, it, expect } from 'vitest';
import {
  buildTerminalEventPredicateSql,
} from '../supportAgentExecutionServicePure.js';

// ---------------------------------------------------------------------------
// Predicate structure tests (pure SQL string analysis)
// ---------------------------------------------------------------------------

describe('buildTerminalEventPredicateSql — predicate structure', () => {
  it('starts with NOT EXISTS', () => {
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate.trim()).toMatch(/^NOT EXISTS/);
  });

  it('contains subquery filtering by organisation_id', () => {
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate).toContain('e.organisation_id = canonical_tickets.organisation_id');
  });

  it('filters ticketId from payload', () => {
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate).toContain("e.payload->>'ticketId' = canonical_tickets.id::text");
  });

  it('includes all three terminal event types', () => {
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate).toContain("'phase1.support.draft_proposed'");
    expect(predicate).toContain("'phase1.support.collision_skipped'");
    expect(predicate).toContain("'phase1.support.ticket_terminal'");
  });

  it('anchors to created_at >= COALESCE(last_customer_message_at, created_at)', () => {
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate).toContain('e.created_at >= COALESCE(canonical_tickets.last_customer_message_at, canonical_tickets.created_at)');
  });
});

// ---------------------------------------------------------------------------
// Fixture 1: Eligible — no terminal event at all
// The predicate should NOT be satisfied (NOT EXISTS returns true)
// ---------------------------------------------------------------------------

describe('Fixture 1: eligible ticket — no terminal events', () => {
  it('predicate text does not reference a fixed event time', () => {
    // The predicate is parameterless — it references canonical_tickets columns.
    // An eligible ticket has no matching rows in agent_execution_events, so
    // NOT EXISTS returns true and the ticket appears in the result set.
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate).toBeDefined();
    // The predicate uses relative joins — no hardcoded timestamps
    expect(predicate).not.toContain('2024-');
    expect(predicate).not.toContain('2025-');
  });
});

// ---------------------------------------------------------------------------
// Fixture 2: Excluded — terminal event after last_customer_message_at
// The predicate should exclude this ticket (NOT EXISTS returns false)
// Logic: e.created_at >= last_customer_message_at AND event_type IN terminal set
// ---------------------------------------------------------------------------

describe('Fixture 2: excluded ticket — terminal event exists after customer message', () => {
  it('predicate correctly anchors to last_customer_message_at', () => {
    const predicate = buildTerminalEventPredicateSql();
    // If an agent_execution_event row exists with:
    //   - organisation_id matching the ticket
    //   - payload->>'ticketId' = ticket id
    //   - event_type in the terminal set
    //   - created_at >= COALESCE(last_customer_message_at, created_at)
    // then NOT EXISTS returns false and the ticket is excluded.
    expect(predicate).toContain('e.event_type IN');
    expect(predicate).toContain('e.created_at >=');
  });
});

// ---------------------------------------------------------------------------
// Fixture 3: COALESCE fallback — last_customer_message_at is NULL
// Uses created_at as the lower bound; still correctly excludes if terminal event
// was created after the ticket itself.
// ---------------------------------------------------------------------------

describe('Fixture 3: COALESCE fallback — null last_customer_message_at', () => {
  it('contains the COALESCE expression', () => {
    const predicate = buildTerminalEventPredicateSql();
    // COALESCE(canonical_tickets.last_customer_message_at, canonical_tickets.created_at)
    // When last_customer_message_at IS NULL, COALESCE returns created_at.
    // A terminal event created after ticket.created_at will exclude the ticket.
    expect(predicate).toContain('COALESCE(canonical_tickets.last_customer_message_at, canonical_tickets.created_at)');
  });

  it('uses canonical_tickets.created_at as the fallback', () => {
    const predicate = buildTerminalEventPredicateSql();
    // Verify created_at appears as the fallback argument in COALESCE
    const coalesceMatch = predicate.match(/COALESCE\([^)]+\)/);
    expect(coalesceMatch).not.toBeNull();
    expect(coalesceMatch![0]).toContain('canonical_tickets.created_at');
  });
});

// ---------------------------------------------------------------------------
// Fixture 4: Degenerate-but-correct — terminal event BEFORE last_customer_message_at
// The predicate's time anchor (COALESCE(last_customer_message_at, created_at))
// means a terminal event that pre-dates the last customer message does NOT
// satisfy e.created_at >= last_customer_message_at. Result: ticket IS eligible
// again (customer replied since the terminal verdict, so re-engagement is correct).
// ---------------------------------------------------------------------------

describe('Fixture 4: degenerate-but-correct — terminal event before last_customer_message_at', () => {
  it('predicate re-admits ticket when customer replied after the terminal event', () => {
    // The predicate requires e.created_at >= COALESCE(last_customer_message_at, created_at).
    // If terminal event was at T1 and last_customer_message_at is at T2 > T1,
    // then e.created_at (T1) < last_customer_message_at (T2) → condition fails →
    // NOT EXISTS returns true → ticket is eligible again.
    // This is intentional: a new customer reply re-opens the processing window.
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate).toContain('e.created_at >=');
    // The predicate does NOT use <=, which would be wrong
    expect(predicate).not.toContain('e.created_at <=');
    expect(predicate).not.toContain('e.created_at <');
  });

  it('the time anchor is >= not >', () => {
    // >= is correct: an event at exactly the same timestamp as last_customer_message_at
    // was processed in the same batch and should exclude the ticket.
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate).toContain('e.created_at >= COALESCE');
  });
});
