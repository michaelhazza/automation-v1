// operatorRuntimeErrors.ts — closed signal set for session_unavailable classification.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.7 item 1
//
// Pure module — no DB, no IO.

export type RuntimeErrorClass =
  | 'session_unavailable'
  | 'transient'
  | 'permanent'
  | 'auth'
  | 'profile_corruption'
  | 'concurrency'
  | 'budget';

/** Signals that unambiguously indicate operator-session unavailability. */
const SESSION_UNAVAILABLE_HTTP_STATUSES = new Set([401, 403]);

/** Broker refresh failure codes that map to session_unavailable. */
const SESSION_UNAVAILABLE_BROKER_CODES = new Set([
  'expired_refresh_token',
  'provider_revoked',
  'insufficient_scope',
]);

/** Retry-After threshold (seconds) above which a 429 is treated as session_unavailable. */
const RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SECONDS = 60;

/** Number of consecutive connection-level errors that indicate session_unavailable. */
const CONNECTION_ERROR_THRESHOLD = 3;

export interface HttpErrorSignal {
  kind: 'http';
  status: number;
  retryAfterSeconds?: number;
  body?: string;
}

export interface BrokerRefreshErrorSignal {
  kind: 'broker_refresh';
  code: string;
}

export interface ConnectionErrorSignal {
  kind: 'connection';
  consecutiveFailures: number;
}

export interface ProfileCorruptionSignal {
  kind: 'profile_corruption';
  reason: string;
}

export interface ConcurrencySignal {
  kind: 'concurrency';
  reason: string;
}

export interface BudgetSignal {
  kind: 'budget';
  reason: string;
}

export interface UnknownErrorSignal {
  kind: 'unknown';
  message: string;
}

export type RuntimeErrorSignal =
  | HttpErrorSignal
  | BrokerRefreshErrorSignal
  | ConnectionErrorSignal
  | ProfileCorruptionSignal
  | ConcurrencySignal
  | BudgetSignal
  | UnknownErrorSignal;

function extractSignal(err: unknown): RuntimeErrorSignal {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;

    if (e['kind'] === 'http' && typeof e['status'] === 'number') {
      return {
        kind: 'http',
        status: e['status'] as number,
        retryAfterSeconds:
          typeof e['retryAfterSeconds'] === 'number'
            ? (e['retryAfterSeconds'] as number)
            : undefined,
        body: typeof e['body'] === 'string' ? (e['body'] as string) : undefined,
      };
    }

    if (e['kind'] === 'broker_refresh' && typeof e['code'] === 'string') {
      return { kind: 'broker_refresh', code: e['code'] as string };
    }

    if (e['kind'] === 'connection' && typeof e['consecutiveFailures'] === 'number') {
      return { kind: 'connection', consecutiveFailures: e['consecutiveFailures'] as number };
    }

    if (e['kind'] === 'profile_corruption' && typeof e['reason'] === 'string') {
      return { kind: 'profile_corruption', reason: e['reason'] as string };
    }

    if (e['kind'] === 'concurrency' && typeof e['reason'] === 'string') {
      return { kind: 'concurrency', reason: e['reason'] as string };
    }

    if (e['kind'] === 'budget' && typeof e['reason'] === 'string') {
      return { kind: 'budget', reason: e['reason'] as string };
    }
  }

  const message = err instanceof Error ? err.message : String(err);
  return { kind: 'unknown', message };
}

/**
 * Classifies a runtime error into a closed set of error classes.
 *
 * Classification rules (per spec §3.7 item 1):
 * - session_unavailable: HTTP 401/403, HTTP 429 with Retry-After >= 60s or
 *   provider "session suspended" body, broker refresh failure with
 *   expired_refresh_token | provider_revoked | insufficient_scope, or
 *   connection errors > 3 consecutive retries.
 * - profile_corruption: profile volume corruption signal.
 * - concurrency: subaccount concurrency cap exceeded.
 * - budget: per-task budget cap exceeded.
 * - auth: auth-related permanent failure (not session unavailability).
 * - transient: recoverable transient errors.
 * - permanent: non-recoverable hard errors.
 */
export function classifyRuntimeError(err: unknown): RuntimeErrorClass {
  const signal = extractSignal(err);

  switch (signal.kind) {
    case 'http': {
      if (SESSION_UNAVAILABLE_HTTP_STATUSES.has(signal.status)) {
        return 'session_unavailable';
      }
      if (signal.status === 429) {
        const retryAfter = signal.retryAfterSeconds ?? 0;
        if (
          retryAfter >= RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SECONDS ||
          (signal.body !== undefined && signal.body.toLowerCase().includes('session suspended'))
        ) {
          return 'session_unavailable';
        }
        return 'transient';
      }
      if (signal.status >= 500) {
        return 'transient';
      }
      if (signal.status >= 400) {
        return 'permanent';
      }
      return 'transient';
    }

    case 'broker_refresh': {
      if (SESSION_UNAVAILABLE_BROKER_CODES.has(signal.code)) {
        return 'session_unavailable';
      }
      return 'auth';
    }

    case 'connection': {
      if (signal.consecutiveFailures > CONNECTION_ERROR_THRESHOLD) {
        return 'session_unavailable';
      }
      return 'transient';
    }

    case 'profile_corruption':
      return 'profile_corruption';

    case 'concurrency':
      return 'concurrency';

    case 'budget':
      return 'budget';

    case 'unknown':
      return 'transient';
  }
}
