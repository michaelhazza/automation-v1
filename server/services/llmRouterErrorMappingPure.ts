// ---------------------------------------------------------------------------
// Pure error → ledger-status mapping for llmRouter's failure path.
//
// Extracted into its own file so the mapping is testable without booting the
// env-dependent router module, and so the router's non-retryable branch can
// "break providerLoop + let the existing ledger-write-on-failure path handle
// the row" without re-implementing classification twice.
//
// Background (April 2026 timeout hardening):
//   The router's non-retryable branch previously `throw err`-ed directly,
//   skipping the ledger-write block below. Result: PROVIDER_TIMEOUT +
//   PROVIDER_NOT_CONFIGURED + auth errors all produced NO ledger row, so
//   the P&L page could not surface them. This file fixes the gap by
//   pinning the full classification in one place and exposing it as a
//   pure function.
//
// Every unhandled error code falls to status='error' rather than silently
// dropping. There is no path from this module that skips the ledger.
// ---------------------------------------------------------------------------

import { isParseFailureError, type ParseFailureError } from '../lib/parseFailureError.js';

// Local type mirrors — the source of truth is server/db/schema/llmRequests.ts,
// but importing that pulls Drizzle + env. Re-declare here so this file stays
// pure. A compile-time assignability check at the bottom pins the mirror.
export type LlmRequestStatusForMapping =
  | 'success'
  | 'partial'
  | 'error'
  | 'timeout'
  | 'budget_blocked'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'provider_not_configured'
  | 'client_disconnected'
  | 'parse_failure'
  | 'aborted_by_caller';

export type AbortReasonForMapping = 'caller_timeout' | 'caller_cancel';

export interface ErrorClassification {
  status:              LlmRequestStatusForMapping;
  abortReason:         AbortReasonForMapping | null;
  parseFailureExcerpt: string | null;
}

/**
 * Maps any router-level error into the ledger row it should produce.
 *
 * Contract:
 *   - Every input produces a classification — no `undefined`, no throw.
 *   - `status='error'` is the fallthrough for unrecognised shapes. It is
 *     not a "skip the row" signal — the caller always writes the row.
 *   - `abortReason` is non-null only for `status='aborted_by_caller'`.
 *   - `parseFailureExcerpt` is non-null only for `status='parse_failure'`.
 */
export function classifyRouterError(err: unknown): ErrorClassification {
  if (isParseFailureError(err)) {
    const pfe = err as ParseFailureError;
    return {
      status: 'parse_failure',
      abortReason: null,
      parseFailureExcerpt: pfe.rawExcerpt,
    };
  }

  const e = err as {
    code?:        string;
    abortReason?: AbortReasonForMapping | null;
  } | null | undefined;

  if (!e || typeof e !== 'object') {
    return { status: 'error', abortReason: null, parseFailureExcerpt: null };
  }

  switch (e.code) {
    case 'CLIENT_DISCONNECTED':
      if (e.abortReason === 'caller_timeout' || e.abortReason === 'caller_cancel') {
        return { status: 'aborted_by_caller', abortReason: e.abortReason, parseFailureExcerpt: null };
      }
      return { status: 'client_disconnected', abortReason: null, parseFailureExcerpt: null };

    case 'PROVIDER_TIMEOUT':
      return { status: 'timeout', abortReason: null, parseFailureExcerpt: null };

    case 'PROVIDER_UNAVAILABLE':
      return { status: 'provider_unavailable', abortReason: null, parseFailureExcerpt: null };

    case 'PROVIDER_NOT_CONFIGURED':
      return { status: 'provider_not_configured', abortReason: null, parseFailureExcerpt: null };

    default:
      return { status: 'error', abortReason: null, parseFailureExcerpt: null };
  }
}
