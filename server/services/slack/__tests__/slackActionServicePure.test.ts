import { describe, it, expect } from 'vitest';
import {
  decideAutoSendScope,
  validatePostMessageInput,
  validatePostDmInput,
  deriveIdempotencyKey,
  assembleThreadSummaryPrompt,
} from '../slackActionServicePure.js';

describe('decideAutoSendScope', () => {
  it('post_message -> review regardless of target', () => {
    expect(
      decideAutoSendScope({ action: 'post_message', target: 'C123', ownerUserId: 'U123' }),
    ).toBe('review');
  });

  it('post_dm to ownerUserId -> auto', () => {
    expect(
      decideAutoSendScope({ action: 'post_dm', target: 'U123', ownerUserId: 'U123' }),
    ).toBe('auto');
  });

  it('post_dm to different user -> review', () => {
    expect(
      decideAutoSendScope({ action: 'post_dm', target: 'U999', ownerUserId: 'U123' }),
    ).toBe('review');
  });

  it('post_dm to channel id -> review', () => {
    expect(
      decideAutoSendScope({ action: 'post_dm', target: 'C456', ownerUserId: 'U123' }),
    ).toBe('review');
  });
});

describe('validatePostMessageInput', () => {
  it('valid: channelId + text present', () => {
    expect(validatePostMessageInput({ channelId: 'C123', text: 'hello' })).toEqual({ valid: true });
  });

  it('invalid: missing channelId', () => {
    const result = validatePostMessageInput({ text: 'hello' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/channelId/);
  });

  it('invalid: empty text', () => {
    const result = validatePostMessageInput({ channelId: 'C123', text: '   ' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/text/);
  });

  it('invalid: non-object input', () => {
    const result = validatePostMessageInput(null);
    expect(result.valid).toBe(false);
  });
});

describe('validatePostDmInput', () => {
  it('valid: targetUserId + text present', () => {
    expect(validatePostDmInput({ targetUserId: 'U123', text: 'hi' })).toEqual({ valid: true });
  });

  it('invalid: missing targetUserId', () => {
    const result = validatePostDmInput({ text: 'hi' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/targetUserId/);
  });

  it('invalid: missing text', () => {
    const result = validatePostDmInput({ targetUserId: 'U123' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/text/);
  });
});

describe('deriveIdempotencyKey', () => {
  it('same args produce same key', () => {
    const args = { action: 'post_message', ownerUserId: 'U1', target: 'C1', text: 'hello' };
    expect(deriveIdempotencyKey(args)).toBe(deriveIdempotencyKey(args));
  });

  it('different ownerUserId produces different key', () => {
    const a = deriveIdempotencyKey({ action: 'post_dm', ownerUserId: 'U1', target: 'C1', text: 'hi' });
    const b = deriveIdempotencyKey({ action: 'post_dm', ownerUserId: 'U2', target: 'C1', text: 'hi' });
    expect(a).not.toBe(b);
  });
});

describe('assembleThreadSummaryPrompt', () => {
  it('returns a string containing all message texts', () => {
    const messages = [
      { user: 'U1', text: 'hello', ts: '1000.0001' },
      { user: 'U2', text: 'world', ts: '1000.0002' },
    ];
    const prompt = assembleThreadSummaryPrompt(messages);
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('hello');
    expect(prompt).toContain('world');
  });

  it('handles empty messages array', () => {
    const prompt = assembleThreadSummaryPrompt([]);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});
