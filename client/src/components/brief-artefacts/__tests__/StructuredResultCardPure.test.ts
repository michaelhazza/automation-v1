/**
 * Pure-function tests for StructuredResultCardPure.
 * Run via: npx tsx client/src/components/brief-artefacts/__tests__/StructuredResultCardPure.test.ts
 */

import { expect, test } from 'vitest';
import { deriveColumns, deriveTruncationNotice } from '../StructuredResultCardPure.js';

// ---------------------------------------------------------------------------
// deriveColumns
// ---------------------------------------------------------------------------

test('returns explicit columns when provided', () => {
  const result = deriveColumns({
    columns: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }],
    rows: [{ name: 'Alice', email: 'alice@example.com' }],
  });
  expect(result.length).toBe(2);
  expect(result[0].key).toBe('name');
  expect(result[0].label).toBe('Name');
});

test('falls back to row keys when columns is empty and rows exist', () => {
  const result = deriveColumns({
    columns: [],
    rows: [{ id: '1', title: 'Task A', status: 'open' }],
  });
  expect(result.length).toBe(3);
  expect(result.map((c) => c.key)).toEqual(['id', 'title', 'status']);
  expect(result.map((c) => c.label)).toEqual(['id', 'title', 'status']);
});

test('falls back to row keys when columns is undefined and rows exist', () => {
  const result = deriveColumns({
    columns: undefined,
    rows: [{ foo: 1, bar: 2 }],
  } as Parameters<typeof deriveColumns>[0]);
  expect(result.length).toBe(2);
});

test('returns empty array when both columns and rows are empty', () => {
  const result = deriveColumns({ columns: [], rows: [] });
  expect(result.length).toBe(0);
});

test('returns empty array when columns is undefined and rows is empty', () => {
  const result = deriveColumns({ columns: undefined, rows: [] } as Parameters<typeof deriveColumns>[0]);
  expect(result.length).toBe(0);
});

// ---------------------------------------------------------------------------
// deriveTruncationNotice
// ---------------------------------------------------------------------------

test('returns null when not truncated', () => {
  const notice = deriveTruncationNotice({ truncated: false, rows: Array(5), rowCount: 5 });
  expect(notice).toBe(null);
});

test('returns notice string when truncated', () => {
  const notice = deriveTruncationNotice({ truncated: true, rows: Array(10), rowCount: 100 });
  expect(notice).toBe('Showing 10 of 100 results');
});

test('returns null when truncated is undefined', () => {
  const notice = deriveTruncationNotice({ truncated: undefined, rows: [], rowCount: 0 } as unknown as Parameters<typeof deriveTruncationNotice>[0]);
  expect(notice).toBe(null);
});
