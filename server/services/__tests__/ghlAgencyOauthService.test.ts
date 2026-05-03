/**
 * ghlAgencyOauthService.test.ts — in-process callback round-trip test.
 * Run: npx vitest run server/services/__tests__/ghlAgencyOauthService.test.ts
 */
import { test, expect } from 'vitest';
import { validateAgencyTokenResponse, computeAgencyTokenExpiresAt } from '../ghlAgencyOauthServicePure.js';

// ── Callback flow pure logic: token parsing + validation ──────────────────

test('callback flow: valid Company token passes validation', () => {
  const mockResponse = {
    access_token: 'eyJ.agency.tok',
    refresh_token: 'eyJ.refresh',
    expires_in: 86399,
    scope: 'contacts.readonly companies.readonly',
    userType: 'Company',
    companyId: 'co_test123',
    userId: 'user_456',
    locationId: null,
  };
  expect(() => validateAgencyTokenResponse(mockResponse)).not.toThrow();
});

test('callback flow: expiresAt is 86399s after claimedAt', () => {
  const claimedAt = new Date('2026-05-03T10:00:00Z');
  const expiresAt = computeAgencyTokenExpiresAt(claimedAt, 86399);
  const diffSeconds = (expiresAt.getTime() - claimedAt.getTime()) / 1000;
  expect(diffSeconds).toBe(86399);
});

test('callback flow: Location token rejected', () => {
  const mockResponse = {
    access_token: 'eyJ.loc.tok',
    refresh_token: 'eyJ.refresh',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Location',
    companyId: 'co_test123',
  };
  expect(() => validateAgencyTokenResponse(mockResponse as Parameters<typeof validateAgencyTokenResponse>[0])).toThrow('Company');
});
