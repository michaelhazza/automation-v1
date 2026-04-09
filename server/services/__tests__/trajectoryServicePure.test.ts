/**
 * trajectoryServicePure unit tests — runnable via:
 *   npx tsx server/services/__tests__/trajectoryServicePure.test.ts
 *
 * Tests the structural trajectory comparison logic introduced by Sprint 4
 * P3.3 of docs/improvements-roadmap-spec.md.
 */

import { compare, matchArgs, formatDiff } from '../trajectoryServicePure.js';

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

// ── compare — exact mode ───────────────────────────────────────────

test('compare exact: matches identical sequences', () => {
  const actual = [
    { actionType: 'read_inbox', args: {} },
    { actionType: 'create_task', args: { title: 'Bug' } },
  ];
  const reference = {
    name: 'test-exact-match',
    matchMode: 'exact' as const,
    expected: [
      { actionType: 'read_inbox' },
      { actionType: 'create_task' },
    ],
  };
  assertEqual(compare(actual, reference).pass, true, 'identical sequences');
});

test('compare exact: fails on different sequence length', () => {
  const actual = [{ actionType: 'read_inbox', args: {} }];
  const reference = {
    name: 'test-exact-length',
    matchMode: 'exact' as const,
    expected: [
      { actionType: 'read_inbox' },
      { actionType: 'create_task' },
    ],
  };
  assertEqual(compare(actual, reference).pass, false, 'different length');
});

test('compare exact: fails on wrong tool at a position', () => {
  const actual = [
    { actionType: 'send_email', args: {} },
    { actionType: 'create_task', args: {} },
  ];
  const reference = {
    name: 'test-exact-wrong',
    matchMode: 'exact' as const,
    expected: [
      { actionType: 'read_inbox' },
      { actionType: 'create_task' },
    ],
  };
  assertEqual(compare(actual, reference).pass, false, 'wrong tool at position');
});

// ── compare — in-order mode ────────────────────────────────────────

test('compare in-order: matches subsequence in order', () => {
  const actual = [
    { actionType: 'web_search', args: {} },
    { actionType: 'read_inbox', args: {} },
    { actionType: 'send_email', args: {} },
    { actionType: 'create_task', args: {} },
  ];
  const reference = {
    name: 'test-inorder-match',
    matchMode: 'in-order' as const,
    expected: [
      { actionType: 'read_inbox' },
      { actionType: 'create_task' },
    ],
  };
  assertEqual(compare(actual, reference).pass, true, 'subsequence in order');
});

test('compare in-order: fails when order is reversed', () => {
  const actual = [
    { actionType: 'create_task', args: {} },
    { actionType: 'read_inbox', args: {} },
  ];
  const reference = {
    name: 'test-inorder-reversed',
    matchMode: 'in-order' as const,
    expected: [
      { actionType: 'read_inbox' },
      { actionType: 'create_task' },
    ],
  };
  assertEqual(compare(actual, reference).pass, false, 'reversed order');
});

// ── compare — any-order mode ───────────────────────────────────────

test('compare any-order: matches set containment regardless of order', () => {
  const actual = [
    { actionType: 'create_task', args: {} },
    { actionType: 'send_email', args: {} },
    { actionType: 'read_inbox', args: {} },
  ];
  const reference = {
    name: 'test-anyorder-match',
    matchMode: 'any-order' as const,
    expected: [
      { actionType: 'read_inbox' },
      { actionType: 'send_email' },
    ],
  };
  assertEqual(compare(actual, reference).pass, true, 'set containment');
});

test('compare any-order: fails when expected tool is missing', () => {
  const actual = [
    { actionType: 'create_task', args: {} },
  ];
  const reference = {
    name: 'test-anyorder-missing',
    matchMode: 'any-order' as const,
    expected: [
      { actionType: 'read_inbox' },
      { actionType: 'send_email' },
    ],
  };
  assertEqual(compare(actual, reference).pass, false, 'missing tool');
});

// ── compare — single-tool mode ─────────────────────────────────────

test('compare single-tool: matches if tool exists anywhere', () => {
  const actual = [
    { actionType: 'web_search', args: {} },
    { actionType: 'read_inbox', args: {} },
  ];
  const reference = {
    name: 'test-single-match',
    matchMode: 'single-tool' as const,
    expected: [{ actionType: 'read_inbox' }],
  };
  assertEqual(compare(actual, reference).pass, true, 'tool found');
});

test('compare single-tool: fails if tool not found', () => {
  const actual = [
    { actionType: 'web_search', args: {} },
  ];
  const reference = {
    name: 'test-single-missing',
    matchMode: 'single-tool' as const,
    expected: [{ actionType: 'read_inbox' }],
  };
  assertEqual(compare(actual, reference).pass, false, 'tool not found');
});

// ── matchArgs ──────────────────────────────────────────────────────

test('matchArgs: matches with partial equality', () => {
  const actual = { to: 'test@example.com', subject: 'Hello', body: 'Hi there' };
  const matchers = { to: 'test@example.com' };
  assertEqual(matchArgs(actual, matchers), true, 'partial match');
});

test('matchArgs: fails on value mismatch', () => {
  const actual = { to: 'wrong@example.com' };
  const matchers = { to: 'test@example.com' };
  assertEqual(matchArgs(actual, matchers), false, 'value mismatch');
});

test('matchArgs: passes with no matchers', () => {
  assertEqual(matchArgs({ anything: true }, undefined), true, 'undefined matchers');
  assertEqual(matchArgs({ anything: true }, {}), true, 'empty matchers');
});

// ── formatDiff ─────────────────────────────────────────────────────

test('formatDiff: formats a passing diff', () => {
  const diff = { name: 'test-diff', matchMode: 'exact' as const, pass: true, entries: [] };
  const output = formatDiff(diff);
  assert(output.includes('PASS'), 'should contain PASS');
});

test('formatDiff: formats a failing diff with entries', () => {
  const diff = {
    name: 'test-diff-fail',
    matchMode: 'exact' as const,
    pass: false,
    entries: [
      { index: 0, status: 'missing' as const, expected: { actionType: 'read_inbox' } },
    ],
  };
  const output = formatDiff(diff);
  assert(output.includes('FAIL'), 'should contain FAIL');
  assert(output.includes('read_inbox'), 'should contain tool name');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
