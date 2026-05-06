/**
 * WorkflowActionCallExecutor pure unit tests — runnable via:
 *   npx tsx server/services/__tests__/WorkflowActionCallExecutorPure.test.ts
 *
 * Tests the output size-cap helper that guards WorkflowStepRuns.outputJson
 * against oversized handler payloads. Spec: docs/onboarding-Workflows-spec.md §4.6.
 */

import { expect, test } from 'vitest';
import {
  maybeTruncateOutput,
  MAX_ACTION_OUTPUT_BYTES,
} from '../workflowActionCallExecutorPure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Passthrough cases ──────────────────────────────────────────────────────

test('passes small objects through unchanged', () => {
  const payload = { agents: [{ id: 'a1', name: 'Ops' }] };
  expect(maybeTruncateOutput(payload), 'small object identity').toEqual(payload);
});

test('passes null through unchanged', () => {
  expect(maybeTruncateOutput(null), 'null identity').toBe(null);
});

test('passes empty object through unchanged', () => {
  expect(maybeTruncateOutput({}), 'empty object identity').toEqual({});
});

test('passes arrays through unchanged when under cap', () => {
  const arr = [1, 2, 3, 4, 5];
  expect(maybeTruncateOutput(arr), 'small array identity').toEqual(arr);
});

// ── Truncation cases ───────────────────────────────────────────────────────

test('truncates a huge string payload', () => {
  const huge = 'x'.repeat(MAX_ACTION_OUTPUT_BYTES + 1000);
  const result = maybeTruncateOutput({ value: huge }) as Record<string, unknown>;
  expect(result._truncated, '_truncated flag set').toBe(true);
  expect(typeof result.originalSize === 'number' && result.originalSize > MAX_ACTION_OUTPUT_BYTES, `originalSize must exceed cap, got ${String(result.originalSize)}`).toBeTruthy();
  expect(typeof result.preview === 'string' && result.preview.length <= 500, 'preview must be ≤ 500 chars').toBeTruthy();
});

test('truncates a huge array payload', () => {
  const arr: string[] = [];
  for (let i = 0; i < 10000; i++) arr.push('lorem ipsum dolor sit amet');
  const result = maybeTruncateOutput(arr) as Record<string, unknown>;
  expect(result._truncated, '_truncated flag set for array').toBe(true);
  expect(typeof result.preview === 'string' && result.preview.length <= 500, 'array preview must be ≤ 500 chars').toBeTruthy();
});

test('preserves payload at exactly the cap', () => {
  // JSON.stringify of a string x adds 2 surrounding quotes, so build
  // a string whose serialised length equals MAX_ACTION_OUTPUT_BYTES.
  const inner = 'a'.repeat(MAX_ACTION_OUTPUT_BYTES - 2);
  const result = maybeTruncateOutput(inner);
  expect(result, 'boundary payload must pass through').toEqual(inner);
});

test('truncates payload just over the cap', () => {
  const inner = 'a'.repeat(MAX_ACTION_OUTPUT_BYTES); // serialises to cap+2
  const result = maybeTruncateOutput(inner) as Record<string, unknown>;
  expect(result._truncated, 'just-over-cap payload is truncated').toBe(true);
});

// ── Robustness ─────────────────────────────────────────────────────────────

test('returns sentinel for BigInt (non-JSON-serialisable)', () => {
  const result = maybeTruncateOutput(BigInt(1)) as Record<string, unknown>;
  expect(result._truncated, 'sentinel has _truncated').toBe(true);
  expect(result.preview, 'sentinel preview').toBe('<unserialisable>');
});

test('returns sentinel for circular reference', () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;
  const result = maybeTruncateOutput(circular) as Record<string, unknown>;
  expect(result._truncated, 'circular sentinel has _truncated').toBe(true);
  expect(result.preview, 'circular sentinel preview').toBe('<unserialisable>');
});

test('returns sentinel for undefined (JSON.stringify returns undefined)', () => {
  const result = maybeTruncateOutput(undefined) as Record<string, unknown>;
  expect(result._truncated, 'undefined routed to sentinel').toBe(true);
});

// ── Summary ────────────────────────────────────────────────────────────────
