// operatorBackendErrors.ts — typed error classes for the operator backend.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §5.1 (Chunk 5)
//
// Error classes:
//   OperatorBackendConflictError  → HTTP 409  (discriminated by .kind)
//   OperatorSessionLimitExceededError → HTTP 429
//
// The route error-handler in server/index.ts maps these to their HTTP codes.
// Pure helper mapOperatorBackendErrorToHttp (below) is extracted so the mapping
// logic can be tested without importing Express.

// ---------------------------------------------------------------------------
// OperatorBackendConflictError — 409
// ---------------------------------------------------------------------------

export type OperatorBackendConflictKind =
  | 'TASK_ALREADY_TERMINAL'
  | 'OPERATOR_TASK_RESTART_BLOCKED'
  | 'OPERATOR_SETTINGS_CONFLICT';

export interface OperatorBackendConflictErrorParams {
  kind: OperatorBackendConflictKind;
  currentState: unknown;
}

export class OperatorBackendConflictError extends Error {
  readonly statusCode = 409;
  readonly errorCode = 'operator_backend_conflict';
  readonly kind: OperatorBackendConflictKind;
  readonly currentState: unknown;

  constructor(params: OperatorBackendConflictErrorParams) {
    super(`Operator backend conflict: ${params.kind}`);
    this.name = 'OperatorBackendConflictError';
    this.kind = params.kind;
    this.currentState = params.currentState;
  }
}

// ---------------------------------------------------------------------------
// OperatorSessionLimitExceededError — 429
// ---------------------------------------------------------------------------

export interface OperatorSessionLimitExceededErrorParams {
  cap: number;
  current: number;
  subaccountId: string;
}

export class OperatorSessionLimitExceededError extends Error {
  readonly statusCode = 429;
  readonly errorCode = 'operator_session_limit_exceeded';
  readonly cap: number;
  readonly current: number;
  readonly subaccountId: string;

  constructor(params: OperatorSessionLimitExceededErrorParams) {
    super(
      `Operator session limit exceeded for subaccount ${params.subaccountId}: ` +
        `cap=${params.cap}, current=${params.current}`,
    );
    this.name = 'OperatorSessionLimitExceededError';
    this.cap = params.cap;
    this.current = params.current;
    this.subaccountId = params.subaccountId;
  }
}

// ---------------------------------------------------------------------------
// Pure mapper helper (extracted for testability)
// ---------------------------------------------------------------------------

export interface MappedErrorResponse {
  statusCode: number;
  errorCode: string;
  body: Record<string, unknown>;
}

/**
 * Maps an operator backend error instance to a structured HTTP response shape.
 * Pure — no Express dependency; tested in operatorBackendErrorsMapper.test.ts.
 *
 * Returns null when the error is not a known operator backend error type.
 */
export function mapOperatorBackendErrorToHttp(
  err: unknown,
): MappedErrorResponse | null {
  if (err instanceof OperatorBackendConflictError) {
    return {
      statusCode: 409,
      errorCode: err.errorCode,
      body: {
        kind: err.kind,
        current_state: err.currentState,
      },
    };
  }

  if (err instanceof OperatorSessionLimitExceededError) {
    return {
      statusCode: 429,
      errorCode: err.errorCode,
      body: {
        cap: err.cap,
        current: err.current,
        subaccount_id: err.subaccountId,
      },
    };
  }

  return null;
}
