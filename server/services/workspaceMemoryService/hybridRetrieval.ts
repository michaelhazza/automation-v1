import { sql, inArray } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workspaceMemoryEntries } from '../../db/schema/index.js';
import { tryEmitAgentEvent } from '../agentExecutionEventEmitter.js';
import { routeCall } from '../llmRouter.js';
import { generateEmbedding, formatVectorLiteral } from '../../lib/embeddings.js';
import { rerank } from '../../lib/reranker.js';
import { sanitizeSearchQuery } from '../../lib/sanitizeSearchQuery.js';
import { classifyQueryIntent } from '../../lib/queryIntentClassifier.js';
import { RETRIEVAL_PROFILES } from '../../lib/queryIntent.js';
import { createHash } from 'crypto';
import { getMemoryConsolidationTierEnabled } from '../../config/featureFlags.js';
import { getActiveMemoryConsolidationConfig } from '../../config/memoryConsolidationConfig.js';
import { computeDecayWeight } from './decayPure.js';
import { applyTierMultiplier } from './tierMultiplierPure.js';
import { recordAccess } from './reinforcementBatch.js';
import {
  VECTOR_SEARCH_LIMIT,
  VECTOR_SEARCH_RECENCY_DAYS,
  RRF_OVER_RETRIEVE_MULTIPLIER,
  RRF_K,
  RRF_MIN_SCORE,
  MAX_MEMORY_SCAN,
  MAX_QUERY_TEXT_CHARS,
  RERANKER_PROVIDER,
  RERANKER_MODEL,
  RERANKER_TOP_N,
  RERANKER_CANDIDATE_COUNT,
  HYDE_THRESHOLD,
  HYDE_MAX_TOKENS,
  DOMINANCE_THRESHOLD,
  EXPANSION_MIN_SCORE,
  RECENCY_BOOST_WINDOW_DAYS,
  RECENCY_BOOST_WEIGHT,
  MIN_QUERY_CONTEXT_LENGTH,
} from '../../config/limits.js';
import { hydeCacheGet, hydeCacheSet } from './hydeCache.js';
import { expandWithGraph } from './graphExpansion.js';
import type { HybridRetrieveParams, HybridResult } from './types.js';

export async function hybridRetrieve(params: HybridRetrieveParams): Promise<HybridResult[]> {
  const {
    subaccountId,
    orgId,
    queryText: rawQueryText,
    qualityThreshold,
    taskSlug,
    domain,
    topK = VECTOR_SEARCH_LIMIT,
    includeOtherSubaccounts = false,
    profile: profileOverride,
    runId,
    organisationId,
  } = params;

  const retrievalStart = Date.now();

  // LAEL Phase 1 — emit a zero-result memory.retrieved event when an early
  // return short-circuits the pipeline (empty/sanitized query, embedding
  // failure). Without this, agent runs with degenerate queries produce no
  // memory.retrieved event at all and the run timeline silently omits the
  // retrieval attempt.
  const emitZeroResultEvent = () => {
    if (runId == null || organisationId == null) return;
    tryEmitAgentEvent({
      runId,
      organisationId,
      subaccountId,
      sourceService: 'workspaceMemoryService',
      payload: {
        eventType: 'memory.retrieved',
        critical: false,
        queryText: rawQueryText,
        retrievalMs: Date.now() - retrievalStart,
        topEntries: [],
        totalRetrieved: 0,
      },
      linkedEntity: null,
    });
  };

  // Phase 0B: sanitize agent-generated queries
  const sanitizedQuery = sanitizeSearchQuery(rawQueryText);
  if (!sanitizedQuery) {
    emitZeroResultEvent();
    return [];
  }

  // Phase 1A: classify intent and select weights
  const profile = profileOverride ?? classifyQueryIntent(sanitizedQuery);
  const weights = RETRIEVAL_PROFILES[profile];

  const safeQueryText = sanitizedQuery.slice(0, MAX_QUERY_TEXT_CHARS);

  // Generate embedding if not provided (with HyDE for short queries)
  let queryEmbedding = params.queryEmbedding;
  if (!queryEmbedding) {
    let embeddingInput = sanitizedQuery;
    if (sanitizedQuery.length < HYDE_THRESHOLD && sanitizedQuery.length >= MIN_QUERY_CONTEXT_LENGTH && orgId) {
      const cacheKey = `hyde:${createHash('sha256').update(sanitizedQuery).digest('hex').slice(0, 16)}`;
      const cached = hydeCacheGet(cacheKey);
      if (cached) {
        embeddingInput = cached;
      } else {
        try {
          const hydeResponse = await routeCall({
            messages: [{ role: 'user', content: `Given this short task context, generate a hypothetical memory entry (2-3 sentences) that would be relevant and useful. Include specific details and terminology.\n\nTask context: "${sanitizedQuery}"\n\nRespond with only the hypothetical memory entry.` }],
            temperature: 0.5,
            maxTokens: HYDE_MAX_TOKENS,
            context: { organisationId: orgId, subaccountId, sourceType: 'system', taskType: 'hyde_expansion', routingMode: 'ceiling' },
          });
          const hydeText = hydeResponse?.content ?? null;
          if (hydeText) {
            embeddingInput = hydeText;
            hydeCacheSet(cacheKey, hydeText);
          }
        } catch {
          // Fall back to original query
        }
      }
    }
    queryEmbedding = await generateEmbedding(embeddingInput) ?? undefined;
    if (!queryEmbedding) {
      emitZeroResultEvent();
      return [];
    }
  }

  const vectorLiteral = formatVectorLiteral(queryEmbedding);
  const overRetrieveLimit = topK * RRF_OVER_RETRIEVE_MULTIPLIER;

  // Build scope filter.
  // §7 G6.2 — always exclude archived Reference notes from semantic and
  // full-text retrieval so "archive" on the Knowledge page immediately
  // removes the note from the agent's memory_search results.
  const scopeFilter = includeOtherSubaccounts && orgId
    ? sql`organisation_id = ${orgId} AND deleted_at IS NULL`
    : orgId
      ? sql`organisation_id = ${orgId} AND subaccount_id = ${subaccountId} AND deleted_at IS NULL`
      : sql`subaccount_id = ${subaccountId} AND deleted_at IS NULL`;

  const taskFilter = taskSlug
    ? sql`AND (task_slug = ${taskSlug} OR task_slug IS NULL)`
    : sql``;

  // Phase 2C: optional domain filter for scoped retrieval
  const domainFilter = domain
    ? sql`AND domain = ${domain}`
    : sql``;

  // Check if query produces a valid tsquery (stopword-only queries yield empty)
  const hybridScopedDb = getOrgScopedDb('hybridRetrieval.hybridRetrieve');
  const tsqCheck = await hybridScopedDb.execute<{ q: string }>(
    sql`SELECT plainto_tsquery('english', ${safeQueryText})::text AS q`
  );
  const hasValidTsquery = !!(tsqCheck as unknown as Array<{ q: string }>)[0]?.q?.trim();

  // Statement timeout to prevent slow queries blocking the request thread.
  // Use session-level SET (not SET LOCAL) since we're not in an explicit transaction.
  await hybridScopedDb.execute(sql`SET statement_timeout = '200ms'`);

  // Full-text CTE (optional)
  const fullTextCte = hasValidTsquery
    ? sql`
      , fulltext AS (
        SELECT id, 1.0 / (${RRF_K} + ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', ${safeQueryText})) DESC
        )) AS rrf_component
        FROM candidate_pool
        WHERE tsv @@ plainto_tsquery('english', ${safeQueryText})
        LIMIT ${overRetrieveLimit}
      )`
    : sql``;

  const fullTextUnion = hasValidTsquery
    ? sql`UNION ALL SELECT id, rrf_component FROM fulltext`
    : sql``;

  // Determine retrieval limit.
  // When the tier flag is ON, fetch a larger candidate pool so the
  // post-fusion tier lens can actually change selected memory IDs (it needs
  // candidates beyond rank topK to promote into the final set). The
  // RRF_OVER_RETRIEVE_MULTIPLIER (4×) matches the multiplier already used by
  // the semantic and full-text CTEs, so this only bounds the final LIMIT,
  // not the inner over-retrieval. When the flag is OFF, retrieveLimit stays
  // at the pre-build value and the lens block does not run, keeping
  // flag-OFF behaviour byte-identical for the selection contract.
  const tierLensEnabled = getMemoryConsolidationTierEnabled();
  const baseRetrieveLimit = RERANKER_PROVIDER !== 'none'
    ? Math.max(RERANKER_CANDIDATE_COUNT, topK)
    : topK;
  const retrieveLimit = tierLensEnabled
    ? Math.max(baseRetrieveLimit, topK * RRF_OVER_RETRIEVE_MULTIPLIER)
    : baseRetrieveLimit;

  // Hybrid RRF query with candidate pool cap
  // Use try/finally so the timeout is always reset even if the query throws.
  let rrfRows: HybridResult[];
  try {
    const rows = await hybridScopedDb.execute<{
      id: string; content: string; rrf_score: number;
      combined_score: number; source_count: number;
      agent_id: string | null; agent_name: string;
      subaccount_id: string; created_at: string;
      last_accessed_at: string | null;
      consolidation_tier: string;
    }>(sql`
      WITH candidate_pool AS (
        SELECT id, content, entry_type, quality_score, created_at,
               last_accessed_at, embedding, tsv, agent_id, subaccount_id,
               consolidation_tier
        FROM workspace_memory_entries
        WHERE ${scopeFilter}
          AND (quality_score IS NULL OR quality_score >= ${qualityThreshold})
          ${taskFilter}
          ${domainFilter}
          AND created_at >= NOW() - INTERVAL '${VECTOR_SEARCH_RECENCY_DAYS} days'
        ORDER BY GREATEST(created_at, COALESCE(last_accessed_at, created_at)) DESC
        LIMIT ${MAX_MEMORY_SCAN}
      ),
      semantic AS (
        SELECT id, 1.0 / (${RRF_K} + ROW_NUMBER() OVER (
          ORDER BY embedding <=> ${vectorLiteral}::vector
        )) AS rrf_component
        FROM candidate_pool
        WHERE embedding IS NOT NULL
        LIMIT ${overRetrieveLimit}
      )
      ${fullTextCte}
      , rrf_scores AS (
        SELECT id, rrf_component FROM semantic
        ${fullTextUnion}
      ),
      fused AS (
        SELECT r.id, SUM(r.rrf_component) AS rrf_score, COUNT(*) AS source_count
        FROM rrf_scores r GROUP BY r.id
      )
      SELECT
        f.id, cp.content, f.rrf_score, f.source_count,
        cp.agent_id, COALESCE(a.name, 'Unknown') AS agent_name,
        cp.subaccount_id, cp.created_at::text AS created_at,
        cp.last_accessed_at::text AS last_accessed_at,
        cp.consolidation_tier,
        f.rrf_score * ${weights.rrf}
          + COALESCE(cp.quality_score, 0.5) * ${weights.quality}
          + (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - GREATEST(
              cp.created_at, COALESCE(cp.last_accessed_at, cp.created_at)
            ))) / 86400.0 / 30.0)) * ${weights.recency} AS combined_score
      FROM fused f
      JOIN candidate_pool cp ON cp.id = f.id
      LEFT JOIN agents a ON a.id = cp.agent_id
      WHERE f.rrf_score >= ${RRF_MIN_SCORE}
      ORDER BY combined_score DESC
      LIMIT ${retrieveLimit}
    `);
    rrfRows = (rows as unknown as Array<{
      id: string; content: string; rrf_score: number;
      combined_score: number; source_count: number;
      agent_id: string | null; agent_name: string;
      subaccount_id: string; created_at: string;
      last_accessed_at: string | null;
      consolidation_tier: string;
    }>).map(r => ({
      ...r,
      consolidationTier: r.consolidation_tier as HybridResult['consolidationTier'],
      tier: null,
      decayWeight: null,
      tierMultiplier: null,
      memoryConsolidationConfigVersion: null,
      lastAccessedAtAtRetrieval: null,
    }));
  } finally {
    // Reset statement timeout to default (no limit) — must run even on timeout throws
    await hybridScopedDb.execute(sql`SET statement_timeout = '0'`);
  }

  // ── Memory & Briefings §4.2 (S2): short-window recency boost ──────────────
  //
  // Entries accessed within the last RECENCY_BOOST_WINDOW_DAYS days receive an
  // additive RECENCY_BOOST_WEIGHT boost to their combined_score.
  //
  // INVARIANT (§4.4): this boost is NEVER written back to qualityScore or any
  // persisted column. It exists only for ranking within this request.
  // The access-count update at the bottom of this function (db.update) sets
  // lastAccessedAt and accessCount — it does NOT touch qualityScore.
  const recencyBoostCutoff = new Date(Date.now() - RECENCY_BOOST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  for (const row of rrfRows) {
    if (row.last_accessed_at !== null) {
      const accessedAt = new Date(row.last_accessed_at);
      if (accessedAt >= recencyBoostCutoff) {
        // Additive boost — ranking-time only, not persisted.
        row.combined_score += RECENCY_BOOST_WEIGHT;
      }
    }
  }
  // Re-sort after boost (boost may reorder entries within the retrieved set)
  if (rrfRows.length > 1) {
    rrfRows.sort((a, b) => b.combined_score - a.combined_score);
  }
  // ── end recency boost ────────────────────────────────────────────────────

  let results = rrfRows;

  // Safety fallback: if RRF floor removed all results, use semantic-only
  if (results.length === 0) {
    console.warn(`[WorkspaceMemory] RRF empty after filter for subaccount ${subaccountId}`);
    const fallback = await hybridScopedDb.execute<{
      id: string; content: string; agent_id: string | null;
      subaccount_id: string; created_at: string;
    }>(sql`
      SELECT id, content, agent_id, subaccount_id, created_at::text AS created_at
      FROM workspace_memory_entries
      WHERE ${scopeFilter}
        AND embedding IS NOT NULL
        AND (quality_score IS NULL OR quality_score >= ${qualityThreshold})
        ${taskFilter}
        ${domainFilter}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${topK}
    `);
    const fbRows = fallback as unknown as Array<{
      id: string; content: string; agent_id: string | null;
      subaccount_id: string; created_at: string;
    }>;
    const fallbackResults: HybridResult[] = fbRows.map(r => ({
      id: r.id,
      content: r.content,
      rrf_score: 0,
      combined_score: 0,
      source_count: 0,
      agent_id: r.agent_id,
      agent_name: 'Unknown',
      subaccount_id: r.subaccount_id,
      created_at: r.created_at,
      last_accessed_at: null,
      consolidationTier: 'episodic' as const,
      tier: null,
      decayWeight: null,
      tierMultiplier: null,
      memoryConsolidationConfigVersion: null,
      lastAccessedAtAtRetrieval: null,
    }));
    if (runId != null && organisationId != null) {
      const topEntries = fallbackResults.slice(0, 5).map(r => ({
        id: r.id,
        score: r.combined_score,
        excerpt: r.content.slice(0, 240),
        tier: r.tier,
        decayWeight: r.decayWeight,
        tierMultiplier: r.tierMultiplier,
        memoryConsolidationConfigVersion: r.memoryConsolidationConfigVersion,
        lastAccessedAtAtRetrieval: r.lastAccessedAtAtRetrieval,
      }));
      tryEmitAgentEvent({
        runId,
        organisationId,
        subaccountId,
        sourceService: 'workspaceMemoryService',
        payload: {
          eventType: 'memory.retrieved',
          critical: false,
          queryText: rawQueryText,
          retrievalMs: Date.now() - retrievalStart,
          topEntries,
          totalRetrieved: fallbackResults.length,
        },
        linkedEntity: fallbackResults.length > 0 ? { type: 'memory_entry', id: fallbackResults[0].id } : null,
      });
    }
    return fallbackResults;
  }

  // Phase 1B: Dominance-ratio confidence gating — skip reranker and graph
  // expansion when results are ambiguous (top two scores too close). Prevents
  // amplifying uncertain retrieval with reranking or relational expansion.
  let dominanceGated = false;
  if (results.length >= 2) {
    const dominanceRatio = results[0].combined_score / results[1].combined_score;
    if (dominanceRatio < DOMINANCE_THRESHOLD) {
      dominanceGated = true;
    }
  }

  // Reranking (Phase B3) — feature-flagged, skipped when dominance-gated
  if (!dominanceGated && RERANKER_PROVIDER !== 'none' && results.length > RERANKER_TOP_N) {
    try {
      const reranked = await rerank(
        sanitizedQuery,
        results.map(r => ({ id: r.id, content: r.content })),
        {
          provider: RERANKER_PROVIDER,
          model: RERANKER_MODEL,
          apiKey: process.env.RERANKER_API_KEY,
          topN: RERANKER_TOP_N,
        }
      );
      const scoreMap = new Map(reranked.map(r => [r.id, r.score]));
      results = results
        .filter(r => scoreMap.has(r.id))
        .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
    } catch (err) {
      console.warn('[WorkspaceMemory] Reranking failed, using hybrid results:', err instanceof Error ? err.message : err);
      results = results.slice(0, topK);
    }
  }

  // Phase 1C: Graph-aware context expansion — follow relational edges to
  // surface connected memories that vector search may miss.
  // Double-gated: skip when results are ambiguous (dominance ratio) OR when
  // the top result is too weak in absolute terms (EXPANSION_MIN_SCORE).
  const topScoreAboveFloor = results.length > 0 && results[0].combined_score >= EXPANSION_MIN_SCORE;
  if (results.length > 0 && !dominanceGated && topScoreAboveFloor) {
    const expanded = await expandWithGraph(results, scopeFilter, 5);
    if (expanded.length > 0) {
      const existingIds = new Set(results.map(r => r.id));
      const minScore = Math.min(...results.map(r => r.combined_score));
      for (const ex of expanded) {
        if (!existingIds.has(ex.id)) {
          results.push({ ...ex, combined_score: minScore * 0.8 });
          existingIds.add(ex.id);
        }
      }
      // Re-sort after expansion
      results.sort((a, b) => b.combined_score - a.combined_score);
    }
  }

  // Capture pre-slice count for totalRetrieved (used in LAEL event payload).
  const totalRetrievedBeforeTopK = results.length;

  // Post-fusion tier lens — applies decay and tier multipliers BEFORE the
  // final topK truncation so a tier-boosted entry at rank topK+1 can be
  // promoted into the returned set. The spec's flag-ON contract treats the
  // lens as affecting "selected memory IDs", not just display order. Paired
  // with the flag-driven retrieveLimit bump above, the lens now has a
  // candidate pool of size >= topK * RRF_OVER_RETRIEVE_MULTIPLIER to choose
  // from. Skipped entirely when flag is OFF; flag-OFF behavioural surface is
  // byte-identical to pre-build (lens never runs, no scores change, slice
  // happens against the original combined_score ordering on a base-sized
  // candidate pool).
  if (tierLensEnabled) {
    const config = getActiveMemoryConsolidationConfig();
    const now = new Date();
    for (const candidate of results) {
      const decayWeight = computeDecayWeight(
        candidate.consolidationTier,
        candidate.last_accessed_at ? new Date(candidate.last_accessed_at) : null,
        now,
        config.decayConfig,
      );
      const tierMultiplier = applyTierMultiplier(candidate.consolidationTier, profile, config);
      candidate.combined_score *= decayWeight * tierMultiplier;
      candidate.tier = candidate.consolidationTier;
      candidate.decayWeight = decayWeight;
      candidate.tierMultiplier = tierMultiplier;
      candidate.memoryConsolidationConfigVersion = config.version;
      candidate.lastAccessedAtAtRetrieval = candidate.last_accessed_at;
    }
    results.sort((a, b) => b.combined_score - a.combined_score);
  }

  // Final topK truncation — runs after the tier lens (when ON) so tier
  // boosts can affect selection. When the flag is OFF, results retain their
  // pre-build ordering and this slice is identical to the prior behaviour.
  results = results.slice(0, topK);

  // Access counter update — flag ON: batched via reinforcementBatch; flag OFF: synchronous UPDATE preserved.
  // Reuses tierLensEnabled (cached above) per the §G1 spec contract that the
  // flag read is stable for the duration of a single retrieval call.
  if (results.length > 0) {
    if (tierLensEnabled) {
      if (organisationId || orgId) {
        for (const r of results) {
          recordAccess(r.id, (organisationId ?? orgId)!, subaccountId);
        }
      }
    } else {
      const now = new Date();
      hybridScopedDb.update(workspaceMemoryEntries)
        .set({ accessCount: sql`access_count + 1`, lastAccessedAt: now })
        .where(inArray(workspaceMemoryEntries.id, results.map(r => r.id)))
        .catch((err) => console.error('[WorkspaceMemory] Failed to update access counts:', err));
    }
  }

  // LAEL Phase 1 — emit memory.retrieved at the return boundary.
  // Skip silently when runId is absent (non-agent callers: admin tooling, config assistant).
  if (runId != null && organisationId != null) {
    const topEntries = results.slice(0, 5).map(r => ({
      id: r.id,
      score: r.combined_score,
      excerpt: r.content.slice(0, 240),
      tier: r.tier,
      decayWeight: r.decayWeight,
      tierMultiplier: r.tierMultiplier,
      memoryConsolidationConfigVersion: r.memoryConsolidationConfigVersion,
      lastAccessedAtAtRetrieval: r.lastAccessedAtAtRetrieval,
    }));
    tryEmitAgentEvent({
      runId,
      organisationId,
      subaccountId,
      sourceService: 'workspaceMemoryService',
      payload: {
        eventType: 'memory.retrieved',
        critical: false,
        queryText: rawQueryText,
        retrievalMs: Date.now() - retrievalStart,
        topEntries,
        totalRetrieved: totalRetrievedBeforeTopK,
      },
      linkedEntity: results.length > 0 ? { type: 'memory_entry', id: results[0].id } : null,
    });
  }

  return results;
}
