export type ErrorClass = 'retryable' | 'non_retryable';

export type FailureReason =
  | 'integration_not_connected'
  | 'api_failure'
  | 'no_data_yet'
  | 'schema_mismatch'
  | 'reader_not_implemented'
  | 'http_4xx'
  | 'http_5xx'
  | 'http_429'
  | 'network_timeout'
  | 'db_serialisation_conflict'
  | 'retry_budget_exhausted';

const RETRYABLE_REASONS: ReadonlySet<FailureReason> = new Set([
  'http_5xx', 'http_429', 'network_timeout', 'no_data_yet',
  'db_serialisation_conflict', 'api_failure',
]);

const NON_RETRYABLE_REASONS: ReadonlySet<FailureReason> = new Set([
  'http_4xx', 'schema_mismatch', 'integration_not_connected', 'reader_not_implemented',
]);

export function classifyFailure(reason: FailureReason): ErrorClass {
  if (RETRYABLE_REASONS.has(reason)) return 'retryable';
  if (NON_RETRYABLE_REASONS.has(reason)) return 'non_retryable';
  // 'retry_budget_exhausted' is a synthetic terminal marker set by the caller
  // after all attempts are consumed — intentionally not in either classifier set.
  return 'non_retryable';
}

/** Spec §5.4 backoff schedule. Returns minutes since last_attempt_at when eligible for retry. */
const BACKOFF_MINUTES: readonly number[] = [60, 240, 1440];  // 1h, 4h, 24h

export function nextBackoffMinutes(attemptCount: number): number | null {
  if (attemptCount < 1 || attemptCount > BACKOFF_MINUTES.length) return null;
  return BACKOFF_MINUTES[attemptCount - 1];
}

/** Spec §5.4 — 3-attempt budget. */
export function isRetryBudgetExhausted(attemptCount: number): boolean {
  return attemptCount >= 3;
}

export interface MetricOutcome {
  source: 'canonical_metric' | 'unavailable';
  errorClass?: ErrorClass;
  unavailableReason?: FailureReason;
}

export type BaselineOutcome =
  | { kind: 'success'; confidence: 'confirmed' | 'partial' }
  | { kind: 'retryable_failure' }
  | { kind: 'non_retryable_failure'; reason: FailureReason };

export function aggregateOutcome(
  perMetric: readonly MetricOutcome[],
  optedInCount: number,
): BaselineOutcome {
  const captured = perMetric.filter((m) => m.source === 'canonical_metric').length;
  if (captured >= 2) {
    const confidence: 'confirmed' | 'partial' =
      optedInCount > 0 && captured >= optedInCount ? 'confirmed' : 'partial';
    return { kind: 'success', confidence };
  }
  const firstNonRetryable = perMetric.find((m) => m.source === 'unavailable' && m.errorClass === 'non_retryable');
  if (firstNonRetryable) {
    return {
      kind: 'non_retryable_failure',
      reason: firstNonRetryable.unavailableReason ?? 'integration_not_connected',
    };
  }
  return { kind: 'retryable_failure' };
}
