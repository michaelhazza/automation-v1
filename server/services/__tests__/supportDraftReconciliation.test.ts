import { describe, it, expect } from 'vitest';
import {
  decideOutcome,
  findBackLinkCandidate,
} from '../supportDraftReconciliationPure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDraft(overrides: Partial<{
  id: string;
  status: string;
  reconciliationAttemptCount: number;
  proposedBodyText: string;
  proposedVisibility: string;
}> = {}) {
  return {
    id: 'draft-1',
    status: 'needs_reconciliation',
    reconciliationAttemptCount: 0,
    proposedBodyText: 'Thank you for contacting us.',
    proposedVisibility: 'public',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<{
  id: string;
  direction: string;
  visibility: string;
  bodyText: string;
  createdAtExternal: Date;
}> = {}) {
  return {
    id: 'msg-1',
    direction: 'outbound',
    visibility: 'public',
    bodyText: 'Thank you for contacting us.',
    createdAtExternal: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// decideOutcome
// ---------------------------------------------------------------------------

describe('decideOutcome', () => {
  it('returns surface_manual when attemptCount >= maxAttempts (budget exhausted)', () => {
    const result = decideOutcome({
      draft: makeDraft(),
      latestMessages: [],
      attemptCount: 5,
      maxAttempts: 5,
    });
    expect(result.kind).toBe('surface_manual');
    expect((result as { kind: 'surface_manual'; reason: string }).reason).toBe('max_attempts_exhausted');
  });

  it('returns surface_manual when attemptCount exceeds maxAttempts (never auto-fail)', () => {
    const result = decideOutcome({
      draft: makeDraft(),
      latestMessages: [],
      attemptCount: 10,
      maxAttempts: 5,
    });
    expect(result.kind).toBe('surface_manual');
  });

  it('returns resolve_sent when a message body exactly matches the draft proposed body', () => {
    const msg = makeMessage({ id: 'msg-exact', bodyText: 'Thank you for contacting us.' });
    const result = decideOutcome({
      draft: makeDraft({ proposedBodyText: 'Thank you for contacting us.' }),
      latestMessages: [msg],
      attemptCount: 0,
    });
    expect(result.kind).toBe('resolve_sent');
    const resolved = result as { kind: 'resolve_sent'; messageId: string };
    expect(resolved.messageId).toBe('msg-exact');
  });

  it('returns resolve_sent when the draft body is a substring of the message body', () => {
    const msg = makeMessage({ bodyText: 'Hello — Thank you for contacting us. We will respond shortly.' });
    const result = decideOutcome({
      draft: makeDraft({ proposedBodyText: 'Thank you for contacting us.' }),
      latestMessages: [msg],
      attemptCount: 1,
    });
    expect(result.kind).toBe('resolve_sent');
  });

  it('returns retry_after_ms when no message matches and budget remains', () => {
    const result = decideOutcome({
      draft: makeDraft({ proposedBodyText: 'Proposed reply text.' }),
      latestMessages: [makeMessage({ bodyText: 'Completely different content.' })],
      attemptCount: 2,
      maxAttempts: 5,
    });
    expect(result.kind).toBe('retry_after_ms');
    const r = result as { kind: 'retry_after_ms'; ms: number };
    // 30000 * 2^2 = 120000
    expect(r.ms).toBe(120_000);
  });

  it('caps retry_after_ms at 3_600_000 (1 hour) for very large attemptCount', () => {
    const result = decideOutcome({
      draft: makeDraft(),
      latestMessages: [],
      attemptCount: 4, // 30000 * 2^4 = 480000 < cap
      maxAttempts: 10,
    });
    // 30000 * 16 = 480000
    expect(result.kind).toBe('retry_after_ms');

    const result2 = decideOutcome({
      draft: makeDraft(),
      latestMessages: [],
      attemptCount: 8, // 30000 * 256 = 7680000 > cap
      maxAttempts: 20,
    });
    const r2 = result2 as { kind: 'retry_after_ms'; ms: number };
    expect(r2.ms).toBe(3_600_000);
  });

  it('returns resolve_failed when draft status is failed', () => {
    const result = decideOutcome({
      draft: makeDraft({ status: 'failed' }),
      latestMessages: [makeMessage()],
      attemptCount: 0,
    });
    expect(result.kind).toBe('resolve_failed');
    expect((result as { kind: 'resolve_failed'; reason: string }).reason).toBe('draft_in_terminal_state');
  });

  it('returns resolve_failed when draft status is expired', () => {
    const result = decideOutcome({
      draft: makeDraft({ status: 'expired' }),
      latestMessages: [],
      attemptCount: 0,
    });
    expect(result.kind).toBe('resolve_failed');
  });

  it('uses default maxAttempts of 5 when not provided', () => {
    const result = decideOutcome({
      draft: makeDraft(),
      latestMessages: [],
      attemptCount: 5,
      // maxAttempts omitted — defaults to 5
    });
    expect(result.kind).toBe('surface_manual');
  });
});

// ---------------------------------------------------------------------------
// findBackLinkCandidate
// ---------------------------------------------------------------------------

describe('findBackLinkCandidate', () => {
  function makeCandidateDraft(overrides: Partial<{
    id: string;
    proposedBodyText: string;
    proposedVisibility: string;
    status: string;
    sentMessageId: string | null;
  }> = {}) {
    return {
      id: 'draft-a',
      proposedBodyText: 'Thank you for contacting us.',
      proposedVisibility: 'public',
      status: 'manually_marked_sent',
      sentMessageId: null,
      ...overrides,
    };
  }

  it('returns a unique match when exactly one draft matches', () => {
    const result = findBackLinkCandidate({
      newlyLandedMessage: makeMessage({
        direction: 'outbound',
        bodyText: 'Thank you for contacting us.',
      }),
      candidateDrafts: [makeCandidateDraft()],
    });
    expect(result.match).toEqual({ id: 'draft-a' });
    expect(result.ambiguous).toBe(false);
  });

  it('returns { match: null, ambiguous: true } when multiple drafts match', () => {
    const result = findBackLinkCandidate({
      newlyLandedMessage: makeMessage({
        direction: 'outbound',
        bodyText: 'Thank you for contacting us.',
      }),
      candidateDrafts: [
        makeCandidateDraft({ id: 'draft-a' }),
        makeCandidateDraft({ id: 'draft-b' }),
      ],
    });
    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it('returns { match: null, ambiguous: false } when no draft matches', () => {
    const result = findBackLinkCandidate({
      newlyLandedMessage: makeMessage({
        direction: 'outbound',
        bodyText: 'Completely different reply.',
      }),
      candidateDrafts: [makeCandidateDraft()],
    });
    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('does not match drafts that already have a sentMessageId set', () => {
    const result = findBackLinkCandidate({
      newlyLandedMessage: makeMessage({ direction: 'outbound', bodyText: 'Thank you for contacting us.' }),
      candidateDrafts: [makeCandidateDraft({ sentMessageId: 'msg-123' })],
    });
    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('does not match drafts with ineligible status', () => {
    const result = findBackLinkCandidate({
      newlyLandedMessage: makeMessage({ direction: 'outbound', bodyText: 'Thank you for contacting us.' }),
      candidateDrafts: [
        makeCandidateDraft({ status: 'awaiting_review' }),
        makeCandidateDraft({ status: 'dispatching' }),
        makeCandidateDraft({ status: 'needs_reconciliation' }),
      ],
    });
    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('matches internal_note direction to internal visibility drafts', () => {
    const result = findBackLinkCandidate({
      newlyLandedMessage: makeMessage({
        direction: 'internal_note',
        visibility: 'internal',
        bodyText: 'Internal note body.',
      }),
      candidateDrafts: [
        makeCandidateDraft({
          id: 'draft-internal',
          proposedBodyText: 'Internal note body.',
          proposedVisibility: 'internal',
          status: 'manually_marked_sent',
        }),
      ],
    });
    expect(result.match).toEqual({ id: 'draft-internal' });
    expect(result.ambiguous).toBe(false);
  });

  it('does not match outbound message to internal draft', () => {
    const result = findBackLinkCandidate({
      newlyLandedMessage: makeMessage({
        direction: 'outbound',
        bodyText: 'Internal note body.',
      }),
      candidateDrafts: [
        makeCandidateDraft({
          proposedBodyText: 'Internal note body.',
          proposedVisibility: 'internal',
          status: 'manually_marked_sent',
        }),
      ],
    });
    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('normalises whitespace before comparing body text', () => {
    const result = findBackLinkCandidate({
      newlyLandedMessage: makeMessage({
        direction: 'outbound',
        bodyText: '  Thank you   for contacting  us.  ',
      }),
      candidateDrafts: [
        makeCandidateDraft({
          proposedBodyText: 'Thank you for contacting us.',
          proposedVisibility: 'public',
          status: 'sent',
          sentMessageId: null,
        }),
      ],
    });
    expect(result.match).toEqual({ id: 'draft-a' });
    expect(result.ambiguous).toBe(false);
  });

  it('matches drafts with status sent (as well as manually_marked_sent)', () => {
    const result = findBackLinkCandidate({
      newlyLandedMessage: makeMessage({ direction: 'outbound', bodyText: 'Reply text.' }),
      candidateDrafts: [
        makeCandidateDraft({
          id: 'draft-sent',
          proposedBodyText: 'Reply text.',
          status: 'sent',
          sentMessageId: null,
        }),
      ],
    });
    expect(result.match).toEqual({ id: 'draft-sent' });
    expect(result.ambiguous).toBe(false);
  });
});
