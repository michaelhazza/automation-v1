/**
 * spendTrendsServicePure — top-4 ranking + synthetic Other rollup + cap classification.
 * Spec: §4.5.
 * INVARIANTS:
 * - actual_workspace_count <= 5: array length = actual count; no Other entry.
 * - actual_workspace_count >  5: top-4 + synthetic Other at index 4.
 * - INVARIANT I6: final tiebreaker is workspaceId (asc) for determinism.
 */

export interface WorkspaceTrendInput {
  workspaceId: string;
  workspaceName: string;
  spend6moCents: number[];   // length 6, oldest → current month
  cap6moCents: Array<number | null>; // length 6
  currentMtdCents: number;   // used for ranking
}

export interface WorkspaceTrendOutput {
  id: string;
  name: string;
  spend6mo: number[];
  capUsage6mo: Array<number | null>;
  capBlownAt: number | null;
}

export interface TrendsOutput {
  workspaces: WorkspaceTrendOutput[];
  monthLabels: string[];
}

export function centsToUsdRounded(cents: number): number {
  return Math.round(cents) / 100;
}

/** cap 0 || null → null (unbounded). Spec §4.5. */
export function classifyCapUsage(spendCents: number, capCents: number | null): number | null {
  if (capCents === null || capCents === 0) return null;
  return (spendCents / capCents) * 100;
}

/** First index where capUsage > 100, treating null as "not blown". Spec §4.5. */
export function firstBlownIndex(capUsage: ReadonlyArray<number | null>): number | null {
  for (let i = 0; i < capUsage.length; i++) {
    const v = capUsage[i];
    if (v !== null && v > 100) return i;
  }
  return null;
}

export function projectIndividual(w: WorkspaceTrendInput): WorkspaceTrendOutput {
  const capUsage6mo = w.spend6moCents.map((s, i) => classifyCapUsage(s, w.cap6moCents[i]));
  return {
    id: w.workspaceId,
    name: w.workspaceName,
    spend6mo: w.spend6moCents.map(centsToUsdRounded),
    capUsage6mo,
    capBlownAt: firstBlownIndex(capUsage6mo),
  };
}

/** Synthetic Other rollup from non-top-4. Zero-cap contributors add 0 to summed cap. */
export function projectOther(rest: ReadonlyArray<WorkspaceTrendInput>): WorkspaceTrendOutput {
  const len = 6;
  const summedSpend: number[] = Array(len).fill(0);
  const summedCap: number[] = Array(len).fill(0);
  for (const w of rest) {
    for (let i = 0; i < len; i++) {
      summedSpend[i] += w.spend6moCents[i];
      const c = w.cap6moCents[i];
      summedCap[i] += c === null ? 0 : c;
    }
  }
  const capUsage6mo = summedSpend.map((s, i) => summedCap[i] === 0 ? null : (s / summedCap[i]) * 100);
  return {
    id: '__other__',
    name: 'Other',
    spend6mo: summedSpend.map(centsToUsdRounded),
    capUsage6mo,
    capBlownAt: firstBlownIndex(capUsage6mo),
  };
}

export function buildTrends(
  workspaces: ReadonlyArray<WorkspaceTrendInput>,
  monthLabels: string[],
): TrendsOutput {
  // INVARIANT I6 — fully deterministic; final tiebreaker is workspaceId asc
  const sorted = [...workspaces].sort((a, b) =>
    b.currentMtdCents - a.currentMtdCents ||
    b.workspaceName.localeCompare(a.workspaceName) ||
    a.workspaceId.localeCompare(b.workspaceId),
  );

  if (workspaces.length <= 5) {
    return { workspaces: sorted.map(projectIndividual), monthLabels };
  }
  const top4 = sorted.slice(0, 4).map(projectIndividual);
  const rest = sorted.slice(4);
  return { workspaces: [...top4, projectOther(rest)], monthLabels };
}
