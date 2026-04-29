/**
 * postCommitEmitter.test.ts
 *
 * Runnable via:
 *   npx tsx server/lib/__tests__/postCommitEmitter.test.ts
 *
 * 8 cases per spec §1.2 Tests.
 */

import { expect, test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  createPostCommitStore,
  getPostCommitStore,
  runWithPostCommitStore,
} from '../postCommitEmitter.js';

// Case 1: enqueue → flushAll fires emit exactly once; store closes
test('case 1: enqueue → flushAll fires emit exactly once; store closes', () => {
  const store = createPostCommitStore('req-1');
  let called = 0;
  store.enqueue(() => { called++; });
  assert.strictEqual(called, 0, 'case 1: emit not fired before flushAll');
  store.flushAll();
  assert.strictEqual(called, 1, 'case 1: emit fired exactly once by flushAll');
  assert.ok(store.isClosed, 'case 1: store closed after flushAll');
});

// Case 2: enqueue → reset drops emit; store closes
test('case 2: enqueue → reset drops emit; store closes', () => {
  const store = createPostCommitStore('req-2');
  let called = 0;
  store.enqueue(() => { called++; });
  store.reset();
  assert.strictEqual(called, 0, 'case 2: emit NOT fired on reset');
  assert.ok(store.isClosed, 'case 2: store closed after reset');
});

// Case 3: flushAll after reset is a no-op (idempotent)
test('case 3: flushAll after reset is a no-op (idempotent)', () => {
  const store = createPostCommitStore('req-3');
  let called = 0;
  store.enqueue(() => { called++; });
  store.reset();
  store.flushAll(); // second terminal call — no-op
  assert.strictEqual(called, 0, 'case 3: flushAll after reset invokes nothing');
  assert.ok(store.isClosed, 'case 3: store still closed');
});

// Case 4: flushAll with throwing emit — second emit still runs (best-effort)
test('case 4: flushAll with throwing emit — second emit still runs (best-effort)', () => {
  const store = createPostCommitStore('req-4');
  let secondCalled = false;
  store.enqueue(() => { throw new Error('boom'); });
  store.enqueue(() => { secondCalled = true; });
  store.flushAll(); // must not throw despite first emit throwing
  assert.ok(secondCalled, 'case 4: second emit runs despite first throwing');
  assert.ok(store.isClosed, 'case 4: store closed after error in emit');
});

// Case 5: closed-state fallback — flushAll then enqueue fires immediately
test('case 5: closed-state fallback — flushAll then enqueue fires immediately', () => {
  const store = createPostCommitStore('req-5');
  store.flushAll(); // close with empty queue
  let immediatelyCalled = false;
  store.enqueue(() => { immediatelyCalled = true; });
  assert.ok(immediatelyCalled, 'case 5: enqueue on closed store fires emit immediately');
  assert.ok(store.isClosed, 'case 5: isClosed remains true after closed-state enqueue');
});

// Case 6: reset-then-enqueue closed-state fallback (same invariant, reset path)
test('case 6: reset-then-enqueue closed-state fallback (same invariant, reset path)', () => {
  const store = createPostCommitStore('req-6');
  store.reset();
  let immediatelyCalled = false;
  store.enqueue(() => { immediatelyCalled = true; });
  assert.ok(immediatelyCalled, 'case 6: enqueue after reset fires emit immediately');
  assert.ok(store.isClosed, 'case 6: isClosed remains true');
});

// Case 7: runWithPostCommitStore binds store to async context
test('case 7: runWithPostCommitStore binds store to async context', async () => {
  assert.strictEqual(getPostCommitStore(), null, 'case 7: no store before run');
  const store = createPostCommitStore('req-7');
  await runWithPostCommitStore(store, async () => {
    assert.strictEqual(getPostCommitStore(), store, 'case 7: store visible inside callback');
  });
  assert.strictEqual(getPostCommitStore(), null, 'case 7: no store after run exits');
});

// Case 8: concurrent requests get isolated stores (no ALS bleed)
test('case 8: concurrent requests get isolated stores (no ALS bleed)', async () => {
  const storeA = createPostCommitStore('req-8a');
  const storeB = createPostCommitStore('req-8b');
  const log: string[] = [];

  await Promise.all([
    runWithPostCommitStore(storeA, async () => {
      getPostCommitStore()!.enqueue(() => log.push('A'));
      // Yield to let storeB's context run concurrently
      await new Promise<void>((r) => setTimeout(r, 10));
      assert.strictEqual(getPostCommitStore(), storeA, 'case 8: context A not leaked after yield');
    }),
    runWithPostCommitStore(storeB, async () => {
      getPostCommitStore()!.enqueue(() => log.push('B'));
      assert.strictEqual(getPostCommitStore(), storeB, 'case 8: context B not leaked');
    }),
  ]);

  storeA.flushAll();
  storeB.flushAll();
  assert.deepStrictEqual(log.sort(), ['A', 'B'], 'case 8: both stores flush independently');
});
