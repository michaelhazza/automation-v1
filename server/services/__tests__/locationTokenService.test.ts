/**
 * locationTokenService.test.ts — in-process tests with pure helpers.
 * Run: npx vitest run server/services/__tests__/locationTokenService.test.ts
 */
import { test, expect } from 'vitest';
import { computeLocationTokenExpiresAt, isLocationTokenExpiringSoon } from '../locationTokenServicePure.js';

test('non-expiring token: isLocationTokenExpiringSoon = false', () => {
  const expiresAt = computeLocationTokenExpiresAt(new Date(), 86400);
  expect(isLocationTokenExpiringSoon(expiresAt)).toBe(false);
});

test('expiring-soon token: isLocationTokenExpiringSoon = true', () => {
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 min
  expect(isLocationTokenExpiringSoon(expiresAt)).toBe(true);
});
