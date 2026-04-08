/**
 * IEE — Failure reason enum and related types.
 *
 * Spec: docs/iee-development-spec.md §8.4, §10/§8.4 (budget_exceeded), §11.5.8.
 *
 * Every IEE failure must classify into exactly one of these reasons. Raw stack
 * traces are NEVER stored on the row; the `resultSummary.output` may carry a
 * short (≤500 char) human-readable explanation.
 */

import { z } from 'zod';

export const FailureReason = z.enum([
  'timeout',
  'step_limit_reached',
  'execution_error',
  'environment_error',
  'auth_failure',
  'budget_exceeded',
  // Reporting Agent / paywall workflow additions (spec v3.4 §8.4)
  // Aligned with the unified failure taxonomy. Existing values retained for
  // backwards compatibility; new values cover cases the original enum did not.
  'connector_timeout',  // external system did not respond within timeout
  'rate_limited',       // external system returned 429 / equivalent
  'data_incomplete',    // expected data missing or malformed (e.g. transcript too short)
  'internal_error',     // bug or unexpected condition in our own code
  'unknown',
]);

export type FailureReason = z.infer<typeof FailureReason>;

/**
 * Structured failure object — the ONLY shape that should be persisted to
 * agent_runs / execution_runs / execution_steps as a failure. The
 * `failure()` helper in shared/iee/failure.ts is the single emit point;
 * inline `{ failureReason: ... }` literals are banned by lint rule and zod
 * validation at the persistence boundary (spec v3.4 §8.4 / T13).
 */
export interface FailureObject {
  failureReason: FailureReason;
  failureDetail: string;
  metadata?: Record<string, unknown>;
}

export const FailureObjectSchema = z.object({
  failureReason: FailureReason,
  failureDetail: z.string().min(1).max(200),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Typed errors thrown by worker code. The classifier in
 * `worker/src/loop/failureClassification.ts` is the ONLY place that maps
 * thrown errors to a `FailureReason`. Handlers throw these; they never set
 * `failureReason` directly.
 */
export class TimeoutError extends Error {
  readonly _tag = 'TimeoutError' as const;
}
export class StepLimitError extends Error {
  readonly _tag = 'StepLimitError' as const;
}
export class SafetyError extends Error {
  readonly _tag = 'SafetyError' as const;
  constructor(message: string, readonly code: 'path_outside_workspace' | 'denylisted_command' | 'invalid_session_key' | 'other' = 'other') {
    super(message);
  }
}
export class SchemaValidationError extends Error {
  readonly _tag = 'SchemaValidationError' as const;
}
export class AuthRedirectError extends Error {
  readonly _tag = 'AuthRedirectError' as const;
}
export class EnvironmentError extends Error {
  readonly _tag = 'EnvironmentError' as const;
}
export class BudgetExceededError extends Error {
  readonly _tag = 'BudgetExceededError' as const;
  constructor(
    message: string,
    readonly scope: 'subaccount' | 'organisation' | 'system',
    readonly limitUsd: number,
    readonly attemptedUsd: number,
  ) {
    super(message);
  }
}

/**
 * Router contract violation — see spec §13.1. Thrown by `routeCall()` when an
 * IEE call is missing `executionRunId`. Distinct from runtime errors so it can
 * be classified as `internal_error` in logs/alerts.
 */
export class RouterContractError extends Error {
  readonly _tag = 'RouterContractError' as const;
}
