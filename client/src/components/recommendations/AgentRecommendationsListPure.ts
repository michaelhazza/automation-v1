/**
 * client/src/components/recommendations/AgentRecommendationsListPure.ts
 *
 * Extracted pure helpers for dedupe + sort in AgentRecommendationsList.
 * No React imports, no side effects — safe to test in a plain Node environment.
 *
 * Spec: docs/sub-account-optimiser-spec.md §6.3
 */

export interface RecommendationRowShape {
  id: string;
  scope_type: string;
  scope_id: string;
  subaccount_display_name?: string;
  category: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  action_hint?: string | null;
  evidence?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  acknowledged_at?: string | null;
  dismissed_at?: string | null;
}

// ── Severity rank ─────────────────────────────────────────────────────────────

export function severityRankLocal(severity: 'info' | 'warn' | 'critical'): number {
  if (severity === 'critical') return 3;
  if (severity === 'warn') return 2;
  return 1;
}

// ── Sort rows by severity desc, then updated_at desc ─────────────────────────

export function sortRows(rows: RecommendationRowShape[]): RecommendationRowShape[] {
  return [...rows].sort((a, b) => {
    const severityDiff = severityRankLocal(b.severity) - severityRankLocal(a.severity);
    if (severityDiff !== 0) return severityDiff;
    const aTime = new Date(a.updated_at).getTime();
    const bTime = new Date(b.updated_at).getTime();
    return bTime - aTime;
  });
}

// ── collapsedDistinctScopeId dedupe ───────────────────────────────────────────
//
// When collapsedDistinctScopeId=true: keep only the highest-priority row per
// scope_id before applying limit. Priority: severity desc, updated_at desc,
// category asc, dedupe_key asc.

export function dedupeByScope(rows: RecommendationRowShape[]): RecommendationRowShape[] {
  const bestByScope = new Map<string, RecommendationRowShape>();

  for (const row of rows) {
    const existing = bestByScope.get(row.scope_id);
    if (!existing || isHigherPriority(row, existing)) {
      bestByScope.set(row.scope_id, row);
    }
  }

  return Array.from(bestByScope.values());
}

function isHigherPriority(
  candidate: RecommendationRowShape,
  current: RecommendationRowShape,
): boolean {
  const severityDiff = severityRankLocal(candidate.severity) - severityRankLocal(current.severity);
  if (severityDiff !== 0) return severityDiff > 0;

  const candidateTime = new Date(candidate.updated_at).getTime();
  const currentTime = new Date(current.updated_at).getTime();
  if (candidateTime !== currentTime) return candidateTime > currentTime;

  if (candidate.category !== current.category) return candidate.category < current.category;

  // Use a fallback string field for dedupe_key since it's not in the row shape
  return false;
}

// ── applyCollapsedView ────────────────────────────────────────────────────────
//
// Combines sort + optional dedupe + limit for collapsed mode.

export function applyCollapsedView(
  rows: RecommendationRowShape[],
  options: {
    limit: number;
    collapsedDistinctScopeId: boolean;
    mode: 'collapsed' | 'expanded';
    scopeType: 'org' | 'subaccount';
    includeDescendantSubaccounts: boolean;
  },
): RecommendationRowShape[] {
  const sorted = sortRows(rows);

  if (options.mode === 'expanded') {
    return sorted;
  }

  // Dedupe only applies in collapsed mode when the conditions are met:
  // scope.type='org' AND includeDescendantSubaccounts=true AND collapsedDistinctScopeId=true
  const shouldDedupe =
    options.collapsedDistinctScopeId &&
    options.scopeType === 'org' &&
    options.includeDescendantSubaccounts;

  const deduped = shouldDedupe ? sortRows(dedupeByScope(sorted)) : sorted;

  return deduped.slice(0, options.limit);
}
