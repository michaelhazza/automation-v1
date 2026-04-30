/**
 * runContextLoader smoke tests — runnable via:
 *   npx tsx server/services/__tests__/runContextLoader.test.ts
 *
 * Tests the PURE post-fetch processing: sort, orderIndex assignment,
 * same-name override resolution, eager/lazy split, budget walk, and
 * manifest cap. Database I/O is not exercised here — the tests build
 * `LoadedDataSource[]` fixtures directly and call processContextPool.
 *
 * The repo doesn't have Jest / Vitest configured, so we follow the same
 * lightweight pattern as server/lib/Workflow/__tests__/Workflow.test.ts.
 */

// Imports the PURE module (runContextLoaderPure.ts), which has zero
// db / env dependencies — keeps the test runnable without DATABASE_URL
// or any other environment setup.
import { expect, test } from 'vitest';
import {
  processContextPool,
  resolveScheduledTaskId,
} from '../runContextLoaderPure.js';

// Inline the LoadedDataSource type so the test doesn't transitively
// import agentService.ts (which would pull in db / env).
interface LoadedDataSource {
  id: string;
  scope: 'agent' | 'subaccount' | 'scheduled_task' | 'task_instance';
  name: string;
  description: string | null;
  content: string;
  contentType: string;
  tokenCount: number;
  sizeBytes: number;
  loadingMode: 'eager' | 'lazy';
  priority: number;
  fetchOk: boolean;
  maxTokenBudget: number;
  orderIndex?: number;
  includedInPrompt?: boolean;
  truncated?: boolean;
  suppressedByOverride?: boolean;
  suppressedBy?: string;
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

let nextId = 0;
function makeSource(overrides: Partial<LoadedDataSource>): LoadedDataSource {
  return {
    id: overrides.id ?? `src-${++nextId}`,
    scope: overrides.scope ?? 'agent',
    name: overrides.name ?? 'unnamed',
    description: overrides.description ?? null,
    content: overrides.content ?? '',
    contentType: overrides.contentType ?? 'text',
    tokenCount: overrides.tokenCount ?? 0,
    sizeBytes: overrides.sizeBytes ?? 0,
    loadingMode: overrides.loadingMode ?? 'eager',
    priority: overrides.priority ?? 0,
    fetchOk: overrides.fetchOk ?? true,
    maxTokenBudget: overrides.maxTokenBudget ?? 8000,
  };
}

console.log('\nrunContextLoader smoke tests\n');

// ─── Sort & precedence ──────────────────────────────────────────────────────

test('sorts by scope precedence: task_instance < scheduled_task < subaccount < agent', () => {
  const pool = [
    makeSource({ id: 'a', scope: 'agent', name: 'a' }),
    makeSource({ id: 'b', scope: 'task_instance', name: 'b' }),
    makeSource({ id: 'c', scope: 'subaccount', name: 'c' }),
    makeSource({ id: 'd', scope: 'scheduled_task', name: 'd' }),
  ];
  const result = processContextPool(pool);
  // pool is mutated in place; check the order
  expect(pool.map(s => s.id), 'sort order').toEqual(['b', 'd', 'c', 'a']);
  void result;
});

test('within a scope, sorts by priority ascending (lower wins)', () => {
  const pool = [
    makeSource({ id: 'p3', scope: 'agent', name: 'p3', priority: 3 }),
    makeSource({ id: 'p1', scope: 'agent', name: 'p1', priority: 1 }),
    makeSource({ id: 'p2', scope: 'agent', name: 'p2', priority: 2 }),
  ];
  processContextPool(pool);
  expect(pool.map(s => s.id), 'priority order').toEqual(['p1', 'p2', 'p3']);
});

// ─── orderIndex assignment ──────────────────────────────────────────────────

test('orderIndex assigned to every entry on the full sorted pool BEFORE suppression', () => {
  const pool = [
    makeSource({ id: 'a-glossary', scope: 'agent', name: 'glossary.md' }),
    makeSource({ id: 'st-glossary', scope: 'scheduled_task', name: 'glossary.md' }),
  ];
  const result = processContextPool(pool);
  // After sort: scheduled_task first (0), agent second (1)
  // After suppression: scheduled_task wins, agent is in suppressed
  // Both should have orderIndex set
  const winner = result.eager.find(s => s.id === 'st-glossary')!;
  const loser = result.suppressed.find(s => s.id === 'a-glossary')!;
  expect(winner.orderIndex === 0, 'winner orderIndex should be 0').toBeTruthy();
  expect(loser.orderIndex === 1, 'loser orderIndex should be 1').toBeTruthy();
  expect(loser.suppressedByOverride === true, 'loser must be marked suppressedByOverride').toBeTruthy();
  expect(loser.suppressedBy === 'st-glossary', 'loser.suppressedBy must point at the winner id').toBeTruthy();
});

test('orderIndex stable across two runs with same input (determinism)', () => {
  const pool1 = [
    makeSource({ id: 'a', scope: 'agent', name: 'a', priority: 1 }),
    makeSource({ id: 'b', scope: 'subaccount', name: 'b', priority: 0 }),
    makeSource({ id: 'c', scope: 'task_instance', name: 'c', priority: 2 }),
  ];
  const pool2 = [
    makeSource({ id: 'a', scope: 'agent', name: 'a', priority: 1 }),
    makeSource({ id: 'b', scope: 'subaccount', name: 'b', priority: 0 }),
    makeSource({ id: 'c', scope: 'task_instance', name: 'c', priority: 2 }),
  ];
  processContextPool(pool1);
  processContextPool(pool2);
  // Both should have identical orderIndex per id
  for (const s1 of pool1) {
    const s2 = pool2.find(x => x.id === s1.id)!;
    expect(s1.orderIndex, `orderIndex stability for ${s1.id}`).toEqual(s2.orderIndex);
  }
});

// ─── Same-name override (spec §3.6) ──────────────────────────────────────────

test('case and whitespace normalisation: "Glossary.MD" matches " glossary.md "', () => {
  const pool = [
    makeSource({ id: 'agent-g', scope: 'agent', name: 'Glossary.MD' }),
    makeSource({ id: 'st-g', scope: 'scheduled_task', name: ' glossary.md ' }),
  ];
  const result = processContextPool(pool);
  expect(result.eager.length === 1, `expected 1 winner, got ${result.eager.length}`).toBeTruthy();
  expect(result.eager[0].id === 'st-g', 'scheduled_task scope should win').toBeTruthy();
  expect(result.suppressed.length === 1, `expected 1 suppressed, got ${result.suppressed.length}`).toBeTruthy();
  expect(result.suppressed[0].id === 'agent-g', 'agent scope should be suppressed').toBeTruthy();
});

test('all four scopes share a name: task_instance wins, others suppressed by it', () => {
  const pool = [
    makeSource({ id: 'agent', scope: 'agent', name: 'glossary' }),
    makeSource({ id: 'sub', scope: 'subaccount', name: 'glossary' }),
    makeSource({ id: 'st', scope: 'scheduled_task', name: 'glossary' }),
    makeSource({ id: 'ti', scope: 'task_instance', name: 'glossary' }),
  ];
  const result = processContextPool(pool);
  // Only the task_instance source should appear in the active eager set
  expect(result.eager.map(s => s.id), 'eager winners').toEqual(['ti']);
  expect(result.manifest.length, 'manifest should be empty').toBe(0);
  // The other three should all be suppressed and point at the task_instance
  // source as the suppressedBy id.
  const suppressedIds = result.suppressed.map(s => s.id).sort();
  expect(suppressedIds, 'suppressed ids').toEqual(['agent', 'st', 'sub']);
  for (const s of result.suppressed) {
    expect(s.suppressedByOverride === true, `${s.id} should be marked suppressedByOverride`).toBeTruthy();
    expect(s.suppressedBy, `${s.id} suppressedBy`).toBe('ti');
    expect(s.includedInPrompt, `${s.id} includedInPrompt`).toBe(false);
  }
});

test('three scopes share a name: scheduled_task wins over subaccount and agent', () => {
  const pool = [
    makeSource({ id: 'a', scope: 'agent', name: 'styleguide.md' }),
    makeSource({ id: 'sa', scope: 'subaccount', name: 'styleguide.md' }),
    makeSource({ id: 'st', scope: 'scheduled_task', name: 'styleguide.md' }),
  ];
  const result = processContextPool(pool);
  expect(result.eager.length === 1, `expected 1 winner, got ${result.eager.length}`).toBeTruthy();
  expect(result.eager[0].id === 'st', 'scheduled_task scope wins').toBeTruthy();
  expect(result.suppressed.length === 2, `expected 2 suppressed, got ${result.suppressed.length}`).toBeTruthy();
  expect(result.suppressed.every(s => s.suppressedBy === 'st'), 'both losers point at scheduled_task winner').toBeTruthy();
});

test('lazy + lazy override: winner is still lazy, loser is suppressed', () => {
  const pool = [
    makeSource({ id: 'a', scope: 'agent', name: 'big.md', loadingMode: 'lazy' }),
    makeSource({ id: 'st', scope: 'scheduled_task', name: 'big.md', loadingMode: 'lazy' }),
  ];
  const result = processContextPool(pool);
  expect(result.eager.length === 0, 'no eager entries').toBeTruthy();
  expect(result.manifest.length === 1, `expected 1 manifest entry, got ${result.manifest.length}`).toBeTruthy();
  expect(result.manifest[0].id === 'st', 'scheduled_task scope wins').toBeTruthy();
  expect(result.suppressed.length === 1, 'agent scope is suppressed').toBeTruthy();
});

// ─── Pre-prompt budget walk ──────────────────────────────────────────────────

test('budget walk: everything fits → all marked includedInPrompt: true', () => {
  const pool = [
    makeSource({ id: '1', scope: 'agent', name: 'a', tokenCount: 1000 }),
    makeSource({ id: '2', scope: 'agent', name: 'b', tokenCount: 2000, priority: 1 }),
    makeSource({ id: '3', scope: 'agent', name: 'c', tokenCount: 1500, priority: 2 }),
  ];
  const result = processContextPool(pool, { maxEagerBudget: 60000 });
  expect(result.eager.every(s => s.includedInPrompt === true), 'all eager fit').toBeTruthy();
});

test('budget walk: partial fit — first sources fit, later ones excluded', () => {
  const pool = [
    makeSource({ id: '1', scope: 'agent', name: 'a', tokenCount: 20000 }),
    makeSource({ id: '2', scope: 'agent', name: 'b', tokenCount: 20000, priority: 1 }),
    makeSource({ id: '3', scope: 'agent', name: 'c', tokenCount: 20000, priority: 2 }),
    makeSource({ id: '4', scope: 'agent', name: 'd', tokenCount: 20000, priority: 3 }),
    makeSource({ id: '5', scope: 'agent', name: 'e', tokenCount: 20000, priority: 4 }),
  ];
  const result = processContextPool(pool, { maxEagerBudget: 50000 });
  // Two sources fit (40k), third would push to 60k, doesn't fit
  expect(result.eager[0].includedInPrompt === true, 'source 1 fits').toBeTruthy();
  expect(result.eager[1].includedInPrompt === true, 'source 2 fits').toBeTruthy();
  expect(result.eager[2].includedInPrompt === false, 'source 3 excluded').toBeTruthy();
  expect(result.eager[3].includedInPrompt === false, 'source 4 excluded').toBeTruthy();
  expect(result.eager[4].includedInPrompt === false, 'source 5 excluded').toBeTruthy();
  // All five are still in the eager array (snapshot completeness)
  expect(result.eager.length === 5, 'excluded sources stay in result.eager for snapshot').toBeTruthy();
});

test('budget walk: precedence preserved under pressure (most-specific wins)', () => {
  const pool = [
    makeSource({ id: 'task', scope: 'task_instance', name: 'task', tokenCount: 10000 }),
    makeSource({ id: 'st', scope: 'scheduled_task', name: 'st', tokenCount: 40000 }),
    makeSource({ id: 'agent', scope: 'agent', name: 'agent', tokenCount: 20000 }),
  ];
  const result = processContextPool(pool, { maxEagerBudget: 60000 });
  // After sort: task_instance (10k) → scheduled_task (50k) → agent (70k)
  // task and st fit; agent does not
  const taskSource = result.eager.find(s => s.id === 'task')!;
  const stSource = result.eager.find(s => s.id === 'st')!;
  const agentSource = result.eager.find(s => s.id === 'agent')!;
  expect(taskSource.includedInPrompt === true, 'task_instance fits').toBeTruthy();
  expect(stSource.includedInPrompt === true, 'scheduled_task fits').toBeTruthy();
  expect(agentSource.includedInPrompt === false, 'agent excluded by budget').toBeTruthy();
});

test('lazy sources do not consume eager budget', () => {
  const pool = [
    makeSource({ id: 'eager', scope: 'agent', name: 'a', tokenCount: 50000, loadingMode: 'eager' }),
    makeSource({ id: 'lazy', scope: 'scheduled_task', name: 'b', tokenCount: 50000, loadingMode: 'lazy' }),
  ];
  const result = processContextPool(pool, { maxEagerBudget: 60000 });
  const eagerSource = result.eager[0];
  expect(eagerSource.includedInPrompt === true, '50k eager source still fits in 60k budget').toBeTruthy();
  // Lazy source should not consume any of the 60k budget
});

// ─── Manifest cap ───────────────────────────────────────────────────────────

test('lazy manifest cap: 10 lazy sources with cap=5 → manifestForPrompt.length=5, elided=5', () => {
  const pool = Array.from({ length: 10 }, (_, i) =>
    makeSource({ id: `lazy-${i}`, scope: 'agent', name: `lazy-${i}`, loadingMode: 'lazy', priority: i })
  );
  const result = processContextPool(pool, { maxLazyManifestItems: 5 });
  expect(result.manifest.length === 10, 'full manifest has all 10').toBeTruthy();
  expect(result.manifestForPrompt.length === 5, 'capped subset has 5').toBeTruthy();
  expect(result.manifestElidedCount === 5, 'elided count is 5').toBeTruthy();
});

test('manifest cap: 3 lazy sources with cap=10 → manifestForPrompt has all 3, elided=0', () => {
  const pool = Array.from({ length: 3 }, (_, i) =>
    makeSource({ id: `lazy-${i}`, scope: 'agent', name: `lazy-${i}`, loadingMode: 'lazy', priority: i })
  );
  const result = processContextPool(pool, { maxLazyManifestItems: 10 });
  expect(result.manifestForPrompt.length === 3, 'full manifest fits').toBeTruthy();
  expect(result.manifestElidedCount === 0, 'no elision').toBeTruthy();
});

// ─── Snapshot completeness ──────────────────────────────────────────────────

test('snapshot completeness: mixed scenario has every entry tagged', () => {
  const pool = [
    makeSource({ id: 'eager-in', scope: 'agent', name: 'a', tokenCount: 1000 }),
    makeSource({ id: 'eager-out', scope: 'agent', name: 'b', tokenCount: 999999, priority: 1 }),
    makeSource({ id: 'lazy', scope: 'agent', name: 'c', loadingMode: 'lazy', priority: 2 }),
    makeSource({ id: 'override-loser', scope: 'agent', name: 'a', priority: 3 }),
  ];
  const result = processContextPool(pool, { maxEagerBudget: 50000 });
  // All four should have orderIndex set
  for (const s of [...result.eager, ...result.manifest, ...result.suppressed]) {
    expect(typeof s.orderIndex === 'number', `${s.id} should have orderIndex`).toBeTruthy();
    expect(s.orderIndex! >= 0, `${s.id} orderIndex should be >= 0`).toBeTruthy();
  }
});

// ─── resolveScheduledTaskId (Blocker 1 fix) ─────────────────────────────────

test('resolveScheduledTaskId: source=scheduled_task with scheduledTaskId returns id', () => {
  const result = resolveScheduledTaskId({ source: 'scheduled_task', scheduledTaskId: 'st-123' });
  expect(result === 'st-123', 'should return scheduledTaskId').toBeTruthy();
});

test('resolveScheduledTaskId: source=scheduled_task_retry STILL returns id (Blocker 1)', () => {
  const result = resolveScheduledTaskId({ source: 'scheduled_task_retry', scheduledTaskId: 'st-456' });
  expect(result === 'st-456', 'retry path must also load scheduled-task context — this is the Blocker 1 fix').toBeTruthy();
});

test('resolveScheduledTaskId: no triggerContext → null', () => {
  const result = resolveScheduledTaskId(undefined);
  expect(result === null, 'null when no trigger context').toBeTruthy();
});

test('resolveScheduledTaskId: triggerContext without scheduledTaskId → null', () => {
  const result = resolveScheduledTaskId({ source: 'manual' });
  expect(result === null, 'null when scheduledTaskId is missing').toBeTruthy();
});

// ─── Summary ────────────────────────────────────────────────────────────────
