/**
 * ghlAgencyOauthServicePure.test.ts
 * Run: npx tsx server/services/__tests__/ghlAgencyOauthServicePure.test.ts
 */
import { test, expect } from 'vitest';
import { OAUTH_PROVIDERS } from '../../config/oauthProviders.js';

const REQUIRED_SCOPES = [
  'contacts.readonly', 'contacts.write',
  'opportunities.readonly', 'opportunities.write',
  'locations.readonly', 'users.readonly',
  'calendars.readonly', 'funnels.readonly',
  'conversations.readonly', 'conversations.write',
  'conversations/message.readonly', 'businesses.readonly',
  'saas/subscription.readonly', 'companies.readonly',
  'payments/orders.readonly',
];

test('GHL scope list contains all 15 required scopes', () => {
  const configured = OAUTH_PROVIDERS.ghl.scopes;
  for (const s of REQUIRED_SCOPES) {
    expect(configured, `missing scope: ${s}`).toContain(s);
  }
  expect(configured.length, 'scope count').toBe(15);
});

import {
  computeAgencyTokenExpiresAt,
  validateAgencyTokenResponse,
  isAgencyTokenExpiringSoon,
  type AgencyTokenResponse,
} from '../ghlAgencyOauthServicePure.js';

// ── computeAgencyTokenExpiresAt ───────────────────────────────────────────

test('computeAgencyTokenExpiresAt: adds expires_in seconds to claimedAt', () => {
  const claimedAt = new Date('2026-05-01T10:00:00Z');
  const result = computeAgencyTokenExpiresAt(claimedAt, 86400);
  expect(result.toISOString()).toBe(new Date('2026-05-02T10:00:00Z').toISOString());
});

// ── isAgencyTokenExpiringSoon ─────────────────────────────────────────────

test('isAgencyTokenExpiringSoon: true when < 5 min remaining', () => {
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000); // 3 min
  expect(isAgencyTokenExpiringSoon(expiresAt)).toBe(true);
});

test('isAgencyTokenExpiringSoon: false when > 5 min remaining', () => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  expect(isAgencyTokenExpiringSoon(expiresAt)).toBe(false);
});

// ── validateAgencyTokenResponse ───────────────────────────────────────────

test('validateAgencyTokenResponse: accepts valid Company token', () => {
  const payload: AgencyTokenResponse = {
    access_token: 'tok_123',
    refresh_token: 'ref_456',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Company',
    companyId: 'co_abc',
  };
  expect(() => validateAgencyTokenResponse(payload)).not.toThrow();
});

test('validateAgencyTokenResponse: rejects userType !== Company', () => {
  const payload = {
    access_token: 'tok',
    refresh_token: 'ref',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Location',
    companyId: 'co_abc',
  } as unknown as AgencyTokenResponse;
  expect(() => validateAgencyTokenResponse(payload)).toThrow('userType');
});

test('validateAgencyTokenResponse: rejects missing companyId', () => {
  const payload = {
    access_token: 'tok',
    refresh_token: 'ref',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Company',
    companyId: '',
  } as AgencyTokenResponse;
  expect(() => validateAgencyTokenResponse(payload)).toThrow('companyId');
});
