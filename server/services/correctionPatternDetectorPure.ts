// server/services/correctionPatternDetectorPure.ts
// Pure correction-pattern clustering — deterministic, no I/O.
// Trust & Verification Layer spec §13.3 (V1 pin, F4 algorithm).

// ── Cosine similarity ─────────────────────────────────────────────────────────

/** Cosine similarity in [−1, 1]. Returns 0 for zero-vectors (degenerate case). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Arithmetic mean of embedding vectors (centroid). Returns empty array for empty input. */
export function centroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0].length;
  const result = new Array<number>(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      result[i] += emb[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    result[i] /= embeddings.length;
  }
  return result;
}

// ── Input / output types ──────────────────────────────────────────────────────

export interface CorrectionInput {
  memoryBlockId: string;
  agentId: string;
  skillSlug: string;
  editedOutputEmbedding: number[];
  /** ISO-8601 string for stable sort ordering. */
  capturedAt: string;
  /** The corrected output text — used to select the cluster representative. */
  content: string;
  /** Closed-Loop Skill Improvement §10.2: quality_check_slug from scorecard_judgements (where available). */
  failedCheckId?: string | null;
  /** Closed-Loop Skill Improvement §10.2: entity type referenced by the run (where available). */
  entityType?: string | null;
}

export interface ClusterResult {
  agentId: string;
  skillSlug: string;
  /** Sorted by (capturedAt ASC, memoryBlockId ASC) — stable per spec §8.21. */
  memberMemoryBlockIds: string[];
  centroidEmbedding: number[];
  /** Content of the cluster member closest to the centroid. */
  representativeEditedOutput: string;
}

export interface ClusterArgs {
  corrections: CorrectionInput[];
  /** Minimum pairwise cosine similarity within a cluster (default 0.82). */
  similarityThreshold: number;
  /** Minimum cluster size to emit (default 3). */
  minClusterSize: number;
  /** Window days — informational; filtering is done by the caller before passing corrections. */
  windowDays: number;
}

// ── Stable sort key ───────────────────────────────────────────────────────────

function sortKey(c: CorrectionInput): string {
  return `${c.capturedAt}\x00${c.memoryBlockId}`;
}

// ── cluster (V1 pin: greedy complete-link on sorted candidates) ───────────────

/**
 * Clusters corrections by (agentId, skillSlug) then by embedding similarity.
 *
 * Algorithm (V1 pin per spec §13.3 / F4):
 * 1. Group by (agentId, skillSlug).
 * 2. Within each group, sort candidates by (capturedAt ASC, memoryBlockId ASC).
 * 3. Greedy complete-link: each candidate joins the first existing cluster where
 *    its cosine similarity to EVERY existing member is ≥ similarityThreshold.
 *    Otherwise, start a new cluster.
 * 4. Drop clusters below minClusterSize.
 * 5. Compute centroid; select representative as the member with minimum cosine
 *    distance to the centroid (tie-break: earliest capturedAt, then smallest
 *    memoryBlockId lexicographically).
 * 6. Return clusters sorted by (agentId ASC, skillSlug ASC, clusterIndex ASC).
 */
export function cluster(args: ClusterArgs): ClusterResult[] {
  const { corrections, similarityThreshold, minClusterSize } = args;

  // Step 1: group by (agentId, skillSlug, failedCheckId, entityType).
  // failedCheckId and entityType are optional clustering dimensions added by
  // Closed-Loop Skill Improvement §10.2. Absent/null values are normalised to
  // the empty string so they participate in the grouping key without collision.
  const groups = new Map<string, CorrectionInput[]>();
  for (const c of corrections) {
    const failedCheckSegment = c.failedCheckId ?? '';
    const entityTypeSegment = c.entityType ?? '';
    const key = `${c.agentId}\x00${c.skillSlug}\x00${failedCheckSegment}\x00${entityTypeSegment}`;
    let group = groups.get(key);
    if (!group) { group = []; groups.set(key, group); }
    group.push(c);
  }

  const results: ClusterResult[] = [];

  // Sort group keys for deterministic cluster iteration order.
  const sortedGroupKeys = Array.from(groups.keys()).sort();

  for (const groupKey of sortedGroupKeys) {
    const members = groups.get(groupKey)!;

    // Step 2: stable sort within group.
    const sorted = [...members].sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    // Step 3: greedy complete-link clustering.
    // Each cluster is a list of CorrectionInputs (already sorted when added).
    const clusters: CorrectionInput[][] = [];

    for (const candidate of sorted) {
      let placed = false;
      for (const clus of clusters) {
        // Complete-link: candidate must be ≥ threshold similar to every member.
        const fitsCluster = clus.every(
          (member) => cosineSimilarity(candidate.editedOutputEmbedding, member.editedOutputEmbedding) >= similarityThreshold,
        );
        if (fitsCluster) {
          clus.push(candidate);
          placed = true;
          break;
        }
      }
      if (!placed) {
        clusters.push([candidate]);
      }
    }

    // Step 4: drop clusters below minClusterSize.
    const validClusters = clusters.filter((c) => c.length >= minClusterSize);

    // Step 5: compute centroid + representative for each valid cluster.
    const [agentId, skillSlug] = groupKey.split('\x00') as [string, string, string, string];
    let clusterIndex = 0;

    for (const clus of validClusters) {
      const c = centroid(clus.map((m) => m.editedOutputEmbedding));

      // Find representative: minimum cosine distance to centroid.
      // Tie-break: earliest capturedAt, then lexicographically smallest memoryBlockId.
      let representative = clus[0];
      let bestSim = cosineSimilarity(c, representative.editedOutputEmbedding);

      for (let i = 1; i < clus.length; i++) {
        const sim = cosineSimilarity(c, clus[i].editedOutputEmbedding);
        if (sim > bestSim) {
          bestSim = sim;
          representative = clus[i];
        } else if (sim === bestSim) {
          // Tie-break: earlier capturedAt, then smaller memoryBlockId.
          if (
            clus[i].capturedAt < representative.capturedAt ||
            (clus[i].capturedAt === representative.capturedAt &&
              clus[i].memoryBlockId < representative.memoryBlockId)
          ) {
            representative = clus[i];
          }
        }
      }

      // Member IDs sorted per spec §8.21.
      const memberMemoryBlockIds = clus
        .map((m) => m.memoryBlockId)
        .sort((a, b) => {
          // Sort by (capturedAt ASC, memoryBlockId ASC) using the original inputs.
          const ca = clus.find((m) => m.memoryBlockId === a)!;
          const cb = clus.find((m) => m.memoryBlockId === b)!;
          const ka = sortKey(ca);
          const kb = sortKey(cb);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });

      results.push({
        agentId,
        skillSlug,
        memberMemoryBlockIds,
        centroidEmbedding: c,
        representativeEditedOutput: representative.content,
      });

      clusterIndex++;
    }
    void clusterIndex; // used implicitly via results order
  }

  // Step 6: results already ordered by (agentId, skillSlug, clusterIndex) because
  // we iterate group keys in sorted order and append clusters in insertion order.
  return results;
}

// ── Helpers exported for job use ─────────────────────────────────────────────

/**
 * Parse a raw embedding value from the DB driver into a number array.
 * Handles arrays (passed through) and postgres vector strings ("[a,b,c]").
 * Returns null for unrecognised shapes.
 */
export function parseEmbedding(raw: unknown): number[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      return raw.replace(/^\[|\]$/g, '').split(',').map(Number);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse skillSlug from a correction memory block name.
 * Name format: `correction:${agentId}:${skillSlug}:${runId}`.
 * Returns null when the name does not match the expected format.
 */
export function parseSkillSlugFromBlockName(name: string): string | null {
  const parts = name.split(':');
  if (parts.length < 4 || parts[0] !== 'correction') return null;
  // agentId and runId are UUIDs (contain hyphens but not colons). skillSlug is part[2].
  return parts[2] ?? null;
}
