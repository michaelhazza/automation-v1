/**
 * Pure tests for D.1 — email-only rate-limit key builders.
 * No IO; no DB; no imports from runtime modules.
 */

import { strict as assert } from 'assert';
import { test } from 'vitest';
import {
  normaliseEmail,
  loginEmailOnlyKey,
  loginEmailOnlyKeyBurst,
  rateLimitKeys,
} from '../rateLimitKeys.js';

test('normaliseEmail: trims and lowercases', () => {
  assert.equal(normaliseEmail('  User@EXAMPLE.COM  '), 'user@example.com');
});

test('normaliseEmail: idempotent on already-lowercase', () => {
  assert.equal(normaliseEmail('already@lower.com'), 'already@lower.com');
});

test('loginEmailOnlyKey and loginEmailOnlyKeyBurst must differ', () => {
  const email = normaliseEmail('test@example.com');
  assert.notEqual(loginEmailOnlyKey(email), loginEmailOnlyKeyBurst(email));
});

test('email-only key must differ from IP+email authLogin key', () => {
  const email = normaliseEmail('test@example.com');
  assert.notEqual(loginEmailOnlyKey(email), rateLimitKeys.authLogin('127.0.0.1', email));
});

test('email-only burst key must differ from IP+email authLoginLong key', () => {
  const email = normaliseEmail('test@example.com');
  assert.notEqual(loginEmailOnlyKeyBurst(email), rateLimitKeys.authLoginLong('127.0.0.1', email));
});

test('same email different case → identical key', () => {
  const lower = normaliseEmail('User@Example.COM');
  const upper = normaliseEmail('user@example.com');
  assert.equal(loginEmailOnlyKey(lower), loginEmailOnlyKey(upper));
  assert.equal(loginEmailOnlyKeyBurst(lower), loginEmailOnlyKeyBurst(upper));
});
