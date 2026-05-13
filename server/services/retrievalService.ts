// DB-backed entry point for auto-knowledge retrieval.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §10.8, §12.5, §1.5

import { eq, and, isNull, inArray, sql } from 'drizzle-orm';

import type { RetrievalCandidate, RetrievalResult } from '../../shared/types/retrieval.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { referenceDocumentChunks } from '../db/schema/referenceDocumentChunks.js';
import { referenceDocumentDataSources } from '../db/schema/referenceDocumentDataSources.js';
import { referenceDocuments } from '../db/schema/referenceDocuments.js';
import { memoryBlocks } from '../db/schema/memoryBlocks.js';
import { tasks } from '../db/schema/tasks.js';
import { rankCandidates } from './retrievalServicePure.js';
import { groupCandidatesByDocument } from './documentRetrievalServicePure.js';
import { truncateForEmission, buildDegradedResult } from './retrievalObservabilityServicePure.js';
import { rankByPrecedencePure, type MemoryBlockRow } from './memoryBlockRetrievalServicePure.js';
import {
  getRetrievalConfig,
  cosineSimilarity,
  recallFallbackPredicate,
} from './retrievalQueryEmbedderPure.js';
import { generateEmbedding } from '../lib/embeddings.js';

// Default token budget; callers may override in future.
const DEFAULT_BUDGET_TOKENS = 32000;

export async function assembleKnowledgeForRun(runId: string): Promise<RetrievalResult> {
  const db = getOrgScopedDb('retrievalService.assembleKnowledgeForRun');

  // ── Step 1: Load the run ────────────────────────────────────────────────────
  let run: {
    id: string;
    organisationId: string;
    agentId: string;
    subaccountId: string | null;
    taskId: string | null;
  };
  try {
    const [row] = await db
      .select({
        id: agentRuns.id,
        organisationId: agentRuns.organisationId,
        agentId: agentRuns.agentId,
        subaccountId: agentRuns.subaccountId,
        taskId: agentRuns.taskId,
      })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);

    if (!row) {
      logger.warn('retrievalService.run_not_found', { runId });
      return buildDegradedResult('pool_query_failed');
    }
    run = row;
  } catch (err) {
    logger.warn('retrievalService.run_load_failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return buildDegradedResult('pool_query_failed');
  }

  const { organisationId, agentId, subaccountId } = run;

  // ── Semantic ranker config + query embedding ────────────────────────────────
  // Spec §4 Phase 3 / §13.5. Flag default off; embedding only when flag is on.
  const config = getRetrievalConfig();
  let queryEmbedding: number[] | null = null;
  let anyFallbackApplied = false;
  let pendingDegradedReason: 'retrieval.embedding_failed' | 'retrieval.empty_after_semantic' | null = null;

  if (config.semanticEnabled) {
    try {
      let taskText: string | null = null;
      if (run.taskId) {
        const [taskRow] = await db
          .select({ title: tasks.title, description: tasks.description })
          .from(tasks)
          .where(eq(tasks.id, run.taskId))
          .limit(1);
        if (taskRow) {
          taskText = `${taskRow.title}${taskRow.description ? ' ' + taskRow.description : ''}`;
        }
      }
      if (taskText) {
        queryEmbedding = await generateEmbedding(taskText);
      }
    } catch {
      // spec §13.5: catch scoped to embedding fetch only; fall back to legacy
      logger.warn('retrieval.embedding_failed', { runId });
      pendingDegradedReason = 'retrieval.embedding_failed';
    }
  }

  // ── Step 2: Build candidate pool from reference_document_chunks ────────────
  // Five-tier UNION scope query (spec §4.1, §1.5 #10).
  // Deterministic ordering: scope_tier DESC, updated_at DESC, id ASC (after fetch).
  let chunkCandidates: RetrievalCandidate[] = [];
  const allChunksByDocumentId: Map<string, typeof referenceDocumentChunks.$inferSelect[]> = new Map();
  try {
    // Fetch all data source links for this run's context (tiers 1-3).
    // Tier 5 (task_instance) and tier 4 (scheduled_task) are not available
    // on agent_runs in v1 — skipped.
    const dsConditions = [
      // Tier 3 — agent scope
      and(
        eq(referenceDocumentDataSources.organisationId, organisationId),
        eq(referenceDocumentDataSources.agentId, agentId),
        isNull(referenceDocumentDataSources.subaccountId),
        isNull(referenceDocumentDataSources.scheduledTaskId),
        isNull(referenceDocumentDataSources.taskInstanceId),
        isNull(referenceDocumentDataSources.deletedAt),
      ),
      // Tier 1 — organisation scope
      and(
        eq(referenceDocumentDataSources.organisationId, organisationId),
        isNull(referenceDocumentDataSources.subaccountId),
        isNull(referenceDocumentDataSources.agentId),
        isNull(referenceDocumentDataSources.scheduledTaskId),
        isNull(referenceDocumentDataSources.taskInstanceId),
        isNull(referenceDocumentDataSources.deletedAt),
      ),
    ];

    // Add tier 2 (subaccount) when subaccountId is present.
    if (subaccountId) {
      dsConditions.splice(1, 0,
        and(
          eq(referenceDocumentDataSources.organisationId, organisationId),
          eq(referenceDocumentDataSources.subaccountId, subaccountId),
          isNull(referenceDocumentDataSources.agentId),
          isNull(referenceDocumentDataSources.scheduledTaskId),
          isNull(referenceDocumentDataSources.taskInstanceId),
          isNull(referenceDocumentDataSources.deletedAt),
        ),
      );
    }

    const dsRows = await db
      .select({
        documentId: referenceDocumentDataSources.documentId,
        subaccountId: referenceDocumentDataSources.subaccountId,
        agentId: referenceDocumentDataSources.agentId,
        scheduledTaskId: referenceDocumentDataSources.scheduledTaskId,
        taskInstanceId: referenceDocumentDataSources.taskInstanceId,
      })
      .from(referenceDocumentDataSources)
      .where(sql`(${dsConditions.reduce((a, b) => sql`${a} OR ${b}`, dsConditions[0])})`);

    // Build map: documentId → highest scope tier
    const documentScopeTier = new Map<string, number>();
    for (const ds of dsRows) {
      let tier = 1;
      if (ds.taskInstanceId) tier = 5;
      else if (ds.scheduledTaskId) tier = 4;
      else if (ds.agentId) tier = 3;
      else if (ds.subaccountId) tier = 2;

      const current = documentScopeTier.get(ds.documentId) ?? 0;
      if (tier > current) documentScopeTier.set(ds.documentId, tier);
    }

    const linkedDocumentIds = [...documentScopeTier.keys()];

    if (linkedDocumentIds.length > 0) {
      // Fetch eligible docs (not deleted, has retrieval version + model, not reference_only).
      const docRows = await db
        .select({
          id: referenceDocuments.id,
          mode: referenceDocuments.mode,
          retrievalVersionId: referenceDocuments.retrievalVersionId,
          activeEmbeddingModel: referenceDocuments.activeEmbeddingModel,
          updatedAt: referenceDocuments.updatedAt,
        })
        .from(referenceDocuments)
        .where(
          and(
            eq(referenceDocuments.organisationId, organisationId),
            isNull(referenceDocuments.deletedAt),
            inArray(referenceDocuments.id, linkedDocumentIds),
          ),
        );

      const eligibleDocs = docRows.filter(
        d => d.retrievalVersionId && d.activeEmbeddingModel && d.mode !== 'reference_only',
      );
      const eligibleDocIds = eligibleDocs.map(d => d.id);

      if (eligibleDocIds.length > 0) {
        // Fetch active chunks for eligible documents.
        const chunkRows = await db
          .select()
          .from(referenceDocumentChunks)
          .where(
            and(
              eq(referenceDocumentChunks.organisationId, organisationId),
              isNull(referenceDocumentChunks.deletedAt),
              inArray(referenceDocumentChunks.documentId, eligibleDocIds),
            ),
          );

        // Build allChunksByDocumentId map.
        for (const chunk of chunkRows) {
          const list = allChunksByDocumentId.get(chunk.documentId) ?? [];
          list.push(chunk);
          allChunksByDocumentId.set(chunk.documentId, list);
        }

        const docMap = new Map(eligibleDocs.map(d => [d.id, d]));

        // Filter chunks to active retrieval version + model, then map to candidates.
        // Sort deterministically: scopeTier DESC, updatedAt DESC, id ASC (spec invariant §1.5 #10).
        const preScoredChunks = chunkRows
          .filter(chunk => {
            const doc = docMap.get(chunk.documentId);
            if (!doc) return false;
            if (chunk.versionId !== doc.retrievalVersionId) return false;
            if (chunk.embeddingModel !== doc.activeEmbeddingModel) return false;
            return true;
          });

        chunkCandidates = preScoredChunks
          .map(chunk => {
            const doc = docMap.get(chunk.documentId)!;
            let finalScore = 0;
            if (queryEmbedding && Array.isArray(chunk.embedding)) {
              try {
                finalScore = cosineSimilarity(chunk.embedding as number[], queryEmbedding);
              } catch {
                // per-candidate vector error — keep 0
              }
            }
            return {
              id: chunk.id,
              documentId: chunk.documentId,
              organisationId: chunk.organisationId,
              kind: 'document_chunk' as const,
              mode: doc.mode,
              scopeTier: documentScopeTier.get(chunk.documentId) ?? 1,
              finalScore,
              updatedAt: chunk.updatedAt,
              tokenCount: chunk.tokenCount,
              content: chunk.content,
            };
          })
          .sort((a, b) => {
            if (b.scopeTier !== a.scopeTier) return b.scopeTier - a.scopeTier;
            if (b.updatedAt.getTime() !== a.updatedAt.getTime()) return b.updatedAt.getTime() - a.updatedAt.getTime();
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
          });

        // Per-category recall fallback for chunks (spec §13.5)
        if (queryEmbedding && chunkCandidates.length > 0) {
          const aboveThreshold = chunkCandidates.filter(c => c.finalScore >= config.threshold).length;
          if (recallFallbackPredicate({ filteredCount: aboveThreshold, originalCount: chunkCandidates.length })) {
            anyFallbackApplied = true;
            logger.warn('retrieval.empty_after_semantic', { runId, category: 'chunks' });
            pendingDegradedReason = 'retrieval.empty_after_semantic';
            chunkCandidates = chunkCandidates.map(c => ({ ...c, finalScore: 0 }));
          }
        }
      }
    }
  } catch (err) {
    logger.warn('retrievalService.pool_query_failed', {
      runId,
      organisationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return buildDegradedResult('pool_query_failed');
  }

  // ── Step 3: Load memory blocks and rank them ────────────────────────────────
  let memoryBlockCandidates: RetrievalCandidate[] = [];
  try {
    const mbRows = await db
      .select({
        id: memoryBlocks.id,
        organisationId: memoryBlocks.organisationId,
        subaccountId: memoryBlocks.subaccountId,
        ownerAgentId: memoryBlocks.ownerAgentId,
        content: memoryBlocks.content,
        isAuthoritative: memoryBlocks.isAuthoritative,
        priority: memoryBlocks.priority,
        pausedAt: memoryBlocks.pausedAt,
        deprecatedAt: memoryBlocks.deprecatedAt,
        createdAt: memoryBlocks.createdAt,
        embedding: memoryBlocks.embedding,
      })
      .from(memoryBlocks)
      .where(
        and(
          eq(memoryBlocks.organisationId, organisationId),
          isNull(memoryBlocks.deletedAt),
          sql`${memoryBlocks.status} = 'active'`,
        ),
      );

    const typedMbRows: MemoryBlockRow[] = mbRows.map(r => ({
      id: r.id,
      organisationId: r.organisationId,
      subaccountId: r.subaccountId,
      ownerAgentId: r.ownerAgentId,
      content: r.content,
      isAuthoritative: r.isAuthoritative,
      priority: r.priority as MemoryBlockRow['priority'],
      pausedAt: r.pausedAt,
      deprecatedAt: r.deprecatedAt,
      createdAt: r.createdAt,
    }));

    const rankedMb = rankByPrecedencePure({
      organisationId,
      subaccountId: subaccountId ?? undefined,
      agentId,
      candidates: typedMbRows,
    });

    const mbById = new Map(mbRows.map(r => [r.id, r]));
    memoryBlockCandidates = rankedMb.map(mb => {
      const row = mbById.get(mb.id)!;
      let tier = 1;
      if (row.ownerAgentId) tier = 3;
      else if (row.subaccountId) tier = 2;
      let finalScore = 0;
      if (queryEmbedding && Array.isArray(row.embedding)) {
        try {
          finalScore = cosineSimilarity(row.embedding as number[], queryEmbedding);
        } catch {
          // per-candidate vector error — keep 0
        }
      }
      return {
        id: mb.id,
        organisationId: mb.organisationId,
        kind: 'memory_block' as const,
        mode: 'auto' as const,
        scopeTier: tier,
        finalScore,
        updatedAt: mb.createdAt,
        tokenCount: 0,
        content: mb.content,
      };
    });

    // Per-category recall fallback for memory blocks (spec §13.5)
    if (queryEmbedding && memoryBlockCandidates.length > 0) {
      const aboveThreshold = memoryBlockCandidates.filter(c => c.finalScore >= config.threshold).length;
      if (recallFallbackPredicate({ filteredCount: aboveThreshold, originalCount: memoryBlockCandidates.length })) {
        anyFallbackApplied = true;
        logger.warn('retrieval.empty_after_semantic', { runId, category: 'blocks' });
        pendingDegradedReason = 'retrieval.empty_after_semantic';
        memoryBlockCandidates = memoryBlockCandidates.map(c => ({ ...c, finalScore: 0 }));
      }
    }
  } catch (err) {
    logger.warn('retrievalService.memory_block_load_failed', {
      runId,
      organisationId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Non-fatal: continue with chunks only
  }

  // ── Step 4: Combine candidates (chunks first, then memory blocks) ───────────
  const allCandidates: RetrievalCandidate[] = [...chunkCandidates, ...memoryBlockCandidates];

  // ── Step 5: Rank ────────────────────────────────────────────────────────────
  let ranked: RetrievalResult;
  try {
    ranked = rankCandidates({
      candidates: allCandidates,
      threshold: anyFallbackApplied ? 0 : config.threshold,
      budgetTokens: DEFAULT_BUDGET_TOKENS,
      nowMs: Date.now(),
      orgId: organisationId,
      runContext: {
        runId,
        agentId,
        subaccountId: subaccountId ?? null,
        scheduledTaskId: null,
        taskInstanceId: null,
      },
    });
  } catch (err) {
    logger.warn('retrievalService.rank_failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return buildDegradedResult('rank_failed');
  }

  // ── Step 6: Group by document ───────────────────────────────────────────────
  // groupCandidatesByDocument requires RetrievalCandidate[] (ranked loaded items).
  // Reconstruct from allCandidates filtered to the loaded IDs.
  try {
    const loadedIds = new Set(ranked.loaded.map(l => l.id));
    const loadedCandidates = allCandidates.filter(c => loadedIds.has(c.id));
    groupCandidatesByDocument({
      rankedCandidates: loadedCandidates,
      allChunksByDocumentId,
    });
  } catch (err) {
    // Non-fatal: grouping failure does not affect the returned result
    logger.warn('retrievalService.document_group_failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Step 7: Truncate for emission ───────────────────────────────────────────
  // Attach degraded reason if embedding failed or semantic fallback was applied.
  if (pendingDegradedReason !== null) {
    ranked = { ...ranked, degraded: true, degradedReason: pendingDegradedReason };
  }
  return truncateForEmission(ranked);
}
