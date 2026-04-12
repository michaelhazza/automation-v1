// ---------------------------------------------------------------------------
// Query intent types and retrieval weight profiles
// Used by the hybrid retrieval pipeline to tune RRF lane weights
// per query intent classification.
// ---------------------------------------------------------------------------

export type RetrievalProfile = 'temporal' | 'factual' | 'general' | 'exploratory' | 'relational';

export interface RetrievalWeights {
  rrf: number;
  quality: number;
  recency: number;
}

export const RETRIEVAL_PROFILES: Record<RetrievalProfile, RetrievalWeights> = {
  temporal:    { rrf: 0.3, quality: 0.1, recency: 0.6 },
  factual:     { rrf: 0.6, quality: 0.3, recency: 0.1 },
  general:     { rrf: 0.5, quality: 0.3, recency: 0.2 },
  exploratory: { rrf: 0.4, quality: 0.2, recency: 0.4 },
  relational:  { rrf: 0.5, quality: 0.2, recency: 0.3 },
};
