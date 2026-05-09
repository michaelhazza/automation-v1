/**
 * spendInsightsServicePure — pure rankings + deltas for org-scope insights tiles.
 * Spec: §4.4. UTC throughout. Cost precision: cents → USD via /100 (plan §3 Gap 2).
 */

export interface WorkspaceMonthlySpend {
  workspaceId: string;
  workspaceName: string;
  mtdCents: number;
  prevMonthCents: number | null;
}

export interface AgentRunCount {
  agentId: string;
  agentName: string;
  workspaceId: string;
  workspaceName: string;
  runs30d: number;
}

export interface SpendInsightsOutput {
  topSpender: {
    workspace: { id: string; name: string };
    mtdUsd: number;
    pctOfOrgTotal: number;
    deltaPct: number | null;
  } | null;
  fastestGrower: {
    workspace: { id: string; name: string };
    deltaPct: number | null;
  } | null;
  mostActiveAgent: {
    agent: { id: string; name: string };
    runs30d: number;
    workspace: { id: string; name: string };
  } | null;
}

/** Returns null when prev is 0 or null. Spec §4.4. */
export function computeDeltaPct(currentCents: number, prevCents: number | null): number | null {
  if (prevCents === null || prevCents === 0) return null;
  return ((currentCents - prevCents) / prevCents) * 100;
}

export function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}

export function computeInsights(
  spends: ReadonlyArray<WorkspaceMonthlySpend>,
  runs: ReadonlyArray<AgentRunCount>,
): SpendInsightsOutput {
  if (spends.length === 0 && runs.length === 0) {
    return { topSpender: null, fastestGrower: null, mostActiveAgent: null };
  }

  const orgTotalMtdCents = spends.reduce((acc, w) => acc + w.mtdCents, 0);

  // INVARIANT I6 — deterministic ordering, final tiebreaker is id asc
  const topSpenderRow = [...spends].sort((a, b) =>
    b.mtdCents - a.mtdCents ||
    b.workspaceName.localeCompare(a.workspaceName) ||
    a.workspaceId.localeCompare(b.workspaceId),
  )[0] ?? null;

  const grower = spends
    .map((w) => ({ w, delta: computeDeltaPct(w.mtdCents, w.prevMonthCents) }))
    .filter((x): x is { w: WorkspaceMonthlySpend; delta: number } => x.delta !== null)
    .sort((a, b) =>
      b.delta - a.delta ||
      b.w.workspaceName.localeCompare(a.w.workspaceName) ||
      a.w.workspaceId.localeCompare(b.w.workspaceId),
    )[0];

  const mostActive = [...runs].sort((a, b) =>
    b.runs30d - a.runs30d ||
    b.agentName.localeCompare(a.agentName) ||
    a.agentId.localeCompare(b.agentId),
  )[0] ?? null;

  return {
    topSpender: topSpenderRow ? {
      workspace: { id: topSpenderRow.workspaceId, name: topSpenderRow.workspaceName },
      mtdUsd: centsToUsd(topSpenderRow.mtdCents),
      pctOfOrgTotal: orgTotalMtdCents === 0 ? 0 : (topSpenderRow.mtdCents / orgTotalMtdCents) * 100,
      deltaPct: computeDeltaPct(topSpenderRow.mtdCents, topSpenderRow.prevMonthCents),
    } : null,
    fastestGrower: grower ? {
      workspace: { id: grower.w.workspaceId, name: grower.w.workspaceName },
      deltaPct: grower.delta,
    } : null,
    mostActiveAgent: mostActive ? {
      agent: { id: mostActive.agentId, name: mostActive.agentName },
      runs30d: mostActive.runs30d,
      workspace: { id: mostActive.workspaceId, name: mostActive.workspaceName },
    } : null,
  };
}
