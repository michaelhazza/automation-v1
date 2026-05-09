/**
 * Tests for supportTicketServicePure — pure functions only, no DB or async.
 *
 * Spec: tasks/builds/support-desk-canonical/spec.md §9, §11.5, §11.8
 */

import { describe, it, expect } from 'vitest';
import {
  isValidTicketStatusTransition,
  filterDeletedFromAgentReads,
  applyMessageRedactionFilterForAudience,
  isDeletionByPollAllowed,
} from '../supportTicketServicePure.js';
import type { SupportCanonicalStatus } from '../../adapters/integrationAdapter.js';

// ---------------------------------------------------------------------------
// isValidTicketStatusTransition
// ---------------------------------------------------------------------------

describe('isValidTicketStatusTransition', () => {
  const nonQuarantineStatuses: SupportCanonicalStatus[] = [
    'open',
    'pending_internal',
    'waiting_on_customer',
    'resolved',
    'closed',
  ];

  it('allows all transitions between the five non-quarantine statuses', () => {
    for (const from of nonQuarantineStatuses) {
      for (const to of nonQuarantineStatuses) {
        if (from === to) continue;
        expect(
          isValidTicketStatusTransition(from, to),
          `expected ${from} → ${to} to be VALID`,
        ).toBe(true);
      }
    }
  });

  it('forbids any → unknown_provider_status (no regression to quarantine)', () => {
    const allStatuses: SupportCanonicalStatus[] = [
      ...nonQuarantineStatuses,
      'unknown_provider_status',
    ];
    for (const from of allStatuses) {
      expect(
        isValidTicketStatusTransition(from, 'unknown_provider_status'),
        `expected ${from} → unknown_provider_status to be INVALID`,
      ).toBe(false);
    }
  });

  it('allows unknown_provider_status → open (mapping-fix correction)', () => {
    expect(isValidTicketStatusTransition('unknown_provider_status', 'open')).toBe(true);
  });

  it('allows unknown_provider_status → all non-quarantine statuses', () => {
    for (const to of nonQuarantineStatuses) {
      expect(
        isValidTicketStatusTransition('unknown_provider_status', to),
        `expected unknown_provider_status → ${to} to be VALID`,
      ).toBe(true);
    }
  });

  it('forbids unknown_provider_status → unknown_provider_status', () => {
    expect(isValidTicketStatusTransition('unknown_provider_status', 'unknown_provider_status')).toBe(false);
  });

  it('forbids same-status transitions', () => {
    for (const status of nonQuarantineStatuses) {
      expect(
        isValidTicketStatusTransition(status, status),
        `expected ${status} → ${status} to be INVALID (same-status no-op)`,
      ).toBe(false);
    }
  });

  it('allows closed → open (ticket reopening via human reply)', () => {
    expect(isValidTicketStatusTransition('closed', 'open')).toBe(true);
  });

  it('allows resolved → open (provider can reopen)', () => {
    expect(isValidTicketStatusTransition('resolved', 'open')).toBe(true);
  });

  it('allows open → closed', () => {
    expect(isValidTicketStatusTransition('open', 'closed')).toBe(true);
  });

  it('allows open → resolved', () => {
    expect(isValidTicketStatusTransition('open', 'resolved')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterDeletedFromAgentReads
// ---------------------------------------------------------------------------

describe('filterDeletedFromAgentReads', () => {
  it('removes rows where providerDeleted is true', () => {
    const rows = [
      { id: 'a', providerDeleted: false },
      { id: 'b', providerDeleted: true },
      { id: 'c', providerDeleted: false },
    ];
    const result = filterDeletedFromAgentReads(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns all rows when none are deleted', () => {
    const rows = [
      { id: 'x', providerDeleted: false },
      { id: 'y', providerDeleted: false },
    ];
    expect(filterDeletedFromAgentReads(rows)).toHaveLength(2);
  });

  it('returns empty array when all rows are deleted', () => {
    const rows = [
      { id: '1', providerDeleted: true },
      { id: '2', providerDeleted: true },
    ];
    expect(filterDeletedFromAgentReads(rows)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(filterDeletedFromAgentReads([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyMessageRedactionFilterForAudience
// ---------------------------------------------------------------------------

const liveMessage = {
  redacted: false,
  bodyText: 'Hello customer',
  bodyHtml: '<p>Hello customer</p>',
  attachments: [{ filename: 'file.pdf' }],
};

const redactedMessage = {
  redacted: true,
  bodyText: 'sensitive content',
  bodyHtml: '<p>sensitive content</p>',
  attachments: [{ filename: 'secret.pdf' }],
};

describe('applyMessageRedactionFilterForAudience', () => {
  describe('agent audience', () => {
    it('replaces bodyText, bodyHtml, and attachments for redacted messages', () => {
      const result = applyMessageRedactionFilterForAudience([redactedMessage], 'agent');
      expect(result[0]!.bodyText).toBe('[redacted]');
      expect(result[0]!.bodyHtml).toBeNull();
      expect(result[0]!.attachments).toBeNull();
    });

    it('passes through non-redacted messages unchanged', () => {
      const result = applyMessageRedactionFilterForAudience([liveMessage], 'agent');
      expect(result[0]).toEqual(liveMessage);
    });

    it('handles mixed messages correctly', () => {
      const result = applyMessageRedactionFilterForAudience([liveMessage, redactedMessage], 'agent');
      expect(result[0]).toEqual(liveMessage);
      expect(result[1]!.bodyText).toBe('[redacted]');
    });
  });

  describe('human_ui audience', () => {
    it('applies same redaction as agent audience', () => {
      const result = applyMessageRedactionFilterForAudience([redactedMessage], 'human_ui');
      expect(result[0]!.bodyText).toBe('[redacted]');
      expect(result[0]!.bodyHtml).toBeNull();
      expect(result[0]!.attachments).toBeNull();
    });

    it('passes through non-redacted messages unchanged', () => {
      const result = applyMessageRedactionFilterForAudience([liveMessage], 'human_ui');
      expect(result[0]).toEqual(liveMessage);
    });
  });

  describe('audit audience', () => {
    it('returns redacted messages as-is (audit sees everything)', () => {
      const result = applyMessageRedactionFilterForAudience([redactedMessage], 'audit');
      expect(result[0]).toEqual(redactedMessage);
      expect(result[0]!.bodyText).toBe('sensitive content');
      expect(result[0]!.bodyHtml).toBe('<p>sensitive content</p>');
      expect(result[0]!.attachments).toEqual([{ filename: 'secret.pdf' }]);
    });

    it('returns non-redacted messages as-is', () => {
      const result = applyMessageRedactionFilterForAudience([liveMessage], 'audit');
      expect(result[0]).toEqual(liveMessage);
    });

    it('returns the same array reference (no copying)', () => {
      const messages = [liveMessage, redactedMessage];
      const result = applyMessageRedactionFilterForAudience(messages, 'audit');
      expect(result).toBe(messages);
    });
  });
});

// ---------------------------------------------------------------------------
// isDeletionByPollAllowed
// ---------------------------------------------------------------------------

describe('isDeletionByPollAllowed', () => {
  it('returns true for a complete full reconciliation with no failures or rate-limiting', () => {
    expect(
      isDeletionByPollAllowed({
        isFullReconciliation: true,
        anyPageFailed: false,
        anyRateLimited: false,
        allPagesComplete: true,
      }),
    ).toBe(true);
  });

  it('returns false for an incremental poll regardless of other flags', () => {
    expect(
      isDeletionByPollAllowed({
        isFullReconciliation: false,
        anyPageFailed: false,
        anyRateLimited: false,
        allPagesComplete: true,
      }),
    ).toBe(false);
  });

  it('returns false when any page failed (even during full reconciliation)', () => {
    expect(
      isDeletionByPollAllowed({
        isFullReconciliation: true,
        anyPageFailed: true,
        anyRateLimited: false,
        allPagesComplete: true,
      }),
    ).toBe(false);
  });

  it('returns false when rate-limited (even during full reconciliation)', () => {
    expect(
      isDeletionByPollAllowed({
        isFullReconciliation: true,
        anyPageFailed: false,
        anyRateLimited: true,
        allPagesComplete: true,
      }),
    ).toBe(false);
  });

  it('returns false when pages are not complete (even during full reconciliation)', () => {
    expect(
      isDeletionByPollAllowed({
        isFullReconciliation: true,
        anyPageFailed: false,
        anyRateLimited: false,
        allPagesComplete: false,
      }),
    ).toBe(false);
  });

  it('returns false when multiple preconditions fail', () => {
    expect(
      isDeletionByPollAllowed({
        isFullReconciliation: false,
        anyPageFailed: true,
        anyRateLimited: true,
        allPagesComplete: false,
      }),
    ).toBe(false);
  });
});
