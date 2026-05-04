// client/src/components/__tests__/activityFeedMerge.test.ts
// Import fails until mergeActivityItems is exported from UnifiedActivityFeed in Task 7.
import { expect, test } from 'vitest';
import { mergeActivityItems } from '../UnifiedActivityFeed.js';

test('assertions', () => {
  type Item = { id: string; updatedAt: string; subject: string };
  
  const item = (id: string, updatedAt: string, subject = 'x'): Item =>
    ({ id, updatedAt, subject });
  
  // Scenario 1: new item not in existing list — prepended at top
  {
    const existing: Item[] = [item('b', '2026-04-27T10:00:01.000Z')];
    const incoming: Item[] = [item('a', '2026-04-27T10:00:02.000Z')];
    const result = mergeActivityItems(existing, incoming);
    expect(result[0].id, 'new item should be prepended').toBe('a');
    expect(result[1].id, 'existing item should follow').toBe('b');
    expect(result.length, 'no duplicates').toBe(2);
  }
  
  // Scenario 2: same ID, newer updatedAt — replaces existing row in-place
  {
    const existing: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'old')];
    const incoming: Item[] = [item('a', '2026-04-27T10:00:01.000Z', 'new')];
    const result = mergeActivityItems(existing, incoming);
    expect(result.length, 'no duplicates on update').toBe(1);
    expect(result[0].subject, 'updated row should replace old').toBe('new');
  }
  
  // Scenario 3: same ID, equal updatedAt — existing row unchanged
  {
    const existing: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'old')];
    const incoming: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'new')];
    const result = mergeActivityItems(existing, incoming);
    expect(result[0].subject, 'equal updatedAt: existing row unchanged').toBe('old');
  }
  
  // Scenario 4: same ID, older updatedAt — existing row unchanged
  {
    const existing: Item[] = [item('a', '2026-04-27T10:00:01.000Z', 'old')];
    const incoming: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'stale')];
    const result = mergeActivityItems(existing, incoming);
    expect(result[0].subject, 'older updatedAt: existing row unchanged').toBe('old');
  }
  
  // Scenario 5: overlapping IDs in two responses — no duplicates
  {
    const existing: Item[] = [item('a', '2026-04-27T10:00:00.000Z'), item('b', '2026-04-27T10:00:00.000Z')];
    const incoming: Item[] = [item('b', '2026-04-27T10:00:01.000Z'), item('c', '2026-04-27T10:00:01.000Z')];
    const result = mergeActivityItems(existing, incoming);
    const ids = result.map(r => r.id);
    expect(new Set(ids).size, 'no duplicate IDs').toBe(ids.length);
    expect(ids.includes('a') && ids.includes('b') && ids.includes('c')).toBeTruthy();
  }
});
