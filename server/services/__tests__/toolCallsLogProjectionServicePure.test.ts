/**
 * toolCallsLogProjectionServicePure.test.ts — Sprint 3 P2.1 Sprint 3A.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/toolCallsLogProjectionServicePure.test.ts
 */

import {
  projectToolCallsLog,
  type ProjectionMessageRow,
} from '../toolCallsLogProjectionServicePure.js';

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
  assertEqual(out, [], 'empty');
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
  assertEqual(out.length, 1, 'one entry');
  assertEqual(out[0].tool, 'search', 'tool name');
  assertEqual(out[0].input, { query: 'x' }, 'tool input');
  assertEqual(out[0].output, 'ok', 'tool output (string)');
  assertEqual(out[0].iteration, 0, 'iteration 0');
  assertEqual(out[0].durationMs, 0, 'lossy durationMs');
  assertEqual(out[0].retried, false, 'lossy retried');
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
  assertEqual(out[0].output, '{"success":true,"bytes":42}', 'json output');
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
  assertEqual(out.length, 2, 'two entries');
  assertEqual(out[0].tool, 'search', 'first tool');
  assertEqual(out[0].output, 'r1', 'first output');
  assertEqual(out[1].tool, 'fetch', 'second tool');
  assertEqual(out[1].output, 'r2', 'second output');
  // Both came from the same assistant message, so both share iteration 0.
  assertEqual(out[0].iteration, 0, 'first iteration');
  assertEqual(out[1].iteration, 0, 'second iteration');
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
  assertEqual(out[0].iteration, 0, 'first iteration');
  assertEqual(out[1].iteration, 1, 'second iteration');
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
  assertEqual(out.length, 1, 'still one entry');
  assertEqual(out[0].tool, 'search', 'tool name preserved');
  assertEqual(out[0].output, '', 'empty output');
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
  assertEqual(out.length, 2, 'two entries after sort');
  assertEqual(out[0].tool, 'search', 'first after sort');
  assertEqual(out[1].tool, 'write', 'second after sort');
  assertEqual(out[0].iteration, 0, 'iteration from sorted order');
  assertEqual(out[1].iteration, 1, 'next iteration from sorted order');
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
  assertEqual(out.length, 1, 'only the tool_use assistant message produces an entry');
  // The text-only assistant at seq=1 still counts as an assistant message,
  // bumping the iteration index — so the tool_use at seq=2 reports iteration 1.
  assertEqual(out[0].iteration, 1, 'iteration reflects assistant message index');
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
  assertEqual(out.length, 1, 'malformed block skipped');
  assertEqual(out[0].tool, 'write', 'good block projected');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
