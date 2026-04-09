/**
 * mutateActiveToolsPreservingUniversal unit tests — runnable via:
 *   npx tsx server/services/__tests__/mutateActiveToolsPreservingUniversal.test.ts
 *
 * Tests the universal-skill preservation helper introduced by Sprint 5 P4.1
 * of docs/improvements-roadmap-spec.md.
 */

import { mutateActiveToolsPreservingUniversal } from '../agentExecutionServicePure.js';
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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Minimal tool stubs
function tool(name: string): ProviderTool {
  return { name, description: '', input_schema: { type: 'object', properties: {}, required: [] } };
}

test('re-injects universal tools removed by the transform', () => {
  const current = [tool('send_email'), tool('ask_clarifying_question'), tool('web_search')];
  const all = [...current, tool('read_workspace')];

  // Transform that removes everything except send_email
  const result = mutateActiveToolsPreservingUniversal(
    current,
    (tools) => tools.filter((t) => t.name === 'send_email'),
    all,
  );

  const names = result.map((t) => t.name);
  assert(names.includes('send_email'), 'should contain send_email');
  assert(names.includes('ask_clarifying_question'), 'should re-inject ask_clarifying_question');
  assert(names.includes('web_search'), 'should re-inject web_search');
  assert(names.includes('read_workspace'), 'should re-inject read_workspace');
});

test('does not duplicate tools that the transform kept', () => {
  const current = [tool('send_email'), tool('ask_clarifying_question')];
  const all = [...current];

  // Transform that keeps everything
  const result = mutateActiveToolsPreservingUniversal(
    current,
    (tools) => tools,
    all,
  );

  const names = result.map((t) => t.name);
  const uniqueNames = new Set(names);
  assertEqual(uniqueNames.size, names.length, 'no duplicates');
});

test('handles empty transform result', () => {
  const current = [tool('send_email'), tool('web_search')];
  const all = [...current, tool('ask_clarifying_question'), tool('read_workspace')];

  const result = mutateActiveToolsPreservingUniversal(
    current,
    () => [],
    all,
  );

  const names = result.map((t) => t.name);
  assert(names.includes('ask_clarifying_question'), 'should contain ask_clarifying_question');
  assert(names.includes('web_search'), 'should contain web_search');
  assert(names.includes('read_workspace'), 'should contain read_workspace');
  assert(!names.includes('send_email'), 'should not contain send_email');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
