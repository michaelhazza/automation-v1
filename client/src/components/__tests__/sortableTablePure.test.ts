/**
 * sortableTablePure.test.ts
 *
 * Pure-function tests for SortableTable helpers.
 *
 * Self-contained — uses Node's built-in `assert` module only (no Jest, no Vitest).
 * Run via:
 *   npx tsx client/src/components/__tests__/sortableTablePure.test.ts
 */

import assert from 'node:assert/strict';
import {
  compareForSort,
  deriveFilterKey,
  applySortAndFilters,
  type ColumnDef,
} from '../sortableTablePure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passCount++;
  } catch (err) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${(err as Error).message}`);
    failCount++;
  }
}

// ---------------------------------------------------------------------------
// compareForSort — string
// ---------------------------------------------------------------------------

console.log('\n── compareForSort (string) ──');

test("'Apple' vs 'banana' under sensitivity:base → negative (Apple < banana)", () => {
  const result = compareForSort('Apple', 'banana', 'string');
  assert.ok(result < 0, `Expected negative, got ${result}`);
});

test("'banana' vs 'Apple' under sensitivity:base → positive", () => {
  const result = compareForSort('banana', 'Apple', 'string');
  assert.ok(result > 0, `Expected positive, got ${result}`);
});

test("equal strings → 0", () => {
  const result = compareForSort('foo', 'foo', 'string');
  assert.strictEqual(result, 0);
});

// ---------------------------------------------------------------------------
// compareForSort — number
// ---------------------------------------------------------------------------

console.log('\n── compareForSort (number) ──');

test('3 vs 10 → -7', () => {
  const result = compareForSort(3, 10, 'number');
  assert.strictEqual(result, -7);
});

test('10 vs 3 → 7', () => {
  const result = compareForSort(10, 3, 'number');
  assert.strictEqual(result, 7);
});

test('equal numbers → 0', () => {
  const result = compareForSort(5, 5, 'number');
  assert.strictEqual(result, 0);
});

// ---------------------------------------------------------------------------
// compareForSort — NaN guard (numeric hint but non-numeric value)
// ---------------------------------------------------------------------------

console.log('\n── compareForSort (NaN guard) ──');

test("'abc' vs 'xyz' with hint:number → NaN guard fires, falls through to localeCompare", () => {
  // Number('abc') = NaN, so falls back to localeCompare('abc', 'xyz')
  const result = compareForSort('abc', 'xyz', 'number');
  // 'abc' < 'xyz' alphabetically → negative
  assert.ok(result < 0, `Expected negative (localeCompare fallback), got ${result}`);
});

test("NaN inputs ('abc' and 'def') — hint:number falls to string compare", () => {
  const result = compareForSort('def', 'abc', 'number');
  // 'def' > 'abc' → positive
  assert.ok(result > 0, `Expected positive (localeCompare fallback), got ${result}`);
});

// ---------------------------------------------------------------------------
// compareForSort — null/undefined handled by caller
// ---------------------------------------------------------------------------
// Note: compareForSort itself does not receive null in normal usage (applySortAndFilters
// intercepts null/undefined before calling it). These tests verify the documented
// caller contract and confirm no crash occurs if invoked with null directly.

console.log('\n── compareForSort (caller null contract, via applySortAndFilters) ──');

// Null-to-bottom tests are covered more fully under applySortAndFilters below.
// Here we just confirm compareForSort doesn't throw on edge inputs.
test('compareForSort does not throw on undefined inputs (treated as strings)', () => {
  assert.doesNotThrow(() => compareForSort(undefined, 'foo', 'string'));
});

// ---------------------------------------------------------------------------
// deriveFilterKey
// ---------------------------------------------------------------------------

console.log('\n── deriveFilterKey ──');

test("string value 'hello' → 'hello'", () => {
  assert.strictEqual(deriveFilterKey('hello', 'name'), 'hello');
});

test('null → sentinel __NULL__::columnKey', () => {
  assert.strictEqual(deriveFilterKey(null, 'status'), '__NULL__::status');
});

test('undefined → sentinel __NULL__::columnKey', () => {
  assert.strictEqual(deriveFilterKey(undefined, 'status'), '__NULL__::status');
});

test('Date instance → String(date) (deterministic per JS spec)', () => {
  const d = new Date('2026-01-15T00:00:00.000Z');
  const result = deriveFilterKey(d, 'createdAt');
  assert.strictEqual(result, String(d));
  assert.ok(result.length > 0);
});

test('number value 42 → "42"', () => {
  assert.strictEqual(deriveFilterKey(42, 'count'), '42');
});

test('empty string → empty string (not sentinel — empty string is a valid value)', () => {
  assert.strictEqual(deriveFilterKey('', 'label'), '');
});

test('sentinel is column-scoped (two null columns produce distinct keys)', () => {
  const k1 = deriveFilterKey(null, 'colA');
  const k2 = deriveFilterKey(null, 'colB');
  assert.notStrictEqual(k1, k2);
});

// ---------------------------------------------------------------------------
// applySortAndFilters
// ---------------------------------------------------------------------------

console.log('\n── applySortAndFilters ──');

type Item = { id: string; name: string; score: number | null };

const colName: ColumnDef<Item> = {
  key: 'name',
  label: 'Name',
  sortable: true,
  filterable: true,
  getValue: (r) => r.name,
};

const colScore: ColumnDef<Item> = {
  key: 'score',
  label: 'Score',
  sortable: true,
  filterable: true,
  getValue: (r) => r.score,
};

const columns: ColumnDef<Item>[] = [colName, colScore];

const rows: Item[] = [
  { id: 'a', name: 'Charlie', score: 80 },
  { id: 'b', name: 'Alice', score: 95 },
  { id: 'c', name: 'Bob', score: 70 },
  { id: 'd', name: 'Dave', score: null },
];

// -- Empty filters (no filters active) --

test('empty filters: all rows returned', () => {
  const result = applySortAndFilters(rows, null, {}, columns);
  assert.strictEqual(result.length, 4);
});

test('does not mutate input array', () => {
  const copy = [...rows];
  applySortAndFilters(rows, { key: 'score', dir: 'asc' }, {}, columns);
  assert.deepStrictEqual(rows, copy);
});

// -- Single-column filter --

test('single-column filter keeps only matching rows', () => {
  const filters: Record<string, Set<string>> = {
    name: new Set(['Alice', 'Bob']),
  };
  const result = applySortAndFilters(rows, null, filters, columns);
  assert.strictEqual(result.length, 2);
  assert.ok(result.some((r) => r.id === 'b'));
  assert.ok(result.some((r) => r.id === 'c'));
});

// -- Multi-column AND --

test('multi-column filter: AND logic (row must pass all columns)', () => {
  const filters: Record<string, Set<string>> = {
    name: new Set(['Alice', 'Charlie']),
    score: new Set(['80']), // Only Charlie has score=80
  };
  const result = applySortAndFilters(rows, null, filters, columns);
  // Only Charlie passes both filters
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'a');
});

// -- Sort + filter combined --

test('sort + filter combined: filter first, then sort result', () => {
  const filters: Record<string, Set<string>> = {
    name: new Set(['Alice', 'Charlie']),
  };
  const result = applySortAndFilters(rows, { key: 'score', dir: 'asc' }, filters, columns);
  assert.strictEqual(result.length, 2);
  // Charlie=80, Alice=95 → asc by score: Charlie then Alice
  assert.strictEqual(result[0].id, 'a'); // Charlie
  assert.strictEqual(result[1].id, 'b'); // Alice
});

// -- Sort ascending --

test('sort by score asc: null goes to bottom', () => {
  const result = applySortAndFilters(rows, { key: 'score', dir: 'asc' }, {}, columns);
  const ids = result.map((r) => r.id);
  // Bob=70, Charlie=80, Alice=95, Dave=null
  assert.strictEqual(ids[0], 'c'); // Bob 70
  assert.strictEqual(ids[1], 'a'); // Charlie 80
  assert.strictEqual(ids[2], 'b'); // Alice 95
  assert.strictEqual(ids[3], 'd'); // Dave null — bottom
});

// -- Null-to-bottom in both directions --

test('null-to-bottom asc: null row always last', () => {
  const result = applySortAndFilters(rows, { key: 'score', dir: 'asc' }, {}, columns);
  assert.strictEqual(result[result.length - 1].id, 'd'); // Dave=null
});

test('null-to-bottom desc: null row still last (not moved to top)', () => {
  const result = applySortAndFilters(rows, { key: 'score', dir: 'desc' }, {}, columns);
  assert.strictEqual(result[result.length - 1].id, 'd'); // Dave=null
  // And first should be the highest non-null score
  assert.strictEqual(result[0].id, 'b'); // Alice=95
});

// -- Sort desc --

test('sort by score desc: Alice first (95), Charlie second (80), Bob third (70)', () => {
  const result = applySortAndFilters(rows, { key: 'score', dir: 'desc' }, {}, columns);
  assert.strictEqual(result[0].id, 'b'); // Alice 95
  assert.strictEqual(result[1].id, 'a'); // Charlie 80
  assert.strictEqual(result[2].id, 'c'); // Bob 70
  assert.strictEqual(result[3].id, 'd'); // Dave null — bottom
});

// -- Sort by string column --

test('sort by name asc: alphabetical order', () => {
  const result = applySortAndFilters(rows, { key: 'name', dir: 'asc' }, {}, columns);
  const names = result.map((r) => r.name);
  // Alice, Bob, Charlie, Dave
  assert.strictEqual(names[0], 'Alice');
  assert.strictEqual(names[1], 'Bob');
  assert.strictEqual(names[2], 'Charlie');
  assert.strictEqual(names[3], 'Dave');
});

// -- Bad column key: silently ignore --

test('bad sort key: silently ignored (no sort applied, no throw)', () => {
  const result = applySortAndFilters(rows, { key: 'nonexistent', dir: 'asc' }, {}, columns);
  // Original order preserved (no sort)
  assert.deepStrictEqual(result.map((r) => r.id), rows.map((r) => r.id));
});

// -- Column with no getValue: comparator receives undefined for both sides → 0 --

test('column without getValue: sort does not reorder (comparator returns 0)', () => {
  const colNoGet: ColumnDef<Item> = { key: 'extra', label: 'Extra', sortable: true };
  const colsWithNoGet: ColumnDef<Item>[] = [colName, colScore, colNoGet];
  const original = rows.map((r) => r.id);
  const result = applySortAndFilters(rows, { key: 'extra', dir: 'asc' }, {}, colsWithNoGet);
  // All comparisons return 0 (undefined vs undefined → aIsNull, bIsNull → 0)
  assert.deepStrictEqual(result.map((r) => r.id), original);
});

// ---------------------------------------------------------------------------
// Stability check — equal sort keys preserve insertion order across flips
// ---------------------------------------------------------------------------

console.log('\n── stability check ──');

test('stability: equal-key rows preserve insertion order', () => {
  type Tied = { id: string; score: number };
  const tiedCol: ColumnDef<Tied> = {
    key: 'score',
    label: 'Score',
    sortable: true,
    getValue: (r) => r.score,
  };
  const tiedRows: Tied[] = [
    { id: 'first', score: 5 },
    { id: 'second', score: 5 },
    { id: 'third', score: 5 },
  ];

  const asc = applySortAndFilters(tiedRows, { key: 'score', dir: 'asc' }, {}, [tiedCol]);
  assert.deepStrictEqual(
    asc.map((r) => r.id),
    ['first', 'second', 'third'],
    'asc preserves insertion order for tied rows',
  );

  const desc = applySortAndFilters(tiedRows, { key: 'score', dir: 'desc' }, {}, [tiedCol]);
  assert.deepStrictEqual(
    desc.map((r) => r.id),
    ['first', 'second', 'third'],
    'desc also preserves insertion order for tied rows (stable sort)',
  );

  // Flip asc → desc → asc and confirm order is consistent
  const ascAgain = applySortAndFilters(tiedRows, { key: 'score', dir: 'asc' }, {}, [tiedCol]);
  assert.deepStrictEqual(
    ascAgain.map((r) => r.id),
    ['first', 'second', 'third'],
    'second asc flip still preserves insertion order',
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n── Results: ${passCount} passed, ${failCount} failed ──\n`);

if (failCount > 0) {
  process.exit(1);
}
