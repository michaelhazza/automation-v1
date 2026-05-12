import { describe, it, expect } from 'vitest';
import {
  canTransition,
  computeExpiresAt,
  isDraftOwner,
  redactDraftForViewer,
} from '../eaDraftServicePure.js';

describe('canTransition', () => {
  it('allows idle -> sending', () => expect(canTransition('idle', 'sending')).toBe(true));
  it('allows sending -> sent', () => expect(canTransition('sending', 'sent')).toBe(true));
  it('allows sending -> send_failed', () => expect(canTransition('sending', 'send_failed')).toBe(true));
  it('allows send_failed -> sending (retry)', () => expect(canTransition('send_failed', 'sending')).toBe(true));
  it('allows sending -> idle (stall reset)', () => expect(canTransition('sending', 'idle')).toBe(true));
  it('forbids idle -> sent', () => expect(canTransition('idle', 'sent')).toBe(false));
  it('forbids sent -> idle', () => expect(canTransition('sent', 'idle')).toBe(false));
  it('forbids idle -> send_failed', () => expect(canTransition('idle', 'send_failed')).toBe(false));
});

describe('computeExpiresAt', () => {
  it('returns exactly 7 days from createdAt', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    const result = computeExpiresAt(base);
    expect(result.getTime()).toBe(base.getTime() + 7 * 24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Admin redaction (spec §21.2): owner sees full body; admin non-owner sees
// metadata only with body redacted to {}; non-admin non-owner fails closed.
// ---------------------------------------------------------------------------

describe('isDraftOwner', () => {
  const draft = {
    ownerUserId: 'user-1',
    body: { text: 'secret' },
  };

  it('returns true when viewer is the owner', () => {
    expect(isDraftOwner({ userId: 'user-1', role: 'user' }, draft)).toBe(true);
  });

  it('returns false when viewer is a different user', () => {
    expect(isDraftOwner({ userId: 'user-2', role: 'user' }, draft)).toBe(false);
  });

  it('returns false when viewer is an admin', () => {
    expect(isDraftOwner({ userId: 'admin-1', role: 'org_admin' }, draft)).toBe(false);
  });

  it('returns false when draft has no owner', () => {
    expect(
      isDraftOwner({ userId: 'user-1', role: 'user' }, { ownerUserId: null, body: {} }),
    ).toBe(false);
  });
});

describe('redactDraftForViewer', () => {
  const baseDraft = {
    id: 'draft-1',
    ownerUserId: 'user-1',
    body: { channelId: 'C123', text: 'private message' },
    kind: 'slack_post' as const,
    sendState: 'idle' as const,
  };

  it('owner sees full body and bodyRedacted=false', () => {
    const result = redactDraftForViewer(baseDraft, { userId: 'user-1', role: 'user' });
    expect(result.bodyRedacted).toBe(false);
    expect(result.body).toEqual({ channelId: 'C123', text: 'private message' });
  });

  it('admin non-owner sees redacted body and bodyRedacted=true (org_admin)', () => {
    const result = redactDraftForViewer(baseDraft, { userId: 'admin-1', role: 'org_admin' });
    expect(result.bodyRedacted).toBe(true);
    expect(result.body).toEqual({});
    // metadata still present
    expect(result.id).toBe('draft-1');
    expect(result.kind).toBe('slack_post');
    expect(result.sendState).toBe('idle');
  });

  it('admin non-owner sees redacted body (system_admin)', () => {
    const result = redactDraftForViewer(baseDraft, { userId: 'admin-1', role: 'system_admin' });
    expect(result.bodyRedacted).toBe(true);
    expect(result.body).toEqual({});
  });

  it('admin non-owner sees redacted body (subaccount_admin)', () => {
    const result = redactDraftForViewer(baseDraft, { userId: 'admin-1', role: 'subaccount_admin' });
    expect(result.bodyRedacted).toBe(true);
    expect(result.body).toEqual({});
  });

  it('non-admin non-owner sees redacted body (fail-closed)', () => {
    const result = redactDraftForViewer(baseDraft, { userId: 'user-2', role: 'user' });
    expect(result.bodyRedacted).toBe(true);
    expect(result.body).toEqual({});
  });

  it('null owner draft is redacted for everyone (defensive)', () => {
    const ownerlessDraft = { ...baseDraft, ownerUserId: null };
    const ownerResult = redactDraftForViewer(ownerlessDraft, { userId: 'user-1', role: 'user' });
    expect(ownerResult.bodyRedacted).toBe(true);
    expect(ownerResult.body).toEqual({});
  });
});
