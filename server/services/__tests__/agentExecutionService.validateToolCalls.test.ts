/**
 * validateToolCalls unit tests — runnable via:
 *   npx tsx server/services/__tests__/agentExecutionService.validateToolCalls.test.ts
 *
 * Tests the pure tool-call validation logic extracted from runAgenticLoop
 * in P0.1 Layer 3 of docs/improvements-roadmap-spec.md.
 *
 * The repo doesn't have Jest / Vitest configured, so we follow the same
 * lightweight pattern as server/services/__tests__/runContextLoader.test.ts.
 */

import { validateToolCalls, type ToolCall } from '../agentExecutionServicePure.js';
import type { ProviderTool } from '../providers/types.js';

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

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Helpers to build test inputs ───────────────────────────────────
function makeToolCall(name: string, input: Record<string, unknown>, id = 'tc-1'): ToolCall {
  return { id, name, input };
}

function makeTool(
  name: string,
  required: string[] = [],
  properties: Record<string, { type: string; description: string }> = {},
): ProviderTool {
  return {
    name,
    description: `${name} tool`,
    input_schema: {
      type: 'object',
      properties,
      required,
    },
  };
}

console.log('');
console.log('validateToolCalls — tool call structural validation');
console.log('');

// ── Happy path ─────────────────────────────────────────────────────
test('empty toolCalls array with any activeTools → valid', () => {
  const result = validateToolCalls([], [makeTool('foo')]);
  assertEqual(result, { valid: true }, 'result');
});

test('single valid tool call with matching tool and no required fields → valid', () => {
  const result = validateToolCalls(
    [makeToolCall('foo', {})],
    [makeTool('foo')],
  );
  assertEqual(result, { valid: true }, 'result');
});

test('tool call with required fields all present → valid', () => {
  const result = validateToolCalls(
    [makeToolCall('send_email', { to: 'a@b.com', subject: 'hi', body: 'yo' })],
    [makeTool('send_email', ['to', 'subject', 'body'])],
  );
  assertEqual(result, { valid: true }, 'result');
});

// ── Unknown tool ───────────────────────────────────────────────────
test('tool call with unknown tool name → invalid with unknown_tool reason', () => {
  const result = validateToolCalls(
    [makeToolCall('mystery_tool', {})],
    [makeTool('foo'), makeTool('bar')],
  );
  assertEqual(result.valid, false, 'valid');
  assertEqual(result.failureReason, 'unknown_tool:mystery_tool', 'failureReason');
});

test('first valid then unknown → invalid on the unknown one', () => {
  const result = validateToolCalls(
    [makeToolCall('foo', {}), makeToolCall('mystery', {}, 'tc-2')],
    [makeTool('foo')],
  );
  assertEqual(result.valid, false, 'valid');
  assertEqual(result.failureReason, 'unknown_tool:mystery', 'failureReason');
});

// ── Invalid input shape ────────────────────────────────────────────
test('tool call with null input → invalid with invalid_input reason', () => {
  const result = validateToolCalls(
    [{ id: 'tc', name: 'foo', input: null as unknown as Record<string, unknown> }],
    [makeTool('foo')],
  );
  assertEqual(result.valid, false, 'valid');
  assertEqual(result.failureReason, 'invalid_input:foo', 'failureReason');
});

test('tool call with string input → invalid with invalid_input reason', () => {
  const result = validateToolCalls(
    [{ id: 'tc', name: 'foo', input: 'not an object' as unknown as Record<string, unknown> }],
    [makeTool('foo')],
  );
  assertEqual(result.valid, false, 'valid');
  assertEqual(result.failureReason, 'invalid_input:foo', 'failureReason');
});

// ── Missing required field ─────────────────────────────────────────
test('tool call missing a required field → invalid with missing_field reason', () => {
  const result = validateToolCalls(
    [makeToolCall('send_email', { to: 'a@b.com' })], // missing subject, body
    [makeTool('send_email', ['to', 'subject', 'body'])],
  );
  assertEqual(result.valid, false, 'valid');
  // The function reports the FIRST missing field it encounters, which for
  // ['to', 'subject', 'body'] iteration order is 'subject'.
  assertEqual(result.failureReason, 'missing_field:send_email.subject', 'failureReason');
});

test('tool call with all required fields plus unknown extras → valid (extras only warn)', () => {
  const result = validateToolCalls(
    [makeToolCall('send_email', { to: 'a@b.com', subject: 'hi', body: 'yo', extraField: 'ignored' })],
    [
      makeTool('send_email', ['to', 'subject', 'body'], {
        to: { type: 'string', description: 'recipient' },
        subject: { type: 'string', description: 'subject line' },
        body: { type: 'string', description: 'message body' },
      }),
    ],
  );
  // Unknown fields are log-only; validation still passes.
  assertEqual(result, { valid: true }, 'result');
});

// ── Multiple tool calls, mixed valid/invalid ──────────────────────
test('first tool call valid, second missing field → invalid on second', () => {
  const result = validateToolCalls(
    [
      makeToolCall('foo', {}),
      makeToolCall('send_email', { to: 'a@b.com' }, 'tc-2'),
    ],
    [
      makeTool('foo'),
      makeTool('send_email', ['to', 'subject', 'body']),
    ],
  );
  assertEqual(result.valid, false, 'valid');
  assertEqual(result.failureReason, 'missing_field:send_email.subject', 'failureReason');
});

test('all three tool calls valid → overall valid', () => {
  const result = validateToolCalls(
    [
      makeToolCall('a', { x: 1 }),
      makeToolCall('b', { y: 2 }, 'tc-2'),
      makeToolCall('c', { z: 3 }, 'tc-3'),
    ],
    [
      makeTool('a', ['x']),
      makeTool('b', ['y']),
      makeTool('c', ['z']),
    ],
  );
  assertEqual(result, { valid: true }, 'result');
});

// ── Empty activeTools with a tool call ─────────────────────────────
test('tool call against empty activeTools → unknown_tool', () => {
  const result = validateToolCalls([makeToolCall('foo', {})], []);
  assertEqual(result.valid, false, 'valid');
  assertEqual(result.failureReason, 'unknown_tool:foo', 'failureReason');
});

// ── Determinism check ──────────────────────────────────────────────
test('same inputs produce same output across repeated calls (purity)', () => {
  const toolCalls = [makeToolCall('foo', { x: 1 })];
  const activeTools = [makeTool('foo', ['x'])];
  const r1 = validateToolCalls(toolCalls, activeTools);
  const r2 = validateToolCalls(toolCalls, activeTools);
  const r3 = validateToolCalls(toolCalls, activeTools);
  assertEqual(r1, r2, 'r1 === r2');
  assertEqual(r2, r3, 'r2 === r3');
  assert(r1.valid, 'r1 was valid');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
