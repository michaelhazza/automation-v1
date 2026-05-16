// guard-ignore-file: pure-helper-convention reason="dynamic import conditioned on NODE_ENV=integration to avoid loading the DB module in unit test runs"
/**
 * ghlOAuthStateStore — DB integration tests (S-P0-1, S-P0-2).
 *
 * Verifies:
 *  - Valid nonce returns the bound org
 *  - Unknown nonce returns null
 *  - Nonce is single-use (consume-once)
 *  - Concurrent consume — exactly one succeeds, the other returns null
 *
 * Requires NODE_ENV=integration (real Postgres). Skipped in unit test runs.
 */
import { expect, test, beforeEach } from 'vitest';

const SKIP = process.env.NODE_ENV !== 'integration';

import 'dotenv/config';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

let setGhlOAuthState: (nonce: string, organisationId: string, pendingRunId?: string) => Promise<void>;
let consumeGhlOAuthState: (nonce: string) => Promise<{ organisationId: string; pendingRunId: string | null } | null>;
let db: Awaited<typeof import('../../db/index.js')>['db'];
let oauthStateNonces: Awaited<typeof import('../../db/schema/oauthStateNonces.js')>['oauthStateNonces'];

if (!SKIP) {
  ({ setGhlOAuthState, consumeGhlOAuthState } = await import('../ghlOAuthStateStore.js'));
  ({ db } = await import('../../db/index.js'));
  ({ oauthStateNonces } = await import('../../db/schema/oauthStateNonces.js'));
}

import { CANONICAL_ORG_ID } from '../../__tests__/fixtures/canonicalIds';

const ORG_ID = CANONICAL_ORG_ID;

beforeEach(async () => {
  if (SKIP) return;
  await db.delete(oauthStateNonces);
});

test.skipIf(SKIP)('valid nonce returns the bound org', async () => {
  await setGhlOAuthState('nonce-abc', ORG_ID);
  const result = await consumeGhlOAuthState('nonce-abc');
  expect(result?.organisationId).toBe(ORG_ID);
});

test.skipIf(SKIP)('unknown nonce returns null', async () => {
  const result = await consumeGhlOAuthState('bad-nonce');
  expect(result).toBeNull();
});

test.skipIf(SKIP)('nonce is single-use — second consume returns null', async () => {
  await setGhlOAuthState('nonce-once', ORG_ID);
  await consumeGhlOAuthState('nonce-once');
  const second = await consumeGhlOAuthState('nonce-once');
  expect(second).toBeNull();
});

test.skipIf(SKIP)('concurrent consume — exactly one returns the org, one returns null', async () => {
  await setGhlOAuthState('nonce-race', ORG_ID);
  const [r1, r2] = await Promise.all([
    consumeGhlOAuthState('nonce-race'),
    consumeGhlOAuthState('nonce-race'),
  ]);
  const results = [r1, r2];
  const successes = results.filter(Boolean).length;
  const nulls = results.filter((r) => r === null).length;
  expect(successes).toBe(1);
  expect(nulls).toBe(1);
});
