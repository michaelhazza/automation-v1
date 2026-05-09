/**
 * server/services/runtimeCheckServicePure.ts
 *
 * Pure (no DB, no network, no filesystem) evaluation functions for runtime checks.
 * Spec: tasks/builds/trust-verification-layer/spec.md §6.1, §6.2, §10.7, §11.
 *
 * Custom handler registration point — all custom_handler names must be registered
 * via registerCustomHandler() at server startup before any evaluation occurs.
 * The registry is a module-level Set; registration is additive and never removed.
 */

import type {
  RuntimeCheckState,
  RuntimeCheckOperatorBadge,
  RuntimeCheckResult,
} from '../../shared/types/runtimeCheck.js';

// ── assertNever — exhaustiveness helper ───────────────────────────────────────

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

// ── Custom handler registry ───────────────────────────────────────────────────
//
// Handlers register via registerCustomHandler() at startup (e.g. in server/index.ts
// or the skill registration phase). The pure module holds only the name registry;
// the actual handler logic lives in the impure runtimeCheckService.ts which
// dispatches to the registered handler function.

const _customHandlerRegistry = new Set<string>();

/**
 * Register a custom_handler name. Call at server startup before any runs execute.
 * Idempotent — registering the same name twice is safe.
 */
export function registerCustomHandler(name: string): void {
  _customHandlerRegistry.add(name);
}

/**
 * Returns true if the named custom handler has been registered.
 */
export function isCustomHandlerRegistered(name: string): boolean {
  return _customHandlerRegistry.has(name);
}

/**
 * Throws a typed inconclusive result shape if the handler is not registered.
 * Used by runtimeCheckService.ts before dispatching a custom_handler check.
 */
export function assertCustomHandlerRegistered(name: string): void {
  if (!_customHandlerRegistry.has(name)) {
    const err = Object.assign(
      new Error(`Custom handler '${name}' is not registered`),
      {
        state: 'inconclusive' as const,
        reasonCode: 'custom_handler_unregistered',
        reasonText: `Custom handler '${name}' is not registered`,
      },
    );
    throw err;
  }
}

// ── Evaluation result type (subset of RuntimeCheckResult) ─────────────────────

export type EvalResult = {
  state: RuntimeCheckState;
  reasonCode: string;
  reasonText: string;
};

// ── evaluateApiStatus2xx ───────────────────────────────────────────────────────

/**
 * Evaluates whether an HTTP status code falls within the expected range.
 * Default range is 200–299 (inclusive).
 * Invalid input (null/undefined/non-number) returns inconclusive.
 */
export function evaluateApiStatus2xx(
  statusCode: number,
  expectedRange?: [number, number],
): EvalResult {
  if (statusCode == null || typeof statusCode !== 'number' || !Number.isFinite(statusCode)) {
    return {
      state: 'inconclusive',
      reasonCode: 'invalid_check_definition',
      reasonText: 'statusCode is missing or not a finite number.',
    };
  }

  const [low, high] = expectedRange ?? [200, 299];
  const passed = statusCode >= low && statusCode <= high;

  if (passed) {
    return {
      state: 'pass',
      reasonCode: 'api_status_in_range',
      reasonText: `HTTP ${statusCode} is within the expected range [${low}, ${high}].`,
    };
  }

  return {
    state: 'fail',
    reasonCode: 'api_status_out_of_range',
    reasonText: `HTTP ${statusCode} is outside the expected range [${low}, ${high}].`,
  };
}

// ── evaluateFieldMatch ─────────────────────────────────────────────────────────

/**
 * Evaluates whether a value's runtime type matches the declared expectedShape.
 * For 'date', checks that the value is a string parseable as a valid ISO date.
 * Returns fail with reasonCode 'field_shape_mismatch' on type mismatch.
 */
export function evaluateFieldMatch(
  value: unknown,
  outputPath: string,
  expectedShape: 'string' | 'number' | 'boolean' | 'date',
): EvalResult {
  if (value == null) {
    return {
      state: 'inconclusive',
      reasonCode: 'invalid_check_definition',
      reasonText: `Field at '${outputPath}' is null or undefined; cannot evaluate shape.`,
    };
  }

  let matches: boolean;

  if (expectedShape === 'date') {
    // ISO 8601: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ
    const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
    if (typeof value !== 'string' || !ISO_DATE_REGEX.test(value)) {
      return {
        state: 'fail',
        reasonCode: 'field_shape_mismatch',
        reasonText: `Expected ISO 8601 date string at '${outputPath}'`,
      };
    }
    matches = !Number.isNaN(Date.parse(value));
  } else {
    matches = typeof value === expectedShape;
  }

  if (matches) {
    return {
      state: 'pass',
      reasonCode: 'field_shape_matched',
      reasonText: `Field '${outputPath}' matches expected shape '${expectedShape}'.`,
    };
  }

  return {
    state: 'fail',
    reasonCode: 'field_shape_mismatch',
    reasonText: `Field '${outputPath}' has type '${typeof value}' but expected shape '${expectedShape}'.`,
  };
}

// ── evaluateRowExists ──────────────────────────────────────────────────────────

/**
 * Declarative evaluation of a row-existence check.
 * The actual DB read happens in the impure runtimeCheckService.ts;
 * this function receives the boolean result and returns the typed eval.
 */
export function evaluateRowExists(rowFound: boolean): EvalResult {
  if (rowFound) {
    return {
      state: 'pass',
      reasonCode: 'row_found',
      reasonText: 'Expected row was found in the database.',
    };
  }

  return {
    state: 'fail',
    reasonCode: 'row_not_found',
    reasonText: 'Expected row was not found in the database.',
  };
}

// ── evaluateExternalReturns ────────────────────────────────────────────────────

/**
 * Evaluates whether an external provider result contains the expected field.
 * Returns pass if the field is present (non-undefined); fail otherwise.
 * Invalid result shape returns inconclusive.
 */
export function evaluateExternalReturns(
  result: unknown,
  provider: string,
  expectedField: string,
): EvalResult {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) {
    return {
      state: 'inconclusive',
      reasonCode: 'invalid_check_definition',
      reasonText: `Provider '${provider}' result is not an object; cannot evaluate field '${expectedField}'.`,
    };
  }

  const hasField = Object.prototype.hasOwnProperty.call(result, expectedField) &&
    (result as Record<string, unknown>)[expectedField] !== undefined;

  if (hasField) {
    return {
      state: 'pass',
      reasonCode: 'external_field_present',
      reasonText: `Provider '${provider}' returned expected field '${expectedField}'.`,
    };
  }

  return {
    state: 'fail',
    reasonCode: 'external_field_missing',
    reasonText: `Provider '${provider}' result is missing expected field '${expectedField}'.`,
  };
}

// ── collapseToOperatorBadge ────────────────────────────────────────────────────

/**
 * F6 invariant: collapses the five internal runtime-check states to the three
 * operator-visible badge values.
 *
 *   pass            → pass
 *   fail            → fail
 *   inconclusive    → pending
 *   pending         → pending
 *   not_applicable  → pending
 *
 * This is the ONLY render-time projection from internal state to operator badge.
 * Do NOT use this function for analytics — always use the raw RuntimeCheckState.
 */
export function collapseToOperatorBadge(state: RuntimeCheckState): RuntimeCheckOperatorBadge {
  switch (state) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'inconclusive':
    case 'pending':
    case 'not_applicable':
      return 'pending';
    default:
      return assertNever(state);
  }
}

// ── classifyTimeoutAsInconclusive ──────────────────────────────────────────────

/**
 * Per spec §11.5: timeouts MUST resolve to 'inconclusive', NEVER 'fail'.
 * A timeout indicates the check could not complete, not that the action failed.
 *
 * Returns a partial RuntimeCheckResult with the timeout classification.
 * The caller (impure service) merges this with run/org context to produce the
 * full RuntimeCheckResult for persistence.
 */
export function classifyTimeoutAsInconclusive(
  skillSlug: string,
  sequenceNumber: number,
): Pick<RuntimeCheckResult, 'state' | 'reasonCode' | 'reasonText'> {
  return {
    state: 'inconclusive',
    reasonCode: 'check_timed_out',
    reasonText: `Runtime check for skill '${skillSlug}' at step ${sequenceNumber} did not complete within the timeout budget. The action outcome is unknown — treated as inconclusive, not a failure.`,
  };
}
