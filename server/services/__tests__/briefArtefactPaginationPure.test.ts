/**
 * briefArtefactPaginationPure.test.ts — nextCursor decision logic.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/briefArtefactPaginationPure.test.ts
 */

import { expect, test } from 'vitest';
import { strict as assert } from 'node:assert';
import { computeNextCursor } from '../briefArtefactPaginationPure.js';
import { decodeCursor } from '../briefArtefactCursorPure.js';

const row = (i: number) => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
  createdAt: new Date(`2026-04-28T10:00:${String(i).padStart(2, '0')}.000Z`),
});

// N < L → no cursor (fewer rows than limit)
{
  const rows = [row(1), row(2), row(3)];
  const { items, nextCursor } = computeNextCursor(rows, 5);
  assert.strictEqual(nextCursor, null, 'fewer than limit → no cursor');
  assert.strictEqual(items.length, 3, 'items unchanged');
}

// N === L → no cursor (exactly limit, means no more rows existed)
{
  const rows = [row(1), row(2), row(3), row(4), row(5)];
  const { items, nextCursor } = computeNextCursor(rows, 5);
  assert.strictEqual(nextCursor, null, 'exactly limit → no cursor');
  assert.strictEqual(items.length, 5, 'items unchanged');
}

// N === L+1 → cursor from item at index L-1 (last kept row in DESC order)
{
  const rows = [row(6), row(5), row(4), row(3), row(2), row(1)]; // 6 rows, limit 5
  const { items, nextCursor } = computeNextCursor(rows, 5);
  assert.notStrictEqual(nextCursor, null, 'L+1 rows → cursor emitted');
  assert.strictEqual(items.length, 5, 'only limit rows kept');
  // Cursor should be from the last kept row (index 4 = row(2) in our DESC list)
  const decoded = decodeCursor(nextCursor!);
  assert.ok(decoded !== null, 'cursor is decodable');
  assert.strictEqual(decoded!.msgId, row(2).id, 'cursor points to last kept row');
  assert.strictEqual(decoded!.ts, row(2).createdAt.toISOString(), 'cursor ts is correct');
}

// Large page: 201 rows (200+1) → cursor from row at index 199
{
  const rows = Array.from({ length: 201 }, (_, i) => row(201 - i)); // DESC order
  const { items, nextCursor } = computeNextCursor(rows, 200);
  assert.notStrictEqual(nextCursor, null, '201 rows with limit 200 → cursor');
  assert.strictEqual(items.length, 200, 'exactly 200 items kept');
  const decoded = decodeCursor(nextCursor!);
  assert.ok(decoded !== null);
  assert.strictEqual(decoded!.msgId, items[199]!.id, 'cursor from last kept item');
}

// Limit of 1: exactly 1 row → no cursor
{
  const rows = [row(1)];
  const { items, nextCursor } = computeNextCursor(rows, 1);
  assert.strictEqual(nextCursor, null, 'exactly 1 row with limit 1 → no cursor');
  assert.strictEqual(items.length, 1);
}

// Limit of 1: 2 rows (1+1) → cursor
{
  const rows = [row(2), row(1)];
  const { items, nextCursor } = computeNextCursor(rows, 1);
  assert.notStrictEqual(nextCursor, null, '2 rows with limit 1 → cursor');
  assert.strictEqual(items.length, 1);
  const decoded = decodeCursor(nextCursor!);
  assert.ok(decoded !== null);
  assert.strictEqual(decoded!.msgId, row(2).id, 'cursor from the single kept row');
}
