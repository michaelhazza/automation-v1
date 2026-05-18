// guard-ignore-file: pure-helper-convention reason="env preamble must run before module-level env parse fires; dynamic import + vi.resetModules() used to re-evaluate the module per case"
/**
 * operatorManagedBackend — OPERATOR_SESSION_IMAGE_TAG fail-loud guard.
 * (iee-worker-retirement spec §4 Chunk 5).
 *
 * Verifies the module-load guard that replaced the unsafe `?? 'latest'`
 * default:
 *   - In production with the env var unset, importing the module throws.
 *   - In production with the env var set, the exported tag equals the env value.
 *   - In non-production with the env var unset, the documented dev fallback is used.
 *
 * Pairs with docs/runbooks/operator-session-image-rollback.md § 2.1.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

export {};

process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_IMAGE_TAG = process.env.OPERATOR_SESSION_IMAGE_TAG;

beforeEach(() => {
  vi.resetModules();
  delete process.env.OPERATOR_SESSION_IMAGE_TAG;
});

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
  if (ORIGINAL_IMAGE_TAG === undefined) {
    delete process.env.OPERATOR_SESSION_IMAGE_TAG;
  } else {
    process.env.OPERATOR_SESSION_IMAGE_TAG = ORIGINAL_IMAGE_TAG;
  }
});

test('throws at module load when NODE_ENV=production and OPERATOR_SESSION_IMAGE_TAG is unset', async () => {
  process.env.NODE_ENV = 'production';
  let caught: unknown;
  try {
    await import('../operatorManagedBackend.js');
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toContain('OPERATOR_SESSION_IMAGE_TAG must be set in production');
  expect((caught as Error).message).toContain('operator-session-image-rollback.md');
});

test('uses the env value when OPERATOR_SESSION_IMAGE_TAG is set in production', async () => {
  process.env.NODE_ENV = 'production';
  process.env.OPERATOR_SESSION_IMAGE_TAG = 'operator-session:v2.4.1';
  const mod = await import('../operatorManagedBackend.js');
  expect(mod.OPERATOR_SESSION_IMAGE_TAG).toBe('operator-session:v2.4.1');
});

test('falls back to operator-session:local-dev in non-production when unset', async () => {
  process.env.NODE_ENV = 'test';
  const mod = await import('../operatorManagedBackend.js');
  expect(mod.OPERATOR_SESSION_IMAGE_TAG).toBe('operator-session:local-dev');
});
