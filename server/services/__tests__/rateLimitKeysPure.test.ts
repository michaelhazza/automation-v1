/**
 * rateLimitKeysPure.test.ts — Pure-unit tests for the rateLimitKeys builders.
 *
 * Spec §7.2 (key cardinality), plan §4 Task 2B.4.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/rateLimitKeysPure.test.ts
 */
import { expect, test } from 'vitest';
import { rateLimitKeys } from '../../lib/rateLimitKeys.js';

// --- determinism ---
test('determinism: authLogin is stable across calls', () => {
  expect(rateLimitKeys.authLogin('1.2.3.4', 'a@x.com')).toBe(rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'));
});

// --- normalisation ---
test('email casing collapses (Alice@x.com === alice@x.com)', () => {
  expect(rateLimitKeys.authLogin('1.2.3.4', 'Alice@x.com')).toBe(rateLimitKeys.authLogin('1.2.3.4', 'alice@x.com'));
});

test('IP is bytewise — different IPs distinct', () => {
  expect(rateLimitKeys.authLogin('1.2.3.4', 'a@x.com')).not.toBe(rateLimitKeys.authLogin('1.2.3.5', 'a@x.com'));
});

// --- cross-user isolation ---
test('different users do NOT collide on same route (testRun)', () => {
  expect(rateLimitKeys.testRun('user-a')).not.toBe(rateLimitKeys.testRun('user-b'));
});

test('different users do NOT collide on same route (sessionMessage)', () => {
  expect(rateLimitKeys.sessionMessage('user-a')).not.toBe(rateLimitKeys.sessionMessage('user-b'));
});

// --- cross-namespace isolation ---
test('same userId on testRun vs sessionMessage produces distinct keys', () => {
  expect(rateLimitKeys.testRun('user-a')).not.toBe(rateLimitKeys.sessionMessage('user-a'));
});

test('same IP on auth vs public routes produces distinct keys', () => {
  expect(rateLimitKeys.authLogin('1.2.3.4', 'a@x.com')).not.toBe(rateLimitKeys.authSignup('1.2.3.4'));
  expect(rateLimitKeys.authSignup('1.2.3.4')).not.toBe(rateLimitKeys.publicFormIp('1.2.3.4'));
  expect(rateLimitKeys.publicFormIp('1.2.3.4')).not.toBe(rateLimitKeys.publicTrackIp('1.2.3.4'));
});

// --- shape ---
test('every builder emits the rl:v1 version prefix', () => {
  const samples = [
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
    rateLimitKeys.authSignup('1.2.3.4'),
    rateLimitKeys.authForgot('1.2.3.4'),
    rateLimitKeys.authReset('1.2.3.4'),
    rateLimitKeys.publicFormIp('1.2.3.4'),
    rateLimitKeys.publicFormPage('page-1'),
    rateLimitKeys.publicTrackIp('1.2.3.4'),
    rateLimitKeys.testRun('user-a'),
    rateLimitKeys.sessionMessage('user-a'),
  ];
  for (const k of samples) {
    expect(k.startsWith('rl:v1:')).toBeTruthy();
  }
});
