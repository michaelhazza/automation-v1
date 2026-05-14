/**
 * critiqueGatePure unit tests — runnable via:
 *   npx tsx server/services/__tests__/critiqueGatePure.test.ts
 *
 * Tests the pure parsing and gating logic for the semantic critique gate
 * introduced by Sprint 5 P4.4 of docs/improvements-roadmap-spec.md.
 */

import { expect, test } from 'vitest';
import {
  parseCritiqueResult,
  buildCritiquePrompt,
  shouldCritique,
} from '../middleware/critiqueGatePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${label}: expected ${b}, got ${a}`);
  }
}

// ── parseCritiqueResult ────────────────────────────────────────────

test('parseCritiqueResult: parses a valid ok result', () => {
  const result = parseCritiqueResult('{ "verdict": "ok", "reason": "Tool call matches user intent" }');
  expect(result, 'ok result').toStrictEqual({ verdict: 'ok', reason: 'Tool call matches user intent' });
});

test('parseCritiqueResult: parses a valid suspect result', () => {
  const result = parseCritiqueResult('{ "verdict": "suspect", "reason": "Wrong recipient" }');
  expect(result, 'suspect result').toStrictEqual({ verdict: 'suspect', reason: 'Wrong recipient' });
});

test('parseCritiqueResult: handles markdown-fenced JSON', () => {
  const input = '```json\n{ "verdict": "ok", "reason": "Looks good" }\n```';
  const result = parseCritiqueResult(input);
  expect(result?.verdict, 'verdict from fenced JSON').toBe('ok');
});

test('parseCritiqueResult: returns null for malformed JSON', () => {
  expect(parseCritiqueResult('not json at all'), 'malformed JSON').toBe(null);
});

test('parseCritiqueResult: returns null for null/undefined', () => {
  expect(parseCritiqueResult(null), 'null input').toBe(null);
  expect(parseCritiqueResult(undefined), 'undefined input').toBe(null);
});

test('parseCritiqueResult: returns null for invalid verdict value', () => {
  expect(parseCritiqueResult('{ "verdict": "maybe", "reason": "hmm" }'), 'invalid verdict').toBe(null);
});

test('parseCritiqueResult: extracts JSON from surrounding text', () => {
  const input = 'Here is my assessment: { "verdict": "suspect", "reason": "Mismatch" } End.';
  const result = parseCritiqueResult(input);
  expect(result?.verdict, 'extracted verdict').toBe('suspect');
});

// ── buildCritiquePrompt ────────────────────────────────────────────

test('buildCritiquePrompt: includes tool name and args', () => {
  const prompt = buildCritiquePrompt(
    'send_email',
    { to: 'test@example.com', subject: 'Hello' },
    [{ role: 'user', content: 'Send an email to the client' }],
  );
  expect(prompt.includes('send_email'), 'prompt should contain tool name').toBeTruthy();
  expect(prompt.includes('test@example.com'), 'prompt should contain args').toBeTruthy();
  expect(prompt.includes('Send an email'), 'prompt should contain message').toBeTruthy();
});

test('buildCritiquePrompt: limits recent messages to last 3', () => {
  const messages = Array.from({ length: 5 }, (_, i) => ({
    role: 'user',
    content: `Message ${i}`,
  }));
  const prompt = buildCritiquePrompt('test_tool', {}, messages);
  expect(!prompt.includes('Message 0'), 'should not contain Message 0').toBeTruthy();
  expect(!prompt.includes('Message 1'), 'should not contain Message 1').toBeTruthy();
  expect(prompt.includes('Message 2'), 'should contain Message 2').toBeTruthy();
  expect(prompt.includes('Message 3'), 'should contain Message 3').toBeTruthy();
  expect(prompt.includes('Message 4'), 'should contain Message 4').toBeTruthy();
});

// ── shouldCritique ─────────────────────────────────────────────────

test('shouldCritique: returns true when all conditions met', () => {
  expect(shouldCritique({
    phase: 'execution',
    wasDowngraded: true,
    requiresCritiqueGate: true,
    shadowMode: true,
  }), 'all conditions met').toBe(true);
});

test('shouldCritique: returns false for planning phase', () => {
  expect(shouldCritique({
    phase: 'planning',
    wasDowngraded: true,
    requiresCritiqueGate: true,
    shadowMode: true,
  }), 'planning phase').toBe(false);
});

test('shouldCritique: returns false when not downgraded', () => {
  expect(shouldCritique({
    phase: 'execution',
    wasDowngraded: false,
    requiresCritiqueGate: true,
    shadowMode: true,
  }), 'not downgraded').toBe(false);
});

test('shouldCritique: returns false when critique gate not required', () => {
  expect(shouldCritique({
    phase: 'execution',
    wasDowngraded: true,
    requiresCritiqueGate: false,
    shadowMode: true,
  }), 'gate not required').toBe(false);
});

console.log('');
console.log('');
