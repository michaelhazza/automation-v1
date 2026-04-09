// ---------------------------------------------------------------------------
// skillExecutorPure.ts
//
// Pure (no DB / env / service-layer) helpers extracted from skillExecutor.ts
// per the *Pure.ts + *.test.ts convention in docs/testing-conventions.md.
//
// These functions implement the onFailure dispatch logic from P0.2 Slice C of
// docs/improvements-roadmap-spec.md. They are pure functions of (directive,
// fallbackValue, error/result) and contain no I/O, no registry lookup, and no
// time-dependent behaviour.
// ---------------------------------------------------------------------------

import { failure, FailureError } from '../../shared/iee/failure.js';

export type OnFailureDirective = 'retry' | 'skip' | 'fail_run' | 'fallback';

/**
 * Decide what to return / throw when a skill handler throws an Error.
 *
 * @param toolSlug      — for error messages and FailureError context
 * @param directive     — the action's onFailure setting (defaults to 'retry')
 * @param fallbackValue — the action's fallbackValue (only consulted for 'fallback')
 * @param err           — the error thrown by the handler
 *
 * Returns a value to surface to the caller, or throws (for 'retry' / 'fail_run'
 * / 'fallback' with no configured value).
 */
export function applyOnFailurePure(
  toolSlug: string,
  directive: OnFailureDirective,
  fallbackValue: unknown,
  err: unknown,
): unknown {
  switch (directive) {
    case 'skip':
      return {
        success: false,
        skipped: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    case 'fail_run':
      throw new FailureError(failure(
        'execution_error',
        `${toolSlug}: ${err instanceof Error ? err.message : String(err)}`,
        { toolSlug, source: 'onFailure:fail_run' },
      ));
    case 'fallback': {
      // No fallbackValue configured → behave as 'retry' rather than returning
      // a structurally-valid but content-empty {value: undefined} response,
      // which would be indistinguishable from an explicit `undefined` fallback.
      if (fallbackValue === undefined) {
        throw err;
      }
      return { success: true, usedFallback: true, value: fallbackValue };
    }
    case 'retry':
    default:
      throw err;
  }
}

/**
 * Decide what to return / throw when a skill handler returns a structured
 * failure object (`{ success: false, error: ... }`) rather than throwing.
 *
 * Mirrors applyOnFailurePure but for the non-throwing path. The 'retry'
 * branch passes the original result through unchanged so the caller's existing
 * retry logic still sees it.
 */
export function applyOnFailureForStructuredFailurePure(
  toolSlug: string,
  directive: OnFailureDirective,
  fallbackValue: unknown,
  result: Record<string, unknown>,
): unknown {
  switch (directive) {
    case 'skip':
      return {
        success: false,
        skipped: true,
        reason: String(result.error ?? 'skill returned success: false'),
      };
    case 'fail_run':
      throw new FailureError(failure(
        'execution_error',
        `${toolSlug}: ${String(result.error ?? 'structured failure')}`,
        { toolSlug, source: 'onFailure:fail_run' },
      ));
    case 'fallback': {
      if (fallbackValue === undefined) {
        return result; // no fallback configured — pass through as 'retry'
      }
      return { success: true, usedFallback: true, value: fallbackValue };
    }
    case 'retry':
    default:
      return result;
  }
}
