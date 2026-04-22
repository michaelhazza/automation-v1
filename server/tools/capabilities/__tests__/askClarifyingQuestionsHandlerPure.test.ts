/**
 * Pure-function tests for ask_clarifying_questions output validation.
 * Run via: npx tsx server/tools/capabilities/__tests__/askClarifyingQuestionsHandlerPure.test.ts
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
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
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('rejects payload with more than 5 questions', () => {
  const payload = {
    ...VALID_PAYLOAD,
    questions: Array(6).fill(VALID_PAYLOAD.questions[0]),
  };
  const r = validateClarifyingQuestionsOutput(payload);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('≤ 5')));
});

test('rejects question longer than 140 chars', () => {
  const payload = {
    ...VALID_PAYLOAD,
    questions: [{ ...VALID_PAYLOAD.questions[0], question: 'x'.repeat(141) }],
  };
  const r = validateClarifyingQuestionsOutput(payload);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('≤ 140')));
});

test('rejects invalid ambiguityDimension', () => {
  const payload = {
    ...VALID_PAYLOAD,
    questions: [{ ...VALID_PAYLOAD.questions[0], ambiguityDimension: 'invalid_dim' }],
  };
  const r = validateClarifyingQuestionsOutput(payload);
  assert.equal(r.valid, false);
});

test('rejects expectedConfidenceAfter <= confidenceBefore', () => {
  const payload = { ...VALID_PAYLOAD, confidenceBefore: 0.9, expectedConfidenceAfter: 0.8 };
  const r = validateClarifyingQuestionsOutput(payload);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('expectedConfidenceAfter must be > confidenceBefore')));
});

test('rejects non-object payload', () => {
  const r = validateClarifyingQuestionsOutput('not an object');
  assert.equal(r.valid, false);
});

test('parseClarifyingQuestionsOutput parses valid JSON', () => {
  const payload = parseClarifyingQuestionsOutput(JSON.stringify(VALID_PAYLOAD));
  assert.equal(payload.questions.length, 1);
  assert.equal(payload.confidenceBefore, 0.55);
  assert.equal(payload.expectedConfidenceAfter, 0.92);
});

test('parseClarifyingQuestionsOutput throws on invalid JSON', () => {
  assert.throws(() => parseClarifyingQuestionsOutput('not json'));
});

test('assembleClarifyingQuestionsPrompt includes briefText and confidence', () => {
  const prompt = assembleClarifyingQuestionsPrompt({
    briefText: 'Show VIP contacts',
    orchestratorConfidence: 0.6,
    ambiguityDimensions: ['scope', 'target'],
  });
  assert.ok(prompt.includes('Show VIP contacts'));
  assert.ok(prompt.includes('60%'));
  assert.ok(prompt.includes('scope'));
});

test('assembleClarifyingQuestionsPrompt includes prior conversation turns', () => {
  const prompt = assembleClarifyingQuestionsPrompt({
    briefText: 'Schedule follow-up',
    orchestratorConfidence: 0.5,
    ambiguityDimensions: ['timing'],
    conversationContext: [{ role: 'user', content: 'For which contact?' }],
  });
  assert.ok(prompt.includes('For which contact?'));
});
