---
title: Agent Intelligence Upgrade — Development Specification
date: 2026-04-12
status: draft
input: docs/oss-intelligence-analysis.md
revision: 1
---

# Agent Intelligence Upgrade — Development Specification

## Table of contents

1. Summary
2. Current state audit
3. Shared infrastructure — migrations, types, utilities
4. Phase 0 — Quick wins (0A, 0B, 0C)
5. Phase 1 — Search & retrieval overhaul (1A, 1B, 1C, 1D)
6. Phase 2 — Memory intelligence (2A, 2B, 2C, 2D)
7. Phase 3 — Context assembly upgrade (3A, 3B, 3C)
8. Migration inventory & build phases
9. Verification plan
10. Open items & risks

<!-- Phases 0-3 only. Phase 4 (Dev Agent code intelligence) and Phase 5 (polish) are separate future specs. -->

## 1. Summary

This spec translates the OSS intelligence analysis (`docs/oss-intelligence-analysis.md`) into implementation-ready detail for Phases 0-3. These phases upgrade search, memory, and context assembly across **all 16 system agents** — nothing here is dev-agent-specific.

**What this spec produces when fully implemented:**

- Unified retrieval pipeline for both prompt-injection and skill-invoked memory search (Phase 0)
- Query sanitisation that prevents agent-generated search pollution (Phase 0)
- Multi-breakpoint Anthropic prompt caching for 40-60% prompt token cost reduction (Phase 0)
- Intent-adaptive search weight tuning and confidence gating (Phase 1)
- Graph-aware context expansion following entity and task relationships (Phase 1)
- Relevance-scored data source loading with two-pass reranking (Phase 1)
- Temporal validity on workspace entities and memories (Phase 2)
- Similarity-based batch memory deduplication (Phase 2)
- Hierarchical domain/topic metadata on memory entries (Phase 2)
- Auto-generated agent briefings for cross-run continuity (Phase 2)
- Task-aware pre-run context injection (Phase 3)
- Auto-extracted subaccount state summaries (Phase 3)
- Post-generation hallucination detection middleware (Phase 3)

**North-star acceptance test:** An agent running its 20th task on a subaccount starts with accurate, relevant context (briefing + task-matched data sources + temporally valid entities), searches memory via the full RRF pipeline when it needs more, and produces output that references only real entities. Measured by: reduced tool calls per run (agents find context faster), reduced hallucinated entity references, and reduced prompt token cost on Anthropic.

**Build order rationale:** Phase 0 items are independent quick wins. Phase 1 builds on 0A (unified retrieval). Phase 2 is mostly independent but 2D benefits from 2A. Phase 3 builds on Phase 1 + 2 infrastructure. Within each phase, items are ordered by dependency.

**Scope boundary:** This spec covers Phases 0-3 only (14 items, ~35-45 dev-days). Phase 4 (AST parsing, dependency graphs, git intelligence — Dev Agent only) and Phase 5 (polish items) are deferred to a separate spec.

---

## 2. Current state audit

Inventory of existing code that this spec modifies. Every file path verified against main at commit `56c40e1`.

### 2.1 Memory retrieval — two divergent paths

| Path | File | Lines | Pipeline |
|------|------|-------|----------|
| Prompt injection | `workspaceMemoryService.ts:507` → `getRelevantMemories()` | 507-654 | Full RRF (BM25+vector), profile-based weights, HyDE (LRU cached), optional reranker, quality gating, recency decay, access tracking, fallback to cosine-only |
| Skill invocation | `workspaceMemoryService.ts:658` → `semanticSearchMemories()` | 658-728 | Pure cosine similarity only (`embedding <=> vector ORDER BY LIMIT`). No RRF, no BM25, no HyDE, no quality gating, no reranking |

The skill path (`search_agent_history`) is what agents call explicitly during a run. It uses the inferior pipeline. This is the single highest-leverage fix in the spec.

### 2.2 Query handling

- `getRelevantMemories` slices query to `MAX_QUERY_TEXT_CHARS`, validates `plainto_tsquery` for stopword-only protection, selects retrieval profile via `selectRetrievalProfile()` (3 profiles: temporal, factual, general — regex-based).
- `semanticSearchMemories` does no query processing at all — passes raw agent input directly to embedding generation.
- No query sanitisation exists anywhere in the codebase.

### 2.3 Prompt assembly (`agentExecutionService.ts`, 2645 lines)

System prompt assembled as `systemPromptParts: string[]` joined flat. Order:

1. `buildSystemPrompt(masterPrompt, dataSourceContents, orgProcesses)` — master + eager data sources + processes
2. `## Core Capabilities` — system skill instructions
3. `## Organisation Instructions` — `agent.additionalPrompt`
4. Memory blocks (Letta pattern, `memoryBlockService.formatBlocksForPrompt`)
5. `## Your Capabilities` — org skill instructions
6. `## Additional Instructions` — custom instructions from subaccount link
7. `## Task Instructions` — scheduled task description
8. `## Available Context Sources` — lazy manifest (capped)
9. Team roster
10. Workspace memory
11. Workspace entities
12. Board state
13. Autonomous instructions
14. Optional addendum

**Caching:** Anthropic adapter (`anthropicAdapter.ts`, 108 lines) wraps the entire system prompt as one `cache_control: { type: 'ephemeral' }` block. One breakpoint. Dynamic content (memory, board, task instructions) invalidates the cache for the entire prompt on every run.

### 2.4 Context loading (`runContextLoader.ts`, 125 lines)

- Fetches data sources by scope (agent > subaccount > scheduled_task > task_instance)
- Deduplicates by name (higher scope wins)
- Budget truncation
- Splits into eager (injected into prompt, 60K token limit) and lazy (manifest only)
- **No relevance scoring.** All in-scope eager sources are included regardless of task relevance.

### 2.5 Entity schema (`workspaceEntities.ts`, 50 lines)

| Column | Type | Present |
|--------|------|---------|
| `name`, `displayName`, `entityType` | text | Yes |
| `attributes` | jsonb | Yes |
| `confidence` | real | Yes |
| `mentionCount` | integer | Yes |
| `firstSeenAt`, `lastSeenAt` | timestamp | Yes |
| `valid_from`, `valid_to` | timestamp | **No** |
| `superseded_by` | uuid | **No** |

Unique constraint: `(subaccountId, name, entityType) WHERE deletedAt IS NULL`.

### 2.6 Memory entry schema (`workspaceMemories.ts`, 129 lines)

| Column | Type | Present |
|--------|------|---------|
| `content`, `entryType` (5 types) | text | Yes |
| `qualityScore` | real | Yes |
| `embedding` (vector 1536) | pgvector | Yes |
| `embeddingContext` | text | Yes (Phase B1) |
| `accessCount`, `lastAccessedAt` | integer/timestamp | Yes |
| `taskSlug` | text | Yes |
| `domain` | text | **No** |
| `topic` | text | **No** |

Indexes: HNSW on embedding (migration 0029), subaccount+includedInSummary, agentRunId, createdAt.

### 2.7 Memory decay (`memoryDecayJob.ts`, 18 lines)

Calls `pruneStaleMemoryEntries()`: deletes entries where `createdAt < 90d AND quality_score < 0.3 AND access_count < 3`. No similarity-based dedup. No batch processing.

### 2.8 Middleware pipeline (`server/services/middleware/`)

Three phases per iteration: `preCall` → `preTool` (per tool) → `postTool`. Current middleware:

| Phase | Middleware | File |
|-------|-----------|------|
| preCall | contextPressure | `contextPressure.ts` |
| preCall | budgetCheck | `budgetCheck.ts` |
| preCall | topicFilter | `topicFilterMiddleware.ts` |
| preTool | proposeAction | `proposeAction.ts` |
| preTool | confidenceEscape | `confidenceEscapeMiddleware.ts` |
| preTool | toolRestriction | `toolRestriction.ts` |
| preTool | loopDetection | `loopDetection.ts` |
| preTool | decisionTimeGuidance | `decisionTimeGuidanceMiddleware.ts` |
| postTool | reflectionLoop | `reflectionLoopMiddleware.ts` |

No hallucination detection middleware exists.

### 2.9 Jobs (`server/jobs/`)

8 registered jobs. Relevant to this spec: `memoryDecayJob` (scheduled), `contextEnrichment` (event-driven). No memory dedup job. No agent briefing job. No subaccount state summary job.

---

## 3. Shared infrastructure — migrations, types, utilities

This section defines new database objects and shared types used across multiple phases. Implemented as a single migration (`0105_agent_intelligence.sql`) to avoid migration ordering conflicts between phases.

### 3.1 Migration `0105_agent_intelligence.sql`

```sql
-- =============================================================================
-- 0105 — Agent Intelligence Upgrade
-- Phases 0-3: search, memory, context, briefing
-- =============================================================================

-- ── Phase 2A: Temporal validity on workspace_entities ────────────────────────
ALTER TABLE workspace_entities
  ADD COLUMN valid_from  timestamptz DEFAULT NOW(),
  ADD COLUMN valid_to    timestamptz,                        -- null = currently valid
  ADD COLUMN superseded_by uuid REFERENCES workspace_entities(id);

CREATE INDEX workspace_entities_validity_idx
  ON workspace_entities (subaccount_id, valid_to)
  WHERE deleted_at IS NULL;

-- Replace the old unique constraint that doesn't account for superseded entities.
-- Old: (subaccount_id, name, entity_type) WHERE deleted_at IS NULL
-- New: only one "current" (valid_to IS NULL) entity per (subaccount_id, name, entity_type)
DROP INDEX IF EXISTS workspace_entities_unique_name_type;  -- adjust name to match actual index name
CREATE UNIQUE INDEX workspace_entities_current_unique
  ON workspace_entities (subaccount_id, name, entity_type)
  WHERE deleted_at IS NULL AND valid_to IS NULL;

-- ── Phase 2C: Hierarchical metadata on workspace_memory_entries ─────────────
ALTER TABLE workspace_memory_entries
  ADD COLUMN domain  text,    -- auto-classified: crm, reporting, support, dev, marketing, etc.
  ADD COLUMN topic   text;    -- auto-extracted from content at write time

CREATE INDEX workspace_memory_entries_domain_idx
  ON workspace_memory_entries (subaccount_id, domain)
  WHERE domain IS NOT NULL;

-- ── Phase 2D: Agent briefings ───────────────────────────────────────────────
CREATE TABLE agent_briefings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  subaccount_id     uuid NOT NULL REFERENCES subaccounts(id),
  agent_id          uuid NOT NULL REFERENCES agents(id),

  content           text NOT NULL,            -- compressed briefing (~500-1000 tokens)
  token_count       integer NOT NULL DEFAULT 0,
  source_run_ids    uuid[] NOT NULL DEFAULT '{}',  -- runs that contributed to this briefing
  version           integer NOT NULL DEFAULT 1,

  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX agent_briefings_unique
  ON agent_briefings (organisation_id, subaccount_id, agent_id);

-- ── Phase 3B: Subaccount state summaries ────────────────────────────────────
CREATE TABLE subaccount_state_summaries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  subaccount_id     uuid NOT NULL REFERENCES subaccounts(id),

  content           text NOT NULL,            -- structured state summary
  token_count       integer NOT NULL DEFAULT 0,
  task_counts       jsonb NOT NULL DEFAULT '{}',   -- { todo: N, in_progress: N, done: N, ... }
  agent_run_stats   jsonb NOT NULL DEFAULT '{}',   -- { success: N, failed: N, escalated: N }
  health_summary    text,                          -- active health findings summary

  generated_at      timestamptz NOT NULL DEFAULT NOW(),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX subaccount_state_summaries_unique
  ON subaccount_state_summaries (organisation_id, subaccount_id);
```

### 3.2 Schema files (Drizzle)

| New file | Table |
|----------|-------|
| `server/db/schema/agentBriefings.ts` | `agent_briefings` |
| `server/db/schema/subaccountStateSummaries.ts` | `subaccount_state_summaries` |

Modified files:

| File | Change |
|------|--------|
| `server/db/schema/workspaceEntities.ts` | Add `validFrom`, `validTo`, `supersededBy` columns |
| `server/db/schema/workspaceMemories.ts` | Add `domain`, `topic` columns to `workspaceMemoryEntries` |
| `server/db/schema/index.ts` | Re-export new tables |
| `server/config/rlsProtectedTables.ts` | Register `agent_briefings`, `subaccount_state_summaries` |

### 3.3 Shared types

New file: `server/lib/queryIntent.ts`

```typescript
export type QueryIntent = 'exact' | 'conceptual' | 'temporal' | 'exploratory' | 'relationship';

export type RetrievalProfile = 'temporal' | 'factual' | 'general' | 'exploratory' | 'relational';

export interface RetrievalWeights {
  rrf: number;
  quality: number;
  recency: number;
}

export const RETRIEVAL_PROFILES: Record<RetrievalProfile, RetrievalWeights> = {
  temporal:     { rrf: 0.3, quality: 0.1, recency: 0.6 },
  factual:      { rrf: 0.6, quality: 0.3, recency: 0.1 },
  general:      { rrf: 0.5, quality: 0.3, recency: 0.2 },
  exploratory:  { rrf: 0.4, quality: 0.2, recency: 0.4 },
  relational:   { rrf: 0.5, quality: 0.2, recency: 0.3 },
};
```

New file: `server/lib/sanitizeSearchQuery.ts`

```typescript
const MAX_CLEAN_LENGTH = 200;

export function sanitizeSearchQuery(raw: string): string {
  const trimmed = raw.trim();
  // Step 1: short queries pass through
  if (trimmed.length <= MAX_CLEAN_LENGTH) return trimmed;
  // Step 2: extract question-mark-terminated sentence
  const qMatch = trimmed.match(/[^.!?]*\?/);
  if (qMatch && qMatch[0].length >= 10) return qMatch[0].trim();
  // Step 3: extract last sentence (agents tend to front-load preamble)
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const last = sentences[sentences.length - 1];
  if (last && last.length >= 10 && last.length <= MAX_CLEAN_LENGTH) return last.trim();
  // Step 4: tail truncate
  return trimmed.slice(-MAX_CLEAN_LENGTH).trim();
}
```

### 3.4 New services inventory

| Service | Phase | Purpose |
|---------|-------|---------|
| `server/lib/sanitizeSearchQuery.ts` | 0B | Query sanitisation utility (pure function) |
| `server/lib/queryIntent.ts` | 1A | Intent classification types + weight profiles |
| `server/lib/queryIntentClassifier.ts` | 1A | Heuristic intent classifier (pure function) |
| `server/services/agentBriefingService.ts` | 2D | Briefing generation + persistence |
| `server/services/subaccountStateSummaryService.ts` | 3B | State summary generation |
| `server/services/middleware/hallucinationDetectionMiddleware.ts` | 3C | Post-generation entity validation |

### 3.5 New jobs

| Job | Phase | Schedule | Queue name |
|-----|-------|----------|------------|
| `memoryDedupJob.ts` | 2B | Nightly 3am UTC | `maintenance:memory-dedup` |
| `agentBriefingJob.ts` | 2D | Post-run (event-driven) | `agent-briefing-update` |
| `subaccountStateSummaryJob.ts` | 3B | Every 4 hours + on-demand | `subaccount-state-summary` |

---

## 4. Phase 0 — Quick wins

No migrations required. No new tables. Each item is independently shippable.

### 4.0A Unify `search_agent_history` with the full retrieval pipeline

**Goal:** Make `semanticSearchMemories()` use the same RRF+HyDE+reranking pipeline as `getRelevantMemories()`.

**Changes to `workspaceMemoryService.ts`:**

1. Extract the RRF query builder from `getRelevantMemories()` into a private method `_hybridRetrieve(params)` that accepts:
   ```typescript
   interface HybridRetrieveParams {
     subaccountId: string;
     orgId: string;
     queryText: string;
     queryEmbedding: number[];
     qualityThreshold: number;
     taskSlug?: string;
     topK?: number;
     includeOtherSubaccounts?: boolean;
     profile?: RetrievalProfile;
   }
   ```
2. `getRelevantMemories()` calls `_hybridRetrieve()` internally (no behaviour change).
3. `semanticSearchMemories()` calls `_hybridRetrieve()` with:
   - `qualityThreshold: 0` (skill path should not silently filter)
   - `profile` auto-detected via `selectRetrievalProfile(query)`
   - `includeOtherSubaccounts` forwarded from params
   - Results mapped to the existing return shape (`id, score, sourceAgentId, sourceAgentName, sourceSubaccountId, summary, createdAt`)
4. The cross-subaccount scope filter (`organisation_id = ?` vs `subaccount_id = ?`) moves into `_hybridRetrieve` as a parameter.

**Changes to `skillExecutor.ts` (`search_agent_history` handler):**

- No changes needed — the handler already calls `semanticSearchMemories()`, which now delegates to the hybrid pipeline.

**Acceptance criteria:**

- `search_agent_history` returns results ranked by RRF score, not raw cosine.
- HyDE triggers for short queries (<threshold chars).
- Reranker triggers when `RERANKER_PROVIDER` is configured.
- Cross-subaccount search still works.
- Quality-gated and profile-weighted.
- Existing `getRelevantMemories` callers see no behaviour change.

### 4.0B Query sanitisation

**Goal:** Prevent agent-generated query pollution from degrading retrieval quality.

**New file:** `server/lib/sanitizeSearchQuery.ts` (see Section 3.3 for implementation).

**Integration points:**

1. `_hybridRetrieve()` (from 0A) calls `sanitizeSearchQuery(queryText)` before passing to the FTS query and to embedding generation.
2. `getRelevantMemories()` inherits sanitisation via `_hybridRetrieve()`.
3. `semanticSearchMemories()` inherits sanitisation via `_hybridRetrieve()`.

**Pure function test:** `server/lib/__tests__/sanitizeSearchQueryPure.test.ts`

Test cases:
- Short query (<200 chars) passes through unchanged
- Long query with question mark extracts the question
- Long query without question extracts the last sentence
- Long query with no sentence boundaries tail-truncates
- Empty string returns empty string
- Query that is exactly MAX_CLEAN_LENGTH passes through

### 4.0C Multi-breakpoint prompt caching

**Goal:** Split the Anthropic system prompt into stable and dynamic sections with separate cache breakpoints, so the stable prefix is cached across runs.

**Changes to `agentExecutionService.ts`:**

The prompt assembly currently returns `systemPromptParts: string[]` which are joined into a single string. Change to return a structured object:

```typescript
interface AssembledPrompt {
  /** Stable across runs for the same agent (master prompt, skill defs, org instructions) */
  stablePrefix: string;
  /** Changes per run (memory, board state, task instructions, entities) */
  dynamicSuffix: string;
}
```

Partition the 14 current prompt sections (plus the Agent Briefing added by 2D):

| Section | Classification | Rationale |
|---------|---------------|-----------|
| 1. Master prompt + eager data sources | Stable (mostly) | Master prompt is identical across runs. Eager data sources change when attachments change, but are stable run-to-run for the same agent config. |
| 2. Core Capabilities (system skills) | Stable | Skill instructions change only on deployment |
| 3. Organisation Instructions | Stable | `additionalPrompt` changes only on admin edit |
| 4. Memory blocks (Letta) | Stable | Updated infrequently |
| 5. Your Capabilities (org skills) | Stable | Org skill config changes only on admin edit |
| 6. Additional Instructions | Stable | Custom instructions change only on admin edit |
| Agent Briefing (added by 2D) | Stable | Updates async post-run — stable for the duration of a single run. One-run staleness acceptable; caching efficiency takes priority. |
| 9. Team roster | Stable | Changes on agent config edit |
| 7. Task Instructions | **Dynamic** | Changes per scheduled task |
| 8. Available Context Sources | **Dynamic** | Lazy manifest varies |
| 10. Workspace memory | **Dynamic** | Updated after each run |
| 11. Workspace entities | **Dynamic** | Updated after each run |
| 12. Board state | **Dynamic** | Changes continuously |
| 13. Autonomous instructions | **Dynamic** | Varies by request type |
| 14. Addendum | **Dynamic** | Optional, per-request |

**Breakpoint:** Sections 1-6 + Agent Briefing + section 9 → `stablePrefix`. Sections 7-8, 10-14 → `dynamicSuffix`.

**Assembly reorder requirement:** The prompt assembly in `agentExecutionService.ts` must reorder sections so that section 9 (Team roster) and the Agent Briefing immediately follow sections 1-6 in the content array, before sections 7-8 and 10-14. The `cache_control` breakpoint is placed after section 9 in the array. This reorder is required for section 9 and the Agent Briefing to be included in the `stablePrefix` cache — without it, they would appear in the dynamic portion and negate cache efficiency.

**Changes to `anthropicAdapter.ts`:**

Accept `system` as either `string` (backward compatible) or `{ stablePrefix: string; dynamicSuffix: string }`.

When structured:
```typescript
body.system = [
  { type: 'text', text: params.system.stablePrefix, cache_control: { type: 'ephemeral' } },
  { type: 'text', text: params.system.dynamicSuffix },
];
```

This caches the stable prefix (master prompt + skills + instructions) while allowing the dynamic suffix to change without invalidating the cache. Anthropic caches from the beginning of the content array up to the last `cache_control` breakpoint.

**Changes to `ProviderCallParams` type:**

```typescript
system?: string | { stablePrefix: string; dynamicSuffix: string };
```

Non-Anthropic adapters (OpenAI, Gemini, OpenRouter) concatenate `stablePrefix + dynamicSuffix` into a single string — no behaviour change for them.

**Acceptance criteria:**

- Anthropic responses show `cache_read_input_tokens > 0` on second and subsequent runs for the same agent (verifiable in `llm_requests.cached_prompt_tokens`).
- Non-Anthropic providers see no behaviour change.
- System prompt content is identical before and after (no accidental truncation or reordering).

---

## 5. Phase 1 — Search & retrieval overhaul

Depends on: 0A (unified retrieval path). Migration 0105 not required for this phase.

### 5.1A Intent-adaptive search weights

**Goal:** Classify query intent at search time and select optimal RRF lane weights per intent.

**New file:** `server/lib/queryIntentClassifier.ts`

```typescript
import type { RetrievalProfile } from './queryIntent.js';

const TEMPORAL_PATTERNS = /\b(when|last|recent|this week|today|yesterday|month|ago|since|before|after|history|timeline)\b/i;
const EXACT_PATTERNS = /\b(what is|define|name of|exact|specific|id|email|phone|url)\b/i;
const RELATIONSHIP_PATTERNS = /\b(related|connected|linked|between|depends|caused|affected|impact)\b/i;
const EXPLORATORY_PATTERNS = /\b(how|why|overview|summary|explain|tell me about|what do we know)\b/i;

export function classifyQueryIntent(query: string): RetrievalProfile {
  const q = query.toLowerCase();
  // Temporal signals dominate (recency matters most)
  if (TEMPORAL_PATTERNS.test(q)) return 'temporal';
  // Exact/factual queries (precision matters most)
  if (EXACT_PATTERNS.test(q)) return 'factual';
  // Relationship queries (graph expansion matters)
  if (RELATIONSHIP_PATTERNS.test(q)) return 'relational';
  // Exploratory queries (breadth over precision)
  if (EXPLORATORY_PATTERNS.test(q)) return 'exploratory';
  // Default
  return 'general';
}
```

**Changes to `workspaceMemoryService.ts`:**

1. Replace the existing `selectRetrievalProfile()` (regex on 3 profiles) with `classifyQueryIntent()` from the new file.
2. Import `RETRIEVAL_PROFILES` from `queryIntent.ts` (5 profiles with tuned weights — see Section 3.3).
3. `_hybridRetrieve()` uses the classified profile to select weights, replacing the current `RRF_WEIGHTS` lookup.

**Pure function test:** `server/lib/__tests__/queryIntentClassifierPure.test.ts`

Test cases:
- "What happened with Client X last week?" → `temporal`
- "What is the client's email address?" → `factual`
- "How are the marketing campaigns connected to revenue?" → `relational`
- "Tell me about the onboarding process" → `exploratory`
- "client preferences" → `general`

### 5.1B Dominance-ratio confidence gating

**Goal:** When retrieval results are ambiguous (top result not clearly dominant), skip LLM reranking and return raw results to prevent confident-sounding hallucination.

**Changes to `workspaceMemoryService.ts` (`_hybridRetrieve`):**

After RRF scoring, before the reranker step:

```typescript
const DOMINANCE_THRESHOLD = 1.2;

if (results.length >= 2) {
  const dominanceRatio = results[0].combined_score / results[1].combined_score;
  if (dominanceRatio < DOMINANCE_THRESHOLD) {
    // Results are ambiguous — skip reranker, return raw RRF results
    // to prevent LLM synthesis on uncertain retrieval
    return results.slice(0, topK).map(r => ({
      ...r,
      confidence: 'low' as const,  // signal ambiguity to caller
    }));
  }
}
```

This is a guard clause inserted before the reranker call. When the top result is clearly dominant (ratio >= 1.2), proceed with reranking as normal.

**Acceptance criteria:**

- When top two results have similar scores (ratio < 1.2), reranker is skipped and results carry `confidence: 'low'`.
- When top result is clearly dominant, reranker runs as before.
- `DOMINANCE_THRESHOLD` is a named constant, tunable.

### 5.1C Graph-aware context expansion

**Goal:** After initial retrieval, follow relational edges to surface connected memories that the vector search might miss.

**Changes to `workspaceMemoryService.ts`:**

New private method `_expandByRelation()`:

```typescript
async _expandByRelation(
  results: HybridResult[],
  subaccountId: string,
  orgId: string,
  maxExpansion: number = 5,
): Promise<HybridResult[]>
```

Algorithm:
1. Collect `taskSlug` values and `agentId` values from initial results.
2. Query for additional entries that share the same `taskSlug` or same `agentId` within a ±2 run window (by `agentRunId` ordering), excluding entries already in results.
3. If workspace entities are referenced in result content (detected by `workspace_entities.name` substring match), fetch entries that also mention those entity names.
4. Score expanded results at 0.8x the minimum score of the initial result set (1-hop penalty).
5. Merge expanded results into the result set, dedup by ID, cap at `maxExpansion` additional entries.

**Integration:** Called in `_hybridRetrieve()` after RRF scoring and before final `topK` truncation.

**Acceptance criteria:**

- Searching for "Client X pricing" surfaces related memories about "Client X contract" even if they don't match the query embedding well.
- Expansion never exceeds `maxExpansion` additional entries.
- Score decay ensures expanded results rank below direct matches.
- No expansion when initial results are empty.

### 5.1D Two-pass context reranking for data sources

**Goal:** Score data sources by relevance to the task description before budget truncation, so the most relevant content survives the token budget cut.

**Changes to `runContextLoaderPure.ts`:**

New exported function:

```typescript
export function rankContextPoolByRelevance(
  pool: ContextSource[],
  taskDescription: string | undefined,
  taskEmbedding: number[] | undefined,
): ContextSource[]
```

If `taskDescription` is absent or `taskEmbedding` is absent, return pool unchanged (backward compatible).

When both are present:
1. For each eager source, compute cosine similarity between the source's content embedding and `taskEmbedding`. The embedding is computed on-the-fly at rank time by calling the existing embedding service (e.g. `generateEmbedding(source.content)`). No schema change is required in Phase 1 — there is no `embedding` column on `agent_data_sources`. If embedding persistence for performance is desired, defer to Phase 2 with a new migration.

   **Latency note:** On-the-fly embedding at rank time introduces one `generateEmbedding()` call per eager source. For agents with many eager data sources (> ~10), this may add noticeable latency to context loading. If latency becomes a concern, cap the number of sources ranked (e.g. rank only the first 20 by name alphabetically) or persist embeddings in a Phase 2 migration.
2. Sort eager sources by similarity descending.
3. Return sorted pool (lazy sources unaffected).

**Changes to `runContextLoader.ts`:**

1. After `processContextPool()`, call `rankContextPoolByRelevance()` with the task description and its embedding.
2. Pass the task description embedding from the scheduled task or task instance (computed at load time via `generateEmbedding()`).

**Changes to `processContextPool()` in `runContextLoaderPure.ts`:**

Budget truncation now respects the relevance ordering — it truncates from the bottom (least relevant) rather than arbitrarily.

**Acceptance criteria:**

- When an agent has 10 eager data sources but a 30K token budget, the most task-relevant sources survive.
- When no task description exists, behaviour is identical to current (no regression).
- Lazy sources are unaffected (they're not budget-limited).

---

## 6. Phase 2 — Memory intelligence

Requires migration 0105 for items 2A, 2C, and 2D. Item 2B requires no migration.

### 6.2A Temporal validity on entities and memories

**Goal:** Entities carry validity ranges so agents can distinguish "was true then" from "is true now."

**Schema changes** (in migration 0105 — see Section 3.1):

- `workspace_entities`: add `valid_from` (timestamptz, default NOW()), `valid_to` (nullable), `superseded_by` (nullable FK to self).
- Partial index on `(subaccount_id, valid_to) WHERE deleted_at IS NULL`.

**Changes to `workspaceMemoryService.ts` (`extractEntities`):**

Current entity upsert logic (line ~895): when an entity with the same `(subaccountId, name, entityType)` already exists, it increments `mentionCount` and updates `lastSeenAt`. Change to:

1. If the incoming entity's attributes conflict with the existing entity's attributes (e.g. `platform: "Shopify"` vs `platform: "WooCommerce"`), **supersede** the old entity:
   - Set `valid_to = NOW()` on the old entity.
   - Create a new entity with `valid_from = NOW()`, `superseded_by` pointing to old.
   - Copy `mentionCount` + 1 to new entity.
2. If attributes don't conflict, upsert as before (bump count, update `lastSeenAt`).
3. Conflict detection: compare JSON keys that exist in both old and new `attributes`. If any value differs, it's a conflict.

**Changes to `getEntitiesForPrompt()` (line ~1026):**

Add `WHERE valid_to IS NULL` to the query (only inject currently-valid entities into the prompt). Expose an optional `asOf` parameter for historical queries:

```typescript
async getEntitiesForPrompt(
  orgId: string,
  subaccountId: string,
  asOf?: Date,  // new — if provided, returns entities valid at that point in time
): Promise<string>
```

When `asOf` is provided: `WHERE valid_from <= asOf AND (valid_to IS NULL OR valid_to > asOf)`.

**Acceptance criteria:**

- When a client switches from Shopify to WooCommerce, the old entity gets `valid_to` set and a new entity is created.
- Prompt injection only shows currently-valid entities.
- Historical queries via `asOf` return the correct entity state at that point.
- The existing unique constraint `(subaccountId, name, entityType) WHERE deletedAt IS NULL` still works because the old entity isn't soft-deleted — it's superseded (valid_to set but deletedAt null). New unique constraint needed: `(subaccountId, name, entityType) WHERE deleted_at IS NULL AND valid_to IS NULL` — add to migration.

### 6.2B Similarity-based memory deduplication job

**Goal:** Periodically remove near-duplicate memory entries to keep pools lean and retrieval sharp.

**New file:** `server/jobs/memoryDedupJob.ts`

Algorithm (greedy, per-subaccount):
1. Load all entries with embeddings for the subaccount, ordered by `qualityScore DESC, createdAt DESC`.
2. Initialize `kept: Set<string>` (entry IDs to keep).
3. For each entry, compute cosine distance against all entries in `kept`. If min distance > `DEDUP_THRESHOLD` (default 0.15, meaning ~85% similarity), add to `kept`. Otherwise, mark for deletion (hard delete — consistent with `pruneStaleMemoryEntries`).
4. Process in batches of 500 entries per subaccount.
5. Hard-delete marked entries (`DELETE FROM workspace_memory_entries WHERE id = ANY($ids_to_delete)`). Consistent with `pruneStaleMemoryEntries` which also hard-deletes.

**Optimisation:** Use pgvector's `<=>` operator to compute pairwise distances in SQL rather than loading all vectors into JS:

```sql
SELECT a.id AS id_a, b.id AS id_b, a.embedding <=> b.embedding AS distance
FROM workspace_memory_entries a
JOIN workspace_memory_entries b ON b.id = ANY($kept_ids)
WHERE a.subaccount_id = $subaccountId
  AND a.embedding IS NOT NULL
  AND a.id != b.id
  AND a.embedding <=> b.embedding < $threshold
LIMIT 500
```

This finds all pairs below threshold in one query, avoiding O(n^2) in application code.

**Job registration:** `server/services/queueService.ts` — register worker as `maintenance:memory-dedup`, schedule nightly at 3am UTC via `boss.schedule('maintenance:memory-dedup', '0 3 * * *', {})` (same pattern as `maintenance:memory-decay`).

**Acceptance criteria:**

- After job runs, no two remaining entries in the same subaccount have cosine similarity > 0.85.
- Highest-quality entry is always kept (greedy by qualityScore DESC).
- Job completes in <60 seconds for subaccounts with <5000 entries.
- Job logs count of deleted entries per subaccount.

### 6.2C Hierarchical metadata on memory entries

**Goal:** Add `domain` and `topic` classification to memory entries for scoped retrieval.

**Schema changes** (in migration 0105): `domain text`, `topic text` columns on `workspace_memory_entries`. Index on `(subaccount_id, domain)`.

**Write path — auto-classification in `extractRunInsights()`:**

After scoring new entries, before persisting:

1. `domain`: derived from the agent's system agent role. Map `systemAgentId` → domain:
   ```typescript
   const AGENT_DOMAIN_MAP: Record<string, string> = {
     'crm-pipeline-agent': 'crm',
     'reporting-agent': 'reporting',
     'client-reporting-agent': 'reporting',
     'support-agent': 'support',
     'dev-agent': 'dev',
     'qa-agent': 'dev',
     'content-seo-agent': 'marketing',
     'social-media-agent': 'marketing',
     'email-outreach-agent': 'marketing',
     'ads-management-agent': 'marketing',
     'finance-agent': 'finance',
     'business-analyst-agent': 'analysis',
     'orchestrator-agent': 'orchestration',
     // ... etc
   };
   ```
   Fallback: `'general'` for unmapped agents. Stored on the agent run or resolved at write time.

2. `topic`: lightweight keyword extraction from the entry content. Use the first matching pattern from a topic taxonomy:
   - Content mentions pricing/cost/budget → `'budget'`
   - Content mentions campaign/ad/creative → `'campaign'`
   - Content mentions contact/lead/deal → `'pipeline'`
   - Content mentions report/metric/KPI → `'metrics'`
   - Content mentions task/ticket/issue → `'tasks'`
   - Content mentions onboarding/setup → `'onboarding'`
   - Default: `null` (unclassified)

   This is deliberately simple — keyword heuristics, no LLM call. Can be upgraded later.

**Read path — scoped retrieval in `_hybridRetrieve()`:**

Add optional `domain` and `topic` parameters to `HybridRetrieveParams`. When provided, add `WHERE` clauses to the `candidate_pool` CTE:
- `AND (domain = $domain OR domain IS NULL)` — entries from the requesting agent's domain + unscoped entries.
- `AND (topic = $topic OR topic IS NULL)` — when a topic filter is active.

The skill handler passes `domain` based on the executing agent. Cross-domain search (e.g. Orchestrator querying CRM memories) omits the domain filter.

**Backfill:** Not required. New entries get classified on write. Existing entries have `domain = NULL, topic = NULL` and are included in all queries via the `OR ... IS NULL` clause.

**Acceptance criteria:**

- New memory entries written by the CRM Agent carry `domain: 'crm'`.
- The CRM Agent's memory search returns CRM-domain entries first, plus unscoped entries.
- The Orchestrator's search returns all domains (no domain filter applied).
- Existing entries without domain/topic are still returned in all queries.

### 6.2D Agent briefing / wake-up context

**Goal:** Auto-generate a compact cross-run summary per agent-subaccount pair, injected at prompt start for instant orientation.

**New table:** `agent_briefings` (see migration 0105, Section 3.1).

**New service:** `server/services/agentBriefingService.ts`

```typescript
export const agentBriefingService = {
  async getOrGenerate(orgId: string, subaccountId: string, agentId: string): Promise<string | null>,
  async updateAfterRun(orgId: string, subaccountId: string, agentId: string, runId: string, handoffJson: object): Promise<void>,
};
```

**`updateAfterRun` algorithm:**

1. Load current briefing (if exists).
2. Load the latest handoff JSON from the completed run.
3. Load the 5 most recent high-quality memory entries for this agent+subaccount.
4. LLM call (economy tier via `llmResolver`): "Given the previous briefing, the latest run outcome, and recent observations, produce an updated briefing in under 800 tokens. Focus on: (a) key facts about this subaccount the agent should know, (b) recent activity summary, (c) any open issues or blockers."
5. Upsert to `agent_briefings` table. Increment `version`. Record `source_run_ids`.

**Token budget:** Target 500-1000 tokens. Hard cap at 1200 tokens (truncate if LLM overshoots).

**New job:** `server/jobs/agentBriefingJob.ts` — triggered post-run. Enqueued by `agentExecutionService` after run completion (alongside existing `contextEnrichment` enqueue).

**Integration with prompt assembly (`agentExecutionService.ts`):**

Inject the briefing into the `stablePrefix`, immediately after section 6 (Additional Instructions). The briefing updates async post-run — it is stable for the full duration of a single run and only regenerates once after the previous run completes. One-run staleness is acceptable. This placement preserves the 40-60% prompt token cost reduction goal of 0C; placing the briefing in `dynamicSuffix` would cause cache misses on every run that has a briefing.

```
[section 6: Additional Instructions]

## Agent Briefing
[briefing content]

[section 9: Team roster]
[stablePrefix ends here — cache_control breakpoint]
```

If no briefing exists (first run), skip — no change to existing behaviour. The stablePrefix still ends after section 9.

**Acceptance criteria:**

- After an agent's 3rd run on a subaccount, a briefing exists and is injected into subsequent prompts.
- Briefing is under 1200 tokens.
- Briefing updates after each run (async, non-blocking).
- Briefing reflects the most recent handoff and top memory entries.
- First run on a subaccount has no briefing (no error, just skipped).

---

## 7. Phase 3 — Context assembly upgrade

Builds on Phase 0 (unified retrieval) and Phase 2 (temporal validity, briefings). Migration 0105 required for 3B.

### 7.3A Task-aware pre-run context injection

**Goal:** Before an agent starts its loop, automatically surface the most relevant context for the specific task — pulling in lazy data sources and memories that wouldn't otherwise be in the prompt.

**New service:** `server/services/taskContextEnrichmentService.ts`

```typescript
export async function enrichContextForTask(params: {
  orgId: string;
  subaccountId: string;
  agentId: string;
  taskDescription: string;
  existingEagerSourceIds: string[];  // already-loaded sources to exclude
  tokenBudget: number;              // max tokens for enrichment section
}): Promise<{ content: string; sourceIds: string[] }>
```

Algorithm:
1. Generate embedding for `taskDescription`.
2. Query workspace memories via `_hybridRetrieve()` with the task description as query text, `topK: 5`.
3. Query lazy data sources that weren't already loaded: compute cosine similarity between `taskDescription` embedding and each lazy source's content embedding (computed on-the-fly via `generateEmbedding(source.content)` — no schema change required). Take top 3 by similarity (above a minimum threshold of 0.3).
4. Assemble results into a formatted section, respecting `tokenBudget` (truncate from bottom):
   ```
   ## Relevant Context for This Task
   
   ### From workspace memory:
   - [memory entry 1]
   - [memory entry 2]
   
   ### From data sources:
   - [source name]: [relevant excerpt]
   ```
5. Return content string and list of source IDs used (for audit logging in `contextSourcesSnapshot`).

**Integration with `agentExecutionService.ts`:**

After context loading (step 5 in `runAgenticLoop`) and before prompt assembly (step 7):

1. If a task description exists (from scheduled task, task instance, or request), call `enrichContextForTask()`.
2. Insert the result as a new prompt section between "Task Instructions" and "Available Context Sources" (sections 7 and 8).
3. Add used source IDs to `contextSourcesSnapshot`.

**Token budget:** 4000 tokens default, configurable via `subaccountAgents.settings.enrichmentTokenBudget`.

**Acceptance criteria:**

- An agent running "review Q1 ad spend" on a subaccount with 10 data sources gets the ad-spend-relevant sources surfaced, not the CRM export or brand guidelines.
- Lazy sources that score above threshold are fetched and included (they normally wouldn't be).
- When no task description exists, enrichment is skipped (no regression).
- Enrichment respects token budget.
- Total prompt size doesn't exceed existing limits (enrichment budget comes out of the 60K eager budget).

### 7.3B Auto-extracted subaccount state summary

**Goal:** Generate a compact, structured summary of the subaccount's current operational state, injected into agent prompts to replace manual `additionalPrompt` maintenance.

**New table:** `subaccount_state_summaries` (see migration 0105, Section 3.1).

**New service:** `server/services/subaccountStateSummaryService.ts`

```typescript
export const subaccountStateSummaryService = {
  async getOrGenerate(orgId: string, subaccountId: string): Promise<string | null>,
  async regenerate(orgId: string, subaccountId: string): Promise<void>,
};
```

**`regenerate` algorithm:**

1. **Task board status:** Query `tasks` table for this subaccount, group by status column. Produce counts: `{ todo: N, in_progress: N, done: N, blocked: N }`.
2. **Recent agent run stats (last 7 days):** Query `agent_runs` for this subaccount. Produce: `{ total: N, success: N, failed: N, escalated: N, avgToolCalls: N }`.
3. **Active health findings:** Query `workspace_health_findings` for unresolved findings. Produce a one-line summary per finding (max 5).
4. **Recent high-signal memories (last 7 days):** Top 3 entries by qualityScore with `entryType IN ('issue', 'decision')`.
5. Assemble into a structured text block (~200-400 tokens):
   ```
   ## Current Subaccount State
   Tasks: 3 in progress, 2 blocked, 12 done
   Agent runs (7d): 8 success, 1 failed (CRM Agent — API timeout), 0 escalated
   Health: 1 finding — broken GHL connection (detected 2d ago)
   Recent decisions: Switched client reporting to weekly cadence
   ```
   No LLM call — this is pure data assembly. Compact, factual, cheap.

6. Upsert to `subaccount_state_summaries`.

**New job:** `server/jobs/subaccountStateSummaryJob.ts` — scheduled every 4 hours. Also triggered on-demand when a subaccount's run completes (debounced — skip if summary was regenerated within the last hour).

**Integration with prompt assembly (`agentExecutionService.ts`):**

Insert as a new section between "Additional Instructions" (section 6) and "Task Instructions" (section 7). Classified as **dynamic** for prompt caching purposes (changes every 4 hours).

**Acceptance criteria:**

- The Orchestrator agent sees "3 tasks blocked, CRM Agent failed last run" without anyone writing it into `additionalPrompt`.
- Summary refreshes every 4 hours automatically.
- Summary is under 400 tokens.
- Subaccounts with no runs or tasks get a minimal summary ("No activity yet").
- No LLM call — pure data assembly.

### 7.3C Hallucination detection middleware

**Goal:** Post-generation, cross-reference entity names in agent output against known workspace entities. Flag phantom references.

**New file:** `server/services/middleware/hallucinationDetectionMiddleware.ts`

```typescript
import type { PostToolMiddleware } from './types.js';

export const hallucinationDetectionMiddleware: PostToolMiddleware = {
  name: 'hallucinationDetection',
  phase: 'postTool',
  async execute(context) { ... },
};
```

Algorithm:
1. Extract entity-like references from the agent's latest response text. Use a lightweight pattern: quoted strings, capitalised multi-word phrases, and backtick-quoted identifiers.
2. Load currently-valid workspace entities for this subaccount (`valid_to IS NULL`).
3. For each extracted reference, check if it fuzzy-matches (case-insensitive, Levenshtein distance ≤ 2) any known entity name.
4. References that don't match any known entity are flagged as `potential_hallucination`.
5. If ≥ 1 potential hallucinations found:
   - Log to `agent_run_snapshots` metadata (for observability).
   - Inject a system nudge into the next iteration's messages: `"Note: You referenced [entity name] which is not a known entity in this workspace. Please verify this reference."`.
6. If 0 potential hallucinations, pass through silently (no overhead on clean output).

**Middleware registration:** Add to `postTool` phase in `server/services/middleware/index.ts`, after `reflectionLoop`.

**Configuration:** Enabled by default. Can be disabled per agent via `subaccountAgents.settings.disableHallucinationDetection: true` for agents that legitimately reference external entities not in the workspace (e.g. Content Agent mentioning industry terms).

**Acceptance criteria:**

- When an agent mentions "Acme Corp" but no such entity exists in the workspace, the next iteration gets a nudge.
- When an agent mentions "Acme Corp" and it exists as a valid entity, no nudge (no false positive).
- Middleware adds <10ms latency on clean output (entity lookup is indexed).
- Phantom references are logged in run metadata for audit.
- Middleware does not block or reject — it nudges. The agent decides whether to self-correct.

---

## 8. Migration inventory & build phases

### 8.1 Migration inventory

One migration covers all schema changes:

| Migration | Tables/columns affected | Phase |
|-----------|------------------------|-------|
| `0105_agent_intelligence.sql` | `workspace_entities` (+3 cols), `workspace_memory_entries` (+2 cols), `agent_briefings` (new), `subaccount_state_summaries` (new), updated unique constraint on `workspace_entities` | 2A, 2C, 2D, 3B |

No migration required for Phases 0 or 1.

### 8.2 New/modified files by phase

**Phase 0** (no migration):
| Action | File |
|--------|------|
| New | `server/lib/sanitizeSearchQuery.ts` |
| New | `server/lib/__tests__/sanitizeSearchQueryPure.test.ts` |
| Modify | `server/services/workspaceMemoryService.ts` (extract `_hybridRetrieve`, refactor `semanticSearchMemories`) |
| Modify | `server/services/providers/anthropicAdapter.ts` (multi-block system prompt) |
| Modify | `server/services/providers/types.ts` (`system` field accepts string or structured) |
| Modify | `server/services/agentExecutionService.ts` (return structured prompt sections) |

**Phase 1** (no migration):
| Action | File |
|--------|------|
| New | `server/lib/queryIntent.ts` |
| New | `server/lib/queryIntentClassifier.ts` |
| New | `server/lib/__tests__/queryIntentClassifierPure.test.ts` |
| Modify | `server/services/workspaceMemoryService.ts` (intent classifier, dominance gate, expansion) |
| Modify | `server/services/runContextLoader.ts` (pass task embedding) |
| Modify | `server/services/runContextLoaderPure.ts` (relevance ranking, budget-aware truncation) |

**Phase 2** (requires migration 0105):
| Action | File |
|--------|------|
| New | `server/db/schema/agentBriefings.ts` |
| New | `server/services/agentBriefingService.ts` |
| New | `server/jobs/agentBriefingJob.ts` |
| New | `server/jobs/memoryDedupJob.ts` |
| Modify | `server/db/schema/workspaceEntities.ts` (+3 cols) |
| Modify | `server/db/schema/workspaceMemories.ts` (+2 cols) |
| Modify | `server/db/schema/index.ts` (re-exports) |
| Modify | `server/config/rlsProtectedTables.ts` |
| Modify | `server/services/workspaceMemoryService.ts` (temporal validity, domain/topic write, domain filter on read) |
| Modify | `server/services/agentExecutionService.ts` (inject briefing, enqueue briefing job) |
| Modify | `server/services/queueService.ts` (register job workers + schedule `maintenance:memory-dedup` at 3am UTC) |
| Modify | `server/config/jobConfig.ts` (add idempotencyStrategy entries for new jobs) |

**Phase 3** (requires migration 0105):
| Action | File |
|--------|------|
| New | `server/db/schema/subaccountStateSummaries.ts` |
| New | `server/services/taskContextEnrichmentService.ts` |
| New | `server/services/subaccountStateSummaryService.ts` |
| New | `server/services/middleware/hallucinationDetectionMiddleware.ts` |
| New | `server/jobs/subaccountStateSummaryJob.ts` |
| Modify | `server/services/agentExecutionService.ts` (enrichment call, state summary injection, hallucination middleware) |
| Modify | `server/services/middleware/index.ts` (register hallucination middleware) |
| Modify | `server/services/queueService.ts` (register job workers + schedule `subaccount-state-summary` every 4 hours) |
| Modify | `server/config/jobConfig.ts` (add idempotencyStrategy entry for subaccount-state-summary job) |

### 8.3 Build order and dependency graph

```
Phase 0 (no deps, ship independently):
  0B  sanitizeSearchQuery.ts ─── pure function, ship first
  0A  _hybridRetrieve refactor ── uses 0B, core change
  0C  multi-breakpoint caching ── independent of 0A/0B

Phase 1 (depends on 0A):
  1A  Intent classifier ────────── uses 0A's _hybridRetrieve
  1B  Dominance gating ─────────── guard clause in _hybridRetrieve
  1C  Graph expansion ──────────── extension to _hybridRetrieve
  1D  Context reranking ────────── independent of 0A (modifies runContextLoader)

Phase 2 (run migration 0105 first):
  2A  Temporal validity ────────── schema + service changes
  2B  Memory dedup job ─────────── independent (no new schema needed)
  2C  Hierarchical metadata ────── schema + write/read path changes
  2D  Agent briefing ───────────── schema + new service + job + prompt inject

Phase 3 (builds on Phase 1+2):
  3A  Task context enrichment ──── uses _hybridRetrieve (Phase 0/1) + context loader (1D)
  3B  Subaccount state summary ─── schema + new service + job + prompt inject
  3C  Hallucination detection ──── uses temporal validity (2A) for entity lookup
```

### 8.4 Suggested sprint plan

| Week | Items | Deliverable |
|------|-------|-------------|
| 1 | 0B, 0A, 0C | All agents use full RRF pipeline. Prompt caching live. Query sanitisation active. |
| 2 | 1A, 1B, 1D | Intent-adaptive search. Confidence gating. Data source relevance ranking. |
| 3 | Migration 0105, 2A, 2B | Temporal validity. Memory dedup job running. |
| 4 | 2C, 2D, 1C | Domain/topic metadata. Agent briefings. Graph expansion. |
| 5 | 3A, 3B, 3C | Task context enrichment. State summaries. Hallucination detection. |

---

## 9. Verification plan

Per `CLAUDE.md` verification conventions: lint, typecheck, and test after every code change. Additional verification specific to this spec:

### 9.1 Pure function tests (run with `npm test`)

| Test file | What it covers | Phase |
|-----------|---------------|-------|
| `server/lib/__tests__/sanitizeSearchQueryPure.test.ts` | Query sanitisation: passthrough, question extraction, tail sentence, truncation, edge cases | 0B |
| `server/lib/__tests__/queryIntentClassifierPure.test.ts` | Intent classification: temporal, factual, relational, exploratory, general, edge cases | 1A |
| `server/services/__tests__/runContextLoader.test.ts` (add test cases — file exists, tests `runContextLoaderPure.ts`) | Relevance ranking: sorted by similarity, budget truncation respects order, no-task-description fallback | 1D |

### 9.2 Static gates (existing `scripts/verify-*.sh`)

All existing gates must continue to pass:

| Gate | Relevance |
|------|-----------|
| `verify-async-handler.sh` | Any new routes (none expected in this spec) |
| `verify-no-db-in-routes.sh` | No routes in this spec |
| `verify-subaccount-resolution.sh` | No routes in this spec |
| `verify-job-idempotency-keys.sh` | New jobs (2B, 2D, 3B) must have idempotency keys |
| `verify-idempotency-strategy-declared.sh` | New skill handlers (none expected) |
| `verify-rls-protected-tables.sh` | New tables (`agent_briefings`, `subaccount_state_summaries`) must be registered |

### 9.3 Manual verification per phase

**Phase 0 verification:**

1. **0A:** Start an agent run that invokes `search_agent_history`. Verify in logs that the query goes through `_hybridRetrieve` (log line should show `profile: 'general'` or similar). Compare result quality to a pre-change baseline by running the same query through both old and new paths.
2. **0B:** Feed a deliberately verbose query (>200 chars with preamble) through `sanitizeSearchQuery`. Verify the output is the extracted question or tail sentence. Run an agent that searches memory with a long-form query and verify retrieval results improve.
3. **0C:** Run an agent twice on the same subaccount with Anthropic. Check `llm_requests.cached_prompt_tokens` — second run should show cache hits. Compare `cached_prompt_tokens` before and after the change using:
   ```sql
   SELECT agent_id, AVG(cached_prompt_tokens) FROM llm_requests
   WHERE created_at > NOW() - INTERVAL '1 hour'
   GROUP BY agent_id;
   ```

**Phase 1 verification:**

4. **1A:** Run queries with temporal ("last week"), factual ("what is"), and exploratory ("tell me about") phrasing. Verify `profile` in logs matches expected classification.
5. **1B:** Find or create a subaccount with many similar memory entries. Run a vague query. Verify that results carry `confidence: 'low'` and reranker is skipped (log line).
6. **1C:** Create two related memories with the same `taskSlug`. Search for one. Verify the other appears in expanded results with a lower score.
7. **1D:** Attach 5+ eager data sources to a subaccount agent. Run a task with a specific description. Verify that relevant sources appear before irrelevant ones in the prompt (inspect `agent_run_snapshots.system_prompt`).

**Phase 2 verification:**

8. **2A:** Create an entity "Client uses Shopify". Update it to "Client uses WooCommerce". Verify old entity has `valid_to` set, new entity has `valid_from` set, and prompt injection shows only WooCommerce.
9. **2B:** Create 10 near-duplicate memory entries (same content, slightly rephrased). Run dedup job. Verify only the highest-quality entry survives.
10. **2C:** Run an agent (e.g. CRM Agent). Verify new memory entries have `domain: 'crm'`. Search from the CRM Agent and verify CRM-domain results rank first.
11. **2D:** Run an agent 3 times on a subaccount. Verify `agent_briefings` row exists after 3rd run. Verify briefing appears in system prompt of 4th run.

**Phase 3 verification:**

12. **3A:** Create a scheduled task with description "review Q1 ad spend". Attach ad-spend and CRM data sources. Verify the prompt includes ad-spend content in "Relevant Context for This Task" section.
13. **3B:** After several runs on a subaccount, verify `subaccount_state_summaries` row exists. Verify it appears in the system prompt. Verify it updates after a run completes.
14. **3C:** Have an agent mention a nonexistent entity name. Verify the next iteration includes a "not a known entity" nudge. Verify the nudge does NOT appear when the entity exists.

### 9.4 Regression checks

After each phase, verify:
- `npm run lint` passes
- `npm run typecheck` passes
- `npm test` passes (all existing pure function tests still green)
- `npm run build` passes
- Existing agent runs complete successfully (no new errors in logs)

---

## 10. Open items & risks

### 10.1 Open design decisions

| # | Question | Options | Recommendation | Phase |
|---|----------|---------|----------------|-------|
| O1 | Should `_hybridRetrieve` use `SET LOCAL statement_timeout` like `getRelevantMemories` currently does (200ms)? | (a) Yes — consistent behaviour. (b) No — skill-invoked searches may accept higher latency for better results. | (a) Yes, keep 200ms timeout. Agents shouldn't block on slow queries. Fallback to cosine-only handles timeouts. | 0A |
| O2 | Should the dominance ratio threshold (1.2) be configurable per agent or fixed? | (a) Fixed constant. (b) Per-agent via `subaccountAgents.settings`. | (a) Fixed constant. Tuning per agent is premature optimisation. Adjust the global constant based on observed retrieval quality. | 1B |
| O3 | Should temporal validity supersession trigger an LLM call to confirm the conflict, or use attribute-diff heuristics only? | (a) Heuristic only (cheaper, faster). (b) LLM confirmation (more accurate). | (a) Heuristic only. LLM call per entity update is too expensive at scale. False positives (unnecessary supersession) are low-cost — the old entity is preserved, not deleted. | 2A |
| O4 | Should the memory dedup job hard-delete or soft-delete near-duplicates? | (a) Hard delete (consistent with `pruneStaleMemoryEntries`). (b) Soft delete (recoverable). | (a) Hard delete. The existing decay job hard-deletes. Adding soft-delete to `workspace_memory_entries` would require a schema change and query filter updates across the entire memory system. The dedup keeps the highest-quality entry, so information loss is minimal. | 2B |
| O5 | Should agent briefings be generated after every run or only after every N runs? | (a) Every run. (b) Every 3 runs. (c) Only when handoff JSON has meaningful content. | (c) Only when handoff has meaningful content. An agent run that fails on the first tool call shouldn't trigger briefing regeneration. Check `handoffJson.accomplished` array length > 0. | 2D |
| O6 | Should the subaccount state summary include cost/budget data? | (a) Yes — agents should know budget utilisation. (b) No — cost visibility is an admin concern. | (b) No for now. Cost data is in `cost_aggregates` and `org_budgets` which are org-scoped, not subaccount-scoped. Adding cost to the summary would require cross-scope joins. Defer until budget-per-subaccount is implemented. | 3B |

### 10.2 Risks and mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **0A: Refactoring `getRelevantMemories` breaks prompt injection path** | High | Extract `_hybridRetrieve` as a private method. `getRelevantMemories` calls it with identical parameters to current behaviour. Run existing tests to verify no regression before changing `semanticSearchMemories`. |
| **0C: Multi-block system prompt changes token counting or formatting** | Medium | Log system prompt character count before and after. Anthropic counts tokens per content block — verify total input tokens in `llm_requests` don't increase. Non-Anthropic adapters must concatenate blocks back to a single string. |
| **1C: Graph expansion adds irrelevant noise to search results** | Medium | Score decay (0.8x) ensures expanded results rank below direct matches. Max expansion cap (5 entries). If expansion proves noisy, the feature can be disabled by setting `maxExpansion: 0` without code changes. |
| **2A: Temporal validity supersession creates too many entity records** | Low | Supersession only triggers on attribute conflict, not on every mention. For entities without attributes (bare name references), the existing upsert path (bump mentionCount) is unchanged. Monitor `workspace_entities` row count per subaccount after deployment. |
| **2B: Memory dedup job deletes entries that should be kept** | Medium | Threshold of 0.15 cosine distance (85% similarity) is conservative. Only entries with near-identical embeddings are removed. The highest-quality entry is always kept. Run the job in dry-run mode first (log deletions without executing) for one cycle. |
| **2D: Agent briefing LLM call adds latency to post-run processing** | Low | Briefing job is async (pg-boss). Non-blocking to the run completion. Economy-tier LLM call (~500 tokens output). If job queue backs up, briefings are stale but not missing — the system degrades gracefully. |
| **3C: Hallucination detection false positives on legitimate external references** | Medium | Configurable per-agent disable via `settings.disableHallucinationDetection`. Fuzzy matching threshold (Levenshtein ≤ 2) is conservative. The middleware nudges but never blocks — agents self-correct or ignore. Monitor `potential_hallucination` counts in run metadata and tune. |
| **Migration 0105: Adding columns to high-volume tables under load** | Low | Pre-production, no live data. `ALTER TABLE ADD COLUMN` with defaults is non-blocking in PostgreSQL 11+. New tables are created fresh. No data backfill required. |

### 10.3 What this spec does NOT cover

- **Phase 4:** AST parsing, dependency graphs, git intelligence (Dev Agent only). Separate spec.
- **Phase 5:** Agent diary, dead code detection, incremental indexing, semantic task categorization, extended health detectors. Backlog — pick opportunistically.
- **UI changes:** No client-side changes in this spec. All improvements are backend/service-layer.
- **Admin configuration UI for new features:** Briefings, state summaries, and dedup are automatic. No admin toggles needed initially. Domain/topic taxonomy is auto-classified, not admin-configured.
- **Observability dashboards:** Log entries are defined (query profiles, cache hits, dedup counts, hallucination flags). Dashboard creation is deferred.
