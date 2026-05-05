/**
 * Pure helpers for WorkflowActionCallExecutor.
 *
 * Extracted so the test suite can exercise them without pulling in the
 * DB / engine dependency graph. Spec: docs/onboarding-Workflows-spec.md §4.6.
 */

/** Action output size cap; outputs larger than this are truncated. Spec §4.6. */
export const MAX_ACTION_OUTPUT_BYTES = 200 * 1024;

/**
 * Enforces §4.6 output size cap. Returns the original output when within
 * the limit; otherwise returns a truncated stub of the form
 * `{ _truncated: true, originalSize, preview }`. Non-JSON-serialisable
 * inputs return a safe sentinel.
 */
export function maybeTruncateOutput(output: unknown): unknown {
  try {
    const serialised = JSON.stringify(output);
    if (serialised === undefined) {
      return { _truncated: true, originalSize: 0, preview: '<unserialisable>' };
    }
    if (serialised.length <= MAX_ACTION_OUTPUT_BYTES) return output;
    return {
      _truncated: true,
      originalSize: serialised.length,
      preview: serialised.slice(0, 500),
    };
  } catch {
    return { _truncated: true, originalSize: 0, preview: '<unserialisable>' };
  }
}
