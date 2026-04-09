import { describe, it, expect } from 'vitest';
import {
  parseCritiqueResult,
  buildCritiquePrompt,
  shouldCritique,
} from '../middleware/critiqueGatePure.js';

describe('parseCritiqueResult', () => {
  it('parses a valid ok result', () => {
    const result = parseCritiqueResult('{ "verdict": "ok", "reason": "Tool call matches user intent" }');
    expect(result).toEqual({ verdict: 'ok', reason: 'Tool call matches user intent' });
  });

  it('parses a valid suspect result', () => {
    const result = parseCritiqueResult('{ "verdict": "suspect", "reason": "Wrong recipient" }');
    expect(result).toEqual({ verdict: 'suspect', reason: 'Wrong recipient' });
  });

  it('handles markdown-fenced JSON', () => {
    const input = '```json\n{ "verdict": "ok", "reason": "Looks good" }\n```';
    const result = parseCritiqueResult(input);
    expect(result?.verdict).toBe('ok');
  });

  it('returns null for malformed JSON', () => {
    expect(parseCritiqueResult('not json at all')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(parseCritiqueResult(null)).toBeNull();
    expect(parseCritiqueResult(undefined)).toBeNull();
  });

  it('returns null for invalid verdict value', () => {
    expect(parseCritiqueResult('{ "verdict": "maybe", "reason": "hmm" }')).toBeNull();
  });

  it('extracts JSON from surrounding text', () => {
    const input = 'Here is my assessment: { "verdict": "suspect", "reason": "Mismatch" } End.';
    const result = parseCritiqueResult(input);
    expect(result?.verdict).toBe('suspect');
  });
});

describe('buildCritiquePrompt', () => {
  it('includes tool name and args', () => {
    const prompt = buildCritiquePrompt(
      'send_email',
      { to: 'test@example.com', subject: 'Hello' },
      [{ role: 'user', content: 'Send an email to the client' }],
    );

    expect(prompt).toContain('send_email');
    expect(prompt).toContain('test@example.com');
    expect(prompt).toContain('Send an email');
  });

  it('limits recent messages to last 3', () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({
      role: 'user',
      content: `Message ${i}`,
    }));

    const prompt = buildCritiquePrompt('test_tool', {}, messages);
    expect(prompt).not.toContain('Message 0');
    expect(prompt).not.toContain('Message 1');
    expect(prompt).toContain('Message 2');
    expect(prompt).toContain('Message 3');
    expect(prompt).toContain('Message 4');
  });
});

describe('shouldCritique', () => {
  it('returns true when all conditions met', () => {
    expect(shouldCritique({
      phase: 'execution',
      wasDowngraded: true,
      requiresCritiqueGate: true,
      shadowMode: true,
    })).toBe(true);
  });

  it('returns false for planning phase', () => {
    expect(shouldCritique({
      phase: 'planning',
      wasDowngraded: true,
      requiresCritiqueGate: true,
      shadowMode: true,
    })).toBe(false);
  });

  it('returns false when not downgraded', () => {
    expect(shouldCritique({
      phase: 'execution',
      wasDowngraded: false,
      requiresCritiqueGate: true,
      shadowMode: true,
    })).toBe(false);
  });

  it('returns false when critique gate not required', () => {
    expect(shouldCritique({
      phase: 'execution',
      wasDowngraded: true,
      requiresCritiqueGate: false,
      shadowMode: true,
    })).toBe(false);
  });
});
