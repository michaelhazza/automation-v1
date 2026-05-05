import type { BaselineMetricSlug } from '../../../shared/constants/baselineMetrics.js';
import type { ErrorClass } from '../baselineRetryClassifierPure.js';
import { getPipelineValue } from './getPipelineValue.js';
import { getOpenOpportunityCount } from './getOpenOpportunityCount.js';
import { getLeadCount } from './getLeadCount.js';
import { getConversationEngagement } from './getConversationEngagement.js';
import { getRevenueLast30d } from './getRevenueLast30d.js';

export interface MetricReaderResult {
  value: { numeric: number; currency?: string; unit: string } | null;
  source: 'canonical_metric' | 'unavailable';
  unavailable_reason?: 'integration_not_connected' | 'api_failure' | 'no_data_yet';
  errorClass?: ErrorClass;
}

export type BaselineMetricReader = (
  ctx: { organisationId: string; subaccountId: string }
) => Promise<MetricReaderResult>;

export const METRIC_READERS: Partial<Record<BaselineMetricSlug, BaselineMetricReader>> = {
  pipeline_value: getPipelineValue,
  open_opportunity_count: getOpenOpportunityCount,
  lead_count: getLeadCount,
  conversation_engagement: getConversationEngagement,
  revenue_last_30d: getRevenueLast30d,
};

/**
 * Synthetic reader for v1 metrics with no adapter. Returns
 * `{source:'unavailable', unavailable_reason:'integration_not_connected', errorClass:'non_retryable'}`.
 * Used by the capture service for slugs marked `readerStatus: 'unavailable_default'`
 * in `V1_BASELINE_METRICS`.
 */
export const UNAVAILABLE_INTEGRATION_NOT_CONNECTED: MetricReaderResult = {
  value: null,
  source: 'unavailable',
  unavailable_reason: 'integration_not_connected',
  errorClass: 'non_retryable',
};
