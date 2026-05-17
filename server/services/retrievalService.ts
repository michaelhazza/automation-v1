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
  scoreCandidates,
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
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
  // Per-category fallback flags (spec §13.5; ChatGPT R1 F2).
  // Tracked independently so one category's fallback does not disable
  // thresholding for the other category.
  let chunksFallbackApplied = false;
  let blocksFallbackApplied = false;
  let pendingDegradedReason: 'retrieval.embedding_failed' | 'retrieval.empty_after_semantic' | null = null;

  if (config.semanticEnabled) {
    try {
      // Embed the run's task DESCRIPTION ONLY per spec §10 + handoff Q1
      // resolution. Concatenating title+description was a Phase-2 drift; reverted
      // per ChatGPT R1 T4. Title-as-search-key may be revisited post-enablement
      // if B1 utility numbers show recall is missing relevant chunks.
      let taskText: string | null = null;
      if (run.taskId) {
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
        const [taskRow] = await db
          .select({ description: tasks.description })
          .from(tasks)
          .where(and(eq(tasks.id, run.taskId), eq(tasks.organisationId, organisationId)))
          .limit(1);
        if (taskRow?.description) {
          taskText = taskRow.description;
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

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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

        // Build candidates without finalScore yet, keeping embedding attached
        // for the scoring boundary below. ChatGPT R2 T1: route scoring through
        // the tested `scoreCandidates()` helper instead of inline cosine.
        const candidateBase = preScoredChunks.map(chunk => {
          const doc = docMap.get(chunk.documentId)!;
          return {
            id: chunk.id,
            documentId: chunk.documentId,
            organisationId: chunk.organisationId,
            kind: 'document_chunk' as const,
            mode: doc.mode,
            scopeTier: documentScopeTier.get(chunk.documentId) ?? 1,
            updatedAt: chunk.updatedAt,
            tokenCount: chunk.tokenCount,
            content: chunk.content,
            embedding: Array.isArray(chunk.embedding) ? (chunk.embedding as number[]) : null,
          };
        });

        if (queryEmbedding) {
          // Use scoreCandidates with threshold 0 so it acts as scorer + malformed
          // exclusion only; the per-category threshold filter applies later.
          const withEmbedding = candidateBase.filter(
            (c): c is typeof c & { embedding: number[] } => c.embedding !== null,
          );
          chunkCandidates = scoreCandidates({
            candidates: withEmbedding,
            queryEmbedding,
            threshold: 0,
          }).map(({ embedding: _embedding, ...rest }) => rest as RetrievalCandidate);
        } else {
          // Flag off: all candidates pass through with finalScore 0.
          chunkCandidates = candidateBase.map(
            ({ embedding: _embedding, ...rest }) => ({ ...rest, finalScore: 0 } as RetrievalCandidate),
          );
        }
        chunkCandidates.sort((a, b) => {
          if (b.scopeTier !== a.scopeTier) return b.scopeTier - a.scopeTier;
          if (b.updatedAt.getTime() !== a.updatedAt.getTime()) return b.updatedAt.getTime() - a.updatedAt.getTime();
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        // Per-category recall fallback for chunks (spec §13.5; ChatGPT R1 F2)
        if (queryEmbedding && chunkCandidates.length > 0) {
          const aboveThreshold = chunkCandidates.filter(c => c.finalScore >= config.threshold).length;
          if (recallFallbackPredicate({ filteredCount: aboveThreshold, originalCount: chunkCandidates.length })) {
            chunksFallbackApplied = true;
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
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
    // Build candidates with embedding still attached, then route scoring
    // through the tested scoreCandidates() helper (ChatGPT R2 T1).
    const mbCandidateBase = rankedMb.map(mb => {
      const row = mbById.get(mb.id)!;
      let tier = 1;
      if (row.ownerAgentId) tier = 3;
      else if (row.subaccountId) tier = 2;
      return {
        id: mb.id,
        organisationId: mb.organisationId,
        kind: 'memory_block' as const,
        mode: 'auto' as const,
        scopeTier: tier,
        updatedAt: mb.createdAt,
        tokenCount: 0,
        content: mb.content,
        embedding: Array.isArray(row.embedding) ? (row.embedding as number[]) : null,
      };
    });

    if (queryEmbedding) {
      const withEmbedding = mbCandidateBase.filter(
        (c): c is typeof c & { embedding: number[] } => c.embedding !== null,
      );
      memoryBlockCandidates = scoreCandidates({
        candidates: withEmbedding,
        queryEmbedding,
        threshold: 0,
      }).map(({ embedding: _embedding, ...rest }) => rest as RetrievalCandidate);
    } else {
      memoryBlockCandidates = mbCandidateBase.map(
        ({ embedding: _embedding, ...rest }) => ({ ...rest, finalScore: 0 } as RetrievalCandidate),
      );
    }

    // Per-category recall fallback for memory blocks (spec §13.5; ChatGPT R1 F2)
    if (queryEmbedding && memoryBlockCandidates.length > 0) {
      const aboveThreshold = memoryBlockCandidates.filter(c => c.finalScore >= config.threshold).length;
      if (recallFallbackPredicate({ filteredCount: aboveThreshold, originalCount: memoryBlockCandidates.length })) {
        blocksFallbackApplied = true;
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
  // Per-category threshold filtering before merge (spec §13.5; ChatGPT R1 F1+F2):
  //   - With flag OFF (queryEmbedding === null): finalScore is 0 for all
  //     candidates by construction; filtering against config.threshold would
  //     drop the entire pool. Skip category filtering entirely; rankCandidates
  //     receives threshold 0 (effective legacy behaviour).
  //   - With flag ON and category did NOT fall back: filter that category to
  //     finalScore >= config.threshold (genuine semantic acceptance).
  //   - With flag ON and category DID fall back: keep all candidates (already
  //     reset to finalScore 0 in the fallback branch above); they bypass the
  //     threshold via the rankCandidates threshold-0 pass below.
  if (queryEmbedding !== null) {
    if (!chunksFallbackApplied) {
      chunkCandidates = chunkCandidates.filter(c => c.finalScore >= config.threshold);
    }
    if (!blocksFallbackApplied) {
      memoryBlockCandidates = memoryBlockCandidates.filter(c => c.finalScore >= config.threshold);
    }
  }

  const allCandidates: RetrievalCandidate[] = [...chunkCandidates, ...memoryBlockCandidates];

  // ── Step 5: Rank ────────────────────────────────────────────────────────────
  // Category-level filtering is already complete above. rankCandidates uses
  // threshold 0 so it does not re-filter fallback or legacy (flag-off) pools.
  let ranked: RetrievalResult;
  try {
    ranked = rankCandidates({
      candidates: allCandidates,
      threshold: 0,
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
