/**
 * baselineManualForm.test.ts
 *
 * Tests for manualMetricInputSchema — F3 §6 cross-field validation
 * (currency required when metric unit is 'cents').
 *
 * Run via:
 *   npx vitest run shared/schemas/__tests__/baselineManualForm.test.ts
 */

import { test, expect } from 'vitest';
import { manualMetricInputSchema, manualBaselineFormSchema } from '../baselineManualForm.js';

// ── currency required for cents-unit metrics ──────────────────────────────────

test('rejects pipeline_value (unit=cents) without currency', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'pipeline_value',
    numeric: 1500,
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path.join('.') === 'currency');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('currency is required');
  }
});

test('accepts pipeline_value (unit=cents) with currency', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'pipeline_value',
    numeric: 1500,
    currency: 'USD',
  });
  expect(result.success).toBe(true);
});

test('rejects revenue_last_30d (unit=cents) without currency', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'revenue_last_30d',
    numeric: 50_000,
  });
  expect(result.success).toBe(false);
});

test('accepts revenue_last_30d (unit=cents) with currency', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'revenue_last_30d',
    numeric: 50_000,
    currency: 'USD',
  });
  expect(result.success).toBe(true);
});

// ── currency NOT required for count / percent metrics ────────────────────────

test('accepts lead_count (unit=count) without currency', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'lead_count',
    numeric: 42,
  });
  expect(result.success).toBe(true);
});

test('accepts churn_rate (unit=percent) without currency', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'churn_rate',
    numeric: 0.05,
  });
  expect(result.success).toBe(true);
});

// ── nonnegative numeric ───────────────────────────────────────────────────────

test('rejects negative numeric value', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'lead_count',
    numeric: -1,
  });
  expect(result.success).toBe(false);
});

test('accepts zero numeric value', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'lead_count',
    numeric: 0,
  });
  expect(result.success).toBe(true);
});

// ── currency length must be exactly 3 (ISO-4217) ─────────────────────────────

test('rejects 2-char currency code', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'pipeline_value',
    numeric: 100,
    currency: 'US',
  });
  expect(result.success).toBe(false);
});

test('rejects 4-char currency code', () => {
  const result = manualMetricInputSchema.safeParse({
    slug: 'pipeline_value',
    numeric: 100,
    currency: 'USDX',
  });
  expect(result.success).toBe(false);
});

// ── form-level: at least one metric required ──────────────────────────────────

test('manualBaselineFormSchema rejects empty metrics array', () => {
  const result = manualBaselineFormSchema.safeParse({ metrics: [] });
  expect(result.success).toBe(false);
});

test('manualBaselineFormSchema accepts single valid metric', () => {
  const result = manualBaselineFormSchema.safeParse({
    metrics: [{ slug: 'lead_count', numeric: 10 }],
  });
  expect(result.success).toBe(true);
});

test('manualBaselineFormSchema accepts mixed cents+count metrics', () => {
  const result = manualBaselineFormSchema.safeParse({
    metrics: [
      { slug: 'pipeline_value', numeric: 5000, currency: 'USD' },
      { slug: 'lead_count', numeric: 25 },
    ],
  });
  expect(result.success).toBe(true);
});

test('manualBaselineFormSchema rejects when any metric is invalid', () => {
  const result = manualBaselineFormSchema.safeParse({
    metrics: [
      { slug: 'pipeline_value', numeric: 5000 }, // missing currency
      { slug: 'lead_count', numeric: 25 },
    ],
  });
  expect(result.success).toBe(false);
});
