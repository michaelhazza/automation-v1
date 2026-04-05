// ---------------------------------------------------------------------------
// Reranker — optional cross-encoder reranking for memory retrieval (Phase B3)
// Supports Cohere Rerank API with timeout + graceful fallback.
// ---------------------------------------------------------------------------

import { RERANKER_TIMEOUT_MS } from '../config/limits.js';

export interface RerankResult {
  id: string;
  score: number;
  originalRank: number;
}

interface RerankerConfig {
  provider: 'cohere' | 'none';
  model?: string;
  apiKey?: string;
  topN: number;
}

/**
 * Rerank a list of documents against a query.
 * Returns top N results sorted by relevance score.
 * Falls back to passthrough ranking if provider is 'none' or on error.
 */
export async function rerank(
  query: string,
  documents: Array<{ id: string; content: string }>,
  config: RerankerConfig
): Promise<RerankResult[]> {
  // Passthrough: no reranking needed
  if (config.provider === 'none' || documents.length <= config.topN) {
    return documents.map((doc, i) => ({
      id: doc.id,
      score: 1 - (i / Math.max(documents.length, 1)),
      originalRank: i,
    }));
  }

  if (config.provider === 'cohere') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RERANKER_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model ?? 'rerank-v3.5',
          query,
          documents: documents.map(d => d.content),
          top_n: config.topN,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        console.warn(`[Reranker] Cohere API error ${response.status}: ${body.slice(0, 200)}`);
        return passthroughRank(documents, config.topN);
      }

      const data = await response.json() as {
        results: Array<{ index: number; relevance_score: number }>;
      };

      return data.results.map((r) => ({
        id: documents[r.index].id,
        score: r.relevance_score,
        originalRank: r.index,
      }));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn(`[Reranker] Cohere API timed out after ${RERANKER_TIMEOUT_MS}ms`);
      } else {
        console.warn('[Reranker] Cohere API failed:', err instanceof Error ? err.message : err);
      }
      return passthroughRank(documents, config.topN);
    } finally {
      clearTimeout(timeout);
    }
  }

  return passthroughRank(documents, config.topN);
}

function passthroughRank(
  documents: Array<{ id: string; content: string }>,
  topN: number
): RerankResult[] {
  return documents.slice(0, topN).map((doc, i) => ({
    id: doc.id,
    score: 1 - (i / Math.max(documents.length, 1)),
    originalRank: i,
  }));
}
