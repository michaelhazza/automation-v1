/**
 * agentRunMessageServicePure.test.ts — Sprint 3 P2.1 Sprint 3A pure tests.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentRunMessageServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  validateMessageShape,
  computeNextSequenceNumber,
  projectMessageForRole,
  projectForRole,
  REDACTION_TOKEN,
  TOOL_RESULT_TRUNCATE_CHARS,
  normaliseRunTraceRole,
} from '../agentRunMessageServicePure.js';

function assertThrows(fn: () => unknown, label: string): void {
  let thrown = false;
  try { fn(); } catch { thrown = true; }
  if (!thrown) throw new Error(`${label} — expected throw`);
}

console.log('');
console.log('agentRunMessageServicePure — Sprint 3 P2.1 Sprint 3A');
console.log('');

// ── validateMessageShape ───────────────────────────────────────────

test('accepts a valid assistant message with array content', () => {
  validateMessageShape({
    role: 'assistant',
    content: [{ type: 'text', text: 'hello' }],
    toolCallId: null,
  });
});

test('accepts a valid user message with tool_result blocks', () => {
  validateMessageShape({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu_123', content: 'ok' }],
    toolCallId: 'tu_123',
  });
});

test('accepts a plain string content value', () => {
  validateMessageShape({
    role: 'system',
    content: 'You are a helpful assistant.',
  });
});

test('accepts an object content value', () => {
  validateMessageShape({
    role: 'assistant',
    content: { type: 'text', text: 'hi' },
  });
});

test('rejects an invalid role', () => {
  assertThrows(
    () =>
      validateMessageShape({
        // reason: deliberately passing an invalid role value to verify the runtime guard rejects it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        role: 'function' as any,
        content: 'x',
      }),
    'bad role',
  );
});

test('rejects undefined content', () => {
  assertThrows(
    () =>
      validateMessageShape({
        role: 'assistant',
        content: undefined,
      }),
    'undefined content',
  );
});

test('rejects null content', () => {
  assertThrows(
    () =>
      validateMessageShape({
        role: 'assistant',
        content: null,
      }),
    'null content',
  );
});

test('rejects empty array content', () => {
  assertThrows(
    () =>
      validateMessageShape({
        role: 'assistant',
        content: [],
      }),
    'empty array',
  );
});

test('rejects empty string toolCallId', () => {
  assertThrows(
    () =>
      validateMessageShape({
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        toolCallId: '',
      }),
    'empty toolCallId',
  );
});

test('rejects non-string toolCallId', () => {
  assertThrows(
    () =>
      validateMessageShape({
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        // reason: deliberately passing a non-string toolCallId to verify the runtime guard rejects it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        toolCallId: 42 as any,
      }),
    'numeric toolCallId',
  );
});

test('accepts omitted toolCallId', () => {
  validateMessageShape({
    role: 'assistant',
    content: [{ type: 'text', text: 'hi' }],
  });
});

test('accepts explicit null toolCallId', () => {
  validateMessageShape({
    role: 'assistant',
    content: [{ type: 'text', text: 'hi' }],
    toolCallId: null,
  });
});

// ── computeNextSequenceNumber ──────────────────────────────────────

test('null current max → 0 (fresh run)', () => {
  expect(computeNextSequenceNumber(null), 'fresh run starts at 0').toBe(0);
});

test('0 current max → 1', () => {
  expect(computeNextSequenceNumber(0), 'increment from 0').toBe(1);
});

test('42 current max → 43', () => {
  expect(computeNextSequenceNumber(42), 'increment from 42').toBe(43);
});

test('rejects negative current max', () => {
  assertThrows(() => computeNextSequenceNumber(-1), 'negative max');
});

test('rejects non-integer current max', () => {
  assertThrows(() => computeNextSequenceNumber(1.5), 'fractional max');
});

test('rejects NaN', () => {
  assertThrows(() => computeNextSequenceNumber(Number.NaN), 'NaN max');
});

console.log('');
console.log('');

// ── §4.8 Run-trace role-aware masking projection ───────────────────

console.log('agentRunMessageServicePure — §4.8 run-trace masking projection');
console.log('');

const SAMPLE_ENTRY = {
  tool: 'send_email',
  input: { to: 'alice@example.com', subject: 'Hello' },
  output: 'Email sent successfully.',
  durationMs: 42,
  iteration: 0,
};

const LONG_OUTPUT = 'x'.repeat(TOOL_RESULT_TRUNCATE_CHARS + 50);

// ── normaliseRunTraceRole ──────────────────────────────────────────

test('normaliseRunTraceRole: known roles pass through', () => {
  expect(normaliseRunTraceRole('system_admin')).toBe('system_admin');
  expect(normaliseRunTraceRole('org_admin')).toBe('org_admin');
  expect(normaliseRunTraceRole('user')).toBe('user');
});

test('normaliseRunTraceRole: unknown role falls back to user (most restrictive)', () => {
  expect(normaliseRunTraceRole('superuser')).toBe('user');
  expect(normaliseRunTraceRole('')).toBe('user');
  expect(normaliseRunTraceRole('workspace_user')).toBe('user');
});

// ── workspace_user ('user') tier ──────────────────────────────────

test('workspace_user: tool input is redacted', () => {
  const result = projectMessageForRole(SAMPLE_ENTRY, 'user');
  expect(result.input).toBe(REDACTION_TOKEN);
});

test('workspace_user: tool output is truncated to TOOL_RESULT_TRUNCATE_CHARS chars', () => {
  const result = projectMessageForRole({ ...SAMPLE_ENTRY, output: LONG_OUTPUT }, 'user');
  expect(result.output).toHaveLength(TOOL_RESULT_TRUNCATE_CHARS);
  expect(result.outputTruncated).toBe(true);
});

test('workspace_user: short output has no truncated flag', () => {
  const result = projectMessageForRole(SAMPLE_ENTRY, 'user');
  expect(result.outputTruncated).toBeUndefined();
});

test('workspace_user: tool name and duration are always visible', () => {
  const result = projectMessageForRole(SAMPLE_ENTRY, 'user');
  expect(result.toolName).toBe('send_email');
  expect(result.durationMs).toBe(42);
});

test('workspace_user: masked field (input) has no truncated flag — mask-over-truncate precedence', () => {
  // When a field is both masked and would be truncated, it must be '<redacted>' with no truncated flag.
  const result = projectMessageForRole({ ...SAMPLE_ENTRY, input: { blob: 'x'.repeat(500) } }, 'user');
  expect(result.input).toBe(REDACTION_TOKEN);
  // No 'inputTruncated' field exists on the shape — the mask wins.
  expect((result as unknown as Record<string, unknown>).inputTruncated).toBeUndefined();
});

// ── org_admin tier ─────────────────────────────────────────────────

test('org_admin: tool input is visible (not redacted)', () => {
  const result = projectMessageForRole(SAMPLE_ENTRY, 'org_admin');
  expect(result.input).toEqual({ to: 'alice@example.com', subject: 'Hello' });
});

test('org_admin: tool output is fully visible (no truncation)', () => {
  const result = projectMessageForRole({ ...SAMPLE_ENTRY, output: LONG_OUTPUT }, 'org_admin');
  expect(result.output).toHaveLength(LONG_OUTPUT.length);
  expect(result.outputTruncated).toBeUndefined();
});

test('org_admin: tool name and duration are visible', () => {
  const result = projectMessageForRole(SAMPLE_ENTRY, 'org_admin');
  expect(result.toolName).toBe('send_email');
  expect(result.durationMs).toBe(42);
});

// ── system_admin tier ──────────────────────────────────────────────

test('system_admin: all fields visible', () => {
  const result = projectMessageForRole(SAMPLE_ENTRY, 'system_admin');
  expect(result.input).toEqual({ to: 'alice@example.com', subject: 'Hello' });
  expect(result.output).toBe('Email sent successfully.');
  expect(result.toolName).toBe('send_email');
  expect(result.outputTruncated).toBeUndefined();
});

test('system_admin: long output not truncated', () => {
  const result = projectMessageForRole({ ...SAMPLE_ENTRY, output: LONG_OUTPUT }, 'system_admin');
  expect(result.output).toHaveLength(LONG_OUTPUT.length);
  expect(result.outputTruncated).toBeUndefined();
});

test('system_admin scoped into an org still sees everything', () => {
  // Per spec §4.8: "When system_admin is scoped into an org, they still see everything."
  // The role string stays 'system_admin' regardless of org scope.
  const result = projectMessageForRole(SAMPLE_ENTRY, 'system_admin');
  expect(result.input).not.toBe(REDACTION_TOKEN);
  expect(result.output).not.toBe(REDACTION_TOKEN);
});

// ── projectForRole (batch) ─────────────────────────────────────────

test('projectForRole returns one projected entry per input entry', () => {
  const entries = [SAMPLE_ENTRY, { ...SAMPLE_ENTRY, tool: 'create_task', iteration: 1 }];
  const result = projectForRole(entries, 'user');
  expect(result).toHaveLength(2);
  expect(result[0].toolName).toBe('send_email');
  expect(result[1].toolName).toBe('create_task');
});

test('projectForRole with empty array returns empty array', () => {
  expect(projectForRole([], 'user')).toEqual([]);
});

// ── Default / fallback fields ─────────────────────────────────────

test('entry with name field (no tool) uses name as toolName', () => {
  const result = projectMessageForRole({ name: 'lookup', output: 'ok' }, 'org_admin');
  expect(result.toolName).toBe('lookup');
});

test('missing input field defaults to empty object (not redacted) for org_admin', () => {
  const result = projectMessageForRole({ tool: 'noop', output: 'done' }, 'org_admin');
  expect(result.input).toEqual({});
});

test('missing durationMs defaults to 0', () => {
  const result = projectMessageForRole({ tool: 'noop' }, 'system_admin');
  expect(result.durationMs).toBe(0);
});

test('missing iteration defaults to 0', () => {
  const result = projectMessageForRole({ tool: 'noop' }, 'system_admin');
  expect(result.iteration).toBe(0);
});

console.log('');
console.log('');
