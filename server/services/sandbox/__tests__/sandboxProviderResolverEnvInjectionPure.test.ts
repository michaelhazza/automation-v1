/**
 * sandboxProviderResolverEnvInjectionPure.test.ts — Regression tests for
 * env-injection guard on resolveSandboxProvider (Chunk 8, spec §8.2 SANDBOX-ADV-2.2).
 *
 * Asserts:
 *  1. The function resolves InlineSandbox when env is correctly set via vi.stubEnv.
 *  2. The function throws when NODE_ENV=production + SANDBOX_PROVIDER=inline.
 *  3. The function signature accepts zero positional arguments (TypeScript compile-time
 *     regression — a forged env object can no longer be injected).
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/sandboxProviderResolverEnvInjectionPure.test.ts
 */

import { describe, test, expect, afterEach, vi } from 'vitest';
import { resolveSandboxProvider } from '../sandboxProviderResolver.js';
import { InlineSandbox } from '../inlineSandbox.js';
import { FailureError } from '../../../../shared/iee/failure.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('env-injection guard regression', () => {
  test('test 1 — resolves InlineSandbox when NODE_ENV=test and SANDBOX_ALLOW_INLINE=1 via stubEnv', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SANDBOX_PROVIDER', 'inline');
    vi.stubEnv('SANDBOX_ALLOW_INLINE', '1');
    const svc = resolveSandboxProvider();
    expect(svc).toBeInstanceOf(InlineSandbox);
  });

  test('test 2 — throws when NODE_ENV=production and SANDBOX_PROVIDER=inline', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SANDBOX_PROVIDER', 'inline');
    vi.stubEnv('SANDBOX_ALLOW_INLINE', '1');
    let caught: unknown;
    try {
      resolveSandboxProvider();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FailureError);
    const fe = caught as FailureError;
    expect(fe.failure.failureReason).toBe('sandbox_provider_unavailable');
    expect(fe.failure.failureDetail).toContain('inlineSandbox is test-only');
  });

  test('test 3 — resolveSandboxProvider accepts zero positional arguments (compile-time regression)', () => {
    // A forged env object can no longer be supplied as a positional argument.
    // This test verifies the function signature has length 0 — TypeScript enforces this
    // at compile time; the runtime assertion catches any future signature regression.
    expect(resolveSandboxProvider.length).toBe(0);
  });
});
