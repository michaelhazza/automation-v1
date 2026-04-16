/**
 * Pure (no-DB) helpers for memoryBlockService.
 * Safe to import in tests without a database connection.
 *
 * Spec:
 *   - docs/config-agent-guidelines-spec.md §3.5 (formatBlocksForPrompt)
 *   - docs/memory-and-briefings-spec.md §5.2 S6 (relevance scoring + token budget)
 */

export interface MemoryBlockForPrompt {
  name: string;
  content: string;
  permission: 'read' | 'read_write';
}

/**
 * Format memory blocks for system prompt injection.
 * Returns null if no blocks are attached.
 */
export function formatBlocksForPrompt(blocks: MemoryBlockForPrompt[]): string | null {
  if (blocks.length === 0) return null;

  const sections = blocks.map(
    (b) => `### ${b.name}\n${b.content}`,
  );

  return `## Shared Context\n\n${sections.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// S6 — Relevance ranking & token-budget eviction (pure)
// ---------------------------------------------------------------------------

export interface CandidateBlock {
  id: string;
  name: string;
  content: string;
  score: number;           // cosine similarity in [0, 1]
  /**
   * Attachment status:
   *   'explicit' — manual attachment via memory_block_attachments (override path)
   *   'relevance' — surfaced by relevance engine only
   */
  source: 'explicit' | 'relevance';
  /** True for config-agent-guidelines and any other protected blocks. */
  protected?: boolean;
}

export interface RankingParams {
  /** Minimum similarity for a relevance-path block to be included. */
  threshold: number;
  /** Max relevance-path blocks to return (ignores explicit/protected). */
  topK: number;
  /**
   * Per-run token budget. Block content lengths (approximated by chars/4)
   * cumulatively counted; blocks exceeding the budget are evicted in reverse
   * relevance order. Explicit and protected blocks bypass eviction.
   */
  tokenBudget: number;
}

/**
 * Rough char-to-token approximation — sufficient for budget enforcement.
 * Keeps the pure module free of any tokenizer dependency.
 */
export function approxTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Deduplicates candidates by block id. When a block appears both as explicit
 * and relevance, the explicit entry wins (its `source` is preserved).
 */
export function dedupeCandidates(candidates: CandidateBlock[]): CandidateBlock[] {
  const seen = new Map<string, CandidateBlock>();
  for (const c of candidates) {
    const existing = seen.get(c.id);
    if (!existing) {
      seen.set(c.id, c);
      continue;
    }
    // Explicit wins over relevance.
    if (existing.source === 'relevance' && c.source === 'explicit') {
      seen.set(c.id, c);
    }
    // If both are explicit or both relevance — keep the first (higher score arrived first).
  }
  return Array.from(seen.values());
}

/**
 * Core ranking + token-budget eviction per §5.2.
 *
 * Rules:
 *   1. Protected blocks always pass through, regardless of score or budget.
 *   2. Explicit (manual) attachments always pass through, regardless of score
 *      or budget — they are the override path (§5.2).
 *   3. Relevance-path blocks must have `score >= threshold`, are sorted
 *      descending by score, and capped at `topK`.
 *   4. Token budget applied to relevance-path blocks only, in relevance order.
 *      Blocks that don't fit are dropped.
 *
 * Note: callers MUST pre-filter out any block with status != 'active' before
 * invoking this ranker. The global block status invariant is enforced at the
 * database query boundary (§5.2); the ranker does not inspect status.
 */
export function rankBlocksForInjection(
  candidates: CandidateBlock[],
  params: RankingParams,
): CandidateBlock[] {
  const deduped = dedupeCandidates(candidates);

  const protectedBlocks = deduped.filter((c) => c.protected);
  const explicitBlocks = deduped.filter((c) => !c.protected && c.source === 'explicit');
  const relevanceBlocks = deduped
    .filter((c) => !c.protected && c.source === 'relevance' && c.score >= params.threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, params.topK);

  // Token-budget eviction applies to relevance blocks only.
  const included: CandidateBlock[] = [];
  let budgetRemaining = params.tokenBudget;
  for (const block of relevanceBlocks) {
    const cost = approxTokenCount(block.content);
    if (cost <= budgetRemaining) {
      included.push(block);
      budgetRemaining -= cost;
    }
    // Block too large for remaining budget — skip it, continue scanning
    // (a smaller block later in the list may still fit).
  }

  // Final order: protected → explicit → relevance (by score).
  return [...protectedBlocks, ...explicitBlocks, ...included];
}

/**
 * Cosine similarity between two equal-length numeric vectors. Returns 0 if
 * either vector has zero magnitude or the lengths differ.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}
