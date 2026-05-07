/**
 * inboxServicePure.test.ts
 *
 * Pure-function tests for deriveBand() and filterByQ().
 * No DB, no I/O — all cases are deterministic.
 */

import { describe, it, expect } from 'vitest';
import { deriveBand, filterByQ, type BandableItem } from '../inboxServicePure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-05-07T12:00:00.000Z');

function makeItem(overrides: Partial<BandableItem> = {}): BandableItem {
  return {
    isRead: false,
    isArchived: false,
    kind: 'review_item',
    ...overrides,
  };
}

/** dueAt within 24 h from NOW */
const DUE_SOON = new Date(NOW.getTime() + 10 * 60 * 60 * 1000); // +10 h
/** dueAt beyond 24 h from NOW */
const DUE_LATER = new Date(NOW.getTime() + 48 * 60 * 60 * 1000); // +48 h
/** dueAt already in the past (within 24 h window, still flags as high) */
const DUE_PAST = new Date(NOW.getTime() - 1 * 60 * 60 * 1000); // -1 h

// ---------------------------------------------------------------------------
// deriveBand — archived items
// ---------------------------------------------------------------------------

describe('deriveBand — archived items are always "previous"', () => {
  it('archived + unread → previous', () => {
    expect(deriveBand(makeItem({ isArchived: true, isRead: false }), NOW)).toBe('previous');
  });

  it('archived + read → previous', () => {
    expect(deriveBand(makeItem({ isArchived: true, isRead: true }), NOW)).toBe('previous');
  });

  it('archived + critical severity → previous (archived wins)', () => {
    expect(deriveBand(makeItem({ isArchived: true, severity: 'critical' }), NOW)).toBe('previous');
  });

  it('archived + due soon → previous (archived wins)', () => {
    expect(deriveBand(makeItem({ isArchived: true, dueAt: DUE_SOON }), NOW)).toBe('previous');
  });
});

// ---------------------------------------------------------------------------
// deriveBand — read items
// ---------------------------------------------------------------------------

describe('deriveBand — read items are always "previous"', () => {
  it('read + review_item → previous', () => {
    expect(deriveBand(makeItem({ isRead: true, kind: 'review_item' }), NOW)).toBe('previous');
  });

  it('read + approval → previous', () => {
    expect(deriveBand(makeItem({ isRead: true, kind: 'approval' }), NOW)).toBe('previous');
  });

  it('read + critical severity → previous (read wins)', () => {
    expect(deriveBand(makeItem({ isRead: true, severity: 'critical' }), NOW)).toBe('previous');
  });

  it('read + due soon → previous (read wins)', () => {
    expect(deriveBand(makeItem({ isRead: true, dueAt: DUE_SOON }), NOW)).toBe('previous');
  });
});

// ---------------------------------------------------------------------------
// deriveBand — high band
// ---------------------------------------------------------------------------

describe('deriveBand — high band (unread + review_item/approval + critical or due soon)', () => {
  it('unread review_item + critical severity → high', () => {
    expect(deriveBand(makeItem({ severity: 'critical', kind: 'review_item' }), NOW)).toBe('high');
  });

  it('unread review_item + urgent severity → high', () => {
    expect(deriveBand(makeItem({ severity: 'urgent', kind: 'review_item' }), NOW)).toBe('high');
  });

  it('severity is case-insensitive (CRITICAL) → high', () => {
    expect(deriveBand(makeItem({ severity: 'CRITICAL', kind: 'review_item' }), NOW)).toBe('high');
  });

  it('unread approval + critical → high', () => {
    expect(deriveBand(makeItem({ severity: 'critical', kind: 'approval' }), NOW)).toBe('high');
  });

  it('unread review_item + dueAt within 24 h → high', () => {
    expect(deriveBand(makeItem({ dueAt: DUE_SOON, kind: 'review_item' }), NOW)).toBe('high');
  });

  it('unread review_item + dueAt in the past → high (past due counts as within 24 h)', () => {
    expect(deriveBand(makeItem({ dueAt: DUE_PAST, kind: 'review_item' }), NOW)).toBe('high');
  });

  it('unread approval + dueAt within 24 h → high', () => {
    expect(deriveBand(makeItem({ dueAt: DUE_SOON, kind: 'approval' }), NOW)).toBe('high');
  });

  it('unread review_item + dueAt beyond 24 h → needs_action (not high)', () => {
    expect(deriveBand(makeItem({ dueAt: DUE_LATER, kind: 'review_item' }), NOW)).toBe('needs_action');
  });

  it('unread review_item + no severity + no dueAt → needs_action (not high)', () => {
    expect(deriveBand(makeItem({ kind: 'review_item' }), NOW)).toBe('needs_action');
  });
});

// ---------------------------------------------------------------------------
// deriveBand — high band NOT available for agent_run or task kinds
// ---------------------------------------------------------------------------

describe('deriveBand — agent_run and task kinds cannot reach "high"', () => {
  it('unread agent_run + critical severity → needs_action (not high)', () => {
    expect(deriveBand(makeItem({ severity: 'critical', kind: 'agent_run' }), NOW)).toBe('needs_action');
  });

  it('unread agent_run + dueAt within 24 h → needs_action', () => {
    expect(deriveBand(makeItem({ dueAt: DUE_SOON, kind: 'agent_run' }), NOW)).toBe('needs_action');
  });

  it('unread task + critical severity → needs_action', () => {
    expect(deriveBand(makeItem({ severity: 'critical', kind: 'task' }), NOW)).toBe('needs_action');
  });

  it('unread task + dueAt within 24 h → needs_action', () => {
    expect(deriveBand(makeItem({ dueAt: DUE_SOON, kind: 'task' }), NOW)).toBe('needs_action');
  });
});

// ---------------------------------------------------------------------------
// deriveBand — needs_action band
// ---------------------------------------------------------------------------

describe('deriveBand — needs_action (unread, not high-eligible or no high trigger)', () => {
  it('unread review_item, no severity, no dueAt → needs_action', () => {
    expect(deriveBand(makeItem({ kind: 'review_item' }), NOW)).toBe('needs_action');
  });

  it('unread approval, no severity, no dueAt → needs_action', () => {
    expect(deriveBand(makeItem({ kind: 'approval' }), NOW)).toBe('needs_action');
  });

  it('unread agent_run → needs_action', () => {
    expect(deriveBand(makeItem({ kind: 'agent_run' }), NOW)).toBe('needs_action');
  });

  it('unread task → needs_action', () => {
    expect(deriveBand(makeItem({ kind: 'task' }), NOW)).toBe('needs_action');
  });
});

// ---------------------------------------------------------------------------
// deriveBand — edge cases with dueAt as string
// ---------------------------------------------------------------------------

describe('deriveBand — dueAt as ISO string', () => {
  it('dueAt as ISO string within 24 h → high', () => {
    const dueSoonString = DUE_SOON.toISOString();
    expect(deriveBand(makeItem({ dueAt: dueSoonString, kind: 'review_item' }), NOW)).toBe('high');
  });

  it('dueAt as ISO string beyond 24 h → needs_action', () => {
    const dueLaterString = DUE_LATER.toISOString();
    expect(deriveBand(makeItem({ dueAt: dueLaterString, kind: 'review_item' }), NOW)).toBe('needs_action');
  });
});

// ---------------------------------------------------------------------------
// filterByQ
// ---------------------------------------------------------------------------

describe('filterByQ', () => {
  it('empty query matches everything', () => {
    expect(filterByQ('Review: pending', '')).toBe(true);
    expect(filterByQ('Review: pending', undefined)).toBe(true);
    expect(filterByQ('Review: pending', '   ')).toBe(true);
  });

  it('case-insensitive match', () => {
    expect(filterByQ('Review: pending', 'PENDING')).toBe(true);
    expect(filterByQ('Review: pending', 'Pending')).toBe(true);
  });

  it('substring match', () => {
    expect(filterByQ('Review: pending', 'rev')).toBe(true);
    expect(filterByQ('Agent run failed', 'failed')).toBe(true);
  });

  it('no match returns false', () => {
    expect(filterByQ('Review: pending', 'approved')).toBe(false);
    expect(filterByQ('Agent run failed', 'review')).toBe(false);
  });

  it('empty title with non-empty query → false', () => {
    expect(filterByQ('', 'pending')).toBe(false);
  });

  it('query matches entire title', () => {
    expect(filterByQ('Review: pending', 'Review: pending')).toBe(true);
  });

  it('whitespace-only query matches everything', () => {
    expect(filterByQ('Review: pending', '   ')).toBe(true);
  });
});
