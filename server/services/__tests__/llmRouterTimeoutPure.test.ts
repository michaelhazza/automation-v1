import { expect, test } from 'vitest';
import { callWithTimeout, ProviderTimeoutError } from '../llmRouterTimeoutPure.js';

// ---------------------------------------------------------------------------
// Pins the provider-timeout contract introduced in the April 2026 llm-obs
// hardening pass. The previous Promise.race-based withTimeout rejected the
// outer promise but never aborted the underlying fetch — so a retry fired a
// second concurrent call against the provider, producing double-billing that
// no provider-side idempotency header could mitigate (none exist today).
//
// These tests catch regressions on:
//   1. The timer actually aborts the inner signal (no orphaned fetch)
//   2. The caller's signal still aborts the inner signal (both paths live)
//   3. Timeouts surface a typed ProviderTimeoutError (drives non-retry
//      classification in isNonRetryableError)
//   4. Happy-path resolution never aborts the signal
// ---------------------------------------------------------------------------

// TS narrows a `let x: T | null = null` back to `null` after an async callback
// assigns it, so we capture the inner signal in a holder object — the field
// type survives through the callback boundary.
interface SignalHolder { signal: AbortSignal | null }

test('callWithTimeout — timer fires before promise resolves → aborts inner signal + throws ProviderTimeoutError', async () => {
  const holder: SignalHolder = { signal: null };

  const result = callWithTimeout('test/model', 20, undefined, async (signal) => {
    holder.signal = signal;
    // Simulate a provider call that would take longer than the timeout.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 200);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(signal.reason);
      });
    });
    return 'never-reached';
  });

  const err = await result.catch((e: unknown) => e) as ProviderTimeoutError;
  expect(err instanceof ProviderTimeoutError).toBeTruthy();
  expect(err.code).toBe('PROVIDER_TIMEOUT');
  expect(err.statusCode).toBe(504);
  expect(err.timeoutMs).toBe(20);
  expect(err.label).toBe('test/model');

  // The inner signal must have been aborted — this is the whole point.
  expect(holder.signal).toBeTruthy();
  expect(holder.signal.aborted).toBe(true);
  expect(holder.signal.reason instanceof ProviderTimeoutError).toBeTruthy();
});

test('callWithTimeout — caller signal abort propagates to inner signal', async () => {
  const callerController = new AbortController();
  const holder: SignalHolder = { signal: null };

  const pending = callWithTimeout('test/model', 10_000, callerController.signal, async (signal) => {
    holder.signal = signal;
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
      setTimeout(resolve, 5_000);
    });
    return 'never-reached';
  });

  // Give the runner a tick to install the abort listener.
  await new Promise((r) => setTimeout(r, 5));
  callerController.abort(new Error('caller cancelled'));

  await await expect(pending).rejects.toThrow();
  expect(holder.signal).toBeTruthy();
  expect(holder.signal.aborted).toBe(true);
});

test('callWithTimeout — promise resolves before timer → returns value, no abort', async () => {
  const holder: SignalHolder = { signal: null };

  const value = await callWithTimeout('test/model', 500, undefined, async (signal) => {
    holder.signal = signal;
    await new Promise((r) => setTimeout(r, 5));
    return 'ok';
  });

  expect(value).toBe('ok');
  expect(holder.signal).toBeTruthy();
  expect(holder.signal.aborted).toBe(false);
});

test('callWithTimeout — inner throw (non-timeout) propagates the original error', async () => {
  const original = new Error('provider returned 500');
  await expect(
    callWithTimeout('test/model', 500, undefined, async () => { throw original; }),
  ).rejects.toBe(original);
});

test('ProviderTimeoutError — shape is stable (isNonRetryableError relies on code)', () => {
  const err = new ProviderTimeoutError(30_000, 'anthropic/claude');
  expect(err.code).toBe('PROVIDER_TIMEOUT');
  expect(err.statusCode).toBe(504);
  expect(err.name).toBe('ProviderTimeoutError');
  expect(err instanceof Error).toBeTruthy();
  expect(err instanceof ProviderTimeoutError).toBeTruthy();
});
