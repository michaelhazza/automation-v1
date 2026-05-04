/**
 * locationTokenServicePure.test.ts
 * Run: npx vitest run server/services/__tests__/locationTokenServicePure.test.ts
 */
import { test, expect } from 'vitest';
import {
  isLocationTokenExpiringSoon,
  validateLocationTokenResponse,
  type LocationTokenResponse,
} from '../locationTokenServicePure.js';

test('isLocationTokenExpiringSoon: true when < 5 min remaining', () => {
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
  expect(isLocationTokenExpiringSoon(expiresAt)).toBe(true);
});

test('isLocationTokenExpiringSoon: false when > 5 min remaining', () => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  expect(isLocationTokenExpiringSoon(expiresAt)).toBe(false);
});

test('validateLocationTokenResponse: accepts valid Location token', () => {
  const payload: LocationTokenResponse = {
    access_token: 'eyJ.loc',
    refresh_token: 'eyJ.ref',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Location',
    companyId: 'co_abc',
    locationId: 'loc_789',
  };
  expect(() => validateLocationTokenResponse(payload, 'co_abc', 'loc_789')).not.toThrow();
});

test('validateLocationTokenResponse: throws LOCATION_TOKEN_MISMATCH on wrong companyId', () => {
  const payload: LocationTokenResponse = {
    access_token: 'tok',
    refresh_token: 'ref',
    expires_in: 86399,
    scope: '',
    userType: 'Location',
    companyId: 'co_WRONG',
    locationId: 'loc_789',
  };
  expect(() => validateLocationTokenResponse(payload, 'co_abc', 'loc_789')).toThrow('LOCATION_TOKEN_MISMATCH');
});

test('validateLocationTokenResponse: throws LOCATION_TOKEN_MISMATCH on wrong locationId', () => {
  const payload: LocationTokenResponse = {
    access_token: 'tok',
    refresh_token: 'ref',
    expires_in: 86399,
    scope: '',
    userType: 'Location',
    companyId: 'co_abc',
    locationId: 'loc_WRONG',
  };
  expect(() => validateLocationTokenResponse(payload, 'co_abc', 'loc_789')).toThrow('LOCATION_TOKEN_MISMATCH');
});
