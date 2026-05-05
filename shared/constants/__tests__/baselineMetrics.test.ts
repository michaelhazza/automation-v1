/**
 * baselineMetrics.test.ts
 *
 * Registry-integrity tests for the v1 baseline metric definitions. Run via:
 *   npx vitest run shared/constants/__tests__/baselineMetrics.test.ts
 */

import { test, expect } from 'vitest';
import {
  V1_BASELINE_METRICS,
  ALL_METRIC_SLUGS,
  AVAILABLE_METRIC_SLUGS,
  isBaselineMetricSlug,
} from '../baselineMetrics.js';

// ── Length invariants ─────────────────────────────────────────────────────────

test('ALL_METRIC_SLUGS.length matches V1_BASELINE_METRICS.length', () => {
  expect(ALL_METRIC_SLUGS.length).toBe(V1_BASELINE_METRICS.length);
});

// ── Uniqueness ────────────────────────────────────────────────────────────────

test('all slugs in ALL_METRIC_SLUGS are unique (no duplicates)', () => {
  const unique = new Set(ALL_METRIC_SLUGS);
  expect(unique.size).toBe(ALL_METRIC_SLUGS.length);
});

// ── isBaselineMetricSlug ──────────────────────────────────────────────────────

test('isBaselineMetricSlug: pipeline_value is a known slug', () => {
  expect(isBaselineMetricSlug('pipeline_value')).toBe(true);
});

test('isBaselineMetricSlug: made_up is not a known slug', () => {
  expect(isBaselineMetricSlug('made_up')).toBe(false);
});

// ── AVAILABLE_METRIC_SLUGS ────────────────────────────────────────────────────

test('AVAILABLE_METRIC_SLUGS contains exactly the 5 expected slugs', () => {
  const expected = new Set([
    'pipeline_value',
    'open_opportunity_count',
    'lead_count',
    'conversation_engagement',
    'revenue_last_30d',
  ]);
  expect(AVAILABLE_METRIC_SLUGS.length).toBe(5);
  for (const slug of AVAILABLE_METRIC_SLUGS) {
    expect(expected.has(slug)).toBe(true);
  }
});

// ── unavailable_default entries ───────────────────────────────────────────────

test('every unavailable_default slug is in ALL_METRIC_SLUGS but not in AVAILABLE_METRIC_SLUGS', () => {
  const unavailable = V1_BASELINE_METRICS.filter((m) => m.readerStatus === 'unavailable_default');
  const allSet = new Set(ALL_METRIC_SLUGS);
  const availableSet = new Set(AVAILABLE_METRIC_SLUGS);
  for (const m of unavailable) {
    expect(allSet.has(m.slug)).toBe(true);
    expect(availableSet.has(m.slug)).toBe(false);
  }
});

// ── currency / unit invariants ────────────────────────────────────────────────

test('every entry with unit=cents has a currencyHint', () => {
  for (const m of V1_BASELINE_METRICS) {
    if (m.unit === 'cents') {
      expect((m as { currencyHint?: string }).currencyHint).toBeDefined();
    }
  }
});

test('every entry without a currencyHint does NOT have unit=cents', () => {
  for (const m of V1_BASELINE_METRICS) {
    if (!('currencyHint' in m)) {
      expect(m.unit).not.toBe('cents');
    }
  }
});
