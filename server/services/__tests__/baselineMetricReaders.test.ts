/**
 * baselineMetricReaders.test.ts
 *
 * Pure-function tests for the v1 metric reader row-transformation logic.
 *
 * Strategy: each reader exports a `transformXxxRows` function that accepts
 * canned rows and returns a MetricReaderResult — no DB connection or mocking
 * required. The DB queries are thin wrappers that collect rows then delegate.
 *
 * Run via:
 *   npx vitest run server/services/__tests__/baselineMetricReaders.test.ts
 */

import { describe, it, expect } from 'vitest';
import { transformPipelineValueRows } from '../baselineMetricReaders/getPipelineValue.js';
import { transformLeadCountRows } from '../baselineMetricReaders/getLeadCount.js';
import { transformRevenueLast30dRows } from '../baselineMetricReaders/getRevenueLast30d.js';
import { METRIC_READERS } from '../baselineMetricReaders/registry.js';
import { AVAILABLE_METRIC_SLUGS } from '../../../shared/constants/baselineMetrics.js';

// ── getPipelineValue ───────────────────────────────────────────────────────────

describe('transformPipelineValueRows', () => {
  it('1 row → correct numeric, currency, unit', () => {
    const result = transformPipelineValueRows([{ value: '47000' }]);
    expect(result.source).toBe('canonical_metric');
    expect(result.value).toEqual({ numeric: 47000, currency: 'USD', unit: 'cents' });
  });

  it('2 rows → sums correctly', () => {
    const result = transformPipelineValueRows([{ value: '20000' }, { value: '27000' }]);
    expect(result.source).toBe('canonical_metric');
    expect(result.value?.numeric).toBe(47000);
  });

  it('0 rows → unavailable / no_data_yet / retryable', () => {
    const result = transformPipelineValueRows([]);
    expect(result.source).toBe('unavailable');
    expect(result.unavailable_reason).toBe('no_data_yet');
    expect(result.errorClass).toBe('retryable');
    expect(result.value).toBeNull();
  });

  it('non-numeric value → unavailable / no_data_yet / non_retryable', () => {
    const result = transformPipelineValueRows([{ value: 'not_a_number' }]);
    expect(result.source).toBe('unavailable');
    expect(result.errorClass).toBe('non_retryable');
    expect(result.value).toBeNull();
  });
});

// ── getLeadCount ───────────────────────────────────────────────────────────────

describe('transformLeadCountRows', () => {
  it('1 row → correct numeric and unit, no currency field', () => {
    const result = transformLeadCountRows([{ value: '127' }]);
    expect(result.source).toBe('canonical_metric');
    expect(result.value).toEqual({ numeric: 127, unit: 'count' });
    expect(result.value && 'currency' in result.value).toBe(false);
  });
});

// ── getRevenueLast30d ──────────────────────────────────────────────────────────

describe('transformRevenueLast30dRows', () => {
  it('2 rows → sums values', () => {
    const result = transformRevenueLast30dRows([{ value: '15000' }, { value: '32000' }]);
    expect(result.source).toBe('canonical_metric');
    expect(result.value?.numeric).toBe(47000);
    expect(result.value).toMatchObject({ currency: 'USD', unit: 'cents' });
  });

  it('0 rows → unavailable / no_data_yet / retryable', () => {
    const result = transformRevenueLast30dRows([]);
    expect(result.source).toBe('unavailable');
    expect(result.unavailable_reason).toBe('no_data_yet');
    expect(result.errorClass).toBe('retryable');
  });
});

// ── Registry completeness ──────────────────────────────────────────────────────

describe('METRIC_READERS registry', () => {
  it('every AVAILABLE_METRIC_SLUG has a reader entry', () => {
    for (const slug of AVAILABLE_METRIC_SLUGS) {
      expect(METRIC_READERS[slug], `missing reader for slug "${slug}"`).toBeDefined();
    }
  });
});
