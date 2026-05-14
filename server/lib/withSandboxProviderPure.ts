// ---------------------------------------------------------------------------
// withSandboxProviderPure.ts — pure helper for withSandboxProvider.ts.
//
// Extracts the failure-classification logic from the async retry wrapper so
// it can be unit-tested without timers, promises, or DB access.
//
// verify-pure-helper-convention.sh checks that test files import from this
// module using a relative path ending in `.js`.
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a provider error signal that the classifier inspects.
 * Callers may pass additional fields; the classifier only reads what it needs.
 */
export interface ProviderSignal {
  /**
   * HTTP status from the provider response, if available. Used to
   * distinguish transient (5xx, 429) from fatal (4xx non-429) outcomes.
   */
  status?: number;
  /**
   * Short machine-readable code from the provider SDK or our wrapper.
   * Known ambiguous codes: 'provider_unknown', 'sandbox_state_unknown'.
   * Known fatal codes: 'not_found', 'credential_denied', 'invalid_request'.
   */
  code?: string;
  /**
   * Whether the provider explicitly reported it cannot determine sandbox
   * liveness (e.g. split-brain, timeout on status poll). When true, the
   * classifier always returns 'ambiguous' regardless of other fields.
   */
  ambiguous?: boolean;
}

export type SignalKind = 'transient' | 'ambiguous' | 'fatal';

export interface ClassifiedSignal {
  kind: SignalKind;
}

// Provider codes that indicate "we don't know if the sandbox is alive."
const AMBIGUOUS_CODES = new Set(['provider_unknown', 'sandbox_state_unknown', 'status_unknown']);

// Provider codes that are definitively fatal (do not retry).
const FATAL_CODES = new Set([
  'not_found',
  'credential_denied',
  'invalid_request',
  'permission_denied',
  'quota_exceeded_hard',
]);

/**
 * Classify a provider error signal into transient / ambiguous / fatal.
 *
 * Decision tree:
 * 1. Explicit `ambiguous: true` flag → 'ambiguous' (overrides everything).
 * 2. Known ambiguous code → 'ambiguous'.
 * 3. Known fatal code → 'fatal'.
 * 4. 4xx status (non-429) → 'fatal'.
 * 5. Transient status (429 or 5xx) → 'transient'.
 * 6. Unknown signal → 'transient' (conservative: retry once more before giving up).
 */
export function classifyProviderSignal(signal: ProviderSignal): ClassifiedSignal {
  if (signal.ambiguous === true) {
    return { kind: 'ambiguous' };
  }

  if (signal.code !== undefined && AMBIGUOUS_CODES.has(signal.code)) {
    return { kind: 'ambiguous' };
  }

  if (signal.code !== undefined && FATAL_CODES.has(signal.code)) {
    return { kind: 'fatal' };
  }

  if (signal.status !== undefined) {
    if (signal.status === 429 || (signal.status >= 500 && signal.status < 600)) {
      return { kind: 'transient' };
    }
    if (signal.status >= 400 && signal.status < 500) {
      return { kind: 'fatal' };
    }
  }

  // Unknown signal — treat as transient (conservative retry posture).
  return { kind: 'transient' };
}

/**
 * Extract a Retry-After delay in milliseconds from a provider error signal.
 * Returns undefined when no hint is present (caller uses exponential backoff).
 *
 * Accepts seconds (integer) or milliseconds (float >= 1000) conventions.
 * Caps at 30 s to prevent runaway waits from malformed headers.
 */
export function extractRetryAfterMs(signal: ProviderSignal & { retryAfterSeconds?: number }): number | undefined {
  const raw = signal.retryAfterSeconds;
  if (typeof raw !== 'number' || raw <= 0) return undefined;
  const ms = raw < 1000 ? raw * 1000 : raw; // interpret large values as ms
  return Math.min(ms, 30_000);
}
