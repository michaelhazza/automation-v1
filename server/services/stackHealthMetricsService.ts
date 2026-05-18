// stackHealthMetricsService — on-demand stack-health metric computation.
// Closed-Loop Skill Improvement spec §10 (Chunk 9).

import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';

export interface StackHealthMetrics {
  amendmentDensity: number;         // accepted_count / 20
  conflictRate: number;             // 0 for Phase 1 (divergence events not in a queryable table)
  rollbackRate: number;             // rollback retirements last 30d / accepts last 30d
  staleRatio: number;               // stale retirements last 30d / total proposals last 30d
  editFrequency: number;            // 0 for Phase 1 (accept_after_edit count not tracked separately)
  compositionSizeTrend: number;     // avg composed_size_chars last 30d minus prior 30d (from effectiveness sidecar); 0 if no data
}

// ── Pure math helpers (exported so tests can cover them) ─────────────────────

export function computeAmendmentDensity(acceptedCount: number): number {
  return acceptedCount / 20;
}

export function computeRollbackRate(rollbackRetirements30d: number, accepts30d: number): number {
  if (accepts30d === 0) return 0;
  return rollbackRetirements30d / accepts30d;
}

export function computeStaleRatio(staleRetirements30d: number, totalProposals30d: number): number {
  if (totalProposals30d === 0) return 0;
  return staleRetirements30d / totalProposals30d;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function computeMetrics(args: {
  orgId: string;
  subaccountId: string;
  skillId: string;
}): Promise<StackHealthMetrics> {
  const { orgId, subaccountId, skillId } = args;
  const db = getOrgScopedDb('stackHealthMetricsService');

  // A skillId coming from the route can be either a UUID (system or org skill)
  // or a text slug. We match against both columns using an OR predicate.
  const rows = (await db.execute(sql`
    SELECT
      -- accepted count (all time) for density
      COUNT(*) FILTER (WHERE status = 'accepted') AS accepted_count,

      -- rollback retirements in last 30d
      COUNT(*) FILTER (
        WHERE status = 'retired'
          AND retirement_reason = 'rollback'
          AND retired_at >= now() - interval '30 days'
      ) AS rollback_retirements_30d,

      -- accepts in last 30d (for rollback rate denominator)
      COUNT(*) FILTER (
        WHERE status = 'accepted'
          AND activated_at >= now() - interval '30 days'
      ) AS accepts_30d,

      -- stale retirements in last 30d
      COUNT(*) FILTER (
        WHERE status = 'retired'
          AND retirement_reason = 'stale'
          AND retired_at >= now() - interval '30 days'
      ) AS stale_retirements_30d,

      -- total proposals in last 30d (any status)
      COUNT(*) FILTER (
        WHERE created_at >= now() - interval '30 days'
      ) AS total_proposals_30d

    FROM skill_amendments
    WHERE
      org_id = ${orgId}::uuid
      AND subaccount_id = ${subaccountId}::uuid
      AND (
        system_skill_id::text = ${skillId}
        OR org_skill_id::text = ${skillId}
      )
  `)) as unknown as Array<{
    accepted_count: string | null;
    rollback_retirements_30d: string | null;
    accepts_30d: string | null;
    stale_retirements_30d: string | null;
    total_proposals_30d: string | null;
  }>;

  const row = rows[0];
  const acceptedCount = Number(row?.accepted_count ?? 0);
  const rollbackRetirements30d = Number(row?.rollback_retirements_30d ?? 0);
  const accepts30d = Number(row?.accepts_30d ?? 0);
  const staleRetirements30d = Number(row?.stale_retirements_30d ?? 0);
  const totalProposals30d = Number(row?.total_proposals_30d ?? 0);

  return {
    amendmentDensity: computeAmendmentDensity(acceptedCount),
    conflictRate: 0,
    rollbackRate: computeRollbackRate(rollbackRetirements30d, accepts30d),
    staleRatio: computeStaleRatio(staleRetirements30d, totalProposals30d),
    editFrequency: 0,
    compositionSizeTrend: 0,
  };
}
