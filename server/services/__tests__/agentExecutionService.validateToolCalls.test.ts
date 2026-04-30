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

import { expect, test } from 'vitest';
import { validateToolCalls, type ToolCall } from '../agentExecutionServicePure.js';
import type { ProviderTool } from '../providers/types.js';

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
  expect(result, 'result').toEqual({ valid: true });
});

test('single valid tool call with matching tool and no required fields → valid', () => {
  const result = validateToolCalls(
    [makeToolCall('foo', {})],
    [makeTool('foo')],
  );
  expect(result, 'result').toEqual({ valid: true });
});

test('tool call with required fields all present → valid', () => {
  const result = validateToolCalls(
    [makeToolCall('send_email', { to: 'a@b.com', subject: 'hi', body: 'yo' })],
    [makeTool('send_email', ['to', 'subject', 'body'])],
  );
  expect(result, 'result').toEqual({ valid: true });
});

// ── Unknown tool ───────────────────────────────────────────────────
test('tool call with unknown tool name → invalid with unknown_tool reason', () => {
  const result = validateToolCalls(
    [makeToolCall('mystery_tool', {})],
    [makeTool('foo'), makeTool('bar')],
  );
  expect(result.valid, 'valid').toBe(false);
  expect(result.failureReason, 'failureReason').toBe('unknown_tool:mystery_tool');
});

test('first valid then unknown → invalid on the unknown one', () => {
  const result = validateToolCalls(
    [makeToolCall('foo', {}), makeToolCall('mystery', {}, 'tc-2')],
    [makeTool('foo')],
  );
  expect(result.valid, 'valid').toBe(false);
  expect(result.failureReason, 'failureReason').toBe('unknown_tool:mystery');
});

// ── Invalid input shape ────────────────────────────────────────────
test('tool call with null input → invalid with invalid_input reason', () => {
  const result = validateToolCalls(
    [{ id: 'tc', name: 'foo', input: null as unknown as Record<string, unknown> }],
    [makeTool('foo')],
  );
  expect(result.valid, 'valid').toBe(false);
  expect(result.failureReason, 'failureReason').toBe('invalid_input:foo');
});

test('tool call with string input → invalid with invalid_input reason', () => {
  const result = validateToolCalls(
    [{ id: 'tc', name: 'foo', input: 'not an object' as unknown as Record<string, unknown> }],
    [makeTool('foo')],
  );
  expect(result.valid, 'valid').toBe(false);
  expect(result.failureReason, 'failureReason').toBe('invalid_input:foo');
});

// ── Missing required field ─────────────────────────────────────────
test('tool call missing a required field → invalid with missing_field reason', () => {
  const result = validateToolCalls(
    [makeToolCall('send_email', { to: 'a@b.com' })], // missing subject, body
    [makeTool('send_email', ['to', 'subject', 'body'])],
  );
  expect(result.valid, 'valid').toBe(false);
  // The function reports the FIRST missing field it encounters, which for
  // ['to', 'subject', 'body'] iteration order is 'subject'.
  expect(result.failureReason, 'failureReason').toBe('missing_field:send_email.subject');
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
  expect(result, 'result').toEqual({ valid: true });
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
  expect(result.valid, 'valid').toBe(false);
  expect(result.failureReason, 'failureReason').toBe('missing_field:send_email.subject');
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
  expect(result, 'result').toEqual({ valid: true });
});

// ── Empty activeTools with a tool call ─────────────────────────────
test('tool call against empty activeTools → unknown_tool', () => {
  const result = validateToolCalls([makeToolCall('foo', {})], []);
  expect(result.valid, 'valid').toBe(false);
  expect(result.failureReason, 'failureReason').toBe('unknown_tool:foo');
});

// ── Determinism check ──────────────────────────────────────────────
test('same inputs produce same output across repeated calls (purity)', () => {
  const toolCalls = [makeToolCall('foo', { x: 1 })];
  const activeTools = [makeTool('foo', ['x'])];
  const r1 = validateToolCalls(toolCalls, activeTools);
  const r2 = validateToolCalls(toolCalls, activeTools);
  const r3 = validateToolCalls(toolCalls, activeTools);
  expect(r1, 'r1 === r2').toEqual(r2);
  expect(r2, 'r2 === r3').toEqual(r3);
  expect(r1.valid, 'r1 was valid').toBeTruthy();
});

console.log('');
console.log('');
