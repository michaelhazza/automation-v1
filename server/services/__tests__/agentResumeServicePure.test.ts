/**
 * agentResumeServicePure.test.ts — Pure-logic tests for agentResumeService.
 *
 * These tests verify the sha256 token-hash derivation logic in isolation without
 * hitting the database. The DB-interaction paths (optimistic UPDATE, idempotent
 * already_resumed check) are covered by integration tests that require a live DB.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentResumeServicePure.test.ts
 */

import { expect, test } from 'vitest';
import crypto from 'crypto';
import { deriveTokenHash } from '../agentResumeService.js';

test('token hash: sha256 of 64-char hex string produces 64-char hex hash', () => {
  const plaintext = crypto.randomBytes(32).toString('hex');
  const hash = deriveTokenHash(plaintext);

  expect(hash).toMatch(/^[a-f0-9]{64}$/);
});

test('token hash: two different plaintexts produce different hashes', () => {
  const p1 = crypto.randomBytes(32).toString('hex');
  const p2 = crypto.randomBytes(32).toString('hex');

  expect(deriveTokenHash(p1)).not.toBe(deriveTokenHash(p2));
});

test('token hash: same plaintext always produces same hash', () => {
  const plaintext = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
  const h1 = deriveTokenHash(plaintext);
  const h2 = deriveTokenHash(plaintext);

  expect(h1).toBe(h2);
});

test('token hash prefix: first 8 chars of hash are safe for logging', () => {
  const plaintext = crypto.randomBytes(32).toString('hex');
  const hash = deriveTokenHash(plaintext);
  const prefix = hash.slice(0, 8);

  expect(prefix).toMatch(/^[a-f0-9]{8}$/);
  // Prefix must NOT equal the start of the plaintext (would reveal the token)
  expect(prefix).not.toBe(plaintext.slice(0, 8));
});

test('token hash: known test vector matches expected output', () => {
  // SHA-256("abc") verified via Node.js crypto
  const plaintext = 'abc';
  const hash = deriveTokenHash(plaintext);

  expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
