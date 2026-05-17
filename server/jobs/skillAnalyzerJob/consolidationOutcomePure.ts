// SKILL-MERGE-TEST-1: pure classifier for the post-LLM consolidation outcome.
// Extracted from stage5Classify.ts so the spec §5 / §6 outcome-classification
// rule is unit-testable without spinning up the full classify pipeline.
//
// Contract:
//   - postWords >= preWords → `not_shortened` failure (protocol violation:
//     the LLM returned a non-shortening payload without declining)
//   - postWords < preWords  → succeeded, reductionPct rounded to nearest %
//   - preWords === 0        → reductionPct: 0 (divide-by-zero guard)

export type ConsolidationClassification =
  | {
      outcome: 'failed';
      failureReason: 'not_shortened';
      preWords: number;
      postWords: number;
    }
  | {
      outcome: 'succeeded';
      preWords: number;
      postWords: number;
      reductionPct: number;
    };

export function classifyConsolidationOutcome(
  preWords: number,
  postWords: number,
): ConsolidationClassification {
  if (postWords >= preWords) {
    return { outcome: 'failed', failureReason: 'not_shortened', preWords, postWords };
  }
  const reductionPct = preWords > 0 ? Math.round((1 - postWords / preWords) * 100) : 0;
  return { outcome: 'succeeded', preWords, postWords, reductionPct };
}
