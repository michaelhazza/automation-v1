import { and, eq } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { canonicalMetrics } from '../../db/schema/canonicalMetrics.js';
import { canonicalAccounts } from '../../db/schema/canonicalAccounts.js';
import type { BaselineMetricReader, MetricReaderResult } from './registry.js';

export function transformOpenOpportunityCountRows(rows: { value: unknown }[]): MetricReaderResult {
  if (rows.length === 0) {
    return { value: null, source: 'unavailable', unavailable_reason: 'no_data_yet', errorClass: 'retryable' };
  }
  let sum = 0;
  for (const r of rows) {
    const n = Number(r.value);
    if (!Number.isFinite(n)) {
      return { value: null, source: 'unavailable', unavailable_reason: 'no_data_yet', errorClass: 'non_retryable' };
    }
    sum += n;
  }
  return { value: { numeric: Math.round(sum), unit: 'count' }, source: 'canonical_metric' };
}

export const getOpenOpportunityCount: BaselineMetricReader = async ({ organisationId, subaccountId }) => {
  const rows = await getOrgScopedDb('getOpenOpportunityCount')
    .select({ value: canonicalMetrics.currentValue })
    .from(canonicalMetrics)
    .innerJoin(canonicalAccounts, eq(canonicalAccounts.id, canonicalMetrics.accountId))
    .where(and(
      eq(canonicalAccounts.organisationId, organisationId),
      eq(canonicalAccounts.subaccountId, subaccountId),
      eq(canonicalMetrics.metricSlug, 'open_opportunity_count'),
    ));
  return transformOpenOpportunityCountRows(rows);
};
