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

import {
  decideUpsert,
  computeCombined,
  serialiseForBlock,
  getByPath,
  MEMORY_BLOCK_CONTENT_MAX,
  MEMORY_BLOCKS_PER_RUN_MAX,
  type ExistingBlockView,
} from '../memoryBlockUpsertPure.js';

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

// ── Helpers ────────────────────────────────────────────────────────────────

function makeExisting(overrides: Partial<ExistingBlockView> = {}): ExistingBlockView {
  return {
    id: 'block-1',
    content: 'existing',
    lastEditedByAgentId: 'agent-1',
    lastWrittenByPlaybookSlug: 'onboarding',
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
    playbookSlug: 'onboarding',
    blocksUpsertedThisRun: 0,
  });
  assertEqual(d.kind, 'skip_empty', 'empty kind');
});

test('skips when per-run rate limit reached', () => {
  const d = decideUpsert({
    existing: null,
    label: 'Facts',
    incomingContent: 'new value',
    mergeStrategy: 'replace',
    playbookSlug: 'onboarding',
    blocksUpsertedThisRun: MEMORY_BLOCKS_PER_RUN_MAX,
  });
  assertEqual(d.kind, 'skip_rate_limited', 'rate limit kind');
});

test('creates when no existing block', () => {
  const d = decideUpsert({
    existing: null,
    label: 'Facts',
    incomingContent: 'hello',
    mergeStrategy: 'replace',
    playbookSlug: 'onboarding',
    blocksUpsertedThisRun: 3,
  });
  assert(d.kind === 'create', 'create kind');
  if (d.kind === 'create') {
    assertEqual(d.content, 'hello', 'create content');
    assertEqual(d.truncated, false, 'not truncated');
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
    playbookSlug: 'onboarding',
    blocksUpsertedThisRun: 0,
  });
  assert(d.kind === 'create', 'create kind');
  if (d.kind === 'create') {
    assertEqual(d.content.length, MEMORY_BLOCK_CONTENT_MAX, 'truncated to cap');
    assertEqual(d.content.endsWith('TAIL'), true, 'tail preserved');
    assertEqual(d.truncated, true, 'truncated flag set');
  }
});

// ── HITL overwrite predicate ───────────────────────────────────────────────

test('HITL skip when last edit was human and prior playbook differs', () => {
  const d = decideUpsert({
    existing: makeExisting({
      lastEditedByAgentId: null,
      lastWrittenByPlaybookSlug: 'different-playbook',
    }),
    label: 'Facts',
    incomingContent: 'new',
    mergeStrategy: 'replace',
    playbookSlug: 'onboarding',
    blocksUpsertedThisRun: 1,
  });
  assert(d.kind === 'skip_hitl_overwrite', 'hitl kind');
});

test('HITL skip when last edit was human and prior playbook is null', () => {
  const d = decideUpsert({
    existing: makeExisting({
      lastEditedByAgentId: null,
      lastWrittenByPlaybookSlug: null,
    }),
    label: 'Facts',
    incomingContent: 'new',
    mergeStrategy: 'replace',
    playbookSlug: 'onboarding',
    blocksUpsertedThisRun: 1,
  });
  assert(d.kind === 'skip_hitl_overwrite', 'hitl kind');
});

test('HITL carve-out: same playbook may rewrite its own human-edited block', () => {
  // Edge case per spec — if a block last-written by the same playbook was
  // later edited by a human, rerunning the playbook still trips HITL because
  // the human edit supersedes. Our predicate treats human-edited as human-owned.
  const d = decideUpsert({
    existing: makeExisting({
      lastEditedByAgentId: null,
      lastWrittenByPlaybookSlug: 'onboarding',
    }),
    label: 'Facts',
    incomingContent: 'new',
    mergeStrategy: 'replace',
    playbookSlug: 'onboarding',
    blocksUpsertedThisRun: 1,
  });
  // Per the spec (§7.5): "A playbook can freely rewrite blocks IT
  // previously wrote". So same-slug = update, not HITL.
  assert(d.kind === 'update', 'update kind for same-slug rewrite');
});

test('no HITL skip when last edit was by an agent', () => {
  const d = decideUpsert({
    existing: makeExisting({
      lastEditedByAgentId: 'agent-1',
      lastWrittenByPlaybookSlug: 'different',
    }),
    label: 'Facts',
    incomingContent: 'new',
    mergeStrategy: 'replace',
    playbookSlug: 'onboarding',
    blocksUpsertedThisRun: 1,
  });
  assert(d.kind === 'update', 'update kind');
});

// ── Merge strategies ───────────────────────────────────────────────────────

test('replace overwrites existing content', () => {
  const r = computeCombined('old', 'new', 'replace');
  assertEqual(r.content, 'new', 'replace content');
  assertEqual(r.truncated, false, 'replace not truncated');
  assertEqual(r.mergeFallback, false, 'no merge fallback on replace');
});

test('append adds incoming after a newline', () => {
  const r = computeCombined('first', 'second', 'append');
  assertEqual(r.content, 'first\nsecond', 'append joined');
});

test('append starts from incoming when existing is empty', () => {
  const r = computeCombined('', 'only', 'append');
  assertEqual(r.content, 'only', 'append skips newline when empty');
});

test('append truncates to 2000 chars from the end', () => {
  const existing = 'A'.repeat(1500);
  const incoming = 'B'.repeat(1500);
  const r = computeCombined(existing, incoming, 'append');
  assertEqual(r.content.length, MEMORY_BLOCK_CONTENT_MAX, 'trimmed to cap');
  assertEqual(r.content.endsWith('B'.repeat(1500)), true, 'tail of incoming preserved');
  assertEqual(r.truncated, true, 'truncated flag set');
});

test('merge combines two JSON objects', () => {
  const r = computeCombined(
    JSON.stringify({ a: 1, b: 2 }),
    JSON.stringify({ b: 3, c: 4 }),
    'merge',
  );
  assertEqual(r.mergeFallback, false, 'no fallback on valid objects');
  assertEqual(JSON.parse(r.content), { a: 1, b: 3, c: 4 }, 'merged keys');
});

test('merge falls back to replace on non-object existing content', () => {
  const r = computeCombined('not-json', JSON.stringify({ x: 1 }), 'merge');
  assertEqual(r.mergeFallback, true, 'fallback set');
  assertEqual(r.content, JSON.stringify({ x: 1 }), 'content is incoming');
});

test('merge falls back to replace on non-object incoming content', () => {
  const r = computeCombined(JSON.stringify({ x: 1 }), 'not-json', 'merge');
  assertEqual(r.mergeFallback, true, 'fallback set');
  assertEqual(r.content, 'not-json', 'content is raw incoming');
});

test('merge falls back when incoming is a JSON array (not an object)', () => {
  const r = computeCombined(JSON.stringify({ x: 1 }), JSON.stringify([1, 2]), 'merge');
  assertEqual(r.mergeFallback, true, 'array triggers fallback');
});

// ── serialiseForBlock ──────────────────────────────────────────────────────

test('serialiseForBlock passes strings through', () => {
  assertEqual(serialiseForBlock('hello'), 'hello', 'string identity');
});

test('serialiseForBlock stringifies objects', () => {
  const s = serialiseForBlock({ a: 1 });
  assertEqual(s.includes('"a"'), true, 'object stringified');
});

test('serialiseForBlock handles null/undefined', () => {
  assertEqual(serialiseForBlock(null), '', 'null → empty');
  assertEqual(serialiseForBlock(undefined), '', 'undefined → empty');
});

test('serialiseForBlock handles numbers and booleans', () => {
  assertEqual(serialiseForBlock(42), '42', 'number stringified');
  assertEqual(serialiseForBlock(true), 'true', 'boolean stringified');
});

// ── getByPath ──────────────────────────────────────────────────────────────

test('getByPath resolves top-level field', () => {
  assertEqual(getByPath({ a: 1 }, 'a'), 1, 'top-level');
});

test('getByPath resolves nested dot path', () => {
  assertEqual(getByPath({ a: { b: { c: 'deep' } } }, 'a.b.c'), 'deep', 'nested');
});

test('getByPath resolves array index', () => {
  assertEqual(getByPath({ items: [10, 20, 30] }, 'items[1]'), 20, 'array index');
});

test('getByPath resolves mixed array + object path', () => {
  assertEqual(
    getByPath({ list: [{ id: 'a' }, { id: 'b' }] }, 'list[1].id'),
    'b',
    'mixed path',
  );
});

test('getByPath returns undefined on missing field', () => {
  assertEqual(getByPath({ a: 1 }, 'missing'), undefined, 'missing returns undefined');
});

test('getByPath returns undefined on type mismatch', () => {
  assertEqual(getByPath({ a: 1 }, 'a.b'), undefined, 'drilling into non-object');
});

test('getByPath returns undefined on index out of bounds', () => {
  assertEqual(getByPath({ items: [1] }, 'items[5]'), undefined, 'oob index');
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
