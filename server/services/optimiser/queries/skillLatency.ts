// ---------------------------------------------------------------------------
// Query module: optimiser.skill.slow  (peer-medians-dependent)
//
// Computes per-subaccount p95 skill latency from agent_execution_events and
// compares it against cross-tenant peer medians from the
// optimiser_skill_peer_medians materialised view.
//
// This module exposes two callables rather than the standard `QueryModule`
// interface because:
//   1. The orchestrator (Chunk 5) must check view population BEFORE deciding
//      whether to call the query (empty view → partial mode, not failure).
//   2. The query requires an `expectedMedianVersion` parameter so the
//      orchestrator can assert row-level version consistency (invariant 32).
//
// Authoritative timestamp: agent_execution_events.event_timestamp
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import type { OrgScopedTx } from '../../../db/index.js';
import { withAdminConnectionGuarded } from '../../../lib/rlsBoundaryGuard.js';
import type { QueryRow } from './types.js';

export interface SkillSlowEvidence {
  skillSlug: string;
  thisP95Ms: number;
  peerP50Ms: number;
  peerP95Ms: number;
  nTenants: number;
  medianVersion: number;
  /** Ratio: thisP95Ms / peerP95Ms — computed in the query layer */
  ratioVsPeerP95: number;
}

// ---------------------------------------------------------------------------
// peerMediansViewIsPopulated
// ---------------------------------------------------------------------------

/**
 * Returns true if the optimiser_skill_peer_medians materialised view contains
 * at least one row.
 *
 * The orchestrator calls this BEFORE running runSkillLatencyQuery.
 * When the view is empty, the orchestrator emits `optimiser.scan.partial` and
 * skips this category entirely — no error is raised.
 *
 * The view is REVOKED from the default role (migration 0277); this function
 * uses withAdminConnectionGuarded internally to access it.
 */
export async function peerMediansViewIsPopulated(): Promise<boolean> {
  // allowRlsBypass: read-only existence check on optimiser_skill_peer_medians (cross-tenant aggregate, excluded from RLS)
  return withAdminConnectionGuarded(
    { source: 'optimiser.peer_medians.populated_check', allowRlsBypass: false },
    async (adminTx) => {
      const rows = await adminTx.execute<{ populated: boolean }>(sql`
        SELECT EXISTS(
          SELECT 1 FROM optimiser_skill_peer_medians LIMIT 1
        ) AS populated
      `);
      const row = rows[0];
      return row?.populated === true;
    },
  );
}

// ---------------------------------------------------------------------------
// runSkillLatencyQuery
// ---------------------------------------------------------------------------

/**
 * Compute per-subaccount p95 skill latency for the past 7 days and compare
 * against cross-tenant peer medians.
 *
 * **MUST be called within `withAdminConnectionGuarded`.**
 * The JOIN to `optimiser_skill_peer_medians` requires the admin_role because
 * that view is REVOKE'd from the default role (it is a cross-tenant aggregate;
 * see migrations/0277_optimiser_peer_medians.sql). The orchestrator (Chunk 5)
 * is responsible for wrapping this call inside `withAdminConnectionGuarded`.
 *
 * Invariant 32: the JOIN includes `AND pm.median_version = $expectedMedianVersion`
 * to ensure that query results and the peer-median baseline are atomically
 * consistent. If the view has been refreshed since the orchestrator last read
 * the version, the JOIN produces no rows and this function returns `[]`.
 *
 * Invariant 22: returning `[]` (empty array) is the correct signal for partial
 * mode. The orchestrator emits `optimiser.scan.partial` in that case; this
 * function never throws for a version mismatch.
 *
 * @param tx   Admin-guarded transaction handle.
 * @param subaccountId  The subaccount to analyse.
 * @param expectedMedianVersion  The peer-median version the orchestrator read
 *   when deciding to run this query. Rows from a different version are excluded.
 */
export async function runSkillLatencyQuery(
  tx: OrgScopedTx,
  subaccountId: string,
  expectedMedianVersion: number,
): Promise<QueryRow<SkillSlowEvidence>[]> {
  await tx.execute(sql`SET LOCAL statement_timeout = '10000'`);

  const rows = await tx.execute<{
    subaccount_id: string;
    skill_slug: string;
    metric_value: string;
    computed_at: string;
    this_p95_ms: string;
    peer_p50_ms: string;
    peer_p95_ms: string;
    n_tenants: string;
    median_version: number;
  }>(sql`
    WITH subaccount_p95 AS (
      SELECT
        payload->>'skillSlug'                                                   AS skill_slug,
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY (payload->>'durationMs')::numeric
        )                                                                        AS p95_ms,
        count(*)                                                                 AS execution_count
      FROM agent_execution_events
      WHERE event_type = 'skill.completed'
        AND event_timestamp >= now() - interval '7 days'
        AND subaccount_id = ${subaccountId}::uuid
        AND payload ? 'skillSlug'
        AND payload ? 'durationMs'
      GROUP BY payload->>'skillSlug'
    )
    SELECT
      ${subaccountId}::uuid                         AS subaccount_id,
      sq.skill_slug                                 AS skill_slug,
      COALESCE(sq.p95_ms, 0)                        AS metric_value,
      now()                                         AS computed_at,
      sq.p95_ms                                     AS this_p95_ms,
      pm.p50_ms                                     AS peer_p50_ms,
      pm.p95_ms                                     AS peer_p95_ms,
      pm.n_tenants                                  AS n_tenants,
      pm.median_version                             AS median_version
    FROM subaccount_p95 sq
    JOIN optimiser_skill_peer_medians pm
      ON sq.skill_slug = pm.skill_slug
      AND pm.median_version = ${expectedMedianVersion}
    WHERE sq.p95_ms IS NOT NULL
  `);

  if (!rows || rows.length === 0) {
    // Invariant 22: empty result is the partial-mode signal — not an error.
    return [];
  }

  return rows.map((row): QueryRow<SkillSlowEvidence> => {
    const thisP95Ms = Number(row.this_p95_ms);
    const peerP95Ms = Number(row.peer_p95_ms);
    const ratioVsPeerP95 = peerP95Ms > 0 ? thisP95Ms / peerP95Ms : 0;

    return {
      subaccountId: row.subaccount_id,
      metricKey: row.skill_slug ?? '',
      metricValue: Number(row.metric_value),
      computedAt: new Date(row.computed_at),
      evidence: {
        skillSlug: row.skill_slug ?? '',
        thisP95Ms,
        peerP50Ms: Number(row.peer_p50_ms),
        peerP95Ms,
        nTenants: Number(row.n_tenants),
        medianVersion: row.median_version,
        ratioVsPeerP95: Number(ratioVsPeerP95.toFixed(4)),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

/**
 * skillLatencyModule — peer-medians-dependent category descriptor.
 *
 * This object intentionally does NOT implement the standard `QueryModule`
 * interface — it exposes `peerMediansViewIsPopulated` and
 * `runSkillLatencyQuery` as top-level callables because the orchestrator
 * (Chunk 5) must handle them specially (view-population check, admin
 * connection, version parameter).
 */
export const skillLatencyModule = {
  category: 'optimiser.skill.slow',
  authoritativeTimestampColumn: 'agent_execution_events.event_timestamp',
  readReplicaSafe: true as const,
  peerMediansViewIsPopulated,
  runSkillLatencyQuery,
};
