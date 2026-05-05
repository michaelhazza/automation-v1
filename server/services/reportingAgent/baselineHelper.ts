import { and, eq, inArray, desc } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { subaccountBaselines, subaccountBaselineMetrics } from '../../db/schema/index.js';
import type { BaselineMetricSlug } from '../../../shared/constants/baselineMetrics.js';

export interface BaselineSnapshot {
  id: string;
  subaccountId: string;
  baselineVersion: number;
  status: 'captured' | 'manual';
  source: string;
  confidence: string;
  capturedAt: Date;
  metrics: Array<{
    slug: BaselineMetricSlug;
    value: { numeric: number; currency?: string; unit: string } | null;
    source: string;
    unavailableReason?: string;
  }>;
}

/**
 * F3 §7 — read the active captured baseline for a subaccount.
 * Returns null when no captured/manual baseline exists.
 *
 * Uses `getOrgScopedDb` so the FORCE-RLS policy on `subaccount_baselines` sees
 * the right `app.organisation_id` GUC; bare `db` would run on a fresh pool
 * connection without the GUC and silently filter to zero rows.
 *
 * Orders by `baseline_version DESC LIMIT 1` so that after an admin reset
 * followed by a fresh capture the helper returns the latest captured/manual
 * baseline rather than a non-deterministic prior row.
 */
export async function getBaselineForSubaccount(
  organisationId: string,
  subaccountId: string,
): Promise<BaselineSnapshot | null> {
  const orgDb = getOrgScopedDb('getBaselineForSubaccount');
  const [baseline] = await orgDb
    .select()
    .from(subaccountBaselines)
    .where(and(
      eq(subaccountBaselines.organisationId, organisationId),
      eq(subaccountBaselines.subaccountId, subaccountId),
      inArray(subaccountBaselines.status, ['captured', 'manual']),
    ))
    .orderBy(desc(subaccountBaselines.baselineVersion))
    .limit(1);
  if (!baseline) return null;

  const metrics = await orgDb
    .select()
    .from(subaccountBaselineMetrics)
    .where(eq(subaccountBaselineMetrics.baselineId, baseline.id));

  return {
    id: baseline.id,
    subaccountId: baseline.subaccountId,
    baselineVersion: baseline.baselineVersion,
    status: baseline.status as 'captured' | 'manual',
    source: baseline.source,
    confidence: baseline.confidence,
    capturedAt: baseline.capturedAt!,
    metrics: metrics.map((m) => ({
      slug: m.metricSlug as BaselineMetricSlug,
      value: m.value as { numeric: number; currency?: string; unit: string } | null,
      source: m.source,
      unavailableReason: m.unavailableReason ?? undefined,
    })),
  };
}

export interface MetricDelta {
  slug: BaselineMetricSlug;
  baselineValue: number | null;
  currentValue: number;
  delta: number | null;
  pct: number | null;
  unavailableAtBaseline: boolean;
}

/**
 * F3 §7 — compute delta between current and baseline values.
 * Pure function — no DB reads. Returns null delta/pct when baseline metric
 * was unavailable (narrated as "first measurement is today's value").
 */
export function computeDelta(
  baselineSnapshot: BaselineSnapshot | null,
  currentMetrics: Array<{ slug: BaselineMetricSlug; numeric: number }>,
): MetricDelta[] {
  return currentMetrics.map((cur) => {
    const b = baselineSnapshot?.metrics.find((m) => m.slug === cur.slug);
    if (!b || !b.value || b.source === 'unavailable') {
      return {
        slug: cur.slug,
        baselineValue: null,
        currentValue: cur.numeric,
        delta: null,
        pct: null,
        unavailableAtBaseline: true,
      };
    }
    const delta = cur.numeric - b.value.numeric;
    const pct = b.value.numeric === 0 ? null : (delta / b.value.numeric) * 100;
    return {
      slug: cur.slug,
      baselineValue: b.value.numeric,
      currentValue: cur.numeric,
      delta,
      pct,
      unavailableAtBaseline: false,
    };
  });
}
