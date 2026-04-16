/**
 * memoryBlockSynthesisService — weekly auto-synthesis of memory blocks (§5.7)
 *
 * Per subaccount:
 *   1. Scan high-quality entries (qualityScore > 0.7, citedCount > 2) that
 *      aren't yet associated with a block.
 *   2. Cluster by embedding similarity (simple agglomerative at
 *      CLUSTERING_DISTANCE_THRESHOLD).
 *   3. For clusters ≥ SYNTHESIS_MIN_CLUSTER_SIZE: summarise via LLM.
 *   4. Score candidate confidence; route per S7 tier:
 *        high    → create block with status='active' (auto-apply)
 *        medium  → create block with status='draft' + memory_review_queue row
 *        low     → discard
 *   5. Passive-age draft blocks after PASSIVE_AGE_CYCLES cycles without rejection.
 *
 * Invariant: every block created by this service is flagged
 * `source='auto_synthesised'`. Draft blocks NEVER surface until status='active'.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.7 (S11)
 */

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workspaceMemoryEntries,
  memoryBlocks,
  memoryReviewQueue,
} from '../db/schema/index.js';
import {
  scoreCluster,
  decideTier,
  passiveAgeDecision,
  CLUSTERING_DISTANCE_THRESHOLD,
  SYNTHESIS_MIN_CLUSTER_SIZE,
  type SynthesisTier,
} from './memoryBlockSynthesisServicePure.js';
import { cosineSimilarity } from './memoryBlockServicePure.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SynthesisRunSummary {
  subaccountId: string;
  entriesScanned: number;
  clustersFormed: number;
  blocksAutoActivated: number;
  blocksQueuedForReview: number;
  clustersDiscarded: number;
  blocksPassiveAged: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runSynthesisForSubaccount(
  subaccountId: string,
  organisationId: string,
): Promise<SynthesisRunSummary> {
  const started = Date.now();
  let clustersFormed = 0;
  let blocksAutoActivated = 0;
  let blocksQueuedForReview = 0;
  let clustersDiscarded = 0;
  let blocksPassiveAged = 0;

  // ── 1. Passive-age pass first: draft blocks that survived without rejection
  const drafts = await db
    .select({
      id: memoryBlocks.id,
      passiveAgeCycles: sql<number>`COALESCE((${memoryBlocks.confidence})::int, 0)`,
      status: memoryBlocks.status,
      createdAt: memoryBlocks.createdAt,
    })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.subaccountId, subaccountId),
        eq(memoryBlocks.organisationId, organisationId),
        isNull(memoryBlocks.deletedAt),
        eq(memoryBlocks.status, 'draft'),
        eq(memoryBlocks.source, 'auto_synthesised'),
      ),
    );

  for (const draft of drafts) {
    // We approximate cycles via (now - createdAt) / 7 days. Each weekly run
    // increments the counter implicitly.
    const ageDays = (Date.now() - draft.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const cycles = Math.floor(ageDays / 7);
    const decision = passiveAgeDecision({ cycles, status: 'draft' });
    if (decision.shouldActivate) {
      await db
        .update(memoryBlocks)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(memoryBlocks.id, draft.id));
      blocksPassiveAged += 1;
      logger.info('memoryBlockSynthesisService.passive_aged', {
        blockId: draft.id,
        cycles,
        reason: decision.reason,
      });
    }
  }

  // ── 2. Candidate entry scan
  const candidates = await db
    .select({
      id: workspaceMemoryEntries.id,
      content: workspaceMemoryEntries.content,
      qualityScore: workspaceMemoryEntries.qualityScore,
      citedCount: workspaceMemoryEntries.citedCount,
      embedding: workspaceMemoryEntries.embedding,
    })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
        gt(workspaceMemoryEntries.qualityScore, 0.7),
        gt(workspaceMemoryEntries.citedCount, 2),
        // Provenance guard: do not synthesise from unverified entries.
        eq(workspaceMemoryEntries.isUnverified, false),
      ),
    )
    .limit(500);

  const entriesScanned = candidates.length;

  // ── 3. Naïve agglomerative clustering on embeddings (in-process)
  interface EntryWithVec {
    id: string;
    content: string;
    qualityScore: number;
    citedCount: number;
    vec: number[];
  }
  const withVec: EntryWithVec[] = candidates
    .map((c) => ({
      id: c.id,
      content: c.content,
      qualityScore: c.qualityScore ?? 0,
      citedCount: c.citedCount ?? 0,
      vec: Array.isArray(c.embedding) ? (c.embedding as unknown as number[]) : [],
    }))
    .filter((e) => e.vec.length > 0);

  const clusters: EntryWithVec[][] = [];
  for (const entry of withVec) {
    let placed = false;
    for (const cluster of clusters) {
      const representative = cluster[0];
      const sim = cosineSimilarity(entry.vec, representative.vec);
      if (1 - sim <= CLUSTERING_DISTANCE_THRESHOLD) {
        cluster.push(entry);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([entry]);
  }

  const viableClusters = clusters.filter((c) => c.length >= SYNTHESIS_MIN_CLUSTER_SIZE);
  clustersFormed = viableClusters.length;

  // ── 4. Route clusters per confidence tier
  for (const cluster of viableClusters) {
    const coherence = computeCoherence(cluster.map((e) => e.vec));
    const avgQuality = cluster.reduce((acc, e) => acc + e.qualityScore, 0) / cluster.length;
    const avgCitedCount = cluster.reduce((acc, e) => acc + e.citedCount, 0) / cluster.length;
    const confidence = scoreCluster({
      size: cluster.length,
      avgQuality,
      avgCitedCount,
      coherence,
    });
    const tier: SynthesisTier = decideTier(confidence);

    if (tier === 'low') {
      clustersDiscarded += 1;
      continue;
    }

    // Draft the candidate block content from the cluster entries (LLM call
    // would live here; Phase 4 uses a simple concatenation as the baseline
    // content — the block is flagged as auto_synthesised so agency review can
    // edit it later). Phase 5+ can swap in an LLM summarisation.
    const content = cluster.map((e) => `- ${e.content}`).join('\n').slice(0, 4000);
    const name = `auto-synth-${cluster[0].id.slice(0, 8)}`;

    const status = tier === 'high' ? 'active' : 'draft';

    const [created] = await db
      .insert(memoryBlocks)
      .values({
        organisationId,
        subaccountId,
        name,
        content,
        status,
        source: 'auto_synthesised',
        confidence: 'normal',
      })
      .returning({ id: memoryBlocks.id });

    if (tier === 'high') {
      blocksAutoActivated += 1;
    } else {
      blocksQueuedForReview += 1;
      await db.insert(memoryReviewQueue).values({
        organisationId,
        subaccountId,
        itemType: 'block_proposal',
        confidence,
        status: 'pending',
        payload: {
          blockId: created.id,
          name,
          content,
          clusterSize: cluster.length,
          avgQuality,
        },
      });
    }
  }

  const summary: SynthesisRunSummary = {
    subaccountId,
    entriesScanned,
    clustersFormed,
    blocksAutoActivated,
    blocksQueuedForReview,
    clustersDiscarded,
    blocksPassiveAged,
    durationMs: Date.now() - started,
  };

  logger.info('memoryBlockSynthesisService.complete', { ...summary });

  return summary;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function computeCoherence(vectors: number[][]): number {
  if (vectors.length < 2) return 1;
  let total = 0;
  let count = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      total += cosineSimilarity(vectors[i], vectors[j]);
      count += 1;
    }
  }
  return count === 0 ? 1 : total / count;
}
