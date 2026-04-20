import type { AbortReason } from '../../db/schema/llmRequests.js';

// ---------------------------------------------------------------------------
// Shared adapter error-mapping primitives — used by every provider adapter
// so the router sees a single consistent error shape regardless of which
// provider actually threw.
//
// See spec §8.1–§8.2 and §19.1:
//   - AbortController.abort('caller_timeout' | 'caller_cancel') → 499 CLIENT_DISCONNECTED
//     with abortReason carried through.
//   - HTTP 499 → 499 CLIENT_DISCONNECTED (rare; seen via proxies / OpenRouter).
//   - Unknown AbortError (no reason) → 'caller_cancel' (bare abort()).
// ---------------------------------------------------------------------------

export interface ClientDisconnectedError {
  statusCode: 499;
  code: 'CLIENT_DISCONNECTED';
  provider: string;
  message: string;
  abortReason: AbortReason | null;
}

/**
 * Map an AbortError caught from `fetch(..., { signal })` to our standard
 * CLIENT_DISCONNECTED error shape. The caller's intent is carried via
 * AbortSignal.reason (convention: the string 'caller_timeout' or
 * 'caller_cancel'). A bare abort() or an unrecognised reason falls back to
 * 'caller_cancel' because that is the more common user-initiated case.
 */
export function mapAbortError(
  provider: string,
  signal: AbortSignal | undefined,
): ClientDisconnectedError {
  const reasonRaw = signal?.reason;
  const abortReason: AbortReason =
    reasonRaw === 'caller_timeout' ? 'caller_timeout' : 'caller_cancel';
  return {
    statusCode: 499,
    code: 'CLIENT_DISCONNECTED',
    provider,
    message: `Request aborted by caller (${abortReason})`,
    abortReason,
  };
}

/**
 * Build a CLIENT_DISCONNECTED error for an HTTP 499 response. We don't know
 * which side initiated the disconnect, so abortReason is null — the caller
 * (router) treats null as "unknown initiator."
 */
export function mapHttp499(provider: string, detail: string): ClientDisconnectedError {
  return {
    statusCode: 499,
    code: 'CLIENT_DISCONNECTED',
    provider,
    message: `Client disconnected: ${detail}`,
    abortReason: null,
  };
}

/**
 * Type guard — distinguishes a fetch AbortError from other thrown values.
 * fetch on Node 20+ throws `DOMException { name: 'AbortError' }` from the
 * AbortController path; some polyfills throw `Error { name: 'AbortError' }`.
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
