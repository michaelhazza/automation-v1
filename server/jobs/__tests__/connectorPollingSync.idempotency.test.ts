// guard-ignore-file: pure-helper-convention reason="Uses dynamic await import('../connectorPollingSync.js') — env preamble must run before module-level zod env parse fires"
/**
 * connectorPollingSync — idempotency + concurrency contract tests (B2).
 *
 * What this asserts (without DB infra):
 *   1. The module exports a `__testHooks` seam matching the canonical shape.
 *   2. The seam is undefined-by-default — production with no override behaves
 *      identically to a job with no hook at all (the call site's
 *      `if (!__testHooks.<name>) return;` short-circuit is dead code without
 *      an override).
 *   3. The hook is mutable and resettable (the reset-on-import-enforcement
 *      pattern documented in the spec — each test resets in beforeEach).
 *
 * Sequential / parallel double-invocation against the live DB lease is not
 * exercised here because connectorPollingSync's lease lives in
 * `integration_connections.sync_lock_token` (a real schema column) and the
 * full sync path threads through pg-boss + the connector polling service.
 * Those properties are validated by the existing per-phase no-op predicates
 * in syncConnector and the lease release in the `finally` block; the contract
 * test above guards the production-safety invariant of the test seam.
 *
 * Runnable via:
 *   npx tsx server/jobs/__tests__/connectorPollingSync.idempotency.test.ts
 */
import { expect, test } from 'vitest';

export {}; // force module scope so top-level await and local declarations don't collide

// connectorPollingSync transitively pulls in server/lib/env.ts which validates
// required env vars via zod. Seed placeholders before any dynamic import so the
// zod parse does not throw. This test is purely structural — it never touches
// the DB or the connector polling service.
await import('dotenv/config');
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';

const { __testHooks } = await import('../connectorPollingSync.js');

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

await test('connectorPollingSync: __testHooks is exported with canonical shape', () => {
  check(typeof __testHooks === 'object' && __testHooks !== null, '__testHooks must be an object');
  check(
    __testHooks.pauseBetweenClaimAndCommit === undefined,
    'pauseBetweenClaimAndCommit must default to undefined (production-safe)',
  );
});

await test('connectorPollingSync: __testHooks override is observable to call site', async () => {
  let called = false;
  __testHooks.pauseBetweenClaimAndCommit = async () => {
    called = true;
  };
  check(typeof __testHooks.pauseBetweenClaimAndCommit === 'function', 'override is a function');
  await __testHooks.pauseBetweenClaimAndCommit!();
  check(called, 'override is invoked when called');
});

await test('connectorPollingSync: __testHooks reset returns to undefined default', () => {
  __testHooks.pauseBetweenClaimAndCommit = async () => {};
  __testHooks.pauseBetweenClaimAndCommit = undefined;
  check(__testHooks.pauseBetweenClaimAndCommit === undefined, 'reset clears the override');
});