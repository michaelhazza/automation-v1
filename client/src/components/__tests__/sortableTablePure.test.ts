/**
 * sortableTablePure.test.ts
 *
 * Pure-function tests for SortableTable helpers.
 * Run via vitest (CI) or `npx vitest run client/src/components/__tests__/sortableTablePure.test.ts` locally.
 */

import { test, expect } from 'vitest';
import {
  compareForSort,
  deriveFilterKey,
  applySortAndFilters,
  type ColumnDef,
} from '../sortableTablePure.js';

// ---------------------------------------------------------------------------
// compareForSort — string
// ---------------------------------------------------------------------------

test("'Apple' vs 'banana' under sensitivity:base → negative (Apple < banana)", () => {
  expect(compareForSort('Apple', 'banana', 'string')).toBeLessThan(0);
});

test("'banana' vs 'Apple' under sensitivity:base → positive", () => {
  expect(compareForSort('banana', 'Apple', 'string')).toBeGreaterThan(0);
});

test('equal strings → 0', () => {
  expect(compareForSort('foo', 'foo', 'string')).toBe(0);
});

// ---------------------------------------------------------------------------
// compareForSort — number
// ---------------------------------------------------------------------------

test('3 vs 10 → -7', () => {
  expect(compareForSort(3, 10, 'number')).toBe(-7);
});

test('10 vs 3 → 7', () => {
  expect(compareForSort(10, 3, 'number')).toBe(7);
});

test('equal numbers → 0', () => {
  expect(compareForSort(5, 5, 'number')).toBe(0);
});

// ---------------------------------------------------------------------------
// compareForSort — NaN guard (numeric hint but non-numeric value)
// ---------------------------------------------------------------------------

test("'abc' vs 'xyz' with hint:number → NaN guard fires, falls through to localeCompare", () => {
  // Number('abc') = NaN, so falls back to localeCompare('abc', 'xyz')
  // 'abc' < 'xyz' alphabetically → negative
  expect(compareForSort('abc', 'xyz', 'number')).toBeLessThan(0);
});

test("NaN inputs ('abc' and 'def') — hint:number falls to string compare", () => {
  // 'def' > 'abc' → positive
  expect(compareForSort('def', 'abc', 'number')).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// compareForSort — null/undefined handled by caller
// ---------------------------------------------------------------------------
// Note: compareForSort itself does not receive null in normal usage (applySortAndFilters
// intercepts null/undefined before calling it). These tests verify the documented
// caller contract and confirm no crash occurs if invoked with null directly.

// Null-to-bottom tests are covered more fully under applySortAndFilters below.
// Here we just confirm compareForSort doesn't throw on edge inputs.
test('compareForSort does not throw on undefined inputs (treated as strings)', () => {
  expect(() => compareForSort(undefined, 'foo', 'string')).not.toThrow();
});

// ---------------------------------------------------------------------------
// deriveFilterKey
// ---------------------------------------------------------------------------

test("string value 'hello' → 'hello'", () => {
  expect(deriveFilterKey('hello', 'name')).toBe('hello');
});

test('null → sentinel __NULL__::columnKey', () => {
  expect(deriveFilterKey(null, 'status')).toBe('__NULL__::status');
});

test('undefined → sentinel __NULL__::columnKey', () => {
  expect(deriveFilterKey(undefined, 'status')).toBe('__NULL__::status');
});

test('Date instance → String(date) (deterministic per JS spec)', () => {
  const d = new Date('2026-01-15T00:00:00.000Z');
  const result = deriveFilterKey(d, 'createdAt');
  expect(result).toBe(String(d));
  expect(result.length).toBeGreaterThan(0);
});

test('number value 42 → "42"', () => {
  expect(deriveFilterKey(42, 'count')).toBe('42');
});

test('empty string → empty string (not sentinel — empty string is a valid value)', () => {
  expect(deriveFilterKey('', 'label')).toBe('');
});

test('sentinel is column-scoped (two null columns produce distinct keys)', () => {
  const k1 = deriveFilterKey(null, 'colA');
  const k2 = deriveFilterKey(null, 'colB');
  expect(k1).not.toBe(k2);
});

// ---------------------------------------------------------------------------
// applySortAndFilters
// ---------------------------------------------------------------------------

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
  expect(result.length).toBe(4);
});

test('does not mutate input array', () => {
  const copy = [...rows];
  applySortAndFilters(rows, { key: 'score', dir: 'asc' }, {}, columns);
  expect(rows).toEqual(copy);
});

// -- Single-column filter --

test('single-column filter keeps only matching rows', () => {
  const filters: Record<string, Set<string>> = {
    name: new Set(['Alice', 'Bob']),
  };
  const result = applySortAndFilters(rows, null, filters, columns);
  expect(result.length).toBe(2);
  expect(result.some((r) => r.id === 'b')).toBe(true);
  expect(result.some((r) => r.id === 'c')).toBe(true);
});

// -- Multi-column AND --

test('multi-column filter: AND logic (row must pass all columns)', () => {
  const filters: Record<string, Set<string>> = {
    name: new Set(['Alice', 'Charlie']),
    score: new Set(['80']), // Only Charlie has score=80
  };
  const result = applySortAndFilters(rows, null, filters, columns);
  // Only Charlie passes both filters
  expect(result.length).toBe(1);
  expect(result[0].id).toBe('a');
});

// -- Sort + filter combined --

test('sort + filter combined: filter first, then sort result', () => {
  const filters: Record<string, Set<string>> = {
    name: new Set(['Alice', 'Charlie']),
  };
  const result = applySortAndFilters(rows, { key: 'score', dir: 'asc' }, filters, columns);
  expect(result.length).toBe(2);
  // Charlie=80, Alice=95 → asc by score: Charlie then Alice
  expect(result[0].id).toBe('a'); // Charlie
  expect(result[1].id).toBe('b'); // Alice
});

// -- Sort ascending --

test('sort by score asc: null goes to bottom', () => {
  const result = applySortAndFilters(rows, { key: 'score', dir: 'asc' }, {}, columns);
  const ids = result.map((r) => r.id);
  // Bob=70, Charlie=80, Alice=95, Dave=null
  expect(ids[0]).toBe('c'); // Bob 70
  expect(ids[1]).toBe('a'); // Charlie 80
  expect(ids[2]).toBe('b'); // Alice 95
  expect(ids[3]).toBe('d'); // Dave null — bottom
});

// -- Null-to-bottom in both directions --

test('null-to-bottom asc: null row always last', () => {
  const result = applySortAndFilters(rows, { key: 'score', dir: 'asc' }, {}, columns);
  expect(result[result.length - 1].id).toBe('d'); // Dave=null
});

test('null-to-bottom desc: null row still last (not moved to top)', () => {
  const result = applySortAndFilters(rows, { key: 'score', dir: 'desc' }, {}, columns);
  expect(result[result.length - 1].id).toBe('d'); // Dave=null
  // And first should be the highest non-null score
  expect(result[0].id).toBe('b'); // Alice=95
});

// -- Sort desc --

test('sort by score desc: Alice first (95), Charlie second (80), Bob third (70)', () => {
  const result = applySortAndFilters(rows, { key: 'score', dir: 'desc' }, {}, columns);
  expect(result[0].id).toBe('b'); // Alice 95
  expect(result[1].id).toBe('a'); // Charlie 80
  expect(result[2].id).toBe('c'); // Bob 70
  expect(result[3].id).toBe('d'); // Dave null — bottom
});

// -- Sort by string column --

test('sort by name asc: alphabetical order', () => {
  const result = applySortAndFilters(rows, { key: 'name', dir: 'asc' }, {}, columns);
  const names = result.map((r) => r.name);
  // Alice, Bob, Charlie, Dave
  expect(names[0]).toBe('Alice');
  expect(names[1]).toBe('Bob');
  expect(names[2]).toBe('Charlie');
  expect(names[3]).toBe('Dave');
});

// -- Bad column key: silently ignore --

test('bad sort key: silently ignored (no sort applied, no throw)', () => {
  const result = applySortAndFilters(rows, { key: 'nonexistent', dir: 'asc' }, {}, columns);
  // Original order preserved (no sort)
  expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id));
});

// -- Column with no getValue: comparator receives undefined for both sides → 0 --

test('column without getValue: sort does not reorder (comparator returns 0)', () => {
  const colNoGet: ColumnDef<Item> = { key: 'extra', label: 'Extra', sortable: true };
  const colsWithNoGet: ColumnDef<Item>[] = [colName, colScore, colNoGet];
  const original = rows.map((r) => r.id);
  const result = applySortAndFilters(rows, { key: 'extra', dir: 'asc' }, {}, colsWithNoGet);
  // All comparisons return 0 (undefined vs undefined → aIsNull, bIsNull → 0)
  expect(result.map((r) => r.id)).toEqual(original);
});

// ---------------------------------------------------------------------------
// Stability check — equal sort keys preserve insertion order across flips
// ---------------------------------------------------------------------------

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
  expect(asc.map((r) => r.id)).toEqual(['first', 'second', 'third']);

  const desc = applySortAndFilters(tiedRows, { key: 'score', dir: 'desc' }, {}, [tiedCol]);
  expect(desc.map((r) => r.id)).toEqual(['first', 'second', 'third']);

  // Flip asc → desc → asc and confirm order is consistent
  const ascAgain = applySortAndFilters(tiedRows, { key: 'score', dir: 'asc' }, {}, [tiedCol]);
  expect(ascAgain.map((r) => r.id)).toEqual(['first', 'second', 'third']);
});
