/**
 * Pure tests for D.1 — email-only rate-limit key builders.
 */

import { expect, test } from 'vitest';
import {
  normaliseEmail,
  loginEmailOnlyKey,
  loginEmailOnlyKeyBurst,
  rateLimitKeys,
} from '../rateLimitKeys.js';

test('normaliseEmail: trims and lowercases', () => {
  expect(normaliseEmail('  User@EXAMPLE.COM  ')).toBe('user@example.com');
});

test('normaliseEmail: idempotent on already-lowercase', () => {
  expect(normaliseEmail('already@lower.com')).toBe('already@lower.com');
});

test('loginEmailOnlyKey and loginEmailOnlyKeyBurst must differ', () => {
  const email = normaliseEmail('test@example.com');
  expect(loginEmailOnlyKey(email)).not.toBe(loginEmailOnlyKeyBurst(email));
});

test('email-only key must differ from IP+email authLogin key', () => {
  const email = normaliseEmail('test@example.com');
  expect(loginEmailOnlyKey(email)).not.toBe(rateLimitKeys.authLogin('127.0.0.1', email));
});

test('email-only burst key must differ from IP+email authLoginLong key', () => {
  const email = normaliseEmail('test@example.com');
  expect(loginEmailOnlyKeyBurst(email)).not.toBe(rateLimitKeys.authLoginLong('127.0.0.1', email));
});

test('same email different case → identical key', () => {
  const lower = normaliseEmail('User@Example.COM');
  const upper = normaliseEmail('user@example.com');
  expect(loginEmailOnlyKey(lower)).toBe(loginEmailOnlyKey(upper));
  expect(loginEmailOnlyKeyBurst(lower)).toBe(loginEmailOnlyKeyBurst(upper));
});
