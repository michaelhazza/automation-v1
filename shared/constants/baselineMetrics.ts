/**
 * F3 §2 — v1 metric registry. Each entry pins:
 *   - slug: stable identifier (matches subaccount_baseline_metrics.metric_slug)
 *   - unit: 'cents' | 'count' | 'percent'
 *   - currencyHint: present when unit='cents'
 *   - readerStatus: 'available' (has reader) | 'unavailable_default' (no
 *     adapter; written as source='unavailable' with non_retryable class)
 *   - source: provider name for narration ('GHL', 'Stripe', etc.)
 */
export const V1_BASELINE_METRICS = [
  { slug: 'pipeline_value',           unit: 'cents',   currencyHint: 'USD', readerStatus: 'available',           source: 'GHL' },
  { slug: 'open_opportunity_count',   unit: 'count',                         readerStatus: 'available',           source: 'GHL' },
  { slug: 'lead_count',               unit: 'count',                         readerStatus: 'available',           source: 'GHL' },
  { slug: 'conversation_engagement',  unit: 'count',                         readerStatus: 'available',           source: 'GHL' },
  { slug: 'revenue_last_30d',         unit: 'cents',   currencyHint: 'USD', readerStatus: 'available',           source: 'Stripe' },
  // Out-of-scope — no adapter; recorded as unavailable / non_retryable.
  { slug: 'gmb_rank',                 unit: 'count',                         readerStatus: 'unavailable_default', source: 'Google Business Profile' },
  { slug: 'review_count',             unit: 'count',                         readerStatus: 'unavailable_default', source: 'Google Business Profile' },
  { slug: 'review_avg_rating',        unit: 'count', /* approximation: 0-5 rating scale; unit enum has no 'rating' value */ readerStatus: 'unavailable_default', source: 'Google Business Profile' },
  { slug: 'mrr',                      unit: 'cents',   currencyHint: 'USD', readerStatus: 'unavailable_default', source: 'Stripe' },
  { slug: 'customer_count',           unit: 'count',                         readerStatus: 'unavailable_default', source: 'Stripe' },
  { slug: 'churn_rate',               unit: 'percent',                       readerStatus: 'unavailable_default', source: 'Stripe' },
] as const;

export type BaselineMetricSlug = typeof V1_BASELINE_METRICS[number]['slug'];

export const ALL_METRIC_SLUGS: readonly BaselineMetricSlug[] =
  V1_BASELINE_METRICS.map((m) => m.slug);

export const AVAILABLE_METRIC_SLUGS: readonly BaselineMetricSlug[] =
  V1_BASELINE_METRICS.filter((m) => m.readerStatus === 'available').map((m) => m.slug);

export function isBaselineMetricSlug(s: string): s is BaselineMetricSlug {
  return ALL_METRIC_SLUGS.includes(s as BaselineMetricSlug);
}

export function metricMeta(slug: BaselineMetricSlug) {
  return V1_BASELINE_METRICS.find((m) => m.slug === slug)!;
}
