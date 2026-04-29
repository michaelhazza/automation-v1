/**
 * agentExecutionServicePure plan tests — runnable via:
 *   npx tsx server/services/__tests__/agentExecutionServicePure.plan.test.ts
 *
 * Tests parsePlan and isComplexRun from Sprint 5 P4.3 of
 * docs/improvements-roadmap-spec.md.
 */

import { expect, test } from 'vitest';
import { parsePlan, isComplexRun } from '../agentExecutionServicePure.js';

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
  expect(plan !== null, 'should not be null').toBeTruthy();
  expect(plan!.actions.length, 'should have 2 actions').toBe(2);
  expect(plan!.actions[0].tool, 'first action tool').toBe('read_inbox');
});

test('parsePlan: parses a plan wrapped in { plan: { actions: [...] } }', () => {
  const input = JSON.stringify({
    plan: {
      actions: [{ tool: 'send_email', reason: 'Notify client' }],
    },
  });
  const plan = parsePlan(input);
  expect(plan !== null, 'should not be null').toBeTruthy();
  expect(plan!.actions[0].tool, 'tool from wrapped plan').toBe('send_email');
});

test('parsePlan: parses markdown-fenced JSON', () => {
  const input = '```json\n{"actions": [{"tool": "web_search", "reason": "Look up info"}]}\n```';
  const plan = parsePlan(input);
  expect(plan !== null, 'should not be null').toBeTruthy();
  expect(plan!.actions[0].tool, 'tool from fenced JSON').toBe('web_search');
});

test('parsePlan: returns null for null/undefined input', () => {
  expect(parsePlan(null), 'null input').toBe(null);
  expect(parsePlan(undefined), 'undefined input').toBe(null);
});

test('parsePlan: returns null for empty actions', () => {
  expect(parsePlan('{"actions": []}'), 'empty actions').toBe(null);
});

test('parsePlan: returns null for malformed JSON', () => {
  expect(parsePlan('not json'), 'malformed JSON').toBe(null);
});

test('parsePlan: extracts JSON from surrounding text', () => {
  const input = 'Here is my plan:\n{"actions": [{"tool": "fetch_url", "reason": "Get data"}]}\nEnd.';
  const plan = parsePlan(input);
  expect(plan !== null, 'should not be null').toBeTruthy();
  expect(plan!.actions[0].tool, 'tool from extracted JSON').toBe('fetch_url');
});

// ── isComplexRun ───────────────────────────────────────────────────

test('isComplexRun: returns true for explicit complex hint', () => {
  expect(isComplexRun({ complexityHint: 'complex', messageWordCount: 10, skillCount: 5 }), 'complex hint').toBe(true);
});

test('isComplexRun: returns true for high word count', () => {
  expect(isComplexRun({ complexityHint: null, messageWordCount: 350, skillCount: 5 }), 'high word count').toBe(true);
});

test('isComplexRun: returns true for high skill count', () => {
  expect(isComplexRun({ complexityHint: null, messageWordCount: 10, skillCount: 20 }), 'high skill count').toBe(true);
});

test('isComplexRun: returns false for simple runs', () => {
  expect(isComplexRun({ complexityHint: null, messageWordCount: 50, skillCount: 5 }), 'simple run').toBe(false);
});

test('isComplexRun: simple hint suppresses planning even with high word count', () => {
  expect(isComplexRun({ complexityHint: 'simple', messageWordCount: 350, skillCount: 5 }), 'simple hint overrides high words').toBe(false);
  expect(isComplexRun({ complexityHint: 'simple', messageWordCount: 10, skillCount: 20 }), 'simple hint overrides high skills').toBe(false);
});

test('isComplexRun: respects word count threshold boundary', () => {
  expect(isComplexRun({ complexityHint: null, messageWordCount: 300, skillCount: 5 }), 'at boundary').toBe(false);
  expect(isComplexRun({ complexityHint: null, messageWordCount: 301, skillCount: 5 }), 'above boundary').toBe(true);
});

test('isComplexRun: respects skill count threshold boundary', () => {
  expect(isComplexRun({ complexityHint: null, messageWordCount: 10, skillCount: 15 }), 'at skill boundary').toBe(false);
  expect(isComplexRun({ complexityHint: null, messageWordCount: 10, skillCount: 16 }), 'above skill boundary').toBe(true);
});

console.log('');
console.log('');
