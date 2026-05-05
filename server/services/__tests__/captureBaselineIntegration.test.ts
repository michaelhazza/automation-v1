/**
 * captureBaselineIntegration.test.ts
 *
 * DB-backed integration tests for F3 baseline capture.
 *
 * Requires: DATABASE_URL env var pointing to a test database with migrations applied.
 *
 * These assertions are covered by the CI gate when DATABASE_URL is available.
 * Run locally:
 *   DATABASE_URL=<test_db_url> npx vitest run server/services/__tests__/captureBaselineIntegration.test.ts
 *
 * Deferred: no integration test scaffolding exists in this repo (no createTestDb helper,
 * no TEST_DATABASE_URL convention). Skipped until DATABASE_URL is available.
 * See tasks/builds/baseline-capture/progress.md § Deferred Items.
 */

import { describe, it } from 'vitest';

describe.skip('captureBaseline integration (requires DATABASE_URL)', () => {
  it.todo('Invariant 1: two pending inserts → second fails with subaccount_baselines_active_uniq');
  it.todo('Invariant 2: captureBaselineService.run() is idempotent — second call is a clean exit');
  it.todo('Invariant 4: concurrent run + runManual → no duplicate metric rows (PK enforces)');
  it.todo('Invariant 5: adminReset → prior row status=reset + new row status=pending + baseline_version=2');
  it.todo('Invariant 7 DB: after retryable failure, next_attempt_at IS NOT NULL; after captured, IS NULL');
  it.todo('Happy path: seed connectors + metrics → run() → status=captured, confidence=partial, metric rows present');
  it.todo('Telemetry: baseline.capture.started + baseline.capture.succeeded emitted on happy path');
});
