# OSS Intelligence Analysis: Repowise + MemPalace + engraph

> Unified analysis of three open-source repos and what Automation OS can learn from them.
> Grounded against actual codebase state as of 2026-04-12.

## Sources

| Repo | What it is | Stars | Stack |
|------|-----------|-------|-------|
| [repowise-dev/repowise](https://github.com/repowise-dev/repowise) | Codebase intelligence platform — AST parsing, dependency graphs, git analytics, auto-generated wiki | ~new | Python, FastAPI, tree-sitter, NetworkX |
| [MemPalace/mempalace](https://github.com/MemPalace/mempalace) | Personal AI memory system — verbatim storage, knowledge graph, temporal facts, MCP tools | 35k | Python, ChromaDB, SQLite |
| [cablehead/engraph](https://github.com/cablehead/engraph) | Knowledge graph + hybrid search — Obsidian vault indexer, RRF search, intent classification | 101 | Rust, SQLite, llama.cpp |

---

## Current State (verified against code)

Before recommending anything, here's what we actually have today:

| Area | Current state |
|------|--------------|
| **Memory retrieval (prompt path)** | Full RRF fusion (BM25 + vector), HyDE, LRU cache, optional reranker, quality scoring, recency decay. Profile-based weight tuning (temporal/factual/general). Sophisticated. |
| **Memory retrieval (skill path)** | `search_agent_history` is **pure cosine-only**. No RRF, no BM25, no HyDE, no reranking. Agents searching memory get the basic path. |
| **Deduplication** | LLM-based dedup at write time (top-20 existing entries compared). No similarity-based batch dedup. |
| **Memory decay** | Age x quality x access pruning (90d, <0.3, <3 accesses). No similarity dedup. |
| **Prompt assembly** | 14-section ordered assembly. Anthropic cache_control applied as one coarse block on the full system prompt. |
| **Context loading** | Scope-based (agent > subaccount > scheduled_task > task_instance). Override dedup + budget truncation. No relevance scoring. |
| **Entity schema** | `firstSeenAt`/`lastSeenAt` but no `valid_from`/`valid_to`. Facts are current or deleted. |
| **Memory metadata** | `entryType` (5 types), `taskSlug`, `qualityScore`, `embedding`. No domain/topic/category hierarchy. |
| **Code analysis** | `search_codebase` = grep/glob. `read_codebase` = file read. No AST, no dependency graph, no symbol index. |

---

## Unified Recommendations (Deduplicated)

Cross-referencing all three repos against our actual code, removing overlaps, and grouping by theme.

---

### Phase 0 — Quick Wins (1-2 days each, immediate ROI)

These require minimal code changes, no new tables, no new services. Ship independently.

#### 0A. Unify `search_agent_history` with the full retrieval pipeline

| | |
|---|---|
| **Source** | engraph (RRF pattern), MemPalace (query sanitizer) |
| **Problem** | `search_agent_history` (the skill agents call via tool use) runs pure cosine-only against `workspace_memory_entries`. Meanwhile, `getRelevantMemories` (the prompt-injection path) has full RRF fusion, HyDE, optional reranking, profile-based weight tuning, and quality gating. Agents searching memory explicitly get the worst retrieval path. |
| **Fix** | Refactor `semanticSearchMemories` to call into the same RRF pipeline that `getRelevantMemories` uses, adapting parameters for the skill context (e.g. cross-subaccount support, topK control). This is not building new infrastructure — it's wiring existing infrastructure into the skill path. |
| **Files** | `server/services/workspaceMemoryService.ts` (refactor `semanticSearchMemories`), `server/services/skillExecutor.ts` (search_agent_history handler) |
| **Benefit** | Every agent that searches memory gets RRF + HyDE + quality gating for free. Immediate retrieval quality improvement across all 16 system agents. |
| **Scope** | All agents, all customers |
| **Effort** | 1-2 days |

#### 0B. Query sanitization for agent-generated searches

| | |
|---|---|
| **Source** | MemPalace |
| **Problem** | LLM agents frequently contaminate search queries with system prompt fragments, verbose preambles, or multi-sentence explanations. MemPalace found this collapses retrieval accuracy from ~90% to ~1%. Our only protection is a `MAX_QUERY_TEXT_CHARS` truncation — no structural cleaning. |
| **Fix** | Add a `sanitizeSearchQuery()` utility with a 4-step cascade: (1) passthrough if <200 chars, (2) extract question-mark-terminated sentence, (3) extract tail sentence, (4) tail-truncate. Apply as a preprocessing step in both `semanticSearchMemories` and `getRelevantMemories`. |
| **Files** | New: `server/lib/sanitizeSearchQuery.ts`. Modified: `server/services/workspaceMemoryService.ts` |
| **Benefit** | Prevents the silent failure mode where agents write verbose tool inputs and get garbage retrieval. Pure function, trivially testable. |
| **Scope** | All agents |
| **Effort** | Half a day |

#### 0C. Multi-breakpoint prompt caching

| | |
|---|---|
| **Source** | Repowise (prefix caching by design) |
| **Problem** | Our Anthropic adapter applies `cache_control: { type: 'ephemeral' }` as one coarse block on the entire system prompt. Since the system prompt includes dynamic content (workspace memory, board state, task instructions), every run invalidates the cache for the entire prompt. Repowise deliberately structures prompts so static content comes first, maximising the cacheable prefix. |
| **Fix** | In `anthropicAdapter.ts`, split the system prompt into multiple `content` blocks: (1) master prompt + skill definitions (stable across runs — cacheable), (2) org/custom instructions (stable across runs for same agent — cacheable), (3) dynamic content (memory, board, task — not cached). Apply `cache_control` breakpoints at the boundaries between stable and dynamic sections. This requires the prompt assembly in `agentExecutionService.ts` to return structured sections rather than a flat string. |
| **Files** | `server/services/agentExecutionService.ts` (return sections), `server/services/providers/anthropicAdapter.ts` (multi-block system prompt) |
| **Benefit** | Anthropic charges 90% less for cached prompt tokens. Master prompts for our 16 system agents are large and stable — caching them properly could reduce prompt token cost by 40-60% on cache-hit runs. This compounds across every agent execution on the platform. |
| **Scope** | All agents using Anthropic models |
| **Effort** | 1-2 days |

---

### Phase 1 — Search & Retrieval Overhaul (1-2 week sprint)

These build on Phase 0 and upgrade how every agent finds and scores information. The theme: agents are only as good as the context they retrieve.

#### 1A. Intent-adaptive search weights

| | |
|---|---|
| **Source** | engraph (5-lane intent classification), our own `getRelevantMemories` (3 profiles) |
| **Problem** | Our RRF pipeline already has 3 query profiles (`temporal`, `factual`, `general`) detected via regex. But the classification is coarse and the skill path (`search_agent_history`) doesn't use profiles at all. engraph classifies into 5 intents (Exact, Conceptual, Relationship, Exploratory, Temporal) and adjusts lane weights per intent. |
| **Fix** | Expand the profile classifier from 3 regex-based profiles to a richer heuristic system: detect question words, temporal markers, entity references, comparison patterns, exploratory phrasing. Apply profiles in the unified skill path (from 0A). This is heuristic-first — no LLM call needed. |
| **Files** | `server/services/workspaceMemoryService.ts` (expand `detectQueryProfile`), new `server/lib/queryIntentClassifier.ts` |
| **Benefit** | "What happened last week?" gets temporal weighting. "What is our CRM setup?" gets factual weighting. "How are things going?" gets exploratory weighting. Better weight tuning = better results without changing the retrieval infrastructure. |
| **Scope** | All agents |
| **Effort** | 2-3 days |

#### 1B. Dominance-ratio confidence gating

| | |
|---|---|
| **Source** | Repowise |
| **Problem** | When retrieval results are ambiguous (top result only marginally better than second), the current pipeline still passes them to the LLM for synthesis or reranking. Repowise skips LLM synthesis when `top_score / second_score < 1.2` and returns raw excerpts instead — preventing hallucination when retrieval is uncertain. |
| **Fix** | After RRF scoring, compute dominance ratio. Below threshold: return raw memory entries as-is (no LLM reranking, no HyDE-driven synthesis). Above threshold: proceed normally. This is a guard clause, not a new pipeline stage. |
| **Files** | `server/services/workspaceMemoryService.ts` (add dominance check after RRF scoring) |
| **Benefit** | Prevents the failure mode where ambiguous retrieval + LLM synthesis = confident-sounding hallucination. Lower cost (fewer LLM calls when retrieval is weak). |
| **Scope** | All agents |
| **Effort** | 1 day |

#### 1C. Graph-aware context expansion

| | |
|---|---|
| **Source** | engraph (wikilink expansion with relevance filtering and score decay) |
| **Problem** | When agents search memory or load context, results are isolated — no traversal of relationships. A memory about "Client X migration to WooCommerce" doesn't automatically surface related memories about "Client X's previous Shopify setup" or the task that triggered the migration. |
| **Fix** | After initial retrieval, follow relational edges: memory → same taskSlug memories, memory → same agentId memories from adjacent runs, entity → memories mentioning that entity. Apply score decay (0.8x for 1-hop, 0.5x for 2-hop). Filter expanded results by minimum similarity threshold to prevent pollution. |
| **Files** | `server/services/workspaceMemoryService.ts` (new `expandResultsByRelation` step), may query `workspace_entities` |
| **Benefit** | Richer, more connected context. Agents understand relationships between facts without manual data source configuration. Particularly valuable for the Orchestrator and CRM agents that work across tasks. |
| **Scope** | All agents |
| **Effort** | 3-4 days |
| **Depends on** | 0A (unified retrieval path) |

#### 1D. Two-pass context reranking for data sources

| | |
|---|---|
| **Source** | engraph (cross-encoder second pass) |
| **Problem** | `runContextLoader.ts` loads all data sources by scope, deduplicates by name, and truncates by budget — but never scores relevance to the actual task. An agent running a "review Q1 ad spend" task loads all eager data sources regardless of relevance. |
| **Fix** | After loading the context pool but before budget truncation, score each data source chunk against the task description using a lightweight embedding similarity check (we already have embeddings infrastructure). Reorder by relevance score, then apply budget truncation. Most relevant content survives the budget cut. |
| **Files** | `server/services/runContextLoader.ts`, `server/services/runContextLoaderPure.ts` |
| **Benefit** | Agents start runs with more relevant context in the same token budget. Reduces noise from irrelevant data sources that happen to be in scope. |
| **Scope** | All agents with data sources attached |
| **Effort** | 2-3 days |

---

### Phase 2 — Memory Intelligence (1-2 week sprint)

These upgrade how knowledge is stored, aged, and maintained. The theme: memory quality compounds — small improvements here improve every future agent run.

#### 2A. Temporal validity on entities and memories

| | |
|---|---|
| **Source** | MemPalace (knowledge graph triples with `valid_from`/`valid_to`, `as_of` query parameter) |
| **Problem** | `workspace_entities` has `firstSeenAt`/`lastSeenAt` but no validity range. A fact like "Client uses Shopify" stays true until manually deleted. When Client migrates to WooCommerce, the old fact is either stale (still present) or gone (no history). Agents can't distinguish "was true then" from "is true now" and can't reason about change over time. |
| **Fix** | Add `valid_from` (timestamp, defaults to `createdAt`) and `valid_to` (nullable timestamp, null = currently valid) to `workspace_entities`. When an entity is superseded, set `valid_to` on the old record and create a new one. Add an `as_of` parameter to entity queries. Apply the same pattern to `workspace_memory_entries` for time-sensitive observations. |
| **Files** | New migration: `0105_temporal_validity.sql`. Modified: `server/db/schema/workspaceEntities.ts`, `server/services/workspaceMemoryService.ts` (entity queries), skill handlers that read entities |
| **Benefit** | Agents managing client accounts where facts change constantly (budgets, platforms, contacts, strategies) stop acting on stale knowledge. The Reporting Agent can compare "what was true in Q1 vs Q4." The CRM Agent knows a contact left the company. Foundational for any agent that works with evolving real-world state. |
| **Scope** | All agents that reference workspace entities (most of them) |
| **Effort** | 3-4 days |

#### 2B. Similarity-based memory deduplication job

| | |
|---|---|
| **Source** | MemPalace (greedy dedup: sort by length, keep if cosine distance > 0.15 from all kept) |
| **Problem** | Our write-time dedup (LLM-based, top-20 comparison window) catches obvious duplicates but misses gradual drift. An agent writing "Client X prefers weekly reports" across 10 runs creates near-duplicate entries that waste token budget and dilute search quality. `memoryDecayJob` prunes by age/quality/access but not by similarity. |
| **Fix** | Add a scheduled pg-boss job (`memoryDedupJob`) that runs nightly per org. For each subaccount: load all entries with embeddings, sort by quality descending, iterate and keep each entry only if its cosine distance to all already-kept entries exceeds a threshold (0.15 per MemPalace, tunable). Soft-delete near-duplicates, keeping the highest-quality version. Process in batches of 500 (pgvector supports cosine distance natively: `embedding <=> other_embedding`). |
| **Files** | New: `server/jobs/memoryDedupJob.ts`. Modified: `server/jobs/index.ts` (registration), `server/services/agentScheduleService.ts` (schedule) |
| **Benefit** | Keeps memory pools lean without losing information. Prevents the "death by a thousand near-duplicates" problem that degrades retrieval quality over time. The effect compounds — cleaner memory pool = better retrieval = better agent runs = cleaner new entries. |
| **Scope** | All agents, all customers |
| **Effort** | 2-3 days |

#### 2C. Hierarchical metadata on memory entries

| | |
|---|---|
| **Source** | MemPalace (wing/room/drawer hierarchy), engraph (folder centroid matching) |
| **Problem** | Memory entries have `entryType` (5 types) and `taskSlug` as the only classification dimensions. For multi-agent orgs, memories from the CRM Agent about pipeline status pollute search results when the Reporting Agent searches for content metrics. There's no domain/topic scoping. |
| **Fix** | Add a `domain` field (auto-classified from the writing agent's role — e.g. `crm`, `reporting`, `support`, `dev`, `marketing`) and a `topic` field (auto-extracted from content at write time — lightweight keyword or embedding-based classification against a small taxonomy). Use these as `WHERE` clause filters in the RRF pipeline before the HNSW vector scan, reducing the candidate pool to relevant entries. |
| **Files** | New migration: add `domain`, `topic` columns to `workspace_memory_entries`. Modified: `server/services/workspaceMemoryService.ts` (write path: classify; read path: filter) |
| **Benefit** | MemPalace showed 34% retrieval improvement from hierarchical filtering alone — not better ML, just better metadata hygiene. For multi-agent orgs with hundreds or thousands of memory entries, domain scoping prevents cross-contamination. |
| **Scope** | All agents, proportional to memory volume |
| **Effort** | 3-4 days |
| **Depends on** | 0A (unified retrieval path — filters need to be in both paths) |

#### 2D. Agent briefing / wake-up context

| | |
|---|---|
| **Source** | MemPalace (`wake_up()` — 170-token essential context), engraph (L1 dynamic identity extraction) |
| **Problem** | Agents load context via data sources (up to 60K tokens) and memory blocks, but there's no compact "here's what matters most" summary. The handoff JSON bridges individual runs but resets each time. An agent running its 50th task on a subaccount has no cumulative awareness of what it's learned — it starts from scratch each time, relying on memory search during the run. |
| **Fix** | Build an auto-generated "agent briefing" — a compact summary (target: 500-1000 tokens) of the agent's most important accumulated knowledge for this subaccount. Updated as a post-run job: take the latest handoff JSON, merge key facts with the previous briefing, compress via LLM to the token budget. Store as a special memory block (`type: 'agent_briefing'`, `permission: read`) attached to the subaccount-agent link. Injected as the first section of workspace memory in prompt assembly. |
| **Files** | New: `server/services/agentBriefingService.ts`, new job in `server/jobs/`. Modified: `server/services/agentExecutionService.ts` (inject briefing into prompt assembly) |
| **Benefit** | Agents develop cumulative awareness across runs. The 50th run on a subaccount starts with "I know Client X uses WooCommerce, prefers weekly reports, has 3 active campaigns, and last week we resolved a billing issue" — without searching. MemPalace achieves session continuity in 170 tokens. We can do the same at the agent-subaccount level. |
| **Scope** | All agents |
| **Effort** | 4-5 days (new service + job + prompt integration) |
| **Depends on** | 2A (temporal validity helps briefing stay current) |

---

### Phase 3 — Context Assembly Upgrade (1 week sprint)

These improve how agents receive context at run start. The theme: the best retrieval in the world is wasted if context assembly doesn't put the right information in front of the agent.

#### 3A. Pre-run task-aware context injection

| | |
|---|---|
| **Source** | Repowise (token-budget-aware context assembly, adaptive generation depth), engraph (identity block injection) |
| **Problem** | When an agent starts a run, `runContextLoader` loads data sources by scope — not by relevance to the task. An agent tasked with "analyse competitor pricing" gets all eager data sources (CRM exports, brand guidelines, meeting notes) instead of the pricing-relevant ones. The agent must then spend tool calls searching for what it needs. |
| **Fix** | Add a `taskContextEnrichment` step between context loading and prompt assembly. Given the task description, compute embedding similarity against all available data source chunks + top workspace memories. Inject the top-N most relevant items (within token budget) as a `## Relevant Context for This Task` section early in the prompt. This is distinct from 1D (which reranks what's already loaded) — this actively pulls in lazy data sources that wouldn't otherwise be loaded. |
| **Files** | New: `server/services/taskContextEnrichmentService.ts`. Modified: `server/services/agentExecutionService.ts` (call enrichment before prompt assembly) |
| **Benefit** | Agents start runs already oriented to their task. Fewer "searching for context" tool calls in the first 2-3 iterations. Repowise showed that pre-computed context assembly reduces token usage by 27x compared to agents fetching context themselves. We won't hit 27x, but even 3-5x fewer search calls per run is significant at scale. |
| **Scope** | All agents with task-based runs |
| **Effort** | 3-4 days |
| **Depends on** | 1D (reranking infrastructure), 0A (unified retrieval) |

#### 3B. Auto-extracted subaccount state summary

| | |
|---|---|
| **Source** | engraph (L1 dynamic identity — active projects, blocking items, current focus) |
| **Problem** | Agents know about a subaccount through static data sources and accumulated memories, but there's no real-time "state of play" summary. The Orchestrator agent doesn't automatically know "3 tasks are blocked, 2 campaigns launched this week, one agent failed its last 3 runs." This situational awareness requires manual prompt maintenance in `additionalPrompt`. |
| **Fix** | Build a `subaccountStateSummaryService` that aggregates: (1) task board status counts, (2) recent agent run outcomes (success/fail/escalation rates), (3) active health findings, (4) recent memory highlights. Compile into a compact structured block (~200-400 tokens). Refresh on a schedule (every 4-6 hours) or on-demand at run start. Inject into the prompt as `## Current Subaccount State`. |
| **Files** | New: `server/services/subaccountStateSummaryService.ts`. Modified: `server/services/agentExecutionService.ts` (inject state summary) |
| **Benefit** | Replaces manual `additionalPrompt` maintenance with automated situational awareness. The Orchestrator, Portfolio Health, and Support agents benefit most — they make decisions based on current state. Eliminates the "stale prompt" problem where `additionalPrompt` describes reality from 3 weeks ago. |
| **Scope** | All agents, highest value for orchestration and monitoring agents |
| **Effort** | 3-4 days |

#### 3C. Hallucination detection on agent output

| | |
|---|---|
| **Source** | Repowise (backtick-quoted identifier cross-reference against known symbol set) |
| **Problem** | When agents generate output that references specific entities (client names, task IDs, skill names, contact names, metric values), there's no verification that these references are real. An agent might confidently reference a task that doesn't exist or a contact who left the company. |
| **Fix** | Add a `postTool` middleware (or extend `reflectionLoopMiddleware`) that extracts entity references from agent output and cross-references against: (1) workspace entities, (2) task board items, (3) known contacts/deals from CRM integration. Flag phantom references as warnings in the agent run log. For high-confidence mismatches, inject a correction nudge into the next iteration's messages. |
| **Files** | New: `server/services/middleware/hallucinationDetectionMiddleware.ts`. Modified: `server/services/middleware/index.ts` (register in pipeline) |
| **Benefit** | Catches factual errors before they reach the user or trigger downstream actions. Particularly valuable for the Reporting Agent (wrong metric names), CRM Agent (phantom contacts), and Support Agent (referencing nonexistent tasks). Repowise applies this to code symbols; we apply it to business entities. |
| **Scope** | All agents, proportional to entity density in output |
| **Effort** | 3-5 days |
| **Depends on** | 2A (temporal validity — need to know which entities are currently valid) |

---

### Phase 4 — Dev Agent Code Intelligence (2-3 week sprint)

These are Dev Agent-specific capabilities. They don't benefit non-dev agents, but they represent a step-change in what the Dev Agent can do. This is where Repowise's core value proposition lives.

#### 4A. AST-based code understanding via tree-sitter

| | |
|---|---|
| **Source** | Repowise (unified parser with zero language branches — `.scm` query files + `LanguageConfig` dataclasses) |
| **Problem** | `search_codebase` is grep/glob. `read_codebase` reads raw files. The Dev Agent navigates code by text pattern matching — no understanding of imports, exports, classes, functions, or module boundaries. It can't answer "find all usages of function X" without regex guesswork, and it can't understand a file's structure without reading the entire file. |
| **Fix** | Build a `codeAnalysisService.ts` using tree-sitter's JavaScript bindings (`web-tree-sitter` or `tree-sitter` npm package). Key design insight from Repowise: **zero language branches in the parser**. All per-language behavior is encoded in `.scm` query files and a `LanguageConfig` type. Adding a new language = one query file + one config entry. The parser extracts: imports, exports, classes, functions, type definitions, and builds a per-file symbol table. Store results in a `code_symbols` table (file path, symbol name, symbol type, line range, file hash for incremental updates). |
| **Files** | New: `server/services/codeAnalysisService.ts`, `server/services/codeAnalysis/` directory with `.scm` query files per language, new migration for `code_symbols` table. New skills: `get_file_structure`, `find_symbol_usages` |
| **Benefit** | The Dev Agent can navigate by symbol rather than by string. "Find all functions that import from auth service" becomes a graph query, not a grep guess. Prerequisite for dependency graph (4B) and dead code detection (5B). |
| **Scope** | Dev Agent, QA Agent |
| **Effort** | 5-7 days |
| **Languages to support first** | TypeScript, JavaScript (our own stack), Python, Go |

#### 4B. Dependency graph + blast radius analysis

| | |
|---|---|
| **Source** | Repowise (NetworkX DiGraph, PageRank, Louvain community detection, BFS blast radius, framework-aware synthetic edges, co-change edge injection) |
| **Problem** | Before the Dev Agent applies a patch, it has no way to know what else might break. There's no import graph, no blast radius analysis, no way to answer "if I change file X, what files depend on it?" |
| **Fix** | Build a `dependencyGraphService.ts` using a JS graph library (`graphology` — well-maintained, TypeScript-native, supports directed graphs). Populate from the symbol table (4A): edges = import relationships. Key patterns to steal from Repowise: (1) **Framework-aware synthetic edges** — Express `router.use()` → route files, Drizzle schema imports → migration files, `skillExecutor.ts` → skill handler references. (2) **PageRank** to identify critical files (high-centrality nodes need more review attention). (3) **BFS blast radius** — given a set of changed files, walk outward N hops to find all potentially affected files, scored by distance. Store edges in a `code_dependency_edges` table. Expose via new skills: `get_blast_radius`, `get_dependency_path`, `get_critical_files`. |
| **Files** | New: `server/services/dependencyGraphService.ts`, new migration for `code_dependency_edges`. New skills: `get_blast_radius`, `get_dependency_path`, `get_critical_files` |
| **Benefit** | Before patching, the Dev Agent can check blast radius. During review, it can prioritize high-centrality files. For architecture tasks, it can identify module boundaries and circular dependencies. Integrates with `review_code` to add impact-awareness to code review. |
| **Scope** | Dev Agent, QA Agent |
| **Effort** | 5-7 days |
| **Depends on** | 4A (symbol table provides the edges) |

#### 4C. Git intelligence / hotspot scoring

| | |
|---|---|
| **Source** | Repowise (500-commit git log mining, exponential temporal decay with 180-day half-life, ownership percentiles, co-change patterns, rename tracking) |
| **Problem** | `gitService.ts` handles git operations (branch, commit, push, PR) but does no analysis. The Dev Agent doesn't know which files change most frequently, who owns what, or which files tend to change together. |
| **Fix** | Build a `gitIntelligenceService.ts` that mines `git log --numstat` for a configurable commit window (default 500). Compute per-file: (1) **Hotspot score** — commit frequency weighted by exponential temporal decay (half-life 180 days, so recent churn matters more). (2) **Ownership** — lines-changed attribution per author, percentile ranking, bus factor (files with single-author ownership). (3) **Co-change patterns** — files that appear in the same commits, weighted by temporal decay. Store in a `code_hotspots` table. Refresh incrementally on push events via GitHub webhook. Expose via new skill: `get_risk_analysis`. |
| **Files** | New: `server/services/gitIntelligenceService.ts`, new migration for `code_hotspots` table. New skill: `get_risk_analysis` |
| **Benefit** | The Dev Agent can prioritize: "This file has been changing 3x/week and only one person has ever touched it — be extra careful." Co-change data feeds into the dependency graph (4B) as synthetic edges for logical coupling beyond imports. |
| **Scope** | Dev Agent |
| **Effort** | 3-4 days |
| **Independent of** | 4A/4B (can be built in parallel — uses git, not AST) |

---

### Phase 5 — Polish & Extensions (ongoing, pick as needed)

Lower-priority items that add value but aren't urgent. Good candidates for filling gaps between sprints.

#### 5A. Agent diary / running journal

| | |
|---|---|
| **Source** | MemPalace (per-agent diary entries with timestamps) |
| **Problem** | Agents have `handoffJson` per run and searchable memory entries, but no lightweight chronological narrative. There's no "what have I been doing this week" view — just search results and structured handoffs. |
| **Fix** | Add an `agent_diary_entries` table (`agentId`, `subaccountId`, `orgId`, `content`, `createdAt`). New universal skill `write_diary_entry`. Agents write a brief (1-2 sentence) journal entry at run completion. The diary feeds into the agent briefing (2D) as recent activity context. Lightweight — no embeddings, no search, just a chronological log. |
| **Effort** | 2-3 days |
| **Scope** | All agents |

#### 5B. Dead code detection

| | |
|---|---|
| **Source** | Repowise (pure graph traversal — no LLM needed, tiered confidence) |
| **Problem** | No way for agents to identify unused code during review or refactoring tasks. |
| **Fix** | Walk the dependency graph (4B), find nodes with zero incoming edges that aren't entry points. Tier confidence by evidence strength. Expose as a `detect_dead_code` skill. Also integrate as a workspace health detector for dev-configured subaccounts. |
| **Effort** | 2-3 days |
| **Scope** | Dev Agent, QA Agent |
| **Depends on** | 4B (dependency graph) |

#### 5C. Incremental code indexing with cascade budget

| | |
|---|---|
| **Source** | Repowise (symbol-level diffs, adaptive cascade budget: 10 pages for 1 file change, capped at 50 for 6+) |
| **Problem** | If we build the code intelligence layer (4A-4C), we need incremental updates. A single commit shouldn't trigger a full re-index. |
| **Fix** | On GitHub webhook push events, compute changed files, re-parse only those files via tree-sitter, update the symbol table and dependency graph incrementally. Apply a cascade budget: cap regeneration at N files per push event to prevent runaway re-indexing on large merges. |
| **Effort** | 3-4 days |
| **Scope** | Dev Agent |
| **Depends on** | 4A, 4B |

#### 5D. Semantic task categorization

| | |
|---|---|
| **Source** | engraph (folder centroid matching with correction feedback) |
| **Problem** | When agents create tasks via `create_task`, categorization is either explicit (agent specifies) or default. No intelligent suggestion based on content. |
| **Fix** | Compute embedding centroids per board column / category from existing tasks. When a new task is created, compare its embedding against centroids and suggest placement. Track corrections (user moves task to different column) and adjust centroids. |
| **Effort** | 2-3 days |
| **Scope** | All agents that create tasks |

#### 5E. Extended workspace health detectors

| | |
|---|---|
| **Source** | engraph (orphan detection, broken links, stale content, tag hygiene) |
| **Problem** | Our 6 health detectors check infrastructure-level issues (broken connections, missing engines). No content-level health checks. |
| **Fix** | Add detectors for: (1) tasks referencing deleted agents, (2) memory blocks not read in N days, (3) data sources with expired/broken connections, (4) agent prompts referencing removed skills, (5) orphaned entities (no memory references). |
| **Effort** | 2-3 days |
| **Scope** | All customers |

#### 5F. Temporal decay on memory relevance scoring

| | |
|---|---|
| **Source** | Repowise (exponential decay with 180-day half-life for hotspot scoring) |
| **Problem** | Our memory retrieval uses a `recency_decay` weight in the RRF scoring, but it's a simple linear factor. Repowise's exponential decay with a configurable half-life is more sophisticated — a 6-month-old memory decays gracefully, not cliff-edge. |
| **Fix** | Replace the linear recency weight in `getRelevantMemories` with an exponential decay function: `score = e^(-lambda * age_days)` where `lambda = ln(2) / half_life_days`. Configurable half-life per query profile (temporal queries: short half-life, factual queries: long half-life). |
| **Effort** | 1 day |
| **Scope** | All agents |

---

## Master Priority Table

All 23 items ranked by ROI (impact / effort), grouped by phase.

| # | ID | Item | Effort | Impact | Scope | Source |
|---|-----|------|--------|--------|-------|--------|
| 1 | 0B | Query sanitization for search skills | 0.5d | High | All agents | MemPalace |
| 2 | 5F | Temporal decay on memory scoring | 1d | Medium | All agents | Repowise |
| 3 | 1B | Dominance-ratio confidence gating | 1d | High | All agents | Repowise |
| 4 | 0A | Unify `search_agent_history` with RRF pipeline | 1-2d | High | All agents | engraph + existing code |
| 5 | 0C | Multi-breakpoint prompt caching | 1-2d | High | All agents (Anthropic) | Repowise |
| 6 | 1A | Intent-adaptive search weights | 2-3d | Medium-High | All agents | engraph |
| 7 | 2B | Similarity-based memory dedup job | 2-3d | Medium | All agents | MemPalace |
| 8 | 5A | Agent diary / running journal | 2-3d | Medium | All agents | MemPalace |
| 9 | 5E | Extended workspace health detectors | 2-3d | Low-Medium | All customers | engraph |
| 10 | 5D | Semantic task categorization | 2-3d | Medium | All agents | engraph |
| 11 | 1D | Two-pass context reranking for data sources | 2-3d | Medium-High | All agents w/ data sources | engraph |
| 12 | 2A | Temporal validity on entities/memories | 3-4d | High | All agents | MemPalace |
| 13 | 2C | Hierarchical metadata on memories | 3-4d | Medium-High | All agents | MemPalace + engraph |
| 14 | 1C | Graph-aware context expansion | 3-4d | Medium | All agents | engraph |
| 15 | 3B | Auto-extracted subaccount state summary | 3-4d | Medium-High | All agents | engraph |
| 16 | 3A | Pre-run task-aware context injection | 3-4d | High | All agents | Repowise |
| 17 | 4C | Git intelligence / hotspot scoring | 3-4d | Medium-High | Dev Agent | Repowise |
| 18 | 3C | Hallucination detection on agent output | 3-5d | Medium | All agents | Repowise |
| 19 | 2D | Agent briefing / wake-up context | 4-5d | High | All agents | MemPalace + engraph |
| 20 | 4A | AST-based code understanding | 5-7d | High | Dev Agent | Repowise |
| 21 | 4B | Dependency graph + blast radius | 5-7d | High | Dev Agent | Repowise |
| 22 | 5B | Dead code detection | 2-3d | Medium | Dev Agent | Repowise |
| 23 | 5C | Incremental code indexing | 3-4d | Medium | Dev Agent | Repowise |

**Total estimated effort:** ~55-75 developer-days across all phases.

**Phase 0 alone:** ~3-4 days for items 1-5 above, impacting every agent immediately.

---

## Cross-Cutting Benefits Matrix

Which system agents benefit from which items. Shaded = high relevance.

| Item | Orchestrator | Dev | QA | Support | CRM/Pipeline | Reporting | Content/SEO | Social Media | Email Outreach | Finance | Ads Mgmt | Onboarding | Knowledge Mgmt | Client Reporting | Portfolio Health | Biz Analyst |
|------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Phase 0** | | | | | | | | | | | | | | | | |
| 0A Unified search | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| 0B Query sanitize | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| 0C Prompt caching | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| **Phase 1** | | | | | | | | | | | | | | | | |
| 1A Intent weights | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| 1B Confidence gate | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| 1C Graph expansion | X | . | . | X | X | X | . | . | . | . | . | . | X | X | X | X |
| 1D Context rerank | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| **Phase 2** | | | | | | | | | | | | | | | | |
| 2A Temporal validity | X | . | . | X | X | X | . | . | X | X | X | X | X | X | X | X |
| 2B Memory dedup | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| 2C Hierarchical meta | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| 2D Agent briefing | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| **Phase 3** | | | | | | | | | | | | | | | | |
| 3A Task context inj. | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| 3B Subaccount state | X | . | . | X | X | X | . | . | . | X | . | X | X | X | X | X |
| 3C Hallucination det. | X | X | X | X | X | X | X | X | X | X | X | . | X | X | X | X |
| **Phase 4** | | | | | | | | | | | | | | | | |
| 4A AST parsing | . | X | X | . | . | . | . | . | . | . | . | . | . | . | . | . |
| 4B Dep graph | . | X | X | . | . | . | . | . | . | . | . | . | . | . | . | . |
| 4C Git intelligence | . | X | X | . | . | . | . | . | . | . | . | . | . | . | . | . |

`X` = directly benefits, `.` = not applicable or marginal benefit.

**Key insight:** Phases 0-3 benefit all 16 system agents. Phase 4 benefits only Dev + QA. If prioritizing by breadth of impact, Phases 0-3 should be completed before Phase 4.

---

## Implementation Dependencies

Items are **not** a flat list — some have hard prerequisites. This map shows what can be parallelised and what must be sequenced.

```
PHASE 0 (no dependencies — all independent)
  0A  Unify search_agent_history ─────────────┐
  0B  Query sanitization                       │ (independent)
  0C  Multi-breakpoint prompt caching          │ (independent)
                                               │
PHASE 1 (0A is the only prerequisite)          │
  1A  Intent-adaptive weights ─────────────────┤ (needs 0A)
  1B  Dominance-ratio gating ──────────────────┤ (needs 0A)
  1C  Graph-aware expansion ───────────────────┤ (needs 0A)
  1D  Two-pass context reranking               │ (independent of 0A)
                                               │
PHASE 2 (mostly independent)                   │
  2A  Temporal validity ───────────────────────┤ (independent)
  2B  Memory dedup job                         │ (independent)
  2C  Hierarchical metadata ───────────────────┤ (needs 0A for filter integration)
  2D  Agent briefing ──────────────────────────┘ (benefits from 2A)

PHASE 3 (builds on Phase 1+2)
  3A  Task-aware context injection ──── needs 1D, 0A
  3B  Subaccount state summary ──────── independent
  3C  Hallucination detection ───────── benefits from 2A

PHASE 4 (self-contained chain)
  4C  Git intelligence ──────────────── independent (can start any time)
  4A  AST code understanding ────────── independent (can start any time)
  4B  Dependency graph ──────────────── needs 4A
  5B  Dead code detection ───────────── needs 4B
  5C  Incremental indexing ──────────── needs 4A + 4B
```

### Parallelisation opportunities

These groups can run concurrently with separate engineers or in the same sprint:

| Track A (Search/Memory) | Track B (Context/Prompt) | Track C (Dev Intelligence) |
|------------------------|--------------------------|---------------------------|
| 0A → 1A, 1B, 1C | 0C (prompt caching) | 4C (git intelligence) |
| 0B (sanitizer) | 1D (context reranking) | 4A (AST parsing) |
| 2B (dedup job) | 3B (subaccount state) | 4B (dep graph) → 5B, 5C |
| 2A (temporal validity) | 3A (task context injection) | |
| 2C (hierarchical metadata) | 3C (hallucination detection) | |
| 2D (agent briefing) | | |

Track A and B can run in parallel from day 1. Track C can start any time but is lower priority for platform-wide impact.

### Critical path

The fastest path to maximum impact:

```
Week 1:  0A + 0B + 0C + 5F          (quick wins — all agents benefit)
Week 2:  1A + 1B + 1D               (search quality + context quality)
Week 3:  2A + 2B                     (memory quality)
Week 4:  2C + 2D                     (memory organisation + agent continuity)
Week 5:  3A + 3B                     (context assembly)
Week 6:  3C + 1C                     (safety + connected context)
Week 7+: 4A → 4B → 4C → 5B → 5C    (dev agent intelligence)
```

---

## What We Deliberately Skip

These exist in the source repos but don't transfer to our architecture.

| Pattern | Source | Why skip |
|---------|--------|----------|
| AAAK compression dialect | MemPalace | Lossy (12.4% worse retrieval). Our `contextPressureMiddleware` + token budgeting is the right approach. |
| Palace metaphor (wing/room/drawer) | MemPalace | Cute for personal use. Our org/subaccount/agent hierarchy already provides natural scoping. |
| ChromaDB as vector store | MemPalace | We're PostgreSQL + pgvector. No reason to add a second vector store. |
| Local GGUF model inference | engraph | We use cloud LLMs. Local inference adds ops burden for no benefit. |
| SQLite FTS5 | Repowise, engraph | We already have PostgreSQL FTS with `plainto_tsquery` + GIN indexes. |
| Obsidian-specific parsing | engraph | We don't work with markdown vaults. |
| File-watcher indexing | engraph | Our data arrives via API/webhooks/jobs, not filesystem events. |
| LanceDB for vectors | Repowise | pgvector already handles this. |
| JSON checkpoint job system | Repowise | pg-boss is more robust. |
| Simple API key auth | Repowise | Our full RBAC system is more appropriate. |
| Stdio-only MCP transport | Repowise | We already have MCP client management with circuit breakers. |
| Hook-based auto-save | MemPalace | Our agents already persist all messages via `agent_run_messages`. |
| Regex entity extraction | MemPalace | Our LLM-assisted extraction is more accurate. |

---

## MemPalace Post-Mortem (2026-04-13)

> Community debunked MemPalace's benchmark claims within 24 hours of launch. This section corrects the record.

### What fell apart

| Claim | Reality |
|-------|---------|
| 96.6% LongMemEval / 100% LoCoMo | LoCoMo 100% was meaningless — top-k exceeded corpus size, so it returned the entire dataset. LongMemEval score not independently reproduced. |
| "30x lossless compression" (AAAK dialect) | Actually lossy summarisation. Independent tests show >10% retrieval accuracy drop. Save pennies on input tokens, spend dollars on agent retries from mangled context. |
| Palace structure drives retrieval quality | Vanilla ChromaDB did most of the work. The wing/room/drawer hierarchy contributed only marginally to retrieval accuracy. |
| Independent BEAM 100K benchmark | 49% answer quality — the honest number, vs the 96.6% marketing claim. |

### Code quality assessment

The repo is AI-generated spaghetti. Many "advanced" features (automated memory conflict resolution, etc.) are empty stubs or placeholder functions. It's a prototype masquerading as a finished product. The "Memory Palace" metaphor is a hierarchical folder structure any dev could build over a weekend on top of ChromaDB.

### What it actually is

A retrieval layer, not a reasoning engine. Works locally and has a functional MCP server for Claude Desktop. If you want a visual dashboard for local RAG, it's a neat toy — nothing more.

### What we're keeping from the analysis

The patterns extracted in this doc (query sanitization, temporal validity, similarity dedup, hierarchical metadata, agent briefing) remain valid — they're well-established retrieval patterns that MemPalace happened to implement. They don't depend on MemPalace's benchmark claims being true.

### What replaces it for Brain's world model layer

- **Week 1:** `beliefs.json` via AgentOS persistence. Simple, working, proven. Close the loop on flat JSON first.
- **Next:** [anda-hippocampus (ldclabs)](https://github.com/ldclabs/anda-hippocampus) — graph-native, bio-inspired sleep consolidation, contradiction detection with state evolution (not overwrite), complete cognitive timeline. Swap once the loop is stable, not before.

### Status

**WATCH.** The method of loci concept is still interesting, the contradiction detection pattern is worth stealing, but the benchmarks didn't hold up. No integration planned.

---

## Executive Summary

### The core insight

All three repos converge on the same thesis: **AI agents are bottlenecked by context quality, not model capability.** Better retrieval, better memory organisation, and better pre-computed intelligence produce dramatically better agent outputs — often at lower cost.

- **Repowise** proves this for code: pre-computed structure (AST, dependency graph, git analytics) enables 27x fewer tokens per query than raw code dumping.
- **MemPalace** claimed this for memory: verbatim storage with metadata scores 96.6% retrieval — but benchmarks were debunked (see Post-Mortem above; honest independent score: 49% on BEAM 100K). The underlying patterns (temporal validity, hierarchical tags, query sanitization) remain sound even though the product didn't deliver.
- **engraph** proves this for search: multi-lane retrieval with intent-adaptive fusion produces markedly better results than any single search method.

### What this means for Automation OS

Our agent execution engine is mature (middleware pipeline, HITL, crash-resume, multi-provider). Our memory infrastructure is partially mature (RRF exists in the prompt path but not the skill path). Our code intelligence is absent.

The highest-leverage work is not building new features — it's **connecting existing infrastructure to the paths agents actually use** (0A), **adding guard rails against silent failure modes** (0B, 1B, 3C), and **improving the quality signal-to-noise ratio** in context assembly (1D, 2C, 3A).

### Recommended approach

1. **Ship Phase 0 immediately** (~3-4 days). These are low-risk, high-reward changes to existing code. Every agent run on the platform improves.

2. **Run Phase 1 + Phase 2 as a 2-week sprint** (~15-20 days across two tracks). Search quality and memory quality are the two highest-leverage areas for platform-wide improvement.

3. **Phase 3 as a follow-up week** (~10 days). Context assembly upgrades that build on Phase 1+2 infrastructure.

4. **Phase 4 as a separate initiative** when Dev Agent capability is a priority. This is a self-contained workstream that doesn't block or depend on Phases 0-3.

5. **Phase 5 items** are backlog — pick opportunistically between sprints.

### The numbers

| Metric | Estimate |
|--------|----------|
| Total items | 23 |
| Platform-wide items (all agents) | 17 |
| Dev-agent-only items | 6 |
| Total effort | 55-75 developer-days |
| Phase 0 effort (ship first) | 3-4 days |
| Expected prompt token cost reduction (from 0C alone) | 40-60% on Anthropic cache hits |
| Agents benefiting from Phase 0-3 | All 16 system agents |

