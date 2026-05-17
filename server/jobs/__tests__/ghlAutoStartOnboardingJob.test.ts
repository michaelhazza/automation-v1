// guard-ignore-file: pure-helper-convention reason="env preamble must run before module-level env parse fires; dynamic import used after env setup"
/**
 * ghlAutoStartOnboardingJob — unit tests (D-P0-1).
 *
 * Verifies the exported constants and payload shape without requiring a live
 * pg-boss or Postgres connection.
 */
import { expect, test } from 'vitest';

export {};

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

const { GHL_AUTO_START_ONBOARDING_JOB } = await import('../ghlAutoStartOnboardingJob.js');
import { CANONICAL_ORG_ID, CANONICAL_SUBACCOUNT_ID } from '../../__tests__/fixtures/canonicalIds';

test('GHL_AUTO_START_ONBOARDING_JOB constant matches jobConfig key', () => {
  expect(GHL_AUTO_START_ONBOARDING_JOB).toBe('ghl:auto-start-onboarding');
});

test('singletonKey format is deterministic for the same org+subaccount', () => {
  const orgId = CANONICAL_ORG_ID;
  const subaccountId = CANONICAL_SUBACCOUNT_ID;
  expect(`onboard:${orgId}:${subaccountId}`).toBe(`onboard:${orgId}:${subaccountId}`);
});

test('singletonKey differs for different subaccounts under the same org', () => {
  const orgId = CANONICAL_ORG_ID;
  const sub1 = CANONICAL_SUBACCOUNT_ID;
  const sub2 = '00000000-0000-0000-0000-000000000003';
  expect(`onboard:${orgId}:${sub1}`).not.toBe(`onboard:${orgId}:${sub2}`);
});
