/**
 * critiqueGatePure unit tests — runnable via:
 *   npx tsx server/services/__tests__/critiqueGatePure.test.ts
 *
 * Tests the pure parsing and gating logic for the semantic critique gate
 * introduced by Sprint 5 P4.4 of docs/improvements-roadmap-spec.md.
 */

import {
  parseCritiqueResult,
  buildCritiquePrompt,
  shouldCritique,
} from '../middleware/critiqueGatePure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

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
  assertDeepEqual(result, { verdict: 'ok', reason: 'Tool call matches user intent' }, 'ok result');
});

test('parseCritiqueResult: parses a valid suspect result', () => {
  const result = parseCritiqueResult('{ "verdict": "suspect", "reason": "Wrong recipient" }');
  assertDeepEqual(result, { verdict: 'suspect', reason: 'Wrong recipient' }, 'suspect result');
});

test('parseCritiqueResult: handles markdown-fenced JSON', () => {
  const input = '```json\n{ "verdict": "ok", "reason": "Looks good" }\n```';
  const result = parseCritiqueResult(input);
  assertEqual(result?.verdict, 'ok', 'verdict from fenced JSON');
});

test('parseCritiqueResult: returns null for malformed JSON', () => {
  assertEqual(parseCritiqueResult('not json at all'), null, 'malformed JSON');
});

test('parseCritiqueResult: returns null for null/undefined', () => {
  assertEqual(parseCritiqueResult(null), null, 'null input');
  assertEqual(parseCritiqueResult(undefined), null, 'undefined input');
});

test('parseCritiqueResult: returns null for invalid verdict value', () => {
  assertEqual(parseCritiqueResult('{ "verdict": "maybe", "reason": "hmm" }'), null, 'invalid verdict');
});

test('parseCritiqueResult: extracts JSON from surrounding text', () => {
  const input = 'Here is my assessment: { "verdict": "suspect", "reason": "Mismatch" } End.';
  const result = parseCritiqueResult(input);
  assertEqual(result?.verdict, 'suspect', 'extracted verdict');
});

// ── buildCritiquePrompt ────────────────────────────────────────────

test('buildCritiquePrompt: includes tool name and args', () => {
  const prompt = buildCritiquePrompt(
    'send_email',
    { to: 'test@example.com', subject: 'Hello' },
    [{ role: 'user', content: 'Send an email to the client' }],
  );
  assert(prompt.includes('send_email'), 'prompt should contain tool name');
  assert(prompt.includes('test@example.com'), 'prompt should contain args');
  assert(prompt.includes('Send an email'), 'prompt should contain message');
});

test('buildCritiquePrompt: limits recent messages to last 3', () => {
  const messages = Array.from({ length: 5 }, (_, i) => ({
    role: 'user',
    content: `Message ${i}`,
  }));
  const prompt = buildCritiquePrompt('test_tool', {}, messages);
  assert(!prompt.includes('Message 0'), 'should not contain Message 0');
  assert(!prompt.includes('Message 1'), 'should not contain Message 1');
  assert(prompt.includes('Message 2'), 'should contain Message 2');
  assert(prompt.includes('Message 3'), 'should contain Message 3');
  assert(prompt.includes('Message 4'), 'should contain Message 4');
});

// ── shouldCritique ─────────────────────────────────────────────────

test('shouldCritique: returns true when all conditions met', () => {
  assertEqual(shouldCritique({
    phase: 'execution',
    wasDowngraded: true,
    requiresCritiqueGate: true,
    shadowMode: true,
  }), true, 'all conditions met');
});

test('shouldCritique: returns false for planning phase', () => {
  assertEqual(shouldCritique({
    phase: 'planning',
    wasDowngraded: true,
    requiresCritiqueGate: true,
    shadowMode: true,
  }), false, 'planning phase');
});

test('shouldCritique: returns false when not downgraded', () => {
  assertEqual(shouldCritique({
    phase: 'execution',
    wasDowngraded: false,
    requiresCritiqueGate: true,
    shadowMode: true,
  }), false, 'not downgraded');
});

test('shouldCritique: returns false when critique gate not required', () => {
  assertEqual(shouldCritique({
    phase: 'execution',
    wasDowngraded: true,
    requiresCritiqueGate: false,
    shadowMode: true,
  }), false, 'gate not required');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
