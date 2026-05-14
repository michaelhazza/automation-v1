// ---------------------------------------------------------------------------
// errorCode — single helper for extracting a stable error code from any of
// the shapes that surface across the codebase
// ---------------------------------------------------------------------------
//
// Branch A is the locked contract for skill returns
// (`docs/pre-launch-hardening-spec.md` §4.3): error: '<code-string>'.
// A handful of older delegation paths historically returned the nested
// envelope `{ code, message, context }` and a few HTTP responses use the
// flat `{ error: '<code-string>' }` shape, so consumers that branch on
// error codes face an implicit two-contract situation.
//
// Rather than reintroduce a normalisation layer (rejected in PR review
// round 1 F5 — would re-create the mixed-shape problem invariant 2.4
// exists to prevent), this helper centralises the extraction so consumers
// don't string-parse error shapes inline. New consumer code SHOULD route
// every error-code inspection through `getErrorCode`. Existing call sites
// migrate opportunistically; no mass rewrite is required.
//
// The helper is stable, dependency-free, and safe to import from server,
// client, and pure-test contexts.
// ---------------------------------------------------------------------------

/**
 * Extract a stable error code from any of the legacy or current error
 * shapes used across the codebase. Returns the `defaultCode` argument
 * (which itself defaults to `null`) when no recognisable code can be
 * derived.
 *
 * Recognised inputs:
 *   - `'code_string'`                          → returns 'code_string'
 *   - `{ code: 'code_string' }`                → returns 'code_string'
 *   - `{ error: 'code_string' }`               → returns 'code_string'
 *   - `{ error: { code: 'code_string' } }`     → returns 'code_string'
 *   - `Error` instance with a `.code` property → returns the code
 *   - thrown `new Error('msg')` (no .code)     → returns `defaultCode`
 *   - anything else                            → returns `defaultCode`
 *
 * Pass an explicit fallback (e.g. `'unknown_error'`) to convert "no code
 * found" into a recognisable sentinel for downstream branching:
 *
 *   const code = getErrorCode(err, 'unknown_error');
 *   logger.warn('skill.failed', { code, raw: err });
 *
 * Note: `Error.message` is intentionally NOT treated as an error code.
 * Free-text messages are not stable codes and should be logged
 * separately (e.g. as a `message` field) rather than smuggled through
 * the code channel.
 */
export function getErrorCode(input: unknown, defaultCode: string | null = null): string | null {
  if (input === null || input === undefined) return defaultCode;
  if (typeof input === 'string') return input.length > 0 ? input : defaultCode;

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;

    // Direct .code on the object (covers Error subclasses with a .code field)
    if (typeof obj.code === 'string' && obj.code.length > 0) return obj.code;

    // .error as a flat string (common HTTP / skill return shape)
    if (typeof obj.error === 'string' && obj.error.length > 0) return obj.error;

    // .error as a nested envelope ({ code, message, context })
    if (obj.error && typeof obj.error === 'object') {
      const inner = obj.error as Record<string, unknown>;
      if (typeof inner.code === 'string' && inner.code.length > 0) return inner.code;
    }
  }

  return defaultCode;
}
