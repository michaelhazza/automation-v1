// ---------------------------------------------------------------------------
// apiAdapter classifier — pure decision function mapping HTTP responses / network
// errors to retry-or-terminal outcomes. Spec §2.3 (ClientPulse Session 2).
// No I/O; deterministic; trivially unit-testable.
// ---------------------------------------------------------------------------

export type AdapterOutcomeClassification =
  | { kind: 'terminal_success' }
  | { kind: 'retryable'; reason: 'rate_limit' | 'gateway' | 'network_timeout' | 'server_error' }
  | { kind: 'terminal_failure'; reason: 'auth' | 'not_found' | 'validation' | 'other' };

export type AdapterResponseInput =
  | { status: number }
  | { networkError: true; timedOut: boolean };

export function classifyAdapterOutcome(response: AdapterResponseInput): AdapterOutcomeClassification {
  if ('networkError' in response) {
    if (response.timedOut) return { kind: 'retryable', reason: 'network_timeout' };
    // Non-timeout network errors (DNS, reset, refused) — retryable; outer loop caps attempts.
    return { kind: 'retryable', reason: 'network_timeout' };
  }

  const status = response.status;

  if (status >= 200 && status < 300) return { kind: 'terminal_success' };

  if (status === 429) return { kind: 'retryable', reason: 'rate_limit' };
  if (status === 502 || status === 503) return { kind: 'retryable', reason: 'gateway' };

  if (status === 401 || status === 403) return { kind: 'terminal_failure', reason: 'auth' };
  if (status === 404) return { kind: 'terminal_failure', reason: 'not_found' };
  if (status === 422) return { kind: 'terminal_failure', reason: 'validation' };

  // Other 5xx — 500, 504, 599 etc. Retryable; outer loop's retryPolicy.maxRetries enforces
  // the "retry once" cap per spec §2.3 (classifier itself is stateless).
  if (status >= 500) return { kind: 'retryable', reason: 'server_error' };

  // Other 4xx — treat as terminal failure.
  return { kind: 'terminal_failure', reason: 'other' };
}
