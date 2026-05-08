// Pure retrieval ranker — no DB, no I/O, no Date.now(), no random.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §10.8, §11.4, §12.5, §1.5

import type { RetrievalCandidate, RetrievalResult, RetrievalRejectionReason } from '../../shared/types/retrieval.js';

// Truncation constants — spec §11.4, §1.5 #3. Single source of truth;
// retrievalObservabilityService re-exports these same constants.
export const MAX_REJECTED_ABOVE_THRESHOLD = 50;
export const MAX_REJECTED_BELOW_THRESHOLD_SAMPLE = 20;
export const MAX_REJECTED_MODE_EXCLUDED = 50;

export interface RankCandidatesInput {
  candidates: RetrievalCandidate[];
  threshold: number;
  budgetTokens: number;
  nowMs: number;
  orgId: string;
  runContext: {
    runId: string;
    agentId: string;
    subaccountId: string | null;
    scheduledTaskId: string | null;
    taskInstanceId: string | null;
  };
}

export function rankCandidates(input: RankCandidatesInput): RetrievalResult {
  const { candidates, threshold, budgetTokens, orgId } = input;

  // Defence-in-depth: filter mismatched org candidates (spec §12.5, §1.5 #5)
  const orgFiltered = candidates.filter(c => c.organisationId === orgId);
  const authFilteredCount = candidates.length - orgFiltered.length;

  // Split by mode — reference_only candidates never enter ranking
  const rankable = orgFiltered.filter(c => c.mode !== 'reference_only');
  const referenceOnly = orgFiltered.filter(c => c.mode === 'reference_only');

  // Comparator chain (spec §10.8, §1.5 #1): finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC
  const comparator = (a: RetrievalCandidate, b: RetrievalCandidate): number => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (b.scopeTier !== a.scopeTier) return b.scopeTier - a.scopeTier;
    if (b.updatedAt.getTime() !== a.updatedAt.getTime()) return b.updatedAt.getTime() - a.updatedAt.getTime();
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // id ASC — determinism anchor (dev-guidelines §8.17)
  };

  const sorted = [...rankable].sort(comparator);

  const loaded: RetrievalResult['loaded'] = [];
  const alwaysAvailable: RetrievalResult['loaded'] = [];
  let totalTokensLoaded = 0;

  const aboveThresholdRejected: Array<{ id: string; reason: RetrievalRejectionReason; finalScore: number }> = [];
  let aboveThresholdBudgetExhaustedCount = 0;
  const belowThresholdItems: Array<{ id: string; finalScore: number }> = [];
  let belowThresholdCount = 0;

  for (const candidate of sorted) {
    if (candidate.finalScore < threshold) {
      belowThresholdCount++;
      if (belowThresholdItems.length < MAX_REJECTED_BELOW_THRESHOLD_SAMPLE) {
        belowThresholdItems.push({ id: candidate.id, finalScore: candidate.finalScore });
      }
      continue;
    }

    // Above threshold — check budget
    if (totalTokensLoaded + candidate.tokenCount > budgetTokens) {
      aboveThresholdBudgetExhaustedCount++;
      if (aboveThresholdRejected.length < MAX_REJECTED_ABOVE_THRESHOLD) {
        aboveThresholdRejected.push({ id: candidate.id, reason: 'budget_exhausted', finalScore: candidate.finalScore });
      }
      continue;
    }

    const row: RetrievalResult['loaded'][number] = {
      id: candidate.id,
      documentId: candidate.documentId,
      kind: candidate.kind,
      mode: candidate.mode,
      scopeTier: candidate.scopeTier,
      finalScore: candidate.finalScore,
      tokenCount: candidate.tokenCount,
      content: candidate.content,
    };

    loaded.push(row);
    if (candidate.mode === 'always_available') {
      alwaysAvailable.push(row);
    }
    totalTokensLoaded += candidate.tokenCount;
  }

  // mode_excluded items (reference_only)
  const modeExcludedItems: Array<{ id: string; mode: RetrievalCandidate['mode'] }> = [];
  for (const c of referenceOnly) {
    if (modeExcludedItems.length < MAX_REJECTED_MODE_EXCLUDED) {
      modeExcludedItems.push({ id: c.id, mode: c.mode });
    }
  }

  // authFilteredCount contributes to the aboveThreshold total (count only — no items
  // since scores are unavailable after org filtering)
  const aboveThresholdTotal = aboveThresholdBudgetExhaustedCount + authFilteredCount;

  return {
    loaded,
    alwaysAvailable,
    referenceOnlyManifest: referenceOnly.map(c => ({ id: c.id, documentId: c.documentId })),
    rejected: {
      aboveThreshold: {
        total: aboveThresholdTotal,
        retained: aboveThresholdRejected.length,
        items: aboveThresholdRejected,
      },
      belowThreshold: {
        count: belowThresholdCount,
        sample: belowThresholdItems,
      },
      modeExcluded: {
        total: referenceOnly.length,
        retained: modeExcludedItems.length,
        items: modeExcludedItems,
      },
    },
    totalTokensLoaded,
    degraded: false,
    degradedReason: null,
  };
}
