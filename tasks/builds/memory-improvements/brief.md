# Memory System Improvements — Pre-Spec Brief

**Status:** Draft, for external review
**Revision:** 2 (corrects Rev 1's incorrect claim that auto-knowledge-retrieval was paused mid-pipeline)
**Date:** 2026-05-12
**Purpose:** Stress-test a set of memory-system improvements before committing to a spec. Each proposal has been vetted against the codebase.

## Table of contents

1. Context and the AKR correction
2. Current state — what is actually shipped today
3. Proposals
   - Proposal A — Synthesis lineage on memory-block versions
   - Proposal B — Citation-rate utility metric
   - Proposal C — Memory-block candidate-pool knob
   - Proposal D — Semantic ranker for the auto-knowledge retrieval path
4. Rejected ideas
   - SPO entity graph
   - Single consolidated memory surface
5. Recommended next steps
6. What this brief deliberately does NOT do

---

## 1. Context and the AKR correction

We audited two open-source memory projects (Memvid, Mnemo Cortex) that claim to beat RAG benchmarks. Both rated as "borrow patterns, do not adopt" — solo-maintainer projects with self-graded numbers. The audits did, however, surface four patterns worth testing against our own code:

1. SPO (subject-predicate-object) entity graph alongside vector search, for multi-hop recall.
2. A single consolidated "memory surface" in the agent's prompt (Mnemo's `MNEMO-CONTEXT.md` pattern).
3. DAG-style lineage from synthesised memory blocks back to source entries.
4. Wider retrieval candidate set before reranking.

Three parallel codebase deep-dives ran against `/home/user/automation-v1` to vet each idea.

**The AKR correction.** An earlier revision of this brief assumed the `auto-knowledge-retrieval` build was paused mid-pipeline (Phase 2, awaiting plan-review). That was wrong. AKR merged on 2026-05-08 (PR #274, commit `b1c4d14`). The stale signal came from `tasks/builds/auto-knowledge-retrieval/progress.md`, which was never updated past Phase 2 step 4. All AKR files are present in `server/services/` and the pipeline is wired into agent runs.

**The surprise that came with the correction.** AKR shipped without the semantic ranker. `server/services/retrievalService.ts:19-21` says verbatim: *"v1 simplification: no query embedding available at run time. Use threshold=0 (all eligible chunks pass)."* Lines 197 and 276 set `finalScore: 0` for every candidate. The function is wired live to agent runs at `agentExecutionService.ts:919-920`. In production today, auto-knowledge retrieval is scope-tier + recency + token-budget cap — no semantic ranking. The "v1 simplification" became the production behaviour.

This changes the recommendation set. Of the four borrow ideas:

- Two are rejected with reasoning the reviewer can challenge (SPO graph, consolidated memory surface).
- One survives as **Proposal A** (synthesis lineage).
- The "wider k" idea narrows to **Proposal C** (memory-block pool knob), because that's where the actual narrow surface is.

Two additional proposals emerge from the audits and the correction:

- **Proposal B** — citation-rate utility metric, the feedback signal we need to know whether any of this is working.
- **Proposal D** — finish the AKR semantic ranker. The single biggest retrieval-quality lever in the codebase. The AKR build deferred it explicitly; the deferral lived through merge into production.

All four proposals are scoped to be additive to what AKR already shipped (chunked embeddings, scoping modes, observability scaffolding, Files/Documents UI), not in competition with it.

---

## 2. Current state — what is actually shipped today

Anchoring on what exists in production, because both external projects sound impressive in a vacuum and look thin against our actual stack — but also because AKR's shipped behaviour diverges from its spec in important ways the reviewer needs to see.

### 2.1 Memory storage and retrieval

- **Three-tier memory.** Org memories, workspace memories, named memory blocks. All on Postgres + pgvector with HNSW indexes. Tenant-isolated via RLS.
- **Workspace-memory retrieval (hybrid).** Semantic + full-text CTEs with RRF fusion, over-retrieve at 4× topK, optional Cohere reranker (default off), candidate pool capped at 1000. This is the only retrieval surface in the codebase with real semantic ranking today.
- **Memory-block retrieval (relevance path).** `memoryBlockService.getRelevantBlocks` — HNSW pull, `poolSize = topK * 3 = 15`, topK=5, threshold 0.65, token-budget eviction at 4000 tokens. Hardcoded constants in `memoryBlockService.ts:177,199`.
- **Auto-knowledge retrieval (`assembleKnowledgeForRun`).** Shipped via AKR. Loads all in-scope active memory blocks + reference-document chunks for the run. **No query embedding. All candidates pass at `finalScore = 0`.** Ranking is scope-tier → updated_at → ID. Token-budget cap at 32k. This is the path called from every agent run.
- **Agent beliefs.** Per-agent key-value facts with `subject`, `value`, predicate-like `beliefKey`, confidence, supersession, `entityKey` for cross-agent conflict detection. Functionally already a degenerate (subject, predicate, value) triple.
- **Workspace entities.** Normalised entity table with temporal validity, supersession, partial unique index on currently-valid rows. Would be the "nodes" of any future graph.

### 2.2 AKR — shipped scope vs. spec scope

AKR's spec described seven phases. What actually shipped:

| Spec area | Shipped? |
|---|---|
| Schema + RLS foundation (Phase 1) | Yes — all tables and policies in production. |
| Document chunking + chunked embeddings (Phase 2/3) | Yes — `documentChunkingServicePure.ts`, `documentEmbeddingService.ts`. |
| Document summarisation + re-embedding jobs (Phase 3) | Yes — `documentSummariseService.ts`. |
| Mode resolver (Auto / Always-available / Reference-only) | Yes. |
| Org + recurring-task scope tiers | Yes. |
| **Semantic ranker on `assembleKnowledgeForRun`** | **No.** "v1 simplification": threshold=0, finalScore=0 for all candidates. |
| Files / Documents UI tabs + promotion flow | Yes. |
| Retrieval observability — payload truncation + degraded reasons + always-available capacity warnings | Yes — `retrievalObservabilityService.ts` (83 LOC) + Pure (64 LOC). |
| Retrieval observability — coverage metrics ("loaded in N of last 30 runs") | **No.** Spec §11 described this; production code does not emit it. |
| Retrieval observability — utility metric (% of injected memory cited) | **No.** Never in the spec; absence flagged in `KNOWLEDGE.md` §236. |

The reviewer should treat AKR as a partial ship. The scaffolding is in production; the ranker that gives the scaffolding meaning is not.

### 2.3 Synthesis pipeline

Weekly clustering job (`memoryBlockSynthesisService.ts`) groups workspace memory entries by semantic similarity, scores each cluster, promotes high-confidence clusters to active memory blocks, sends medium-confidence ones to a review queue, passively ages drafts after two cycles. Cluster membership is discarded after the block is inserted — no lineage column exists.

### 2.4 Citation tracking

Per-run citation data is persisted (`agent_runs.cited_entry_ids`, `agent_runs.applied_memory_block_citations`, `memory_citation_scores`), but no aggregate metric or dashboard surfaces "% of injected memory actually used." Heuristic detector at `memoryCitationDetector.ts`.

### 2.5 Key files for the reviewer

`server/services/agentExecutionService.ts` (memory injection lines 1156–1375; AKR call at 919–920), `server/services/retrievalService.ts` (the punted ranker), `server/services/retrievalServicePure.ts`, `server/services/retrievalObservabilityService.ts`, `server/services/workspaceMemoryService.ts` (hybrid retrieval), `server/services/memoryBlockService.ts` (relevance path), `server/services/memoryBlockSynthesisService.ts` (clustering job), `server/services/agentBeliefService.ts`, `server/config/limits.ts`.

---

## 3. Proposals

### Proposal A — Synthesis lineage on memory-block versions (RECOMMEND)

**Why.** Today, when the weekly synthesis job clusters 12 workspace entries into a single memory block, the link between the block and those 12 entries is discarded after insert. The `memory_blocks` row only carries `source = 'auto_synthesised'`; there is no array of source entry IDs, no per-version snapshot. An operator cannot answer "where did this block come from?" for any auto-synthesised content.

This is a real, documented gap. `docs/universal-brief-dev-brief.md:330` says: *"memory exists but is opaque — users can't audit what's been learned."* The Trust & Verification Layer build (`tasks/builds/trust-verification-layer/plan.md:988`) is already adding a `Source` pill with values `Correction | Manual | Auto`. Without lineage, the `Auto` case is a dead-end — the pill exists but clicking it answers nothing.

**How.** Add `source_entry_ids uuid[]` to `memory_block_versions` (the immutable-versions table, not the mutable block itself). Populate at the version-insert site inside `memoryBlockSynthesisService.ts:195-206`. Surface via a new admin route `/api/memory-blocks/:id/sources` that hydrates the IDs into a clickable list of source entries, with links through to the run IDs that produced them. Per-version, so future re-syntheses preserve their own cluster.

**Why this shape, not others.** A single column on `memory_blocks` instead of `memory_block_versions` loses history when the block is re-synthesised. A full `memory_block_sources` join table with per-entry weights is overkill for the current evidence of need. The `uuid[]` (rather than a foreign key with cascade) is deliberate: the nightly decay job soft-deletes low-quality entries, and cascade delete would nuke historical lineage exactly when an auditor needs it most. If even harder durability is wanted, snapshot `{id, contentHash, qualityScore}` as JSONB so the lineage survives entry deletion entirely.

**Scope.** ~80 LOC, one migration, one admin route, one UI section on the existing `MemoryBlockDetailPage`. No agent-prompt change — lineage is operator-facing only.

**Why now, not later.** The Trust & Verification Layer pill is the trigger. If we ship that pill without lineage behind the `Auto` case, we ship a dead-end UX. Cheaper to add lineage now (one migration) than to retrofit when operators start clicking and find nothing.

**Open questions for the reviewer:**
- Per-version lineage vs. join table — is the audit question only "which entries → this block" (per-version is fine) or also "which versions did this entry contribute to" (needs join table)?
- Should we backfill historical blocks? Cannot — the clusters were never persisted. Acceptable to start from migration forward?
- Should the agent itself see source entries? Default no (prompt bloat); reconsider only if a `cite_sources` tool call wants it.

---

### Proposal B — Citation-rate utility metric (RECOMMEND)

**Why.** Every retrieval-quality decision we'd want to make — should we widen k, turn on the reranker by default, change synthesis thresholds, ship the Proposal D semantic ranker — depends on a feedback signal we don't currently surface. We persist per-run citation data (`agent_runs.cited_entry_ids`, `agent_runs.applied_memory_block_citations`, `memory_citation_scores`). What's missing is the aggregate question: of the memory we inject into prompts, what percentage is actually used by the agent?

`KNOWLEDGE.md` §236 flagged this explicitly and it was never built. Without it, every retrieval change is unfalsifiable — we can ship "improvements" indefinitely with no way to know if they helped.

**Why this is NOT a duplicate of AKR's observability.** AKR shipped `retrievalObservabilityService` (147 LOC across both files). What it actually emits in production: payload truncation, degraded-reason builders, and always-available capacity warnings (30 docs / 30k tokens). It does **not** emit per-document coverage ("loaded in N of last 30 runs") even though §11 of the AKR spec described it. It does **not** emit any utility metric. The reviewer should treat utility and coverage as separate questions: *coverage* answers "which memory got loaded into the prompt?" — *utility* answers "of what got loaded, how much did the agent actually use?" Coverage belongs as an extension of the existing `retrievalObservabilityService` (same code-owner, same event substrate). Utility is what this proposal adds.

**How.** Background rollup job over the last N days, per workspace and per agent: `cited_entry_count / injected_entry_count` for workspace-memory entries, and equivalent for memory blocks. Surface on the existing admin observability page with two charts (one per category) and a per-agent breakdown. Derived from `agent_runs` + `memory_citation_scores`; no new tables. Heuristic detector accuracy (`memoryCitationDetector.ts`) is a known limitation but acceptable for a directional metric.

**Why this matters for Proposal D.** Proposal D (semantic ranker) needs a measurable success criterion. Without B, we cannot tell whether the ranker improves things or makes them worse. Ship B first or in parallel; do not ship D without it.

**Scope.** ~150 LOC, one new materialised view (refresh nightly), one chart component, one rollup job.

**Caveats.**
- Citation detection is heuristic. False negatives (agent uses memory but doesn't phrase it as a citation) understate utility. False positives (agent paraphrases something coincidentally) overstate it. The metric is directional, not absolute.
- Per-agent breakdowns get noisy on low-volume agents. Consider a minimum-runs gate before surfacing per-agent numbers.

**Open questions:**
- Window — 30 days, 7 days, both? 30d is more stable; 7d catches regressions faster.
- Per-agent + per-workspace, or only per-workspace?
- Should we also audit `memoryCitationDetector.ts` accuracy before shipping B, so the reviewer knows the signal-to-noise floor?

---

### Proposal C — Memory-block candidate-pool size promoted to env knob (RECOMMEND)

**Why.** The memory-block relevance path (`memoryBlockService.getRelevantBlocks`) retrieves `poolSize = topK * 3 = 15` candidates before applying token-budget eviction and emitting topK=5 to the prompt. The pool of 15 is hardcoded at `memoryBlockService.ts:177,199`. The Cohere reranker (when enabled) prices the same for 5 or 100 candidates per call. Going from a pool of 15 to 30–60 costs sub-millisecond on the HNSW pull and zero on rerank.

The original Memvid borrow idea ("k=60 then rerank") does not translate cleanly to our other retrieval surfaces. Workspace memory already over-retrieves at 4× with a 1000-row candidate ceiling — plenty of headroom. The AKR auto-knowledge path is not a "pool size" problem because it has no semantic ranker (see Proposal D). The actual narrow surface in the codebase is the memory-block relevance path.

**How.** Promote `BLOCK_RELEVANCE_TOP_K` and the `* 3` multiplier in `memoryBlockService.ts:177` to env-overridable constants (`MEMORY_BLOCK_POOL_MULTIPLIER`, default 3). Add the multiplier to `server/config/limits.ts` so the value lives next to the other retrieval knobs. No flag-day change; default unchanged.

**Caveats.**
- Widening only helps if recall is the bottleneck. Without Proposal B, we cannot verify it is. Treat C as a knob to turn after B's dashboard tells us recall is the lever to pull.
- The dominance gate in `workspaceMemoryService.ts:441-447` short-circuits the reranker when top-two scores are close. Widening matters most when the result set is ambiguous; that gate limits the upside.
- The `MAX_MEMORY_SCAN = 1000` candidate-pool ceiling means widening past ~250 has diminishing returns. We are nowhere near that today.

**Scope.** ~20 LOC, no migration. Trivial.

**Open questions:**
- Should this be per-tenant (column on a workspace-settings table) rather than a global env? Per-tenant is more aligned with how the rest of the stack handles tunables.
- Should we widen the AKR auto-knowledge path too? No — that path has no semantic ranker; widening it would just load more zero-scored candidates into the budget cap. The right fix for that path is Proposal D.

---

### Proposal D — Semantic ranker for the auto-knowledge retrieval path (RECOMMEND, highest leverage)

**Why.** AKR shipped, but the `assembleKnowledgeForRun` function — wired live into every agent run at `agentExecutionService.ts:919-920` — has no semantic ranking. `retrievalService.ts:19-21` explicitly says: *"v1 simplification: no query embedding available at run time. Use threshold=0 (all eligible chunks pass)."* Lines 197 and 276 set `finalScore: 0` for every retrieved chunk. The AKR spec described this as a v1 simplification with a v2 follow-up implied; v2 did not happen, and the simplification is now production behaviour.

This is the single biggest retrieval-quality lever in the codebase. The infrastructure to support semantic ranking is already shipped — chunked embeddings, observability scaffolding, scoping modes, pure ranker scaffold (`retrievalServicePure.ts`). What is missing is **the query embedding at retrieval time and a non-zero threshold.** Everything downstream of those two inputs already works.

**How.** Three pieces of work, all small:

1. **Define the query.** At the moment `assembleKnowledgeForRun(runId)` is called, the run has: agent ID, task description (the run's input prompt or task message), agent master prompt, and active workspace context. The natural query is the **task description** because that captures intent for this specific run; the agent master prompt is too generic (every run for that agent retrieves the same set) and conversation history is too noisy. Embed the task description with the same model used for chunk embeddings (`text-embedding-3-small`, 1536 dims) and pass the vector into `retrievalServicePure.scoreCandidates`.

2. **Compute a real `finalScore`.** Replace the `finalScore: 0` literals at `retrievalService.ts:197,276` with cosine similarity between the query embedding and each candidate's chunk embedding. The downstream `retrievalServicePure.rankAndBudget` function already handles threshold filtering, budget capping, and rejection-reason emission; it just needs a real score to filter on.

3. **Set a threshold.** AKR's pure ranker already accepts a `threshold` parameter that is currently always `V1_RETRIEVAL_THRESHOLD = 0`. Set a starting threshold via env (`AKR_RETRIEVAL_THRESHOLD`, default ~0.30 based on `text-embedding-3-small` cosine-distance norms). Tune from the citation-rate dashboard once Proposal B ships.

**Why this is a real follow-up to AKR and not a new build.** Everything except those three pieces is already in production. The pure ranker (`retrievalServicePure.ts:38-91`) has the comparator chain, threshold logic, budget loop, and rejection-reason emission. The observability service emits the truncated payload contract. The schema, indexes, modes, ingestion jobs, UI tabs, and tenant-isolation invariants are live. We are completing a deliberate v1 simplification, not designing a new system.

**Cost.**
- One OpenAI embedding call per agent run (~$0.00002 at `text-embedding-3-small` pricing). Negligible.
- ~50 LOC of new code (query construction, embedding call, score wiring). The threshold is a constant.
- Risk profile is moderate: changing the production retrieval scoring function for every agent run. Mitigated by:
  - Threshold defaulting to a permissive value (~0.30) so the change is additive in v2 mode (less loaded), not subtractive (more loaded).
  - Feature-flag the cutover (`AKR_SEMANTIC_RANKER_ENABLED`, default false on first deploy; flip per-tenant or globally after observing citation-rate impact).
  - Proposal B's utility metric provides the rollback signal — if citation rate drops, revert the flag.

**What this does NOT do.**
- No re-ranking layer (Cohere or LLM). Pure cosine, consistent with AKR spec §1.2 ("no cross-encoder re-ranking. Pure cosine for v1.").
- No version-aware retrieval (continues to retrieve the latest version of each document, per AKR spec §1.2).
- No backfill of historical chunks — they are already embedded as part of AKR's ingestion pipeline.
- No new UI. Operator-facing surfaces stay the same; the agent prompt continues to receive what the budget allows, just from a higher-quality candidate set.

**Sequencing.** Proposal D depends on Proposal B (citation-rate utility metric) only for the success criterion and rollback signal. They can be built in parallel; D must not ship without B's dashboard live for at least a week first.

**Open questions for the reviewer:**
- Query definition — is "task description" the right choice over "task description + conversation summary" or "task description + agent master prompt summary"? Combining inputs is plausible; the trade-off is signal-to-noise and embedding cost (per-component embeddings, then weighted average vs. concatenated single embedding).
- Threshold starting point — 0.30 is a guess based on `text-embedding-3-small` norms. Worth validating against a sample of production runs before defaulting.
- Feature-flag scope — global, per-tenant, or per-agent? Per-tenant is the natural compromise (operator opt-in, blast radius bounded).
- Should we revisit the AKR spec §1.2 "no cross-encoder re-ranking" stance once D ships? Cohere rerank-v3.5 is already in the codebase for workspace-memory retrieval (`server/lib/reranker.ts`); reusing it on the AKR path is a one-line plumbing change once cosine ranking is live. Defer the decision until citation-rate data is in.
- Is D big enough to be its own spec rather than a section of this brief? Recommend: yes if the reviewer pressure-tests it and finds open design questions in the "query definition" axis; no if the task-description approach is accepted.

---

## 4. Rejected ideas

Documented explicitly so the reviewer can challenge the rejection if the reasoning is wrong.

### Rejected — SPO entity graph for multi-hop retrieval

**Why we rejected.**
1. **No user pain signal.** Searched 90+ build slugs, `tasks/todo.md`, and `KNOWLEDGE.md` for any complaint about multi-hop retrieval, connecting entities, or joining across memory rows. Zero hits. This is a marketing-driven idea, not a feedback-driven one.
2. **A prior internal audit already rejected it.** `docs/ai-agent-repo-research-report.md:316-326` explicitly concluded *"The graph layer (Neo4j) adds infrastructure complexity not yet justified."* That is a standing decision, not a fresh question.
3. **Our existing belief layer is already ~80% of the value.** `agent_beliefs` already stores (subject, predicate, value) triples with confidence, supersession, and entity-key cross-references. Memvid's multi-hop edge is more plausibly explained by query decomposition at retrieval time (re-querying with entities surfaced from the first pass) than by the storage format. That can be prototyped in `retrievalServicePure.ts` with no schema change if we ever want to test the hypothesis.
4. **Cheaper alternative exists.** If multi-hop becomes a real complaint, the smaller win is to make `agent_beliefs.value` foreign-key to `workspace_entities` when it parses as a known entity. Most of the multi-hop benefit, no parallel extraction pipeline.

**When to revisit.** Multi-hop becomes a complaint backed by measurement (Proposal B's utility metric drops on multi-hop-shaped tasks), AND the query-decomposition prototype proves insufficient.

---

### Rejected — Single consolidated memory surface (Mnemo's MNEMO-CONTEXT.md pattern)

**Why we rejected.**
1. **Our injection is already structured, with intent.** Memory is split across six sections (`## Shared Context`, `## Your Briefing`, `## Your Beliefs`, `## Workspace Memory`, `## Known Workspace Entities`, subaccount state). The split is not accidental.
2. **The split is load-bearing for prompt caching.** `agentExecutionService.ts:1254-1257` deliberately separates a stable prefix (memory blocks, briefing) from a dynamic suffix (workspace memory, beliefs). Collapsing them invalidates the prefix cache on every entry write — a real cost increase for zero measurable benefit.
3. **The split is load-bearing for prompt-injection defence.** `workspaceMemoryService.ts:1213-1223` wraps workspace-memory content in `MEMORY_BOUNDARY_START / END` markers specifically because that content is operator-untrusted user data, while `## Shared Context` is operator-authored configuration. Merging them removes a security boundary.

Mnemo's MNEMO-CONTEXT pattern works for a solo-developer's single agent with no caching pipeline and no injection threat model. It is the wrong pattern for a multi-tenant SaaS.

**When to revisit.** Never — unless the cache or injection-defence reasoning above turns out to be wrong, in which case we have a bigger problem to fix first.

---

## 5. Recommended next steps

1. **External reviewer reads this brief.** The most likely places to be wrong are: the rejections in §4, the threshold-tuning starting point in Proposal D, the "task description" choice for the query embedding in D, and the per-version-vs-join-table shape choice in A. Pressure-test those.
2. **Proposal A and Proposal C can ship independently.** Different files, different surfaces, no shared cutover risk. Either can land first. Both are <100 LOC.
3. **Proposal B ships before Proposal D, or in parallel.** D must not ship without B's dashboard live for at least a week first — otherwise we have no rollback signal.
4. **Proposal D is the highest-leverage change.** It completes a deliberate v1 simplification in AKR, with infrastructure already in production. Scope is small (~50 LOC behind a feature flag); risk is moderate (production retrieval scoring change).
5. **Two months after A, B, C, and D land, check the citation-rate dashboard.** If memory utility is consistently high (say >50% of injected entries cited), we are done. If not, the dashboard tells us where to look next — and gives us a measurable baseline for any further change.

---

## 6. What this brief deliberately does NOT do

- **No tech spec.** Schema columns, API shapes, and UI mockups are sketched only where needed for the reviewer to judge feasibility. Final shapes come in the spec phase. Proposal D in particular may warrant its own spec if the reviewer surfaces design questions on the query-definition axis.
- **No re-opening of AKR's design choices already shipped.** Scope-tier ranking, the Auto / Always-available / Reference-only modes, the chunked-embedding model, and the pure-cosine "no cross-encoder" stance are all in production. Proposal D completes AKR's deferred semantic ranker without revisiting those choices. The reranking question is flagged as a follow-up open question, not a re-opening.
- **No promises about benchmark numbers.** The external projects we audited made specific claims (+35%, +76%, +56%) that did not survive scrutiny. We are deliberately not stating equivalent numbers for our own changes because we don't have a benchmark harness to measure them on. Proposal B's utility metric is the first step toward having one.
- **No commitment to a graph layer or alternative storage.** Both rejected ideas in §4 stay rejected unless a measurable user-facing problem surfaces. The cost of revisiting that decision is one good piece of evidence; the cost of building either is months of engineering. Asymmetric.
