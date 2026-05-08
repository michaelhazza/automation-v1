// Pure helpers for retrieval observability — no I/O.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §11.4, §11.5, §1.5 #3, #8

import type { RetrievalDegradedReason, RetrievalResult } from '../../shared/types/retrieval.js';
import {
  MAX_REJECTED_ABOVE_THRESHOLD,
  MAX_REJECTED_BELOW_THRESHOLD_SAMPLE,
  MAX_REJECTED_MODE_EXCLUDED,
} from './retrievalServicePure.js';

// Always-available capacity warning thresholds (spec §11.5, §1.5 #8)
export const ALWAYS_AVAILABLE_DOC_COUNT_WARN = 30;
export const ALWAYS_AVAILABLE_TOKEN_COST_WARN = 30000;

export function shouldShowAlwaysAvailableWarning(input: { docCount: number; tokenCost: number }): boolean {
  return input.docCount >= ALWAYS_AVAILABLE_DOC_COUNT_WARN || input.tokenCost >= ALWAYS_AVAILABLE_TOKEN_COST_WARN;
}

export function truncateForEmission(result: RetrievalResult): RetrievalResult {
  // Deterministic top-N truncation (spec §11.4, §1.5 #3).
  // Must produce byte-identical output for identical input.
  return {
    ...result,
    rejected: {
      aboveThreshold: {
        total: result.rejected.aboveThreshold.total,
        retained: Math.min(result.rejected.aboveThreshold.items.length, MAX_REJECTED_ABOVE_THRESHOLD),
        items: result.rejected.aboveThreshold.items
          .sort((a, b) => b.finalScore - a.finalScore || a.id.localeCompare(b.id))
          .slice(0, MAX_REJECTED_ABOVE_THRESHOLD),
      },
      belowThreshold: {
        count: result.rejected.belowThreshold.count,
        sample: result.rejected.belowThreshold.sample
          .sort((a, b) => b.finalScore - a.finalScore || a.id.localeCompare(b.id))
          .slice(0, MAX_REJECTED_BELOW_THRESHOLD_SAMPLE),
      },
      modeExcluded: {
        total: result.rejected.modeExcluded.total,
        retained: Math.min(result.rejected.modeExcluded.items.length, MAX_REJECTED_MODE_EXCLUDED),
        items: result.rejected.modeExcluded.items
          .slice(0, MAX_REJECTED_MODE_EXCLUDED),
      },
    },
  };
}

export function buildDegradedResult(reason: RetrievalDegradedReason): RetrievalResult {
  return {
    loaded: [],
    alwaysAvailable: [],
    referenceOnlyManifest: [],
    rejected: {
      aboveThreshold: { total: 0, retained: 0, items: [] },
      belowThreshold: { count: 0, sample: [] },
      modeExcluded: { total: 0, retained: 0, items: [] },
    },
    totalTokensLoaded: 0,
    degraded: true,
    degradedReason: reason,
  };
}
