/**
 * briefConversationWriterPostCommit.integration.test.ts
 *
 * Verifies the post-commit emit lifecycle:
 *   - Emits enqueued inside a bound store are deferred until the middleware
 *     calls flushAll (simulating res.finish on a 2xx response).
 *   - On a 4xx/5xx response the middleware calls reset() — enqueued emits
 *     are dropped (no websocket events fire).
 *
 * This test simulates the middleware lifecycle without a real DB or HTTP
 * server. The briefConversationWriter path is exercised via direct
 * getPostCommitStore() calls to isolate the emit-deferral contract.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/briefConversationWriterPostCommit.integration.test.ts
 */

import { expect, test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  createPostCommitStore,
  getPostCommitStore,
  runWithPostCommitStore,
} from '../../lib/postCommitEmitter.js';

test('case 1: 2xx path — emits fire after flushAll', async () => {
  const store = createPostCommitStore('test-req-2xx');
  const fired: string[] = [];

  await runWithPostCommitStore(store, async () => {
    const s = getPostCommitStore()!;
    s.enqueue(() => fired.push('conversation-update'));
    s.enqueue(() => fired.push('artefact-new'));
  });

  assert.deepStrictEqual(fired, []);
  store.flushAll();
  assert.deepStrictEqual(fired, ['conversation-update', 'artefact-new']);
  assert.ok(store.isClosed);
});

test('case 2: 5xx path — emits dropped on reset', async () => {
  const store = createPostCommitStore('test-req-5xx');
  const fired: string[] = [];

  await runWithPostCommitStore(store, async () => {
    const s = getPostCommitStore()!;
    s.enqueue(() => fired.push('conversation-update'));
    s.enqueue(() => fired.push('artefact-new'));
  });

  assert.deepStrictEqual(fired, []);
  assert.strictEqual(store.pendingCount, 2);
  store.reset();
  assert.deepStrictEqual(fired, []);
  assert.ok(store.isClosed);
  assert.strictEqual(store.pendingCount, 0);
});
