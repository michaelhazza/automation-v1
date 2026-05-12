import { describe, it, expect } from 'vitest';
import { canTransition, computeExpiresAt } from '../eaDraftServicePure.js';

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
