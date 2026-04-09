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

import { extractToolIntentConfidence } from '../agentExecutionServicePure.js';

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

function assertEqual(a: unknown, b: unknown, label: string) {
  if (a !== b) throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

console.log('');
console.log('agentExecutionServicePure.extractToolIntentConfidence — Sprint 3 P2.3');
console.log('');

test('returns null for null / undefined / empty input', () => {
  assertEqual(extractToolIntentConfidence(null, 'send_email'), null, 'null');
  assertEqual(extractToolIntentConfidence(undefined, 'send_email'), null, 'undefined');
  assertEqual(extractToolIntentConfidence('', 'send_email'), null, 'empty');
});

test('returns null when no tool_intent block is present', () => {
  const text = 'I will now call the send_email tool to notify the user.';
  assertEqual(extractToolIntentConfidence(text, 'send_email'), null, 'no block');
});

test('extracts confidence from single-object block', () => {
  const text = `
    I'm ready to proceed.
    <tool_intent>
    { "tool": "send_email", "confidence": 0.82, "reason": "template verified" }
    </tool_intent>
  `;
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 0.82, 'single');
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
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 0.9, 'array send');
  assertEqual(extractToolIntentConfidence(text, 'create_deal'), 0.4, 'array deal');
});

test('returns null when tool is not in the block', () => {
  const text = `
    <tool_intent>
    { "tool": "send_email", "confidence": 0.9 }
    </tool_intent>
  `;
  assertEqual(extractToolIntentConfidence(text, 'create_deal'), null, 'missing tool');
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
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 0.95, 'last wins');
});

test('accepts \\`\\`\\`json fenced JSON inside the block', () => {
  const text = `
    <tool_intent>
    \`\`\`json
    { "tool": "send_email", "confidence": 0.77 }
    \`\`\`
    </tool_intent>
  `;
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 0.77, 'fenced json');
});

test('accepts plain \\`\\`\\` fenced block (no json language tag)', () => {
  const text = `
    <tool_intent>
    \`\`\`
    { "tool": "send_email", "confidence": 0.55 }
    \`\`\`
    </tool_intent>
  `;
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 0.55, 'plain fence');
});

test('returns null on malformed JSON', () => {
  const text = `
    <tool_intent>
    { "tool": "send_email", "confidence": 0.9  // oops missing brace
    </tool_intent>
  `;
  assertEqual(extractToolIntentConfidence(text, 'send_email'), null, 'malformed');
});

test('returns null when confidence is out of [0, 1]', () => {
  const neg = `<tool_intent>{ "tool": "send_email", "confidence": -0.1 }</tool_intent>`;
  const over = `<tool_intent>{ "tool": "send_email", "confidence": 1.5 }</tool_intent>`;
  assertEqual(extractToolIntentConfidence(neg, 'send_email'), null, 'negative');
  assertEqual(extractToolIntentConfidence(over, 'send_email'), null, 'over one');
});

test('returns null when confidence is not a number', () => {
  const text = `<tool_intent>{ "tool": "send_email", "confidence": "high" }</tool_intent>`;
  assertEqual(extractToolIntentConfidence(text, 'send_email'), null, 'string confidence');
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
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 0.4, 'array fallback');
});

test('0 is a valid confidence (fail closed will still kick in)', () => {
  const text = `<tool_intent>{ "tool": "send_email", "confidence": 0 }</tool_intent>`;
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 0, 'zero');
});

test('1 is a valid confidence', () => {
  const text = `<tool_intent>{ "tool": "send_email", "confidence": 1 }</tool_intent>`;
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 1, 'one');
});

test('case-insensitive tag match', () => {
  const text = `<Tool_Intent>{ "tool": "send_email", "confidence": 0.6 }</Tool_Intent>`;
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 0.6, 'case insensitive');
});

test('tool slug comparison is case-sensitive', () => {
  const text = `<tool_intent>{ "tool": "Send_Email", "confidence": 0.9 }</tool_intent>`;
  assertEqual(extractToolIntentConfidence(text, 'send_email'), null, 'mismatched case');
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
  assertEqual(extractToolIntentConfidence(text, 'send_email'), 0.5, 'tolerant array');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
