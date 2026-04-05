# Development Brief: Semantic Search / RAG Improvements

**Date:** 2026-04-05
**Status:** Research Complete -- Actionable Improvements Identified

---

## Executive Summary

Our RAG system is already well-architected: pgvector with HNSW indexing, a hybrid scoring formula (60% cosine + 25% quality + 15% recency), Mem0-style deduplication, entity extraction, and memory decay. BM25 via wink-bm25-text-search is used separately for tool discovery only.

The system has clear, high-impact improvement opportunities that require no new infrastructure. All improvements build on existing Postgres + pgvector.

**Recommendation: Pursue a 4-phase improvement plan.** Each phase is independently valuable and incrementally improves retrieval quality without architectural disruption.

---

## Current State Assessment

### Architecture Overview

```
Agent Run Completes
    |
    v
LLM Extraction (insights) --> Quality Scoring (completeness/relevance/specificity/actionability)
    |
    v
Mem0 Deduplication (ADD/UPDATE/DELETE via LLM)
    |
    v
INSERT workspace_memory_entries (content, entryType, qualityScore, taskSlug)
    |
    v
ASYNC: OpenAI text-embedding-3-small (1536d, 8192 char limit) --> pgvector column
    |
    v
When Agent Runs:
  Task Context --> generateEmbedding() --> Hybrid Scoring Query
    |
    v
  SQL: (1 - cosine_dist) * 0.60 + quality * 0.25 + recency_decay * 0.15
  WHERE quality >= threshold AND recency <= 90 days
  ORDER BY combined_score DESC LIMIT 5
  FILTER: combined_score >= 0.75
    |
    v
  Inject into <workspace-memory-data> tag in system prompt
```

### What We Have

| Component | Implementation | Status |
|-----------|---------------|--------|
| Embedding model | OpenAI text-embedding-3-small (1536d) | Working |
| Vector storage | pgvector column, vector(1536) | Working |
| Vector index | HNSW (m=16, ef_construction=64, vector_cosine_ops) | Working |
| Similarity search | Cosine distance via `<=>` operator | Working |
| Hybrid scoring | 60% cosine + 25% quality + 15% recency decay | Working |
| Quality scoring | Heuristic: completeness + relevance + specificity + actionability | Working |
| Recency decay | Exponential, 30-day half-life | Working |
| Memory lifecycle | 90-day pruning for low-quality (< 0.3) + low-access (< 3) entries | Working |
| Deduplication | Mem0 pattern: LLM classifies ADD/UPDATE/DELETE against recent 20 entries | Working |
| Entity extraction | Named entities with confidence threshold (0.7), max 10 per prompt | Working |
| BM25 search | wink-bm25-text-search, lazy-loaded singleton | Working (tool discovery only) |
| Summary regeneration | Every 5 runs, LLM merges summary + new entries | Working |
| Org-level memory | Separate schema with scopeTags for cross-subaccount filtering | Working |

### What's Working Well

- HNSW index provides fast ANN queries
- Hybrid scoring formula balances relevance, quality, and freshness
- Mem0 dedup prevents memory bloat
- Access tracking enables intelligent decay
- Non-blocking embedding generation (fire-and-forget)
- Boundary markers prevent prompt injection via memory content
- Graceful degradation when embeddings fail

### Identified Gaps

| Gap | Impact | Current Workaround |
|-----|--------|-------------------|
| No contextual retrieval | Chunks lack document context, reducing embedding quality | Quality scoring heuristic compensates partially |
| BM25 not used for memory retrieval | Keyword-exact matches missed in semantic search | Only used for tool discovery, not memory |
| No hybrid search for memories | Vector-only retrieval misses keyword signals | Quality + recency scoring partially compensates |
| No reranking | Single-stage retrieval, no cross-encoder refinement | High similarity threshold (0.75) filters noise |
| No query expansion | Short/vague queries produce poor embeddings | MIN_QUERY_CONTEXT_LENGTH (20 chars) gate |
| Fixed scoring weights | 60/25/15 not tunable or learnable | Hard-coded in workspaceMemoryService.ts |
| tsvector not used | Postgres full-text search capabilities unused | wink-bm25 handles keyword search in-memory |
| BM25 index is memory-only | Not persistent, rebuilt on restart, can't participate in SQL | Lazy loading mitigates cold start |

---

## Improvement Plan

### Phase 1: Contextual Retrieval (Highest Impact)

**What:** Before embedding memory entries, enrich them with contextual prefix using an LLM call.

**Why:** Anthropic's research shows contextual retrieval improves retrieval accuracy by ~5-7 percentage points. This is the single highest-impact change with zero per-query overhead (one-time ingestion cost).

**How it works:**
- When extracting insights from agent runs (extractRunInsights), generate a 1-2 sentence context prefix for each entry using the run's full context
- Prepend the context to the content before embedding: `"${context}\n\n${content}"`
- The stored content remains unchanged (context is only used for embedding)
- Use prompt caching to reduce cost (~69% reduction when processing multiple entries from the same run)

**Impact on current system:**
- Modify `extractRunInsights()` in workspaceMemoryService.ts
- Add context generation step before embedding
- Re-embed existing entries (one-time backfill job)
- No schema changes needed (context can be stored in a new column or discarded after embedding)

**Estimated effort:** Medium (2-3 days)
**Risk:** Low -- additive change, existing flow unchanged

---

### Phase 2: Hybrid Search for Memory Retrieval (Second Highest Impact)

**What:** Combine pgvector cosine similarity with Postgres full-text search (tsvector) using Reciprocal Rank Fusion (RRF) in a single SQL query.

**Why:** Pure vector search achieves ~62% retrieval precision. Adding keyword search with RRF fusion improves it to ~84%. This catches exact term matches, names, and codes that embeddings miss.

**How it works:**

Replace the current single-source vector query with an RRF CTE:

```sql
WITH semantic AS (
  SELECT id, content,
    ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS rank
  FROM workspace_memory_entries
  WHERE embedding IS NOT NULL
    AND quality_score >= :threshold
    AND (task_slug = :taskSlug OR task_slug IS NULL)
    AND created_at >= NOW() - INTERVAL '90 days'
  ORDER BY embedding <=> query_embedding
  LIMIT 20
),
fulltext AS (
  SELECT id, content,
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, query) DESC) AS rank
  FROM workspace_memory_entries
  WHERE tsv @@ plainto_tsquery(:queryText)
    AND quality_score >= :threshold
    AND (task_slug = :taskSlug OR task_slug IS NULL)
    AND created_at >= NOW() - INTERVAL '90 days'
  LIMIT 20
)
SELECT COALESCE(s.id, f.id) AS id,
  COALESCE(s.content, f.content) AS content,
  COALESCE(1.0 / (60 + s.rank), 0.0) +
  COALESCE(1.0 / (60 + f.rank), 0.0) AS rrf_score
FROM semantic s
FULL OUTER JOIN fulltext f ON s.id = f.id
ORDER BY rrf_score DESC
LIMIT 5;
```

**Impact on current system:**
- Add `tsvector` column to `workspace_memory_entries` with GIN index
- Add trigger to auto-populate tsvector on INSERT/UPDATE
- Replace `getRelevantMemories()` query in workspaceMemoryService.ts
- Can retain quality + recency weighting as additional scoring factors
- Backfill tsvector for existing entries (one-time migration)

**Why tsvector over keeping wink-bm25:**
- Runs in Postgres alongside vector search -- single query, no application-level fusion
- Transactionally consistent with data changes
- No memory pressure from in-memory index
- Persistent across restarts
- Note: Postgres `ts_rank` is not true BM25 (lacks IDF). If keyword relevance quality is insufficient, evaluate `pg_textsearch` extension for true BM25.

**Estimated effort:** Medium (2-3 days)
**Risk:** Low -- additive schema change, can A/B test against current approach

---

### Phase 3: Cross-Encoder Reranking (Refinement)

**What:** Add a reranking step after retrieval. Over-retrieve 20-50 candidates from hybrid search, then rerank to top 5 using a cross-encoder model.

**Why:** Cross-encoder reranking improves RAG accuracy by ~40% and reduces hallucinations by 10-25%. It's a precision multiplier on top of hybrid search.

**Options:**

| Reranker | Latency | Cost | Notes |
|----------|---------|------|-------|
| Cohere Rerank 4 | 150-400ms | ~$1/1000 requests | Best-in-class, API-based |
| FlashRank | 15-30ms | Free (self-hosted) | Lightweight, good for latency-sensitive |
| MiniLM cross-encoder | 100-250ms | Free (self-hosted) | No API dependency |

**Impact on current system:**
- Add reranking call between retrieval and result filtering in `getRelevantMemories()`
- Increase `VECTOR_SEARCH_LIMIT` from 5 to 20-50 for initial retrieval
- Apply reranker, then take top 5
- Adds 15-400ms latency per query (depending on choice)

**Estimated effort:** Low (1-2 days)
**Risk:** Low -- optional step, can be feature-flagged

---

### Phase 4: Query Expansion (Polish)

**What:** For short or vague queries, use HyDE (Hypothetical Document Embeddings) -- generate a hypothetical answer via LLM, then embed that instead of the raw query.

**Why:** Short queries produce poor embeddings. HyDE bridges the semantic gap between terse questions and detailed memory entries. Reports show up to 42 percentage points improvement on some datasets.

**Trade-off:** Adds one LLM call per query (~200-500ms). Only worth applying when query context is short (below a threshold, e.g., < 100 chars).

**Impact on current system:**
- Add conditional HyDE step in `getMemoryForPrompt()` when `taskContext.length < HYDE_THRESHOLD`
- Uses existing LLM infrastructure
- No schema changes

**Estimated effort:** Low (1 day)
**Risk:** Low -- conditional, only activates for short queries

---

## What NOT to Build

| Don't | Why |
|-------|-----|
| Add ChromaDB or another vector DB | Already on Postgres with pgvector. Chroma adds infrastructure with no upside. |
| Switch to Pinecone/Weaviate | Overkill -- our corpus is well under 1M vectors. pgvector handles this easily. |
| Over-chunk documents | Our memories are LLM-extracted insights, not raw documents. They're already at the right granularity. |
| Build learnable scoring weights | Premature optimisation. Fixed weights with manual tuning (Phase 2) will get us further. |
| Replace wink-bm25 for tool discovery | It works well for its use case (tool search). The hybrid search improvement is for memory retrieval. |

---

## Impact Summary

| Phase | Change | Retrieval Impact | Per-Query Overhead | Effort |
|-------|--------|-----------------|-------------------|--------|
| 1 | Contextual retrieval | +5-7% accuracy | None (ingestion only) | Medium |
| 2 | Hybrid search (RRF) | +15-20% accuracy | ~1-2ms (same query) | Medium |
| 3 | Cross-encoder reranking | +5-10% accuracy | 15-400ms | Low |
| 4 | Query expansion (HyDE) | Variable (short queries) | 200-500ms (conditional) | Low |

**Cumulative expected improvement:** ~25-35% better retrieval accuracy, measured by relevant memories surfaced in agent prompts.

---

## Prioritised Execution Order

1. **Phase 1 + 2 together** -- Contextual retrieval and hybrid search are independent and can be developed in parallel. Together they represent the bulk of the improvement.
2. **Phase 3** -- Add reranking once hybrid search is in place to refine results.
3. **Phase 4** -- Query expansion is a polish step, apply if short-query retrieval remains weak.

---

## Key Files

| File | Purpose | Phases Affected |
|------|---------|----------------|
| `server/services/workspaceMemoryService.ts` | Core memory extraction, scoring, retrieval | 1, 2, 3, 4 |
| `server/lib/embeddings.ts` | Embedding generation (OpenAI text-embedding-3-small) | 1 |
| `server/db/schema/workspaceMemories.ts` | Schema: vector(1536), quality scores, access tracking | 2 |
| `server/db/schema/orgMemories.ts` | Org-level memory schema | 2 (if extending to org) |
| `server/services/orgMemoryService.ts` | Org-level semantic search | 2, 3 |
| `server/config/limits.ts` | VECTOR_SEARCH_LIMIT, VECTOR_SIMILARITY_THRESHOLD | 2, 3 |
| `server/tools/meta/searchTools.ts` | BM25 tool discovery (unchanged) | None |
| `server/jobs/memoryDecayJob.ts` | Memory pruning | None |

---

## Measurement Plan

To validate improvements, measure before and after each phase:

1. **Retrieval precision** -- For a sample of agent runs, compare memories surfaced vs. memories that would have been useful (manual evaluation on 50-100 runs)
2. **Agent task success rate** -- Track whether better memory retrieval correlates with higher task completion rates
3. **Query latency** -- p50/p95/p99 for `getRelevantMemories()` before and after each phase
4. **Memory utilisation** -- % of retrieved memories that agents actually reference in their responses
