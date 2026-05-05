import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { connectorConfigs } from '../db/schema/connectorConfigs.js';
import { canonicalMetrics } from '../db/schema/canonicalMetrics.js';
import { canonicalAccounts } from '../db/schema/canonicalAccounts.js';
import {
  evaluateReadiness,
  CORE_METRIC_SLUGS,
} from './baselineReadinessPure.js';

export type { ReadinessResult, CoreConnectorRow, CoreMetricRow } from './baselineReadinessPure.js';
export { evaluateReadiness, CORE_METRIC_SLUGS } from './baselineReadinessPure.js';

/**
 * F3 §4 — pure read over four conditions:
 *   (1) ≥1 active connector for the subaccount
 *   (2) ≥2 successful polls (via connector_configs.successful_poll_count_total)
 *   (3) Settle window: now() - first_qualifying_poll_at >= 1h (evaluated in Postgres)
 *   (4) ≥2 of 4 core metrics non-null in canonical_metrics
 *
 * Idempotent. Never mutates state.
 */
export const baselineReadinessService = {
  async evaluate(subaccountId: string, organisationId: string) {
    const tx = getOrgScopedDb('baselineReadinessService.evaluate');

    // (1) + (2) + (3) — query connector_configs. Settle-window comparison is
    // evaluated inside Postgres via interval arithmetic (§6 DB-time invariant).
    const connectors = await tx
      .select({
        pollCount: connectorConfigs.successfulPollCountTotal,
        firstAt: connectorConfigs.firstQualifyingPollAt,
        settleOk: sql<boolean>`(${connectorConfigs.firstQualifyingPollAt} IS NOT NULL AND now() - ${connectorConfigs.firstQualifyingPollAt} >= interval '1 hour')`,
      })
      .from(connectorConfigs)
      .where(
        and(
          eq(connectorConfigs.organisationId, organisationId),
          eq(connectorConfigs.subaccountId, subaccountId),
          eq(connectorConfigs.status, 'active'),
        ),
      );

    // (4) — count of non-null currentValue for core slugs in canonical_metrics.
    const metricRows = await tx
      .select({ slug: canonicalMetrics.metricSlug })
      .from(canonicalMetrics)
      .innerJoin(canonicalAccounts, eq(canonicalAccounts.id, canonicalMetrics.accountId))
      .where(
        and(
          eq(canonicalAccounts.organisationId, organisationId),
          eq(canonicalAccounts.subaccountId, subaccountId),
          isNotNull(canonicalMetrics.currentValue),
          inArray(canonicalMetrics.metricSlug, [...CORE_METRIC_SLUGS]),
        ),
      );

    return evaluateReadiness(connectors, metricRows);
  },
};
