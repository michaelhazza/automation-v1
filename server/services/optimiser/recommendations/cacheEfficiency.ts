/**
 * server/services/optimiser/recommendations/cacheEfficiency.ts
 *
 * Evaluator: LLM cache efficiency detection.
 *
 * Trigger: reused_tokens / (creation_tokens + reused_tokens) < 20%.
 *
 * Category: optimiser.llm.cache_poor_reuse
 * Severity: info
 * Dedupe key: agent_id
 */

import type { CacheEfficiencyRow } from '../queries/cacheEfficiency.js';
import type { RecommendationCandidate } from './agentBudget.js';

const CATEGORY = 'optimiser.llm.cache_poor_reuse';
const CACHE_REUSE_THRESHOLD = 0.20;
/** Minimum total token volume (creation + reused) required to fire this recommendation. */
const CACHE_VOLUME_FLOOR = 5000;

export function evaluateCacheEfficiency(
  rows: CacheEfficiencyRow[],
): RecommendationCandidate[] {
  const candidates: RecommendationCandidate[] = [];

  for (const row of rows) {
    const totalTokens = row.creation_tokens + row.reused_tokens;
    // Skip rows below the volume floor — too little data to produce a meaningful recommendation
    if (totalTokens < CACHE_VOLUME_FLOOR) continue;

    const reuseRatio = row.reused_tokens / totalTokens;

    if (reuseRatio < CACHE_REUSE_THRESHOLD) {
      candidates.push({
        category: CATEGORY,
        severity: 'info',
        evidence: {
          agent_id: row.agent_id,
          creation_tokens: row.creation_tokens,
          reused_tokens: row.reused_tokens,
          dominant_skill: row.dominant_skill,
        },
        dedupe_key: row.agent_id,
      });
    }
  }

  return candidates;
}
