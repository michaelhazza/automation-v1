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
  'unknown',
]);

export type FailureReason = z.infer<typeof FailureReason>;

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
