/**
 * oauth-state-security — DB integration tests for ghlOAuthStateStore.
 *
 * Tests require a live Postgres DB connection. Run via:
 *   npx tsx server/tests/services/oauth-state-security.test.ts
 *
 * Verifies: (S-P0-1, S-P0-2)
 *  - Valid nonce returns the bound org
 *  - Unknown nonce returns null
 *  - Nonce is single-use (consume-once)
 *  - Concurrent consume — exactly one succeeds, the other returns null
 */

import { setGhlOAuthState, consumeGhlOAuthState } from '../../lib/ghlOAuthStateStore.js';
import { db } from '../../db/index.js';
import { oauthStateNonces } from '../../db/schema/oauthStateNonces.js';

export {}; // make this a module

let passed = 0;
let failed = 0;

function ok(description: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}`);
    failed++;
  }
}

async function cleanup(): Promise<void> {
  await db.delete(oauthStateNonces);
}

async function testValidNonceReturnsOrg(): Promise<void> {
  await cleanup();
  await setGhlOAuthState('nonce-abc', '00000000-0000-0000-0000-000000000001');
  const result = await consumeGhlOAuthState('nonce-abc');
  ok('returns the bound org for a valid nonce', result?.organisationId === '00000000-0000-0000-0000-000000000001');
}

async function testUnknownNonceReturnsNull(): Promise<void> {
  await cleanup();
  const result = await consumeGhlOAuthState('bad-nonce');
  ok('returns null for an unknown nonce', result === null);
}

async function testOneShotConsume(): Promise<void> {
  await cleanup();
  await setGhlOAuthState('nonce-once', '00000000-0000-0000-0000-000000000001');
  await consumeGhlOAuthState('nonce-once');
  const second = await consumeGhlOAuthState('nonce-once');
  ok('is one-shot — second consume returns null', second === null);
}

async function testConcurrentConsume(): Promise<void> {
  await cleanup();
  await setGhlOAuthState('nonce-race', '00000000-0000-0000-0000-000000000001');
  const [r1, r2] = await Promise.all([
    consumeGhlOAuthState('nonce-race'),
    consumeGhlOAuthState('nonce-race'),
  ]);
  const results = [r1, r2];
  const successes = results.filter(Boolean).length;
  const nulls = results.filter(r => r === null).length;
  ok('concurrent consume — exactly one returns the org', successes === 1);
  ok('concurrent consume — exactly one returns null', nulls === 1);
}

async function main(): Promise<void> {
  console.log('oauth-state-security tests');
  try {
    await testValidNonceReturnsOrg();
    await testUnknownNonceReturnsNull();
    await testOneShotConsume();
    await testConcurrentConsume();
    await cleanup();
  } finally {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
