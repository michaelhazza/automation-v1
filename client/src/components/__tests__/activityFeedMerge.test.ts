// client/src/components/__tests__/activityFeedMerge.test.ts
import assert from 'node:assert';

// Import fails until mergeActivityItems is exported from UnifiedActivityFeed in Task 7.
import { mergeActivityItems } from '../UnifiedActivityFeed.js';

type Item = { id: string; updatedAt: string; subject: string };

const item = (id: string, updatedAt: string, subject = 'x'): Item =>
  ({ id, updatedAt, subject });

// Scenario 1: new item not in existing list — prepended at top
{
  const existing: Item[] = [item('b', '2026-04-27T10:00:01.000Z')];
  const incoming: Item[] = [item('a', '2026-04-27T10:00:02.000Z')];
  const result = mergeActivityItems(existing, incoming);
  assert.strictEqual(result[0].id, 'a', 'new item should be prepended');
  assert.strictEqual(result[1].id, 'b', 'existing item should follow');
  assert.strictEqual(result.length, 2, 'no duplicates');
}

// Scenario 2: same ID, newer updatedAt — replaces existing row in-place
{
  const existing: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'old')];
  const incoming: Item[] = [item('a', '2026-04-27T10:00:01.000Z', 'new')];
  const result = mergeActivityItems(existing, incoming);
  assert.strictEqual(result.length, 1, 'no duplicates on update');
  assert.strictEqual(result[0].subject, 'new', 'updated row should replace old');
}

// Scenario 3: same ID, equal updatedAt — existing row unchanged
{
  const existing: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'old')];
  const incoming: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'new')];
  const result = mergeActivityItems(existing, incoming);
  assert.strictEqual(result[0].subject, 'old', 'equal updatedAt: existing row unchanged');
}

// Scenario 4: same ID, older updatedAt — existing row unchanged
{
  const existing: Item[] = [item('a', '2026-04-27T10:00:01.000Z', 'old')];
  const incoming: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'stale')];
  const result = mergeActivityItems(existing, incoming);
  assert.strictEqual(result[0].subject, 'old', 'older updatedAt: existing row unchanged');
}

// Scenario 5: overlapping IDs in two responses — no duplicates
{
  const existing: Item[] = [item('a', '2026-04-27T10:00:00.000Z'), item('b', '2026-04-27T10:00:00.000Z')];
  const incoming: Item[] = [item('b', '2026-04-27T10:00:01.000Z'), item('c', '2026-04-27T10:00:01.000Z')];
  const result = mergeActivityItems(existing, incoming);
  const ids = result.map(r => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate IDs');
  assert.ok(ids.includes('a') && ids.includes('b') && ids.includes('c'), 'all IDs present');
}

console.log('✓ mergeActivityItems tests passed');
