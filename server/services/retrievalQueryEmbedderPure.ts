// Pure semantic ranker helpers — zero DB imports, zero network.
// Spec §4 Phase 3 / §13.5.

import { logger } from '../lib/logger.js';

export function getRetrievalConfig(): { semanticEnabled: boolean; threshold: number } {
  const rawThreshold = process.env.AKR_RETRIEVAL_THRESHOLD ?? '0.30';
  const parsed = Number(rawThreshold);
  const threshold =
    Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.30;
  if (threshold !== parsed) {
    logger.warn('retrieval.threshold.env_invalid', { rawThreshold, parsed, fallback: 0.30 });
  }
  return {
    semanticEnabled: process.env.AKR_SEMANTIC_RANKER_ENABLED === 'true',
    threshold,
  };
}

// Cosine similarity over two equal-length float vectors.
// Throws on length mismatch, empty vector, or NaN element.
// Caller (scoreCandidates) catches per-candidate errors.
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) throw new Error('Empty vector');
  if (a.length !== b.length) throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error('NaN element');
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Score candidates against a query embedding and filter by threshold.
// Per-candidate vector errors are silently excluded — one bad embedding does
// not fail the whole ranker (spec R2 F3). Global fallback fires only via
// recallFallbackPredicate when the filtered count is zero.
export function scoreCandidates<T extends { embedding: number[] }>(opts: {
  candidates: T[];
  queryEmbedding: number[];
  threshold: number;
}): Array<T & { finalScore: number }> {
  const { candidates, queryEmbedding, threshold } = opts;
  const scored: Array<T & { finalScore: number }> = [];
  for (const c of candidates) {
    try {
      const score = cosineSimilarity(c.embedding, queryEmbedding);
      if (score >= threshold) {
        scored.push({ ...c, finalScore: score });
      }
    } catch {
      // Per-candidate vector error — exclude silently (R2 F3)
    }
  }
  return scored;
}

// Returns true when filtering reduced a non-empty pool to zero.
export function recallFallbackPredicate(opts: {
  filteredCount: number;
  originalCount: number;
}): boolean {
  return opts.originalCount > 0 && opts.filteredCount === 0;
}
