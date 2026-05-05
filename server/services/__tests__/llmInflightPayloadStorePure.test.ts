import { expect, test } from 'vitest';
import {
  MAX_PAYLOAD_SNAPSHOTS,
  MAX_PAYLOAD_BYTES,
  _resetForTests,
  _size,
  get,
  remove,
  set,
} from '../llmInflightPayloadStore.js';

// ---------------------------------------------------------------------------
// Pins the LRU semantics + byte-cap truncation of the payload snapshot
// store (deferred-items brief §7). The store is a plain in-memory Map, no
// env or DB — these tests exercise the eviction + truncation invariants
// that protect against runaway memory use under load.
// ---------------------------------------------------------------------------

function tinyMessages(tag: string): unknown {
  return [{ role: 'user', content: `hello ${tag}` }];
}

test('payload store — set + get round-trip', () => {
  _resetForTests();
  set('rt_1', { messages: tinyMessages('a') });
  const snap = get('rt_1');
  expect(snap).toBeTruthy();
  expect(snap!.truncated).toBe(false);
  expect(snap!.messages).toEqual(tinyMessages('a'));
  expect(snap!.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('payload store — get returns null when missing', () => {
  _resetForTests();
  expect(get('rt_missing')).toBe(null);
});

test('payload store — remove clears the entry', () => {
  _resetForTests();
  set('rt_1', { messages: tinyMessages('a') });
  expect(get('rt_1')).toBeTruthy();
  remove('rt_1');
  expect(get('rt_1')).toBe(null);
});

test('payload store — LRU eviction when above MAX_PAYLOAD_SNAPSHOTS', () => {
  _resetForTests();
  // Fill the store to cap.
  for (let i = 0; i < MAX_PAYLOAD_SNAPSHOTS; i++) {
    set(`rt_${i}`, { messages: tinyMessages(String(i)) });
  }
  expect(_size()).toBe(MAX_PAYLOAD_SNAPSHOTS);
  // Adding one more evicts the oldest (rt_0).
  set('rt_new', { messages: tinyMessages('new') });
  expect(_size()).toBe(MAX_PAYLOAD_SNAPSHOTS);
  expect(get('rt_0'), 'oldest entry should have been evicted').toBe(null);
  expect(get('rt_new')).toBeTruthy();
});

test('payload store — touching via get refreshes LRU position', () => {
  _resetForTests();
  for (let i = 0; i < MAX_PAYLOAD_SNAPSHOTS; i++) {
    set(`rt_${i}`, { messages: tinyMessages(String(i)) });
  }
  // Touch rt_0 via get — moves it to most-recently-used position.
  get('rt_0');
  // Next set evicts rt_1 (now oldest) instead of rt_0.
  set('rt_new', { messages: tinyMessages('new') });
  expect(get('rt_0')).toBeTruthy();
  expect(get('rt_1'), 'next-oldest should have been evicted').toBe(null);
});

test('payload store — truncates oversized payloads', () => {
  _resetForTests();
  // Build messages that serialise above MAX_PAYLOAD_BYTES.
  const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 1000);
  set('rt_huge', { messages: [{ role: 'user', content: huge }] });
  const snap = get('rt_huge');
  expect(snap).toBeTruthy();
  expect(snap!.truncated, 'oversized payload should be truncated').toBe(true);
  expect(snap!.messages, 'messages dropped on truncation').toBe(null);
});

test('payload store — truncation surfaces originalSizeBytes', () => {
  // Reviewer follow-up (2026-04-21): the admin drawer needs to know HOW
  // big the dropped payload actually was so operators can decide
  // whether raising the cap is worthwhile or the call itself is
  // pathological. originalSizeBytes MUST be populated on truncation
  // and MUST be null when the payload fit normally.
  _resetForTests();
  const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 1000);
  set('rt_huge', { messages: [{ role: 'user', content: huge }] });
  const snap = get('rt_huge');
  expect(snap).toBeTruthy();
  expect(snap!.truncated).toBe(true);
  expect(typeof snap!.originalSizeBytes).toBe('number');
  expect(snap!.originalSizeBytes! > MAX_PAYLOAD_BYTES).toBeTruthy();
});

test('payload store — non-truncated payloads carry originalSizeBytes: null', () => {
  _resetForTests();
  set('rt_small', { messages: tinyMessages('a') });
  const snap = get('rt_small');
  expect(snap).toBeTruthy();
  expect(snap!.truncated).toBe(false);
  expect(snap!.originalSizeBytes, 'originalSizeBytes is null when truncated=false — the payload itself is the truth').toBe(null);
});

test('payload store — set never throws on bad input', () => {
  _resetForTests();
  // Circular reference would break JSON.stringify — should be caught.
  const circular: Record<string, unknown> = { self: null };
  circular.self = circular;
  expect(() => set('rt_circular', { messages: circular })).not.toThrow();
});
