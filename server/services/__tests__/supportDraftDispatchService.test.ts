// supportDraftDispatchService.test.ts — Vitest tests for pure dispatch helpers.
// Tests only deterministic pure functions; no DB, no mocking needed.

import { describe, it, expect } from 'vitest';
import {
  isValidDraftStatusTransition,
  deriveActionIdempotencyKey,
  deriveInPlaceActionKey,
  planSameRunSupersession,
  type DraftStatus,
} from '../supportDraftDispatchServicePure.js';

// ---------------------------------------------------------------------------
// isValidDraftStatusTransition
// ---------------------------------------------------------------------------

describe('isValidDraftStatusTransition', () => {
  // ── Valid transitions (happy path + documented exceptions) ──────────────

  it.each<[DraftStatus, DraftStatus]>([
    // From draft
    ['draft', 'awaiting_review'],
    ['draft', 'superseded'],
    ['draft', 'dispatching'],
    ['draft', 'expired'],
    // From awaiting_review
    ['awaiting_review', 'dispatching'],
    ['awaiting_review', 'rejected'],
    ['awaiting_review', 'superseded'],
    ['awaiting_review', 'expired'],
    // From dispatching
    ['dispatching', 'sent'],
    ['dispatching', 'needs_reconciliation'],
    ['dispatching', 'failed'],
    // From needs_reconciliation (all permitted exits)
    ['needs_reconciliation', 'failed'],
    ['needs_reconciliation', 'manually_marked_sent'],
    ['needs_reconciliation', 'sent'],
    ['needs_reconciliation', 'dispatching'],
    // From manually_marked_sent (back-link route only)
    ['manually_marked_sent', 'sent'],
  ])('allows %s → %s', (from, to) => {
    expect(isValidDraftStatusTransition(from, to)).toBe(true);
  });

  // ── Explicitly forbidden transitions ───────────────────────────────────

  it('forbids dispatching → expired', () => {
    expect(isValidDraftStatusTransition('dispatching', 'expired')).toBe(false);
  });

  // ── Post-terminal: sent is fully terminal (no exit) ─────────────────────

  it.each<DraftStatus>([
    'draft', 'awaiting_review', 'dispatching', 'needs_reconciliation',
    'manually_marked_sent', 'rejected', 'failed', 'expired', 'superseded',
  ])('forbids sent → %s', (to) => {
    expect(isValidDraftStatusTransition('sent', to)).toBe(false);
  });

  // ── Post-terminal: failed is fully terminal (no exit) ──────────────────

  it.each<DraftStatus>([
    'draft', 'awaiting_review', 'dispatching', 'needs_reconciliation',
    'manually_marked_sent', 'sent', 'rejected', 'expired', 'superseded',
  ])('forbids failed → %s', (to) => {
    expect(isValidDraftStatusTransition('failed', to)).toBe(false);
  });

  // ── Post-terminal: rejected is fully terminal (no exit) ────────────────

  it.each<DraftStatus>([
    'draft', 'awaiting_review', 'dispatching', 'needs_reconciliation',
    'manually_marked_sent', 'sent', 'failed', 'expired', 'superseded',
  ])('forbids rejected → %s', (to) => {
    expect(isValidDraftStatusTransition('rejected', to)).toBe(false);
  });

  // ── Post-terminal: expired is fully terminal (no exit) ─────────────────

  it.each<DraftStatus>([
    'draft', 'awaiting_review', 'dispatching', 'needs_reconciliation',
    'manually_marked_sent', 'sent', 'rejected', 'failed', 'superseded',
  ])('forbids expired → %s', (to) => {
    expect(isValidDraftStatusTransition('expired', to)).toBe(false);
  });

  // ── Post-terminal: superseded is fully terminal (no exit) ──────────────

  it.each<DraftStatus>([
    'draft', 'awaiting_review', 'dispatching', 'needs_reconciliation',
    'manually_marked_sent', 'sent', 'rejected', 'failed', 'expired',
  ])('forbids superseded → %s', (to) => {
    expect(isValidDraftStatusTransition('superseded', to)).toBe(false);
  });

  // ── manually_marked_sent only allows → sent ────────────────────────────

  it.each<DraftStatus>([
    'draft', 'awaiting_review', 'dispatching', 'needs_reconciliation',
    'rejected', 'failed', 'expired', 'superseded',
  ])('forbids manually_marked_sent → %s', (to) => {
    expect(isValidDraftStatusTransition('manually_marked_sent', to)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveActionIdempotencyKey
// ---------------------------------------------------------------------------

describe('deriveActionIdempotencyKey', () => {
  const base = {
    connectorConfigId: 'cc-111',
    ticketId: 'tk-222',
    actionType: 'reply' as const,
    draftId: 'dr-333',
  };

  it('returns a 64-char hex string (SHA-256)', () => {
    const key = deriveActionIdempotencyKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs produce the same key', () => {
    expect(deriveActionIdempotencyKey(base)).toBe(deriveActionIdempotencyKey(base));
  });

  it('different draftId produces a different key', () => {
    const other = { ...base, draftId: 'dr-999' };
    expect(deriveActionIdempotencyKey(base)).not.toBe(deriveActionIdempotencyKey(other));
  });

  it('different connectorConfigId produces a different key', () => {
    const other = { ...base, connectorConfigId: 'cc-000' };
    expect(deriveActionIdempotencyKey(base)).not.toBe(deriveActionIdempotencyKey(other));
  });

  it('different actionType produces a different key', () => {
    const other = { ...base, actionType: 'internal_note' as const };
    expect(deriveActionIdempotencyKey(base)).not.toBe(deriveActionIdempotencyKey(other));
  });
});

// ---------------------------------------------------------------------------
// deriveInPlaceActionKey
// ---------------------------------------------------------------------------

describe('deriveInPlaceActionKey', () => {
  const base = {
    connectorConfigId: 'cc-111',
    ticketId: 'tk-222',
    actionType: 'status_change' as const,
    payload: { status: 'resolved', reason: 'fixed' },
  };

  it('returns a 64-char hex string (SHA-256)', () => {
    const key = deriveInPlaceActionKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs produce the same key', () => {
    expect(deriveInPlaceActionKey(base)).toBe(deriveInPlaceActionKey(base));
  });

  it('is key-order-independent (sorted payload)', () => {
    const shuffled = {
      ...base,
      payload: { reason: 'fixed', status: 'resolved' },
    };
    expect(deriveInPlaceActionKey(base)).toBe(deriveInPlaceActionKey(shuffled));
  });

  it('different payload produces a different key', () => {
    const other = { ...base, payload: { status: 'open' } };
    expect(deriveInPlaceActionKey(base)).not.toBe(deriveInPlaceActionKey(other));
  });
});

// ---------------------------------------------------------------------------
// planSameRunSupersession
// ---------------------------------------------------------------------------

describe('planSameRunSupersession', () => {
  it("returns 'supersede_then_insert' when existingDraft.status is 'draft'", () => {
    const result = planSameRunSupersession({
      existingDraft: { status: 'draft' },
      newProposal: { visibility: 'public' },
    });
    expect(result).toEqual({ action: 'supersede_then_insert' });
  });

  it("returns 'supersede_then_insert' when existingDraft.status is 'awaiting_review'", () => {
    const result = planSameRunSupersession({
      existingDraft: { status: 'awaiting_review' },
      newProposal: { visibility: 'internal' },
    });
    expect(result).toEqual({ action: 'supersede_then_insert' });
  });

  it("returns 'insert_only' when existingDraft is null", () => {
    const result = planSameRunSupersession({
      existingDraft: null,
      newProposal: { visibility: 'public' },
    });
    expect(result).toEqual({ action: 'insert_only' });
  });

  it("returns 'insert_only' when existingDraft.status is 'sent'", () => {
    const result = planSameRunSupersession({
      existingDraft: { status: 'sent' },
      newProposal: { visibility: 'public' },
    });
    expect(result).toEqual({ action: 'insert_only' });
  });

  it("returns 'insert_only' when existingDraft.status is 'rejected'", () => {
    const result = planSameRunSupersession({
      existingDraft: { status: 'rejected' },
      newProposal: { visibility: 'public' },
    });
    expect(result).toEqual({ action: 'insert_only' });
  });

  it("returns 'insert_only' when existingDraft.status is 'dispatching'", () => {
    const result = planSameRunSupersession({
      existingDraft: { status: 'dispatching' },
      newProposal: { visibility: 'public' },
    });
    expect(result).toEqual({ action: 'insert_only' });
  });

  it("returns 'insert_only' when existingDraft.status is 'failed'", () => {
    const result = planSameRunSupersession({
      existingDraft: { status: 'failed' },
      newProposal: { visibility: 'public' },
    });
    expect(result).toEqual({ action: 'insert_only' });
  });

  it("returns 'insert_only' when existingDraft.status is 'needs_reconciliation'", () => {
    const result = planSameRunSupersession({
      existingDraft: { status: 'needs_reconciliation' },
      newProposal: { visibility: 'public' },
    });
    expect(result).toEqual({ action: 'insert_only' });
  });

  it("returns 'insert_only' when existingDraft.status is 'superseded'", () => {
    const result = planSameRunSupersession({
      existingDraft: { status: 'superseded' },
      newProposal: { visibility: 'public' },
    });
    expect(result).toEqual({ action: 'insert_only' });
  });

  it("returns 'insert_only' when existingDraft.status is 'expired'", () => {
    const result = planSameRunSupersession({
      existingDraft: { status: 'expired' },
      newProposal: { visibility: 'public' },
    });
    expect(result).toEqual({ action: 'insert_only' });
  });
});
