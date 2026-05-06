/**
 * trajectoryServicePure unit tests — runnable via:
 *   npx tsx server/services/__tests__/trajectoryServicePure.test.ts
 *
 * Tests the structural trajectory comparison logic introduced by Sprint 4
 * P3.3 of docs/improvements-roadmap-spec.md.
 */

import { expect, test } from 'vitest';
import { compare, matchArgs, formatDiff } from '../trajectoryServicePure.js';

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
  expect(compare(actual, reference).pass, 'identical sequences').toBe(true);
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
  expect(compare(actual, reference).pass, 'different length').toBe(false);
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
  expect(compare(actual, reference).pass, 'wrong tool at position').toBe(false);
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
  expect(compare(actual, reference).pass, 'subsequence in order').toBe(true);
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
  expect(compare(actual, reference).pass, 'reversed order').toBe(false);
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
  expect(compare(actual, reference).pass, 'set containment').toBe(true);
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
  expect(compare(actual, reference).pass, 'missing tool').toBe(false);
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
  expect(compare(actual, reference).pass, 'tool found').toBe(true);
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
  expect(compare(actual, reference).pass, 'tool not found').toBe(false);
});

// ── matchArgs ──────────────────────────────────────────────────────

test('matchArgs: matches with partial equality', () => {
  const actual = { to: 'test@example.com', subject: 'Hello', body: 'Hi there' };
  const matchers = { to: 'test@example.com' };
  expect(matchArgs(actual, matchers), 'partial match').toBe(true);
});

test('matchArgs: fails on value mismatch', () => {
  const actual = { to: 'wrong@example.com' };
  const matchers = { to: 'test@example.com' };
  expect(matchArgs(actual, matchers), 'value mismatch').toBe(false);
});

test('matchArgs: passes with no matchers', () => {
  expect(matchArgs({ anything: true }, undefined), 'undefined matchers').toBe(true);
  expect(matchArgs({ anything: true }, {}), 'empty matchers').toBe(true);
});

// ── formatDiff ─────────────────────────────────────────────────────

test('formatDiff: formats a passing diff', () => {
  const diff = { name: 'test-diff', matchMode: 'exact' as const, pass: true, entries: [] };
  const output = formatDiff(diff);
  expect(output.includes('PASS'), 'should contain PASS').toBeTruthy();
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
  expect(output.includes('FAIL'), 'should contain FAIL').toBeTruthy();
  expect(output.includes('read_inbox'), 'should contain tool name').toBeTruthy();
});

console.log('');
console.log('');
