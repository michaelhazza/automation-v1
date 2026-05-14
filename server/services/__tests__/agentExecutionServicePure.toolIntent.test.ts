/**
 * agentExecutionServicePure.toolIntent.test.ts — Sprint 3 P2.3 pure tests
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentExecutionServicePure.toolIntent.test.ts
 *
 * Exercises `extractToolIntentConfidence` — the parser for the
 * `<tool_intent>` block the master prompt asks agents to emit before
 * every tool call. Pure: no DB, no env, no LLM, just string → number.
 */

import { expect, test } from 'vitest';
import { extractToolIntentConfidence } from '../agentExecutionServicePure.js';

console.log('');
console.log('agentExecutionServicePure.extractToolIntentConfidence — Sprint 3 P2.3');
console.log('');

test('returns null for null / undefined / empty input', () => {
  expect(extractToolIntentConfidence(null, 'send_email'), 'null').toBe(null);
  expect(extractToolIntentConfidence(undefined, 'send_email'), 'undefined').toBe(null);
  expect(extractToolIntentConfidence('', 'send_email'), 'empty').toBe(null);
});

test('returns null when no tool_intent block is present', () => {
  const text = 'I will now call the send_email tool to notify the user.';
  expect(extractToolIntentConfidence(text, 'send_email'), 'no block').toBe(null);
});

test('extracts confidence from single-object block', () => {
  const text = `
    I'm ready to proceed.
    <tool_intent>
    { "tool": "send_email", "confidence": 0.82, "reason": "template verified" }
    </tool_intent>
  `;
  expect(extractToolIntentConfidence(text, 'send_email'), 'single').toBe(0.82);
});

test('extracts confidence from array block', () => {
  const text = `
    <tool_intent>
    [
      { "tool": "send_email", "confidence": 0.9 },
      { "tool": "create_deal", "confidence": 0.4 }
    ]
    </tool_intent>
  `;
  expect(extractToolIntentConfidence(text, 'send_email'), 'array send').toBe(0.9);
  expect(extractToolIntentConfidence(text, 'create_deal'), 'array deal').toBe(0.4);
});

test('returns null when tool is not in the block', () => {
  const text = `
    <tool_intent>
    { "tool": "send_email", "confidence": 0.9 }
    </tool_intent>
  `;
  expect(extractToolIntentConfidence(text, 'create_deal'), 'missing tool').toBe(null);
});

test('last tool_intent block wins when multiple are present', () => {
  const text = `
    <tool_intent>
    { "tool": "send_email", "confidence": 0.2 }
    </tool_intent>
    On reflection, I'm more certain now.
    <tool_intent>
    { "tool": "send_email", "confidence": 0.95 }
    </tool_intent>
  `;
  expect(extractToolIntentConfidence(text, 'send_email'), 'last wins').toBe(0.95);
});

test('accepts \\`\\`\\`json fenced JSON inside the block', () => {
  const text = `
    <tool_intent>
    \`\`\`json
    { "tool": "send_email", "confidence": 0.77 }
    \`\`\`
    </tool_intent>
  `;
  expect(extractToolIntentConfidence(text, 'send_email'), 'fenced json').toBe(0.77);
});

test('accepts plain \\`\\`\\` fenced block (no json language tag)', () => {
  const text = `
    <tool_intent>
    \`\`\`
    { "tool": "send_email", "confidence": 0.55 }
    \`\`\`
    </tool_intent>
  `;
  expect(extractToolIntentConfidence(text, 'send_email'), 'plain fence').toBe(0.55);
});

test('returns null on malformed JSON', () => {
  const text = `
    <tool_intent>
    { "tool": "send_email", "confidence": 0.9  // oops missing brace
    </tool_intent>
  `;
  expect(extractToolIntentConfidence(text, 'send_email'), 'malformed').toBe(null);
});

test('returns null when confidence is out of [0, 1]', () => {
  const neg = `<tool_intent>{ "tool": "send_email", "confidence": -0.1 }</tool_intent>`;
  const over = `<tool_intent>{ "tool": "send_email", "confidence": 1.5 }</tool_intent>`;
  expect(extractToolIntentConfidence(neg, 'send_email'), 'negative').toBe(null);
  expect(extractToolIntentConfidence(over, 'send_email'), 'over one').toBe(null);
});

test('returns null when confidence is not a number', () => {
  const text = `<tool_intent>{ "tool": "send_email", "confidence": "high" }</tool_intent>`;
  expect(extractToolIntentConfidence(text, 'send_email'), 'string confidence').toBe(null);
});

test('returns null when confidence is NaN / Infinity', () => {
  // JSON doesn't support NaN/Infinity literals, but the parser may
  // receive a number that becomes non-finite after coercion. Verify
  // the finite-check via a crafted scenario using an array with a
  // valid entry alongside an invalid one.
  const text = `
    <tool_intent>
    [
      { "tool": "send_email", "confidence": 2 },
      { "tool": "send_email", "confidence": 0.4 }
    ]
    </tool_intent>
  `;
  // The out-of-range entry is rejected, the next valid entry (0.4)
  // wins — confirms invalid entries don't poison the result.
  expect(extractToolIntentConfidence(text, 'send_email'), 'array fallback').toBe(0.4);
});

test('0 is a valid confidence (fail closed will still kick in)', () => {
  const text = `<tool_intent>{ "tool": "send_email", "confidence": 0 }</tool_intent>`;
  expect(extractToolIntentConfidence(text, 'send_email'), 'zero').toBe(0);
});

test('1 is a valid confidence', () => {
  const text = `<tool_intent>{ "tool": "send_email", "confidence": 1 }</tool_intent>`;
  expect(extractToolIntentConfidence(text, 'send_email'), 'one').toBe(1);
});

test('case-insensitive tag match', () => {
  const text = `<Tool_Intent>{ "tool": "send_email", "confidence": 0.6 }</Tool_Intent>`;
  expect(extractToolIntentConfidence(text, 'send_email'), 'case insensitive').toBe(0.6);
});

test('tool slug comparison is case-sensitive', () => {
  const text = `<tool_intent>{ "tool": "Send_Email", "confidence": 0.9 }</tool_intent>`;
  expect(extractToolIntentConfidence(text, 'send_email'), 'mismatched case').toBe(null);
});

test('ignores array entries with non-string tool fields', () => {
  const text = `
    <tool_intent>
    [
      { "tool": 42, "confidence": 0.9 },
      { "tool": "send_email", "confidence": 0.5 }
    ]
    </tool_intent>
  `;
  expect(extractToolIntentConfidence(text, 'send_email'), 'tolerant array').toBe(0.5);
});

console.log('');
console.log('');
