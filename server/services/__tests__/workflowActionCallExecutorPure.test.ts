/**
 * WorkflowActionCallExecutor pure unit tests — runnable via:
 *   npx tsx server/services/__tests__/WorkflowActionCallExecutorPure.test.ts
 *
 * Tests the output size-cap helper that guards WorkflowStepRuns.outputJson
 * against oversized handler payloads. Spec: docs/onboarding-Workflows-spec.md §4.6.
 */

import {
  maybeTruncateOutput,
  MAX_ACTION_OUTPUT_BYTES,
} from '../workflowActionCallExecutorPure.js';

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

// ── Passthrough cases ──────────────────────────────────────────────────────

test('passes small objects through unchanged', () => {
  const payload = { agents: [{ id: 'a1', name: 'Ops' }] };
  assertEqual(maybeTruncateOutput(payload), payload, 'small object identity');
});

test('passes null through unchanged', () => {
  assertEqual(maybeTruncateOutput(null), null, 'null identity');
});

test('passes empty object through unchanged', () => {
  assertEqual(maybeTruncateOutput({}), {}, 'empty object identity');
});

test('passes arrays through unchanged when under cap', () => {
  const arr = [1, 2, 3, 4, 5];
  assertEqual(maybeTruncateOutput(arr), arr, 'small array identity');
});

// ── Truncation cases ───────────────────────────────────────────────────────

test('truncates a huge string payload', () => {
  const huge = 'x'.repeat(MAX_ACTION_OUTPUT_BYTES + 1000);
  const result = maybeTruncateOutput({ value: huge }) as Record<string, unknown>;
  assertEqual(result._truncated, true, '_truncated flag set');
  assert(
    typeof result.originalSize === 'number' && result.originalSize > MAX_ACTION_OUTPUT_BYTES,
    `originalSize must exceed cap, got ${String(result.originalSize)}`,
  );
  assert(
    typeof result.preview === 'string' && result.preview.length <= 500,
    'preview must be ≤ 500 chars',
  );
});

test('truncates a huge array payload', () => {
  const arr: string[] = [];
  for (let i = 0; i < 10000; i++) arr.push('lorem ipsum dolor sit amet');
  const result = maybeTruncateOutput(arr) as Record<string, unknown>;
  assertEqual(result._truncated, true, '_truncated flag set for array');
  assert(
    typeof result.preview === 'string' && result.preview.length <= 500,
    'array preview must be ≤ 500 chars',
  );
});

test('preserves payload at exactly the cap', () => {
  // JSON.stringify of a string x adds 2 surrounding quotes, so build
  // a string whose serialised length equals MAX_ACTION_OUTPUT_BYTES.
  const inner = 'a'.repeat(MAX_ACTION_OUTPUT_BYTES - 2);
  const result = maybeTruncateOutput(inner);
  assertEqual(result, inner, 'boundary payload must pass through');
});

test('truncates payload just over the cap', () => {
  const inner = 'a'.repeat(MAX_ACTION_OUTPUT_BYTES); // serialises to cap+2
  const result = maybeTruncateOutput(inner) as Record<string, unknown>;
  assertEqual(result._truncated, true, 'just-over-cap payload is truncated');
});

// ── Robustness ─────────────────────────────────────────────────────────────

test('returns sentinel for BigInt (non-JSON-serialisable)', () => {
  const result = maybeTruncateOutput(BigInt(1)) as Record<string, unknown>;
  assertEqual(result._truncated, true, 'sentinel has _truncated');
  assertEqual(result.preview, '<unserialisable>', 'sentinel preview');
});

test('returns sentinel for circular reference', () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;
  const result = maybeTruncateOutput(circular) as Record<string, unknown>;
  assertEqual(result._truncated, true, 'circular sentinel has _truncated');
  assertEqual(result.preview, '<unserialisable>', 'circular sentinel preview');
});

test('returns sentinel for undefined (JSON.stringify returns undefined)', () => {
  const result = maybeTruncateOutput(undefined) as Record<string, unknown>;
  assertEqual(result._truncated, true, 'undefined routed to sentinel');
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
