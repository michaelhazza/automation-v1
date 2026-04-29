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

// --- Case 1: 2xx path — emits fire after flushAll ---
{
  const store = createPostCommitStore('test-req-2xx');
  const fired: string[] = [];

  // Simulate what briefConversationWriter does inside a route handler:
  await runWithPostCommitStore(store, async () => {
    const s = getPostCommitStore()!;
    s.enqueue(() => fired.push('conversation-update'));
    s.enqueue(() => fired.push('artefact-new'));
  });

  assert.deepStrictEqual(fired, [], '2xx: emits not fired before res.finish');

  // Simulate middleware res.on('finish') with 2xx status
  store.flushAll();

  assert.deepStrictEqual(
    fired,
    ['conversation-update', 'artefact-new'],
    '2xx: both emits fire after flushAll (res.finish 200)',
  );
  assert.ok(store.isClosed, '2xx: store closed after flushAll');
}

// --- Case 2: 5xx path — emits dropped on reset ---
{
  const store = createPostCommitStore('test-req-5xx');
  const fired: string[] = [];

  await runWithPostCommitStore(store, async () => {
    const s = getPostCommitStore()!;
    s.enqueue(() => fired.push('conversation-update'));
    s.enqueue(() => fired.push('artefact-new'));
  });

  assert.deepStrictEqual(fired, [], '5xx: emits not fired before res.finish');
  assert.strictEqual(store.pendingCount, 2, '5xx: 2 emits pending before reset');

  // Simulate middleware res.on('finish') with 5xx status — calls reset()
  store.reset();

  assert.deepStrictEqual(fired, [], '5xx: NO emits fired after reset (ghost-emit prevention)');
  assert.ok(store.isClosed, '5xx: store closed after reset');
  assert.strictEqual(store.pendingCount, 0, '5xx: queue cleared by reset');
}
