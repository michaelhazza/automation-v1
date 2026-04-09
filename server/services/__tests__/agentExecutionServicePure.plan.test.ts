/**
 * agentExecutionServicePure plan tests — runnable via:
 *   npx tsx server/services/__tests__/agentExecutionServicePure.plan.test.ts
 *
 * Tests parsePlan and isComplexRun from Sprint 5 P4.3 of
 * docs/improvements-roadmap-spec.md.
 */

import { parsePlan, isComplexRun } from '../agentExecutionServicePure.js';

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

// ── parsePlan ──────────────────────────────────────────────────────

test('parsePlan: parses a valid plan with actions', () => {
  const input = JSON.stringify({
    actions: [
      { tool: 'read_inbox', reason: 'Check emails' },
      { tool: 'create_task', reason: 'File bug' },
    ],
  });
  const plan = parsePlan(input);
  assert(plan !== null, 'should not be null');
  assertEqual(plan!.actions.length, 2, 'should have 2 actions');
  assertEqual(plan!.actions[0].tool, 'read_inbox', 'first action tool');
});

test('parsePlan: parses a plan wrapped in { plan: { actions: [...] } }', () => {
  const input = JSON.stringify({
    plan: {
      actions: [{ tool: 'send_email', reason: 'Notify client' }],
    },
  });
  const plan = parsePlan(input);
  assert(plan !== null, 'should not be null');
  assertEqual(plan!.actions[0].tool, 'send_email', 'tool from wrapped plan');
});

test('parsePlan: parses markdown-fenced JSON', () => {
  const input = '```json\n{"actions": [{"tool": "web_search", "reason": "Look up info"}]}\n```';
  const plan = parsePlan(input);
  assert(plan !== null, 'should not be null');
  assertEqual(plan!.actions[0].tool, 'web_search', 'tool from fenced JSON');
});

test('parsePlan: returns null for null/undefined input', () => {
  assertEqual(parsePlan(null), null, 'null input');
  assertEqual(parsePlan(undefined), null, 'undefined input');
});

test('parsePlan: returns null for empty actions', () => {
  assertEqual(parsePlan('{"actions": []}'), null, 'empty actions');
});

test('parsePlan: returns null for malformed JSON', () => {
  assertEqual(parsePlan('not json'), null, 'malformed JSON');
});

test('parsePlan: extracts JSON from surrounding text', () => {
  const input = 'Here is my plan:\n{"actions": [{"tool": "fetch_url", "reason": "Get data"}]}\nEnd.';
  const plan = parsePlan(input);
  assert(plan !== null, 'should not be null');
  assertEqual(plan!.actions[0].tool, 'fetch_url', 'tool from extracted JSON');
});

// ── isComplexRun ───────────────────────────────────────────────────

test('isComplexRun: returns true for explicit complex hint', () => {
  assertEqual(isComplexRun({ complexityHint: 'complex', messageWordCount: 10, skillCount: 5 }), true, 'complex hint');
});

test('isComplexRun: returns true for high word count', () => {
  assertEqual(isComplexRun({ complexityHint: null, messageWordCount: 350, skillCount: 5 }), true, 'high word count');
});

test('isComplexRun: returns true for high skill count', () => {
  assertEqual(isComplexRun({ complexityHint: null, messageWordCount: 10, skillCount: 20 }), true, 'high skill count');
});

test('isComplexRun: returns false for simple runs', () => {
  assertEqual(isComplexRun({ complexityHint: null, messageWordCount: 50, skillCount: 5 }), false, 'simple run');
});

test('isComplexRun: simple hint suppresses planning even with high word count', () => {
  assertEqual(isComplexRun({ complexityHint: 'simple', messageWordCount: 350, skillCount: 5 }), false, 'simple hint overrides high words');
  assertEqual(isComplexRun({ complexityHint: 'simple', messageWordCount: 10, skillCount: 20 }), false, 'simple hint overrides high skills');
});

test('isComplexRun: respects word count threshold boundary', () => {
  assertEqual(isComplexRun({ complexityHint: null, messageWordCount: 300, skillCount: 5 }), false, 'at boundary');
  assertEqual(isComplexRun({ complexityHint: null, messageWordCount: 301, skillCount: 5 }), true, 'above boundary');
});

test('isComplexRun: respects skill count threshold boundary', () => {
  assertEqual(isComplexRun({ complexityHint: null, messageWordCount: 10, skillCount: 15 }), false, 'at skill boundary');
  assertEqual(isComplexRun({ complexityHint: null, messageWordCount: 10, skillCount: 16 }), true, 'above skill boundary');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
