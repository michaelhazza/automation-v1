/**
 * Pure-function tests for StructuredResultCardPure.
 * Run via: npx tsx client/src/components/brief-artefacts/__tests__/StructuredResultCardPure.test.ts
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deriveColumns, deriveTruncationNotice } from '../StructuredResultCardPure.js';

// ---------------------------------------------------------------------------
// deriveColumns
// ---------------------------------------------------------------------------

test('returns explicit columns when provided', () => {
  const result = deriveColumns({
    columns: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }],
    rows: [{ name: 'Alice', email: 'alice@example.com' }],
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].key, 'name');
  assert.equal(result[0].label, 'Name');
});

test('falls back to row keys when columns is empty and rows exist', () => {
  const result = deriveColumns({
    columns: [],
    rows: [{ id: '1', title: 'Task A', status: 'open' }],
  });
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((c) => c.key), ['id', 'title', 'status']);
  assert.deepEqual(result.map((c) => c.label), ['id', 'title', 'status']);
});

test('falls back to row keys when columns is undefined and rows exist', () => {
  const result = deriveColumns({
    columns: undefined,
    rows: [{ foo: 1, bar: 2 }],
  } as Parameters<typeof deriveColumns>[0]);
  assert.equal(result.length, 2);
});

test('returns empty array when both columns and rows are empty', () => {
  const result = deriveColumns({ columns: [], rows: [] });
  assert.equal(result.length, 0);
});

test('returns empty array when columns is undefined and rows is empty', () => {
  const result = deriveColumns({ columns: undefined, rows: [] } as Parameters<typeof deriveColumns>[0]);
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// deriveTruncationNotice
// ---------------------------------------------------------------------------

test('returns null when not truncated', () => {
  const notice = deriveTruncationNotice({ truncated: false, rows: Array(5), rowCount: 5 });
  assert.equal(notice, null);
});

test('returns notice string when truncated', () => {
  const notice = deriveTruncationNotice({ truncated: true, rows: Array(10), rowCount: 100 });
  assert.equal(notice, 'Showing 10 of 100 results');
});

test('returns null when truncated is undefined', () => {
  const notice = deriveTruncationNotice({ truncated: undefined, rows: [], rowCount: 0 } as unknown as Parameters<typeof deriveTruncationNotice>[0]);
  assert.equal(notice, null);
});
