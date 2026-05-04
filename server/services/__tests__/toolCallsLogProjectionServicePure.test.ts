/**
 * toolCallsLogProjectionServicePure.test.ts — Sprint 3 P2.1 Sprint 3A.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/toolCallsLogProjectionServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  projectToolCallsLog,
  type ProjectionMessageRow,
} from '../toolCallsLogProjectionServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

console.log('');
console.log('toolCallsLogProjectionServicePure — Sprint 3 P2.1 Sprint 3A');
console.log('');

test('empty input returns an empty array', () => {
  const out = projectToolCallsLog([]);
  expect(out, 'empty').toEqual([]);
});

test('single tool_use + matching tool_result', () => {
  const messages: ProjectionMessageRow[] = [
    {
      sequenceNumber: 0,
      role: 'assistant',
      content: [
        { type: 'text', text: 'thinking...' },
        { type: 'tool_use', id: 'tu_1', name: 'search', input: { query: 'x' } },
      ],
    },
    {
      sequenceNumber: 1,
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }],
    },
  ];
  const out = projectToolCallsLog(messages);
  expect(out.length, 'one entry').toBe(1);
  expect(out[0].tool, 'tool name').toBe('search');
  expect(out[0].input, 'tool input').toEqual({ query: 'x' });
  expect(out[0].output, 'tool output (string)').toBe('ok');
  expect(out[0].iteration, 'iteration 0').toBe(0);
  expect(out[0].durationMs, 'lossy durationMs').toBe(0);
  expect(out[0].retried, 'lossy retried').toBe(false);
});

test('serialises an object tool_result content to JSON', () => {
  const messages: ProjectionMessageRow[] = [
    {
      sequenceNumber: 0,
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'write', input: { path: '/a' } }],
    },
    {
      sequenceNumber: 1,
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_1',
          content: { success: true, bytes: 42 },
        },
      ],
    },
  ];
  const out = projectToolCallsLog(messages);
  expect(out[0].output, 'json output').toBe('{"success":true,"bytes":42}');
});

test('multiple tool_use blocks in one assistant message pair with separate results', () => {
  const messages: ProjectionMessageRow[] = [
    {
      sequenceNumber: 0,
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'a' } },
        { type: 'tool_use', id: 'tu_2', name: 'fetch', input: { url: 'b' } },
      ],
    },
    {
      sequenceNumber: 1,
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'r1' },
        { type: 'tool_result', tool_use_id: 'tu_2', content: 'r2' },
      ],
    },
  ];
  const out = projectToolCallsLog(messages);
  expect(out.length, 'two entries').toBe(2);
  expect(out[0].tool, 'first tool').toBe('search');
  expect(out[0].output, 'first output').toBe('r1');
  expect(out[1].tool, 'second tool').toBe('fetch');
  expect(out[1].output, 'second output').toBe('r2');
  // Both came from the same assistant message, so both share iteration 0.
  expect(out[0].iteration, 'first iteration').toBe(0);
  expect(out[1].iteration, 'second iteration').toBe(0);
});

test('iteration index advances across assistant messages', () => {
  const messages: ProjectionMessageRow[] = [
    {
      sequenceNumber: 0,
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'search', input: {} }],
    },
    {
      sequenceNumber: 1,
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'r1' }],
    },
    {
      sequenceNumber: 2,
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_2', name: 'write', input: {} }],
    },
    {
      sequenceNumber: 3,
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'r2' }],
    },
  ];
  const out = projectToolCallsLog(messages);
  expect(out[0].iteration, 'first iteration').toBe(0);
  expect(out[1].iteration, 'second iteration').toBe(1);
});

test('unmatched tool_use still produces a log entry with empty output', () => {
  const messages: ProjectionMessageRow[] = [
    {
      sequenceNumber: 0,
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_skip', name: 'search', input: { q: 'x' } }],
    },
    // No tool_result for tu_skip — simulates a skip-before-execute path.
  ];
  const out = projectToolCallsLog(messages);
  expect(out.length, 'still one entry').toBe(1);
  expect(out[0].tool, 'tool name preserved').toBe('search');
  expect(out[0].output, 'empty output').toBe('');
});

test('sorts rows by sequenceNumber before projecting', () => {
  const messages: ProjectionMessageRow[] = [
    {
      sequenceNumber: 3,
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'r2' }],
    },
    {
      sequenceNumber: 1,
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'r1' }],
    },
    {
      sequenceNumber: 0,
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'search', input: {} }],
    },
    {
      sequenceNumber: 2,
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_2', name: 'write', input: {} }],
    },
  ];
  const out = projectToolCallsLog(messages);
  expect(out.length, 'two entries after sort').toBe(2);
  expect(out[0].tool, 'first after sort').toBe('search');
  expect(out[1].tool, 'second after sort').toBe('write');
  expect(out[0].iteration, 'iteration from sorted order').toBe(0);
  expect(out[1].iteration, 'next iteration from sorted order').toBe(1);
});

test('ignores plain-text assistant and system messages', () => {
  const messages: ProjectionMessageRow[] = [
    { sequenceNumber: 0, role: 'system', content: 'You are helpful.' },
    {
      sequenceNumber: 1,
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
    },
    {
      sequenceNumber: 2,
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'search', input: {} }],
    },
    {
      sequenceNumber: 3,
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }],
    },
  ];
  const out = projectToolCallsLog(messages);
  expect(out.length, 'only the tool_use assistant message produces an entry').toBe(1);
  // The text-only assistant at seq=1 still counts as an assistant message,
  // bumping the iteration index — so the tool_use at seq=2 reports iteration 1.
  expect(out[0].iteration, 'iteration reflects assistant message index').toBe(1);
});

test('ignores malformed tool_use blocks without throwing', () => {
  const messages: ProjectionMessageRow[] = [
    {
      sequenceNumber: 0,
      role: 'assistant',
      content: [
        // missing input
        { type: 'tool_use', id: 'tu_bad', name: 'search' },
        // valid block
        { type: 'tool_use', id: 'tu_good', name: 'write', input: { path: 'a' } },
      ],
    },
    {
      sequenceNumber: 1,
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_good', content: 'ok' },
      ],
    },
  ];
  const out = projectToolCallsLog(messages);
  expect(out.length, 'malformed block skipped').toBe(1);
  expect(out[0].tool, 'good block projected').toBe('write');
});

console.log('');
console.log('');
