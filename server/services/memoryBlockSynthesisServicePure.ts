/**
 * memoryBlockSynthesisServicePure — clustering + passive-ageing decisions
 *
 * Two decision layers over clustered memory entries:
 *   - scoreCluster: compute candidate confidence from cluster stats
 *   - decideTier: map confidence → S7 tier (high / medium / low)
 *   - passiveAgeDecision: should a draft transition to active after N cycles?
 *
 * Spec: docs/memory-and-briefings-spec.md §5.7 (S11)
 */

// Mirrors the S7 confidence tiers used by memoryReviewQueueService.
export const HIGH_CONFIDENCE_THRESHOLD = 0.85;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.6;

/** Cluster minimum size before synthesis fires. */
export const SYNTHESIS_MIN_CLUSTER_SIZE = 5;

/** Agglomerative clustering distance threshold. */
export const CLUSTERING_DISTANCE_THRESHOLD = 0.82;

/** Cycles a draft must survive without rejection before passive-ageing to active. */
export const PASSIVE_AGE_CYCLES = 2;

export interface ClusterStats {
  /** Number of entries in the cluster. */
  size: number;
  /** Average qualityScore of cluster members. */
  avgQuality: number;
  /** Average citedCount of cluster members. */
  avgCitedCount: number;
  /** Average pairwise similarity (0-1). Higher = tighter cluster. */
  coherence: number;
}

export function scoreCluster(stats: ClusterStats): number {
  if (stats.size < SYNTHESIS_MIN_CLUSTER_SIZE) return 0;
  // Weighted blend: coherence dominates (a tight cluster is more trustworthy),
  // avgQuality as secondary, citation signal as tertiary. Capped at 1.0.
  const citedFactor = Math.min(1.0, stats.avgCitedCount / 5); // normalise to [0,1]
  const blended =
    stats.coherence * 0.5 +
    stats.avgQuality * 0.35 +
    citedFactor * 0.15;
  return Math.max(0, Math.min(1, blended));
}

export type SynthesisTier = 'high' | 'medium' | 'low';

export function decideTier(confidence: number): SynthesisTier {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) return 'medium';
  return 'low';
}

export interface PassiveAgeParams {
  /** Number of weekly synthesis cycles the block has survived without rejection. */
  cycles: number;
  /** Current status of the block. */
  status: 'draft' | 'pending_review' | 'rejected' | 'active';
}

export interface PassiveAgeDecision {
  /** Activate the block (status → 'active'). */
  shouldActivate: boolean;
  /** Reason for the decision — logged with the transition. */
  reason: string;
}

export function passiveAgeDecision(params: PassiveAgeParams): PassiveAgeDecision {
  if (params.status !== 'draft') {
    return { shouldActivate: false, reason: `status=${params.status}, no passive-age` };
  }
  if (params.cycles >= PASSIVE_AGE_CYCLES) {
    return {
      shouldActivate: true,
      reason: `survived ${params.cycles} cycles without rejection`,
    };
  }
  return {
    shouldActivate: false,
    reason: `only ${params.cycles} of ${PASSIVE_AGE_CYCLES} cycles survived`,
  };
}
