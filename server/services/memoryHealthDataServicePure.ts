/**
 * memoryHealthDataServicePure — memory-health heuristics (pure)
 *
 * Two decision functions used by the impure gather pass:
 *   - rankTopEntriesByQuality: top-N ranker with qualityScore + cited tiebreak
 *   - detectCoverageGaps: naïve topic-frequency heuristic for gap detection
 *
 * Spec: docs/memory-and-briefings-spec.md §5.10 (S14)
 */

export interface EntrySignal {
  id: string;
  qualityScore: number;
  citedCount: number;
  topic: string | null;
}

/**
 * Return the top N entries by qualityScore (descending), with `citedCount` as
 * a secondary tiebreak. Stable for equal inputs.
 */
export function rankTopEntriesByQuality(
  entries: EntrySignal[],
  n: number,
): EntrySignal[] {
  return [...entries]
    .sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      return b.citedCount - a.citedCount;
    })
    .slice(0, n);
}

export interface CoverageGapInput {
  /** Frequency of each topic in recent agent tasks. */
  recentTaskTopics: Record<string, number>;
  /** Distinct topics the subaccount's memory currently covers. */
  coveredTopics: Set<string>;
  /** Minimum task count before a topic is flagged as a gap. Default 3. */
  taskFrequencyMin?: number;
}

/**
 * Identify topics that appear ≥ `taskFrequencyMin` times in recent tasks but
 * have zero entries in memory. Surfaces as "No memories about X despite N
 * recent tasks" lines in the Weekly Digest.
 */
export function detectCoverageGaps(input: CoverageGapInput): string[] {
  const min = input.taskFrequencyMin ?? 3;
  const gaps: string[] = [];
  for (const [topic, count] of Object.entries(input.recentTaskTopics)) {
    if (count >= min && !input.coveredTopics.has(topic)) {
      gaps.push(`No memories about ${topic} despite ${count} recent tasks`);
    }
  }
  return gaps.sort();
}
