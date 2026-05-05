/**
 * baselineRetryClassifierPure.test.ts
 *
 * Pure-function tests confirming retry classification, backoff schedule, and
 * outcome aggregation match spec §5.4. Run via:
 *   npx vitest run server/services/__tests__/baselineRetryClassifierPure.test.ts
 */

import { test, expect } from 'vitest';
import {
  classifyFailure,
  nextBackoffMinutes,
  isRetryBudgetExhausted,
  aggregateOutcome,
} from '../baselineRetryClassifierPure.js';

// ── classifyFailure ───────────────────────────────────────────────────────────

test('classifyFailure: http_5xx is retryable', () => {
  expect(classifyFailure('http_5xx')).toBe('retryable');
});

test('classifyFailure: http_4xx is non_retryable', () => {
  expect(classifyFailure('http_4xx')).toBe('non_retryable');
});

test('classifyFailure: http_429 is retryable', () => {
  expect(classifyFailure('http_429')).toBe('retryable');
});

test('classifyFailure: integration_not_connected is non_retryable', () => {
  expect(classifyFailure('integration_not_connected')).toBe('non_retryable');
});

test('classifyFailure: reader_not_implemented is non_retryable', () => {
  expect(classifyFailure('reader_not_implemented')).toBe('non_retryable');
});

// ── nextBackoffMinutes ────────────────────────────────────────────────────────

test('nextBackoffMinutes(1) = 60 (1 hour)', () => {
  expect(nextBackoffMinutes(1)).toBe(60);
});

test('nextBackoffMinutes(2) = 240 (4 hours)', () => {
  expect(nextBackoffMinutes(2)).toBe(240);
});

test('nextBackoffMinutes(3) = 1440 (24 hours)', () => {
  expect(nextBackoffMinutes(3)).toBe(1440);
});

test('nextBackoffMinutes(4) = null (beyond budget)', () => {
  expect(nextBackoffMinutes(4)).toBeNull();
});

// ── isRetryBudgetExhausted ────────────────────────────────────────────────────

test('isRetryBudgetExhausted(2) = false (still has attempts remaining)', () => {
  expect(isRetryBudgetExhausted(2)).toBe(false);
});

test('isRetryBudgetExhausted(3) = true (budget exhausted)', () => {
  expect(isRetryBudgetExhausted(3)).toBe(true);
});

// ── aggregateOutcome ──────────────────────────────────────────────────────────

test('aggregateOutcome: 2 captured out of 2 opted-in → success confirmed', () => {
  const result = aggregateOutcome(
    [{ source: 'canonical_metric' }, { source: 'canonical_metric' }],
    2,
  );
  expect(result).toEqual({ kind: 'success', confidence: 'confirmed' });
});

test('aggregateOutcome: 2 captured out of 3 opted-in → success partial', () => {
  const result = aggregateOutcome(
    [
      { source: 'canonical_metric' },
      { source: 'canonical_metric' },
      { source: 'unavailable', errorClass: 'retryable' },
    ],
    3,
  );
  expect(result).toEqual({ kind: 'success', confidence: 'partial' });
});

test('aggregateOutcome: 1 captured (retryable failures) → retryable_failure', () => {
  const result = aggregateOutcome(
    [{ source: 'unavailable', errorClass: 'retryable' }],
    5,
  );
  expect(result).toEqual({ kind: 'retryable_failure' });
});

test('aggregateOutcome: non_retryable failure present → non_retryable_failure', () => {
  const result = aggregateOutcome(
    [{ source: 'unavailable', errorClass: 'non_retryable' }],
    5,
  );
  expect(result).toEqual({ kind: 'non_retryable_failure', reason: 'integration_not_connected' });
});

test('aggregateOutcome: non_retryable propagates per-metric unavailableReason', () => {
  const result = aggregateOutcome(
    [{ source: 'unavailable', errorClass: 'non_retryable', unavailableReason: 'schema_mismatch' }],
    5,
  );
  expect(result).toEqual({ kind: 'non_retryable_failure', reason: 'schema_mismatch' });
});

test('aggregateOutcome: first non_retryable wins when multiple have reasons', () => {
  const result = aggregateOutcome(
    [
      { source: 'unavailable', errorClass: 'retryable', unavailableReason: 'no_data_yet' },
      { source: 'unavailable', errorClass: 'non_retryable', unavailableReason: 'reader_not_implemented' },
      { source: 'unavailable', errorClass: 'non_retryable', unavailableReason: 'http_4xx' },
    ],
    5,
  );
  expect(result).toEqual({ kind: 'non_retryable_failure', reason: 'reader_not_implemented' });
});

test('aggregateOutcome: optedInCount=0 forces partial even when captured >= 0 (vacuously true)', () => {
  const result = aggregateOutcome(
    [{ source: 'canonical_metric' }, { source: 'canonical_metric' }],
    0,
  );
  expect(result).toEqual({ kind: 'success', confidence: 'partial' });
});

// ── classifyFailure additional coverage (S2) ──────────────────────────────────

test('classifyFailure: network_timeout is retryable', () => {
  expect(classifyFailure('network_timeout')).toBe('retryable');
});

test('classifyFailure: no_data_yet is retryable', () => {
  expect(classifyFailure('no_data_yet')).toBe('retryable');
});

test('classifyFailure: db_serialisation_conflict is retryable', () => {
  expect(classifyFailure('db_serialisation_conflict')).toBe('retryable');
});

test('classifyFailure: api_failure is retryable', () => {
  expect(classifyFailure('api_failure')).toBe('retryable');
});

test('classifyFailure: schema_mismatch is non_retryable', () => {
  expect(classifyFailure('schema_mismatch')).toBe('non_retryable');
});

// ── aggregateOutcome boundary cases (S4) ─────────────────────────────────────

test('aggregateOutcome: 0 captured, 1 retryable → retryable_failure', () => {
  const result = aggregateOutcome(
    [{ source: 'unavailable', errorClass: 'retryable' }],
    1,
  );
  expect(result).toEqual({ kind: 'retryable_failure' });
});

test('aggregateOutcome: 1 captured + 1 retryable → retryable_failure (just below ≥2 threshold)', () => {
  const result = aggregateOutcome(
    [
      { source: 'canonical_metric' },
      { source: 'unavailable', errorClass: 'retryable' },
    ],
    2,
  );
  expect(result).toEqual({ kind: 'retryable_failure' });
});

test('aggregateOutcome: 3 captured out of 3 opted-in → success confirmed', () => {
  const result = aggregateOutcome(
    [
      { source: 'canonical_metric' },
      { source: 'canonical_metric' },
      { source: 'canonical_metric' },
    ],
    3,
  );
  expect(result).toEqual({ kind: 'success', confidence: 'confirmed' });
});

test('aggregateOutcome: 1 captured + 1 non-retryable + 1 retryable → non_retryable_failure (non-retryable flag wins)', () => {
  const result = aggregateOutcome(
    [
      { source: 'canonical_metric' },
      { source: 'unavailable', errorClass: 'non_retryable' },
      { source: 'unavailable', errorClass: 'retryable' },
    ],
    3,
  );
  expect(result).toEqual({ kind: 'non_retryable_failure', reason: 'integration_not_connected' });
});

test('aggregateOutcome: 2 canonical + 1 non-retryable → success partial (success short-circuits failure when ≥2 captured)', () => {
  const result = aggregateOutcome(
    [
      { source: 'canonical_metric' },
      { source: 'canonical_metric' },
      { source: 'unavailable', errorClass: 'non_retryable' },
    ],
    3,
  );
  expect(result).toEqual({ kind: 'success', confidence: 'partial' });
});

// ── classifyFailure: synthetic terminal marker ────────────────────────────────

test('classifyFailure: retry_budget_exhausted → non_retryable (synthetic terminal marker, not in either classifier set)', () => {
  expect(classifyFailure('retry_budget_exhausted')).toBe('non_retryable');
});

// ── nextBackoffMinutes: zero attempt boundary ─────────────────────────────────

test('nextBackoffMinutes(0) = null (no attempt yet, before budget window)', () => {
  expect(nextBackoffMinutes(0)).toBeNull();
});
