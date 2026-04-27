// ---------------------------------------------------------------------------
// BaselineReader — read-only query API for system_monitor_baselines.
//
// Satisfies the BaselineReader interface declared in heuristics/types.ts.
// No caching beyond the connection-pool query cache; the table is small
// and indexed on the natural key.
// ---------------------------------------------------------------------------

import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemMonitorBaselines } from '../../../db/schema/index.js';
import type { Baseline, BaselineReader, BaselineEntityKind } from '../heuristics/types.js';

function rowToBaseline(row: typeof systemMonitorBaselines.$inferSelect): Baseline {
  return {
    entityKind: row.entityKind as BaselineEntityKind,
    entityId: row.entityId,
    metric: row.metricName,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    sampleCount: row.sampleCount,
    p50: row.p50 ?? 0,
    p95: row.p95 ?? 0,
    p99: row.p99 ?? 0,
    mean: row.mean ?? 0,
    stddev: row.stddev ?? 0,
    min: row.min ?? 0,
    max: row.max ?? 0,
  };
}

async function get(
  entityKind: BaselineEntityKind,
  entityId: string,
  metric: string,
): Promise<Baseline | null> {
  const rows = await db
    .select()
    .from(systemMonitorBaselines)
    .where(
      and(
        eq(systemMonitorBaselines.entityKind, entityKind),
        eq(systemMonitorBaselines.entityId, entityId),
        eq(systemMonitorBaselines.metricName, metric),
      ),
    )
    .limit(1);

  return rows.length > 0 ? rowToBaseline(rows[0]!) : null;
}

async function getOrNull(
  entityKind: BaselineEntityKind,
  entityId: string,
  metric: string,
  minSampleCount: number,
): Promise<Baseline | null> {
  const baseline = await get(entityKind, entityId, metric);
  if (!baseline || baseline.sampleCount < minSampleCount) return null;
  return baseline;
}

/**
 * Singleton BaselineReader instance — share across heuristic context construction.
 * Uses the global db pool; no per-request isolation needed for read-only queries
 * against a system-bypass table.
 */
export const baselineReader: BaselineReader = { get, getOrNull };
