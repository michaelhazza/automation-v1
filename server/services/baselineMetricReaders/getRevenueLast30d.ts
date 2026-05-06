import { and, eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { canonicalMetricHistory } from '../../db/schema/canonicalMetrics.js';
import { canonicalAccounts } from '../../db/schema/canonicalAccounts.js';
import type { BaselineMetricReader, MetricReaderResult } from './registry.js';

export function transformRevenueLast30dRows(rows: { value: unknown }[]): MetricReaderResult {
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
  return { value: { numeric: Math.round(sum), currency: 'USD', unit: 'cents' }, source: 'canonical_metric' };
}

export const getRevenueLast30d: BaselineMetricReader = async ({ organisationId, subaccountId }) => {
  // §10 timestamp invariant: defer the 30-day window to Postgres so the
  // comparison anchor is the DB clock, never the Node process clock.
  const rows = await getOrgScopedDb('getRevenueLast30d')
    .select({ value: canonicalMetricHistory.value })
    .from(canonicalMetricHistory)
    .innerJoin(canonicalAccounts, eq(canonicalAccounts.id, canonicalMetricHistory.accountId))
    .where(and(
      eq(canonicalAccounts.organisationId, organisationId),
      eq(canonicalAccounts.subaccountId, subaccountId),
      eq(canonicalMetricHistory.metricSlug, 'revenue_last_30d'),
      sql`${canonicalMetricHistory.computedAt} >= now() - interval '30 days'`,
    ));
  return transformRevenueLast30dRows(rows);
};
