// ---------------------------------------------------------------------------
// Failure classification — the ONLY place that maps thrown errors to a
// FailureReason. Spec §8.4 / §13.1.
// ---------------------------------------------------------------------------

import {
  TimeoutError,
  StepLimitError,
  SafetyError,
  SchemaValidationError,
  AuthRedirectError,
  EnvironmentError,
  BudgetExceededError,
  type FailureReason,
} from '../../../shared/iee/failureReason.js';

export function classifyError(err: unknown): FailureReason {
  if (err instanceof TimeoutError) return 'timeout';
  if (err instanceof StepLimitError) return 'step_limit_reached';
  if (err instanceof SafetyError || err instanceof SchemaValidationError) return 'execution_error';
  if (err instanceof AuthRedirectError) return 'auth_failure';
  if (err instanceof BudgetExceededError) return 'budget_exceeded';
  if (err instanceof EnvironmentError) return 'environment_error';

  // Heuristic fallback for raw errors that escape typed handlers
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
    if (msg.includes('econn') || msg.includes('enotfound') || msg.includes('network')) return 'environment_error';
  }
  return 'unknown';
}
