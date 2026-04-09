/**
 * agentRunMessageServicePure.test.ts — Sprint 3 P2.1 Sprint 3A pure tests.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentRunMessageServicePure.test.ts
 */

import {
  validateMessageShape,
  computeNextSequenceNumber,
} from '../agentRunMessageServicePure.js';

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

function assertThrows(fn: () => void, label: string) {
  let thrown = false;
  try {
    fn();
  } catch {
    thrown = true;
  }
  if (!thrown) throw new Error(`${label} — expected throw`);
}

function assertEqual(a: unknown, b: unknown, label: string) {
  if (a !== b) throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
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
  assertEqual(computeNextSequenceNumber(null), 0, 'fresh run starts at 0');
});

test('0 current max → 1', () => {
  assertEqual(computeNextSequenceNumber(0), 1, 'increment from 0');
});

test('42 current max → 43', () => {
  assertEqual(computeNextSequenceNumber(42), 43, 'increment from 42');
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
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
