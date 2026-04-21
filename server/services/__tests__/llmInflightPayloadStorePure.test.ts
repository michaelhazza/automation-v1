import { strict as assert } from 'node:assert';
import { test } from 'node:test';
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
  assert.ok(snap);
  assert.equal(snap.truncated, false);
  assert.deepEqual(snap.messages, tinyMessages('a'));
  assert.match(snap.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('payload store — get returns null when missing', () => {
  _resetForTests();
  assert.equal(get('rt_missing'), null);
});

test('payload store — remove clears the entry', () => {
  _resetForTests();
  set('rt_1', { messages: tinyMessages('a') });
  assert.ok(get('rt_1'));
  remove('rt_1');
  assert.equal(get('rt_1'), null);
});

test('payload store — LRU eviction when above MAX_PAYLOAD_SNAPSHOTS', () => {
  _resetForTests();
  // Fill the store to cap.
  for (let i = 0; i < MAX_PAYLOAD_SNAPSHOTS; i++) {
    set(`rt_${i}`, { messages: tinyMessages(String(i)) });
  }
  assert.equal(_size(), MAX_PAYLOAD_SNAPSHOTS);
  // Adding one more evicts the oldest (rt_0).
  set('rt_new', { messages: tinyMessages('new') });
  assert.equal(_size(), MAX_PAYLOAD_SNAPSHOTS);
  assert.equal(get('rt_0'), null, 'oldest entry should have been evicted');
  assert.ok(get('rt_new'));
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
  assert.ok(get('rt_0'), 'touched entry should survive eviction');
  assert.equal(get('rt_1'), null, 'next-oldest should have been evicted');
});

test('payload store — truncates oversized payloads', () => {
  _resetForTests();
  // Build messages that serialise above MAX_PAYLOAD_BYTES.
  const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 1000);
  set('rt_huge', { messages: [{ role: 'user', content: huge }] });
  const snap = get('rt_huge');
  assert.ok(snap);
  assert.equal(snap.truncated, true, 'oversized payload should be truncated');
  assert.equal(snap.messages, null, 'messages dropped on truncation');
});

test('payload store — set never throws on bad input', () => {
  _resetForTests();
  // Circular reference would break JSON.stringify — should be caught.
  const circular: Record<string, unknown> = { self: null };
  circular.self = circular;
  assert.doesNotThrow(() => set('rt_circular', { messages: circular }));
});
