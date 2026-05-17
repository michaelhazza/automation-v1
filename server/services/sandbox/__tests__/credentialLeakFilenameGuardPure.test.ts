/**
 * credentialLeakFilenameGuardPure.test.ts — Pure tests for credential-leak filename predicate.
 *
 * Spec §5.3 (SANDBOX-ADV-4.1). Covers:
 *   - /workspace/secrets/ path detection (lowercase, uppercase, mixed-case, backslash, double-slash).
 *   - secrets/ prefix detection.
 *   - Path-traversal (..) detection.
 *   - Innocuous paths return false.
 *   - Empty string returns false.
 *
 * No DB, no network, no side effects.
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/credentialLeakFilenameGuardPure.test.ts
 */

import { describe, test, expect } from 'vitest';
import { isCredentialLeakFilename } from '../credentialLeakFilenameGuardPure.js';

describe('isCredentialLeakFilename', () => {
  test('Test 1: /workspace/secrets/x.token → true', () => {
    expect(isCredentialLeakFilename('/workspace/secrets/x.token')).toBe(true);
  });

  test('Test 2: /workspace/Secrets/x.token → true (case bypass blocked)', () => {
    expect(isCredentialLeakFilename('/workspace/Secrets/x.token')).toBe(true);
  });

  test('Test 3: /WORKSPACE/SECRETS/x.token → true (full-upper bypass blocked)', () => {
    expect(isCredentialLeakFilename('/WORKSPACE/SECRETS/x.token')).toBe(true);
  });

  test('Test 4: \\workspace\\secrets\\x.token → true (backslash normalised)', () => {
    expect(isCredentialLeakFilename('\\workspace\\secrets\\x.token')).toBe(true);
  });

  test('Test 5: /workspace//secrets/x.token → true (double-slash normalised)', () => {
    expect(isCredentialLeakFilename('/workspace//secrets/x.token')).toBe(true);
  });

  test('Test 6: /workspace/artefacts/foo.txt → false (innocuous file)', () => {
    expect(isCredentialLeakFilename('/workspace/artefacts/foo.txt')).toBe(false);
  });

  test('Test 7: ../../etc/passwd → true (path-traversal pattern)', () => {
    expect(isCredentialLeakFilename('../../etc/passwd')).toBe(true);
  });

  test('Test 8 (bonus): secrets/foo → true (begins-with check)', () => {
    expect(isCredentialLeakFilename('secrets/foo')).toBe(true);
  });

  test('Test 9 (bonus): empty string → false (innocuous)', () => {
    expect(isCredentialLeakFilename('')).toBe(false);
  });
});
