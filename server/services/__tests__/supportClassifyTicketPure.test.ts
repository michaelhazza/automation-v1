/**
 * supportClassifyTicketPure.test.ts — Unit tests for pure helpers in supportClassifyTicketPure.ts
 *
 * Chunk 6 (phase-1-showcase-mvps): covers isMalformedOutput malformed-output cases,
 * buildClassifyPrompt prompt construction, and buildSentinelResult sentinel shape.
 *
 * Test posture: targeted Vitest only — do NOT run umbrella suites locally.
 */

import { describe, it, expect } from 'vitest';
import {
  isMalformedOutput,
  buildClassifyPrompt,
  buildSentinelResult,
  scoreIntentConfidence,
} from '../skillHandlers/supportClassifyTicketPure.js';
import type { SupportClassifyTicketResult } from '../../../shared/types/supportClassifyTicketResult.js';

// ---------------------------------------------------------------------------
// isMalformedOutput — malformed-output cases
// ---------------------------------------------------------------------------

describe('isMalformedOutput', () => {
  it('returns true when intent is null', () => {
    const input = {
      intent: null,
      urgency: 'medium',
      recommended_action: 'draft_reply',
      confidence: 0.8,
      reasoning: 'looks fine',
      escalate_reason: null,
    };
    expect(isMalformedOutput(input)).toBe(true);
  });

  it('returns true when confidence is out of range (1.5)', () => {
    const input = {
      intent: 'bug_report',
      urgency: 'high',
      recommended_action: 'draft_reply',
      confidence: 1.5,
      reasoning: 'out of range',
      escalate_reason: null,
    };
    expect(isMalformedOutput(input)).toBe(true);
  });

  it('returns true when recommended_action is missing', () => {
    const input = {
      intent: 'billing_question',
      urgency: 'low',
      confidence: 0.7,
      reasoning: 'missing action',
      escalate_reason: null,
    };
    expect(isMalformedOutput(input)).toBe(true);
  });

  it('returns true for null input', () => {
    expect(isMalformedOutput(null)).toBe(true);
  });

  it('returns true for non-object input', () => {
    expect(isMalformedOutput('invalid string')).toBe(true);
  });

  it('returns false for a fully valid result', () => {
    const input: SupportClassifyTicketResult = {
      intent: 'bug_report',
      urgency: 'high',
      recommended_action: 'escalate_to_human',
      confidence: 0.9,
      reasoning: 'user reported a crash',
      escalate_reason: 'needs engineering review',
    };
    expect(isMalformedOutput(input)).toBe(false);
  });

  it('returns true when intent is an unrecognised enum value', () => {
    const input = {
      intent: 'unknown_intent_type',
      urgency: 'medium',
      recommended_action: 'draft_reply',
      confidence: 0.5,
      reasoning: 'bad intent enum',
      escalate_reason: null,
    };
    expect(isMalformedOutput(input)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildClassifyPrompt — prompt construction
// ---------------------------------------------------------------------------

describe('buildClassifyPrompt', () => {
  it('returns strings containing the subject', () => {
    const { system, user } = buildClassifyPrompt('Password reset help', 'I cannot log in', []);
    expect(typeof system).toBe('string');
    expect(user).toContain('Password reset help');
  });

  it('includes the ticket body in the user prompt', () => {
    const { user } = buildClassifyPrompt('Billing issue', 'I was charged twice', []);
    expect(user).toContain('I was charged twice');
  });

  it('includes recent messages when provided', () => {
    const { user } = buildClassifyPrompt('Subject', 'Body', ['First message', 'Second message']);
    expect(user).toContain('First message');
    expect(user).toContain('Second message');
  });

  it('does not include recent messages section when array is empty', () => {
    const { user } = buildClassifyPrompt('Subject', 'Body', []);
    expect(user).not.toContain('Recent messages:');
  });

  it('system prompt contains the JSON schema description', () => {
    const { system } = buildClassifyPrompt('Subject', 'Body', []);
    expect(system).toContain('intent');
    expect(system).toContain('urgency');
    expect(system).toContain('recommended_action');
    expect(system).toContain('confidence');
  });
});

// ---------------------------------------------------------------------------
// buildSentinelResult — sentinel shape
// ---------------------------------------------------------------------------

describe('buildSentinelResult', () => {
  it('returns confidence = 0', () => {
    const result = buildSentinelResult('classification_parse_failed');
    expect(result.confidence).toBe(0);
  });

  it('returns recommended_action = escalate_to_human', () => {
    const result = buildSentinelResult('classification_parse_failed');
    expect(result.recommended_action).toBe('escalate_to_human');
  });

  it('returns the provided reason as escalate_reason', () => {
    const result = buildSentinelResult('my_reason');
    expect(result.escalate_reason).toBe('my_reason');
  });

  it('returns intent = other', () => {
    const result = buildSentinelResult('any');
    expect(result.intent).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// scoreIntentConfidence — pass-through behaviour
// ---------------------------------------------------------------------------

describe('scoreIntentConfidence', () => {
  it('returns the confidence from the result', () => {
    const result: SupportClassifyTicketResult = {
      intent: 'billing_question',
      urgency: 'low',
      recommended_action: 'draft_reply',
      confidence: 0.75,
      reasoning: 'looks straightforward',
      escalate_reason: null,
    };
    expect(scoreIntentConfidence(result)).toBe(0.75);
  });
});
