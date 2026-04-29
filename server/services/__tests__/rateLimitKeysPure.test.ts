/**
 * rateLimitKeysPure.test.ts — Pure-unit tests for the rateLimitKeys builders.
 *
 * Spec §7.2 (key cardinality), plan §4 Task 2B.4.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/rateLimitKeysPure.test.ts
 */
import { expect, test } from 'vitest';
import { strict as assert } from 'node:assert';
import { rateLimitKeys } from '../../lib/rateLimitKeys.js';

// --- determinism ---
test('determinism: authLogin is stable across calls', () => {
  assert.equal(
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
  );
});

// --- normalisation ---
test('email casing collapses (Alice@x.com === alice@x.com)', () => {
  assert.equal(
    rateLimitKeys.authLogin('1.2.3.4', 'Alice@x.com'),
    rateLimitKeys.authLogin('1.2.3.4', 'alice@x.com'),
  );
});

test('IP is bytewise — different IPs distinct', () => {
  assert.notEqual(
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
    rateLimitKeys.authLogin('1.2.3.5', 'a@x.com'),
  );
});

// --- cross-user isolation ---
test('different users do NOT collide on same route (testRun)', () => {
  assert.notEqual(rateLimitKeys.testRun('user-a'), rateLimitKeys.testRun('user-b'));
});

test('different users do NOT collide on same route (sessionMessage)', () => {
  assert.notEqual(
    rateLimitKeys.sessionMessage('user-a'),
    rateLimitKeys.sessionMessage('user-b'),
  );
});

// --- cross-namespace isolation ---
test('same userId on testRun vs sessionMessage produces distinct keys', () => {
  assert.notEqual(
    rateLimitKeys.testRun('user-a'),
    rateLimitKeys.sessionMessage('user-a'),
  );
});

test('same IP on auth vs public routes produces distinct keys', () => {
  assert.notEqual(
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
    rateLimitKeys.authSignup('1.2.3.4'),
  );
  assert.notEqual(
    rateLimitKeys.authSignup('1.2.3.4'),
    rateLimitKeys.publicFormIp('1.2.3.4'),
  );
  assert.notEqual(
    rateLimitKeys.publicFormIp('1.2.3.4'),
    rateLimitKeys.publicTrackIp('1.2.3.4'),
  );
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
    assert.ok(k.startsWith('rl:v1:'), `expected rl:v1: prefix on ${k}`);
  }
});
