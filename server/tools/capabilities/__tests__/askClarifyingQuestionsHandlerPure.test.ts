/**
 * Pure-function tests for ask_clarifying_questions output validation.
 * Run via: npx tsx server/tools/capabilities/__tests__/askClarifyingQuestionsHandlerPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  validateClarifyingQuestionsOutput,
  parseClarifyingQuestionsOutput,
  assembleClarifyingQuestionsPrompt,
} from '../askClarifyingQuestionsHandlerPure.js';

const VALID_PAYLOAD = {
  questions: [
    {
      question: 'Which subaccount should this apply to?',
      rationale: 'Brief did not specify a subaccount.',
      ambiguityDimension: 'scope',
      suggestedAnswers: ['Acme Inc', 'Beta Ltd'],
    },
  ],
  confidenceBefore: 0.55,
  expectedConfidenceAfter: 0.92,
};

test('valid payload passes validation', () => {
  const r = validateClarifyingQuestionsOutput(VALID_PAYLOAD);
  expect(r.valid).toBe(true);
  expect(r.errors).toEqual([]);
});

test('rejects payload with more than 5 questions', () => {
  const payload = {
    ...VALID_PAYLOAD,
    questions: Array(6).fill(VALID_PAYLOAD.questions[0]),
  };
  const r = validateClarifyingQuestionsOutput(payload);
  expect(r.valid).toBe(false);
  expect(r.errors.some((e) => e.includes('≤ 5'))).toBeTruthy();
});

test('rejects question longer than 140 chars', () => {
  const payload = {
    ...VALID_PAYLOAD,
    questions: [{ ...VALID_PAYLOAD.questions[0], question: 'x'.repeat(141) }],
  };
  const r = validateClarifyingQuestionsOutput(payload);
  expect(r.valid).toBe(false);
  expect(r.errors.some((e) => e.includes('≤ 140'))).toBeTruthy();
});

test('rejects invalid ambiguityDimension', () => {
  const payload = {
    ...VALID_PAYLOAD,
    questions: [{ ...VALID_PAYLOAD.questions[0], ambiguityDimension: 'invalid_dim' }],
  };
  const r = validateClarifyingQuestionsOutput(payload);
  expect(r.valid).toBe(false);
});

test('rejects expectedConfidenceAfter <= confidenceBefore', () => {
  const payload = { ...VALID_PAYLOAD, confidenceBefore: 0.9, expectedConfidenceAfter: 0.8 };
  const r = validateClarifyingQuestionsOutput(payload);
  expect(r.valid).toBe(false);
  expect(r.errors.some((e) => e.includes('expectedConfidenceAfter must be > confidenceBefore'))).toBeTruthy();
});

test('rejects non-object payload', () => {
  const r = validateClarifyingQuestionsOutput('not an object');
  expect(r.valid).toBe(false);
});

test('parseClarifyingQuestionsOutput parses valid JSON', () => {
  const payload = parseClarifyingQuestionsOutput(JSON.stringify(VALID_PAYLOAD));
  expect(payload.questions.length).toBe(1);
  expect(payload.confidenceBefore).toBe(0.55);
  expect(payload.expectedConfidenceAfter).toBe(0.92);
});

test('parseClarifyingQuestionsOutput throws on invalid JSON', () => {
  expect(() => parseClarifyingQuestionsOutput('not json')).toThrow();
});

test('assembleClarifyingQuestionsPrompt includes briefText and confidence', () => {
  const prompt = assembleClarifyingQuestionsPrompt({
    briefText: 'Show VIP contacts',
    orchestratorConfidence: 0.6,
    ambiguityDimensions: ['scope', 'target'],
  });
  expect(prompt.includes('Show VIP contacts')).toBeTruthy();
  expect(prompt.includes('60%')).toBeTruthy();
  expect(prompt.includes('scope')).toBeTruthy();
});

test('assembleClarifyingQuestionsPrompt includes prior conversation turns', () => {
  const prompt = assembleClarifyingQuestionsPrompt({
    briefText: 'Schedule follow-up',
    orchestratorConfidence: 0.5,
    ambiguityDimensions: ['timing'],
    conversationContext: [{ role: 'user', content: 'For which contact?' }],
  });
  expect(prompt.includes('For which contact?')).toBeTruthy();
});
