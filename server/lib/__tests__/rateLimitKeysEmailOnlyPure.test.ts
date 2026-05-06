/**
 * Pure tests for D.1 — email-only rate-limit key builders.
 * No IO; no DB; no imports from runtime modules.
 */

import { strict as assert } from 'assert';
import {
  normaliseEmail,
  loginEmailOnlyKey,
  loginEmailOnlyKeyBurst,
  rateLimitKeys,
} from '../rateLimitKeys.js';

// ── normaliseEmail ─────────────────────────────────────────────────────────────

{
  const norm = normaliseEmail('  User@EXAMPLE.COM  ');
  assert.equal(norm, 'user@example.com', 'normaliseEmail: trims and lowercases');
}

{
  const norm = normaliseEmail('already@lower.com');
  assert.equal(norm, 'already@lower.com', 'normaliseEmail: idempotent on already-lowercase');
}

// ── key distinctness ───────────────────────────────────────────────────────────

{
  const email = normaliseEmail('test@example.com');
  const k1 = loginEmailOnlyKey(email);
  const k2 = loginEmailOnlyKeyBurst(email);
  assert.notEqual(k1, k2, 'loginEmailOnlyKey and loginEmailOnlyKeyBurst must differ');
}

{
  const email = normaliseEmail('test@example.com');
  const emailOnly = loginEmailOnlyKey(email);
  const ipEmail = rateLimitKeys.authLogin('127.0.0.1', email);
  assert.notEqual(emailOnly, ipEmail, 'email-only key must differ from IP+email authLogin key');
}

{
  const email = normaliseEmail('test@example.com');
  const emailOnlyBurst = loginEmailOnlyKeyBurst(email);
  const ipEmailLong = rateLimitKeys.authLoginLong('127.0.0.1', email);
  assert.notEqual(emailOnlyBurst, ipEmailLong, 'email-only burst key must differ from IP+email authLoginLong key');
}

// ── case normalisation → same key ─────────────────────────────────────────────

{
  const lower = normaliseEmail('User@Example.COM');
  const upper = normaliseEmail('user@example.com');
  assert.equal(loginEmailOnlyKey(lower), loginEmailOnlyKey(upper), 'same email different case → identical key');
  assert.equal(loginEmailOnlyKeyBurst(lower), loginEmailOnlyKeyBurst(upper), 'same email different case → identical burst key');
}

console.log('rateLimitKeysEmailOnlyPure: all assertions passed');
