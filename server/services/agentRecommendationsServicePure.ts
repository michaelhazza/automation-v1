/**
 * server/services/agentRecommendationsServicePure.ts
 *
 * Pure helpers extracted from agentRecommendationsService.ts so they can be
 * tested without triggering the DB module import chain.
 *
 * No I/O, no side effects, no DB imports.
 *
 * Imported by:
 *   - server/services/agentRecommendationsService.ts (re-uses comparePriority)
 *   - server/services/__tests__/agentRecommendationsServicePure.test.ts
 */

// ── Eviction priority comparator ──────────────────────────────────────────────

export interface PriorityTuple {
  severity: number;     // 3=critical, 2=warn, 1=info
  updatedAt: string;    // ISO-8601
  category: string;
  dedupeKey: string;
}

/**
 * Returns positive if a > b (a has higher priority than b).
 *
 * Priority order:
 *   1. severity DESC  (higher severity = higher priority)
 *   2. updated_at DESC (newer = higher priority)
 *   3. category ASC   (earlier alphabet = higher priority)
 *   4. dedupeKey ASC  (earlier alphabet = higher priority)
 *
 * Eviction removes the LOWEST priority row; sort ascending → first element = eviction target.
 */
export function comparePriority(a: PriorityTuple, b: PriorityTuple): number {
  if (a.severity !== b.severity) return a.severity - b.severity;
  const aTime = new Date(a.updatedAt).getTime();
  const bTime = new Date(b.updatedAt).getTime();
  if (aTime !== bTime) return aTime - bTime; // newer = higher priority (positive = a > b)
  if (a.category !== b.category) return a.category < b.category ? 1 : -1; // earlier alpha = higher
  if (a.dedupeKey !== b.dedupeKey) return a.dedupeKey < b.dedupeKey ? 1 : -1;
  return 0;
}
