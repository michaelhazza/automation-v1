/**
 * postCommitEmitter.test.ts
 *
 * Runnable via:
 *   npx tsx server/lib/__tests__/postCommitEmitter.test.ts
 *
 * 8 cases per spec §1.2 Tests.
 */

import { expect, test } from 'vitest';
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
  expect(called).toBe(0);
  store.flushAll();
  expect(called).toBe(1);
  expect(store.isClosed).toBeTruthy();
});

// Case 2: enqueue → reset drops emit; store closes
test('case 2: enqueue → reset drops emit; store closes', () => {
  const store = createPostCommitStore('req-2');
  let called = 0;
  store.enqueue(() => { called++; });
  store.reset();
  expect(called).toBe(0);
  expect(store.isClosed).toBeTruthy();
});

// Case 3: flushAll after reset is a no-op (idempotent)
test('case 3: flushAll after reset is a no-op (idempotent)', () => {
  const store = createPostCommitStore('req-3');
  let called = 0;
  store.enqueue(() => { called++; });
  store.reset();
  store.flushAll(); // second terminal call — no-op
  expect(called).toBe(0);
  expect(store.isClosed).toBeTruthy();
});

// Case 4: flushAll with throwing emit — second emit still runs (best-effort)
test('case 4: flushAll with throwing emit — second emit still runs (best-effort)', () => {
  const store = createPostCommitStore('req-4');
  let secondCalled = false;
  store.enqueue(() => { throw new Error('boom'); });
  store.enqueue(() => { secondCalled = true; });
  store.flushAll(); // must not throw despite first emit throwing
  expect(secondCalled).toBeTruthy();
  expect(store.isClosed).toBeTruthy();
});

// Case 5: closed-state fallback — flushAll then enqueue fires immediately
test('case 5: closed-state fallback — flushAll then enqueue fires immediately', () => {
  const store = createPostCommitStore('req-5');
  store.flushAll(); // close with empty queue
  let immediatelyCalled = false;
  store.enqueue(() => { immediatelyCalled = true; });
  expect(immediatelyCalled).toBeTruthy();
  expect(store.isClosed).toBeTruthy();
});

// Case 6: reset-then-enqueue closed-state fallback (same invariant, reset path)
test('case 6: reset-then-enqueue closed-state fallback (same invariant, reset path)', () => {
  const store = createPostCommitStore('req-6');
  store.reset();
  let immediatelyCalled = false;
  store.enqueue(() => { immediatelyCalled = true; });
  expect(immediatelyCalled).toBeTruthy();
  expect(store.isClosed).toBeTruthy();
});

// Case 7: runWithPostCommitStore binds store to async context
test('case 7: runWithPostCommitStore binds store to async context', async () => {
  expect(getPostCommitStore()).toBe(null);
  const store = createPostCommitStore('req-7');
  await runWithPostCommitStore(store, async () => {
    expect(getPostCommitStore()).toBe(store);
  });
  expect(getPostCommitStore()).toBe(null);
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
      expect(getPostCommitStore()).toBe(storeA);
    }),
    runWithPostCommitStore(storeB, async () => {
      getPostCommitStore()!.enqueue(() => log.push('B'));
      expect(getPostCommitStore()).toBe(storeB);
    }),
  ]);

  storeA.flushAll();
  storeB.flushAll();
  expect(log.sort()).toEqual(['A', 'B']);
});
