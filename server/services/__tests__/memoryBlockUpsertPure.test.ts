/**
 * memoryBlockUpsertPure unit tests — runnable via:
 *   npx tsx server/services/__tests__/memoryBlockUpsertPure.test.ts
 *
 * Covers the §7.5 / §8.4 decision matrix:
 *   - merge strategies (replace / append / merge with JSON fallback)
 *   - 2000-char end-truncation (newest content wins)
 *   - per-run rate limit (§7.5, 10 blocks per run)
 *   - HITL overwrite predicate (§7.5)
 *   - empty-content skip
 *   - path resolver corner cases
 *
 * Spec: docs/onboarding-playbooks-spec.md §7.5 & §8.4.
 */

import { expect, test } from 'vitest';
import {
  decideUpsert,
  computeCombined,
  serialiseForBlock,
  getByPath,
  MEMORY_BLOCK_CONTENT_MAX,
  MEMORY_BLOCKS_PER_RUN_MAX,
  type ExistingBlockView,
} from '../memoryBlockUpsertPure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeExisting(overrides: Partial<ExistingBlockView> = {}): ExistingBlockView {
  return {
    id: 'block-1',
    content: 'existing',
    lastEditedByAgentId: 'agent-1',
    lastWrittenByWorkflowSlug: 'onboarding',
    sourceRunId: 'run-prior',
    ...overrides,
  };
}

// ── Empty / rate-limit / create paths ──────────────────────────────────────

test('skips empty incoming content', () => {
  const d = decideUpsert({
    existing: null,
    label: 'Facts',
    incomingContent: '   ',
    mergeStrategy: 'replace',
    workflowSlug: 'onboarding',
    blocksUpsertedThisRun: 0,
  });
  expect(d.kind, 'empty kind').toBe('skip_empty');
});

test('skips when per-run rate limit reached', () => {
  const d = decideUpsert({
    existing: null,
    label: 'Facts',
    incomingContent: 'new value',
    mergeStrategy: 'replace',
    workflowSlug: 'onboarding',
    blocksUpsertedThisRun: MEMORY_BLOCKS_PER_RUN_MAX,
  });
  expect(d.kind, 'rate limit kind').toBe('skip_rate_limited');
});

test('creates when no existing block', () => {
  const d = decideUpsert({
    existing: null,
    label: 'Facts',
    incomingContent: 'hello',
    mergeStrategy: 'replace',
    workflowSlug: 'onboarding',
    blocksUpsertedThisRun: 3,
  });
  expect(d.kind === 'create', 'create kind').toBeTruthy();
  if (d.kind === 'create') {
    expect(d.content, 'create content').toBe('hello');
    expect(d.truncated, 'not truncated').toBe(false);
  }
});

test('create truncates oversize incoming content from end', () => {
  // Build a string longer than the cap; end-truncation should preserve the tail.
  const incoming = 'HEAD'.padEnd(MEMORY_BLOCK_CONTENT_MAX + 500, '.') + 'TAIL';
  const d = decideUpsert({
    existing: null,
    label: 'Facts',
    incomingContent: incoming,
    mergeStrategy: 'replace',
    workflowSlug: 'onboarding',
    blocksUpsertedThisRun: 0,
  });
  expect(d.kind === 'create', 'create kind').toBeTruthy();
  if (d.kind === 'create') {
    expect(d.content.length, 'truncated to cap').toEqual(MEMORY_BLOCK_CONTENT_MAX);
    expect(d.content.endsWith('TAIL'), 'tail preserved').toBe(true);
    expect(d.truncated, 'truncated flag set').toBe(true);
  }
});

// ── HITL overwrite predicate ───────────────────────────────────────────────

test('HITL skip when last edit was human and prior playbook differs', () => {
  const d = decideUpsert({
    existing: makeExisting({
      lastEditedByAgentId: null,
      lastWrittenByWorkflowSlug: 'different-workflow',
    }),
    label: 'Facts',
    incomingContent: 'new',
    mergeStrategy: 'replace',
    workflowSlug: 'onboarding',
    blocksUpsertedThisRun: 1,
  });
  expect(d.kind === 'skip_hitl_overwrite', 'hitl kind').toBeTruthy();
});

test('HITL skip when last edit was human and prior playbook is null', () => {
  const d = decideUpsert({
    existing: makeExisting({
      lastEditedByAgentId: null,
      lastWrittenByWorkflowSlug: null,
    }),
    label: 'Facts',
    incomingContent: 'new',
    mergeStrategy: 'replace',
    workflowSlug: 'onboarding',
    blocksUpsertedThisRun: 1,
  });
  expect(d.kind === 'skip_hitl_overwrite', 'hitl kind').toBeTruthy();
});

test('HITL carve-out: same playbook may rewrite its own human-edited block', () => {
  // Edge case per spec — if a block last-written by the same playbook was
  // later edited by a human, rerunning the playbook still trips HITL because
  // the human edit supersedes. Our predicate treats human-edited as human-owned.
  const d = decideUpsert({
    existing: makeExisting({
      lastEditedByAgentId: null,
      lastWrittenByWorkflowSlug: 'onboarding',
    }),
    label: 'Facts',
    incomingContent: 'new',
    mergeStrategy: 'replace',
    workflowSlug: 'onboarding',
    blocksUpsertedThisRun: 1,
  });
  // Per the spec (§7.5): "A playbook can freely rewrite blocks IT
  // previously wrote". So same-slug = update, not HITL.
  expect(d.kind === 'update', 'update kind for same-slug rewrite').toBeTruthy();
});

test('no HITL skip when last edit was by an agent', () => {
  const d = decideUpsert({
    existing: makeExisting({
      lastEditedByAgentId: 'agent-1',
      lastWrittenByWorkflowSlug: 'different',
    }),
    label: 'Facts',
    incomingContent: 'new',
    mergeStrategy: 'replace',
    workflowSlug: 'onboarding',
    blocksUpsertedThisRun: 1,
  });
  expect(d.kind === 'update', 'update kind').toBeTruthy();
});

// ── Merge strategies ───────────────────────────────────────────────────────

test('replace overwrites existing content', () => {
  const r = computeCombined('old', 'new', 'replace');
  expect(r.content, 'replace content').toBe('new');
  expect(r.truncated, 'replace not truncated').toBe(false);
  expect(r.mergeFallback, 'no merge fallback on replace').toBe(false);
});

test('append adds incoming after a newline', () => {
  const r = computeCombined('first', 'second', 'append');
  expect(r.content, 'append joined').toBe('first\nsecond');
});

test('append starts from incoming when existing is empty', () => {
  const r = computeCombined('', 'only', 'append');
  expect(r.content, 'append skips newline when empty').toBe('only');
});

test('append truncates to 2000 chars from the end', () => {
  const existing = 'A'.repeat(1500);
  const incoming = 'B'.repeat(1500);
  const r = computeCombined(existing, incoming, 'append');
  expect(r.content.length, 'trimmed to cap').toEqual(MEMORY_BLOCK_CONTENT_MAX);
  expect(r.content.endsWith('B'.repeat(1500)), 'tail of incoming preserved').toBe(true);
  expect(r.truncated, 'truncated flag set').toBe(true);
});

test('merge combines two JSON objects', () => {
  const r = computeCombined(
    JSON.stringify({ a: 1, b: 2 }),
    JSON.stringify({ b: 3, c: 4 }),
    'merge',
  );
  expect(r.mergeFallback, 'no fallback on valid objects').toBe(false);
  expect(JSON.parse(r.content), 'merged keys').toEqual({ a: 1, b: 3, c: 4 });
});

test('merge falls back to replace on non-object existing content', () => {
  const r = computeCombined('not-json', JSON.stringify({ x: 1 }), 'merge');
  expect(r.mergeFallback, 'fallback set').toBe(true);
  expect(r.content, 'content is incoming').toEqual(JSON.stringify({ x: 1 }));
});

test('merge falls back to replace on non-object incoming content', () => {
  const r = computeCombined(JSON.stringify({ x: 1 }), 'not-json', 'merge');
  expect(r.mergeFallback, 'fallback set').toBe(true);
  expect(r.content, 'content is raw incoming').toBe('not-json');
});

test('merge falls back when incoming is a JSON array (not an object)', () => {
  const r = computeCombined(JSON.stringify({ x: 1 }), JSON.stringify([1, 2]), 'merge');
  expect(r.mergeFallback, 'array triggers fallback').toBe(true);
});

// ── serialiseForBlock ──────────────────────────────────────────────────────

test('serialiseForBlock passes strings through', () => {
  expect(serialiseForBlock('hello'), 'string identity').toBe('hello');
});

test('serialiseForBlock stringifies objects', () => {
  const s = serialiseForBlock({ a: 1 });
  expect(s.includes('"a"'), 'object stringified').toBe(true);
});

test('serialiseForBlock handles null/undefined', () => {
  expect(serialiseForBlock(null), 'null → empty').toBe('');
  expect(serialiseForBlock(undefined), 'undefined → empty').toBe('');
});

test('serialiseForBlock handles numbers and booleans', () => {
  expect(serialiseForBlock(42), 'number stringified').toBe('42');
  expect(serialiseForBlock(true), 'boolean stringified').toBe('true');
});

// ── getByPath ──────────────────────────────────────────────────────────────

test('getByPath resolves top-level field', () => {
  expect(getByPath({ a: 1 }, 'a'), 'top-level').toBe(1);
});

test('getByPath resolves nested dot path', () => {
  expect(getByPath({ a: { b: { c: 'deep' } } }, 'a.b.c'), 'nested').toBe('deep');
});

test('getByPath resolves array index', () => {
  expect(getByPath({ items: [10, 20, 30] }, 'items[1]'), 'array index').toBe(20);
});

test('getByPath resolves mixed array + object path', () => {
  expect(getByPath({ list: [{ id: 'a' }, { id: 'b' }] }, 'list[1].id'), 'mixed path').toBe('b');
});

test('getByPath returns undefined on missing field', () => {
  expect(getByPath({ a: 1 }, 'missing'), 'missing returns undefined').toBe(undefined);
});

test('getByPath returns undefined on type mismatch', () => {
  expect(getByPath({ a: 1 }, 'a.b'), 'drilling into non-object').toBe(undefined);
});

test('getByPath returns undefined on index out of bounds', () => {
  expect(getByPath({ items: [1] }, 'items[5]'), 'oob index').toBe(undefined);
});

// ── Summary ────────────────────────────────────────────────────────────────
