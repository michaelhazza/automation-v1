/**
 * Fake provider adapter — shared test fixture.
 *
 * Spec: docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md §1.2.
 *
 * Produces an `LLMProviderAdapter`-compatible object with configurable
 * response, latency, error, and call-recording. Multiple integration tests
 * can each instantiate one, register it via `registerProviderAdapter` (in
 * `server/services/providers/registry.ts`), exercise production code that
 * routes LLM calls through the registry, and assert on the captured
 * invocations.
 *
 * Latency semantics: the configured delay is applied **before resolving or
 * rejecting** the adapter call — between "the call has been received and
 * recorded into `calls`" and "the promise settles". Latency applies equally
 * to success and error paths (`setError` + `setLatencyMs` together cause the
 * rejection to be delayed by `latencyMs`, not just success). The call is
 * recorded immediately on entry; only the promise-settlement is delayed.
 * This makes "did the call reach the adapter" and "how long did the adapter
 * take to respond" two independently assertable properties.
 *
 * Restore-in-finally contract: tests MUST always call the `restore()`
 * function returned by `registerProviderAdapter` in a `finally` block (NOT
 * just on the happy path). Same-key sequential AND parallel test
 * registrations are non-interfering as long as each test brackets its
 * registration with its own `restore()` — the registry's prior-state
 * capture handles the "two adapters under the same key" case structurally.
 */

import type {
  LLMProviderAdapter,
  ProviderCallParams,
  ProviderResponse,
} from '../../providers/types.js';

export interface FakeProviderCall {
  receivedAt: Date;
  args: ProviderCallParams;
}

export interface FakeProviderAdapter extends LLMProviderAdapter {
  readonly calls: readonly FakeProviderCall[];
  readonly callCount: number;
  /** Override the response for subsequent calls (sticky). */
  setResponse(response: ProviderResponse): void;
  /**
   * Cause the next call to reject with this error. **One-shot** — subsequent
   * calls return the default response again. Tests that need multiple
   * rejections must call `setError` per scenario.
   *
   * **Why one-shot, not sticky:** errors are typically per-scenario in
   * integration tests — inject one rejection, exercise the recovery path,
   * verify the recovery worked. A sticky error would force every test that
   * exercises a recovery path to manually `setError(null)` or `reset()`
   * after the failure injection, which is easy to forget and makes the
   * scenario-then-recovery sequence noisier than it needs to be.
   * Symmetric reasoning explains why `setLatencyMs` is sticky (below):
   * latency typically simulates an environmental condition (slow network)
   * for an entire scenario, where a one-shot would force the same boilerplate.
   * Don't unify the two — the asymmetry is deliberate.
   */
  setError(error: Error): void;
  /**
   * Apply this delay before the promise settles (success or rejection).
   * **Sticky** — applies to every subsequent call until `reset()` or another
   * `setLatencyMs(0)` clears it.
   *
   * **Why sticky, not one-shot:** see `setError` JSDoc — latency typically
   * simulates an environmental condition (slow network) for an entire
   * scenario. A one-shot would force every latency-during-recovery test to
   * re-set the latency before each call, defeating the "environmental"
   * framing. The asymmetry with `setError` is intentional.
   */
  setLatencyMs(ms: number): void;
  /** Clear `calls` and any pending overrides. */
  reset(): void;
}

const DEFAULT_RESPONSE: ProviderResponse = {
  content: 'fake response',
  stopReason: 'end_turn',
  tokensIn: 100,
  tokensOut: 50,
  providerRequestId: 'fake-prov-req-default',
};

export function createFakeProviderAdapter(opts?: {
  defaultResponse?: ProviderResponse;
  /** Provider name reported by the adapter — defaults to `'fake-test-provider'`. */
  provider?: string;
}): FakeProviderAdapter {
  const calls: FakeProviderCall[] = [];
  let response: ProviderResponse = opts?.defaultResponse ?? DEFAULT_RESPONSE;
  let pendingError: Error | null = null;
  let latencyMs = 0;

  const adapter: FakeProviderAdapter = {
    provider: opts?.provider ?? 'fake-test-provider',
    async call(params: ProviderCallParams): Promise<ProviderResponse> {
      // Record on entry — independently observable from the promise's
      // settlement. Future regressions that move the latency above the
      // success branch only would flip "latency on error" tests red.
      calls.push({ receivedAt: new Date(), args: params });

      const consumedError = pendingError;
      pendingError = null; // one-shot

      if (latencyMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
      }

      if (consumedError) {
        throw consumedError;
      }
      return response;
    },
    get calls() { return calls; },
    get callCount() { return calls.length; },
    setResponse(next: ProviderResponse) { response = next; },
    setError(err: Error) { pendingError = err; },
    setLatencyMs(ms: number) { latencyMs = ms; },
    reset() {
      calls.length = 0;
      response = opts?.defaultResponse ?? DEFAULT_RESPONSE;
      pendingError = null;
      latencyMs = 0;
    },
  };

  return adapter;
}
