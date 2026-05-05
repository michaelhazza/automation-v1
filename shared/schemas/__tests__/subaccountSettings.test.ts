/**
 * subaccountSettings.test.ts
 *
 * Tests for resolveBaselineOptIn — opt-in resolution logic for F3 §2. Run via:
 *   npx vitest run shared/schemas/__tests__/subaccountSettings.test.ts
 */

import { test, expect } from 'vitest';
import { resolveBaselineOptIn } from '../subaccount.js';
import { ALL_METRIC_SLUGS } from '../../constants/baselineMetrics.js';

// ── Default fallback (null / empty settings) ──────────────────────────────────

test('resolveBaselineOptIn(null) returns ALL_METRIC_SLUGS', () => {
  expect(resolveBaselineOptIn(null)).toEqual(ALL_METRIC_SLUGS);
});

test('resolveBaselineOptIn({}) returns ALL_METRIC_SLUGS (no opt-in key)', () => {
  expect(resolveBaselineOptIn({})).toEqual(ALL_METRIC_SLUGS);
});

// ── Valid opt-in subset ───────────────────────────────────────────────────────

test('resolveBaselineOptIn with valid slugs returns those slugs', () => {
  const result = resolveBaselineOptIn({ baseline_metrics_opt_in: ['pipeline_value', 'lead_count'] });
  expect(result).toEqual(['pipeline_value', 'lead_count']);
});

// ── Invalid slug falls back to ALL_METRIC_SLUGS ───────────────────────────────

test('resolveBaselineOptIn with invalid slug falls back to ALL_METRIC_SLUGS', () => {
  // zod rejects the unknown enum value — safeParse returns failure → fallback
  expect(resolveBaselineOptIn({ baseline_metrics_opt_in: ['made_up_slug'] })).toEqual(ALL_METRIC_SLUGS);
});

// ── Extra keys pass through (passthrough schema) ──────────────────────────────

test('resolveBaselineOptIn with extra keys still resolves opt-in correctly', () => {
  const result = resolveBaselineOptIn({ otherKey: 'value', baseline_metrics_opt_in: ['lead_count'] });
  expect(result).toEqual(['lead_count']);
});
