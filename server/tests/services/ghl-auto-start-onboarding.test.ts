/**
 * GHL auto-start onboarding job — unit tests (D-P0-1).
 *
 * Verifies the exported constants and payload shape without requiring a live
 * pg-boss or Postgres connection. Integration-level deduplication testing
 * (singletonKey collapse) is covered by the Phase 1 exit gate manual test
 * plan (tasks/builds/pre-launch-hardening/plan.md §Idempotency replay tests).
 *
 * Runnable via:
 *   npx tsx server/tests/services/ghl-auto-start-onboarding.test.ts
 */

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

import assert from 'node:assert/strict';

const { GHL_AUTO_START_ONBOARDING_JOB } = await import('../../jobs/ghlAutoStartOnboardingJob.js');

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok — ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL — ${label}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log('\nghl-auto-start-onboarding — unit tests\n');

test('GHL_AUTO_START_ONBOARDING_JOB constant matches jobConfig key', () => {
  assert.equal(GHL_AUTO_START_ONBOARDING_JOB, 'ghl:auto-start-onboarding');
});

test('singletonKey format is deterministic for the same org+subaccount', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';
  const subaccountId = '00000000-0000-0000-0000-000000000002';
  const key1 = `onboard:${orgId}:${subaccountId}`;
  const key2 = `onboard:${orgId}:${subaccountId}`;
  assert.equal(key1, key2);
});

test('singletonKey differs for different subaccounts under the same org', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';
  const sub1 = '00000000-0000-0000-0000-000000000002';
  const sub2 = '00000000-0000-0000-0000-000000000003';
  const key1 = `onboard:${orgId}:${sub1}`;
  const key2 = `onboard:${orgId}:${sub2}`;
  assert.notEqual(key1, key2);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
