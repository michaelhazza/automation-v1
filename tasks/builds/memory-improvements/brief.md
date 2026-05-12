# Memory System Improvements — Pre-Spec Brief

**Status:** Draft, for external review
**Date:** 2026-05-12
**Purpose:** Stress-test a set of memory-system improvements before committing to a spec. Each proposal has been vetted against the codebase.

## Table of contents

1. Context
2. Current state — what we already have
3. Proposals
   - Proposal A — Synthesis lineage
   - Proposal B — Citation-rate observability (utility metric)
   - Proposal C — Memory-block candidate pool knob
4. Out of scope — handled by an existing in-flight build
5. Rejected ideas
   - SPO entity graph
   - Single consolidated memory surface
6. Recommended next steps
7. What this brief deliberately does NOT do

---

## 1. Context

Two open-source memory projects (Memvid, Mnemo Cortex) make aggressive claims about beating RAG benchmarks. We audited both and rated them "borrow patterns, do not adopt" — solo-maintainer projects with self-graded benchmarks. The audits did, however, surface four patterns potentially worth lifting:

1. SPO (subject-predicate-object) entity graph alongside vector search, to improve multi-hop recall.
2. A single consolidated "memory surface" in the agent's prompt (Mnemo's `MNEMO-CONTEXT.md` pattern).
3. DAG-style lineage from synthesised memory blocks back to the source entries that produced them.
4. Wider retrieval candidate set before reranking (k=60 instead of our current defaults).

We then ran three parallel deep-dives against `/home/user/automation-v1` to test each idea against the actual code. Findings below.

**Headline:** Two ideas should be rejected (with explicit reasoning so the reviewer can challenge it). One of the surviving ideas (lineage) becomes Proposal A. A new prerequisite — citation-rate observability — becomes Proposal B. A narrow tuning win becomes Proposal C. A fourth area (semantic ranking on the auto-knowledge retrieval path) is **out of scope here** because it is already covered by an in-flight build (`tasks/builds/auto-knowledge-retrieval/`) that has a frozen 875-line spec and a 979-line plan, paused at the chatgpt-plan-review step. That build is being resumed separately; this brief assumes it ships.

---

## 2. Current state — what we already have

Anchoring on what exists, because both external projects sound impressive in a vacuum and look thin against our actual stack.

- **Three-tier memory.** Org memories, workspace memories, named memory blocks. All on Postgres + pgvector with HNSW indexes. Tenant-isolated via RLS.
- **Hybrid retrieval.** Workspace memory uses semantic + full-text CTEs with RRF fusion, over-retrieve at 4× topK, optional Cohere reranker (default off), candidate pool capped at 1000. Memory blocks have two paths: relevance (HNSW, pool=15, topK=5) and auto-knowledge (no embedding ranker — scope-tier scan, 32k token budget).
- **Agent beliefs.** Per-agent key-value facts with `subject`, `value`, predicate-like `beliefKey`, confidence, supersession, `entityKey` for cross-agent conflict detection. Functionally already a degenerate (subject, predicate, value) triple.
- **Workspace entities.** Normalised entity table with temporal validity, supersession, partial unique index on currently-valid rows. Would be the "nodes" of any future graph.
- **Synthesis pipeline.** Weekly clustering job groups workspace memory entries by semantic similarity, scores each cluster, promotes high-confidence clusters to active memory blocks, sends medium-confidence ones to a review queue, passively ages drafts after two cycles.
- **Citation tracking.** Per-run cited entry IDs and applied memory-block citations are persisted (`agent_runs.cited_entry_ids`, `memory_citation_scores` table), but no aggregate metric or dashboard surfaces "% of injected memory actually used."

**Key files** for the external reviewer's reference: `server/services/agentExecutionService.ts` (memory injection lines 1156–1375), `server/services/workspaceMemoryService.ts` (hybrid retrieval), `server/services/memoryBlockService.ts` (relevance path), `server/services/retrievalService.ts` (auto-knowledge path), `server/services/memoryBlockSynthesisService.ts` (clustering job), `server/services/agentBeliefService.ts`, `server/config/limits.ts` (all retrieval constants).

---

## 3. Proposals

### Proposal A — Add lineage from synthesised memory blocks to source entries (RECOMMEND)

**Why.** Today, when the weekly synthesis job clusters 12 workspace entries into a single memory block, the link between the block and those 12 entries is discarded after insert. The `memory_blocks` row only carries `source = 'auto_synthesised'`; there is no array of source entry IDs, no per-version snapshot. An operator cannot answer "where did this block come from?" for any auto-synthesised content.

This is a real, documented gap, not a theoretical one. `docs/universal-brief-dev-brief.md:330` explicitly says: *"memory exists but is opaque — users can't audit what's been learned."* The Trust & Verification Layer build (`tasks/builds/trust-verification-layer/plan.md:988`) is already adding a `Source` pill with values `Correction | Manual | Auto`. Without lineage, the `Auto` case is a dead-end — the pill exists but clicking it answers nothing.

**How.** Add `source_entry_ids uuid[]` to `memory_block_versions` (the immutable-versions table, not the mutable block itself). Populate at the version-insert site inside the synthesis job. Surface via a new admin route `/api/memory-blocks/:id/sources` that hydrates the IDs into a clickable list of source entries, with links through to the run IDs that produced them. Per-version, so future re-syntheses preserve their own cluster — answers "what did v3 know that v4 forgot?"

**Why this shape, not others.** A single column on `memory_blocks` instead of `memory_block_versions` loses history when the block is re-synthesised. A full `memory_block_sources` join table with per-entry weights is overkill for the current evidence of need. The `uuid[]` (rather than a foreign-key with cascade) is deliberate: the nightly decay job soft-deletes low-quality entries, and cascade delete would nuke historical lineage exactly when an auditor needs it most. If even harder durability is wanted, snapshot `{id, contentHash, qualityScore}` as JSONB so the lineage survives entry deletion entirely.

**Scope.** ~80 LOC, one migration, one route, one UI section on the existing `MemoryBlockDetailPage`. No agent-prompt change — lineage is operator-facing only.

**Open questions for the reviewer:**
- Is per-version lineage the right granularity, or do we want a join table for partial-credit re-synthesis (entry X contributed to versions 3, 4, and 6)?
- Should we backfill lineage for historical blocks (impossible — the clusters were never persisted) or accept that lineage starts from the migration forward?
- Do we want the agent itself to see source entries (currently no — would bloat the prompt)? If so, only on explicit `cite_sources` tool call, not by default.

---

### Proposal B — Citation-rate observability — utility metric (RECOMMEND)

**Why.** Every retrieval-quality decision we'd want to make — should we widen k, turn on the reranker by default, change synthesis thresholds — depends on a feedback signal we don't currently surface. We persist per-run citation data already (`agent_runs.cited_entry_ids`, `agent_runs.applied_memory_block_citations`, `memory_citation_scores`). What's missing is the aggregate question: of the memory we inject into prompts, what percentage is actually used by the agent?

This was flagged in `KNOWLEDGE.md` §236 ("no dashboard for % of injected entries actually cited in run over last 30 days") and never built. Without it, every retrieval change is unfalsifiable — we can ship "improvements" indefinitely with no way to know if they helped.

**Why this is NOT a duplicate of `auto-knowledge-retrieval` §11.** That spec's observability surfaces (loaded / rejected events, "loaded in N of last 30 runs" relevance bar, per-document attribution) measure retrieval **coverage** — *which* documents were chosen at retrieval time and why. Proposal B measures retrieval **utility** — of the entries we did inject, how many did the agent actually use in its output? Coverage and utility share the same data substrate (`agent_execution_events`, `memory_citation_scores`) but answer different questions. A document can have 100% coverage and 0% utility — pinned but ignored — and §11 alone will not surface that. The two metrics are complementary; this brief assumes §11 ships and adds the utility layer on top.

**How.** Background job that aggregates over the last N days per workspace/agent: `cited_entry_count / injected_entry_count`. Same for memory blocks. Surface on the existing admin observability page with two charts and a per-agent breakdown. No new tables — derived view over `agent_runs`, `memory_citation_scores`, and the `retrieval.summary` events emitted by the auto-knowledge-retrieval build.

**Sequencing.** Build B after auto-knowledge-retrieval Phase 4 ships, because Phase 4 is what wires `retrieval.summary` event emission. Before that, B can only see the legacy `applied_memory_block_citations` data — useful but partial. Ordering: AKR Phase 4 → Proposal B.

**Scope.** ~150 LOC, one new view or materialised view, one chart component, optional weekly rollup.

**Open questions:**
- Aggregate rolling window — 30d, 7d, both?
- Per-agent or only per-workspace? (Per-agent reveals more but more noise on low-volume agents.)
- Citation detection is heuristic today (`memoryCitationDetector.ts`). Should we audit its accuracy before building the rollup, so we know what signal-to-noise we're aggregating?
- Does the auto-knowledge-retrieval team want utility as a built-in chart on their telemetry surfaces, or kept as a separate dashboard?

---

### Proposal C — Promote memory-block retrieval candidate pool to an env knob (RECOMMEND, low cost)

**Why.** The memory-block relevance path retrieves `poolSize = topK * 3 = 15` candidates before applying token-budget eviction and emitting topK=5 to the prompt. The pool of 15 is hardcoded in `memoryBlockService.ts:177,199`. The Cohere reranker (when on) can score 100 docs per call for the same price as 5. Going from a pool of 15 to 30–60 costs sub-millisecond on the HNSW pull and zero on rerank, but materially widens what's available for ranking.

The original Memvid borrow idea ("k=60 then rerank") doesn't translate cleanly — our workspace-memory hybrid path already over-retrieves at 4×, with a 1000-row candidate ceiling, which is plenty. The actual narrow surface is the memory-blocks relevance path, which is the one we'd want to tune.

**How.** Promote `BLOCK_RELEVANCE_TOP_K` and the `* 3` pool multiplier to `MEMORY_BLOCK_POOL_MULTIPLIER` (env-overridable, default 3). Keep `RRF_OVER_RETRIEVE_MULTIPLIER` in the same shape. No flag-day change; tenants can opt into wider pools.

**Caveats from the audit.**
- Widening only helps if recall is the bottleneck. Without Proposal B (citation rate) we can't verify it is.
- The dominance gate in `workspaceMemoryService.ts:441-447` short-circuits the reranker when top-two scores are close, so wider candidates only matter when the result set is ambiguous. This is desired behaviour but limits the upside.
- The hard `MAX_MEMORY_SCAN = 1000` pool ceiling means widening past ~250 has diminishing returns. We are nowhere near that today.

**Scope.** ~20 LOC, no migration, env-var addition.

**Open questions:**
- Should this be per-tenant (column on the workspace settings table) rather than global env?
- Should we widen the auto-knowledge memory-block path too, or keep that as a separate proposal?

---

---

## 4. Out of scope — handled by an existing in-flight build

During the retrieval-width audit, the deepest finding was unexpected: `retrievalService.assembleKnowledgeForRun` — the path that injects memory blocks and reference-document chunks into every agent run — **has no semantic ranking at all**. It scans every in-scope active block / chunk, scores them all at zero, sorts by scope-tier and recency, and fills the 32k token budget. Reference-document chunks have HNSW embedding columns; they are not used in this path. The comment in the code (`retrievalService.ts:22`) describes it as "v1 simplification: no query embedding available at run time."

This is a much bigger lever than any of the borrow ideas from Memvid / Mnemo. It is also **already addressed by an existing in-flight build** that this brief does not duplicate:

- **Build:** `tasks/builds/auto-knowledge-retrieval/`
- **Spec:** 875 lines, frozen at commit `8a44844c`, chatgpt-spec-review complete (9 findings resolved, round 2 declined).
- **Plan:** 979 lines, 25 chunks across 7 phases (schema + RLS, pure ranker, ingestion jobs, cutover + observability, three UI phases).
- **Status:** Phase 2 Step 4 paused — *awaiting operator decision on chatgpt-plan-review*. One operator decision from execution.
- **Scope covers:** shared retrieval engine, chunked-embedding model for documents, Auto / Always-available / Reference-only modes (replacing eager / lazy), org + recurring-task scopes, **retrieval observability as an operator product** (§11 of that spec), hard tenant-isolation invariants (filtering before semantic retrieval).

This brief assumes the auto-knowledge-retrieval build resumes and ships. Proposals A, B, and C are scoped to be additive to that work, not in competition with it:

- **Proposal A (synthesis lineage)** is orthogonal — it concerns memory-block synthesis history, not document retrieval.
- **Proposal B (citation-rate utility metric)** explicitly sequences *after* AKR Phase 4 (the phase that emits `retrieval.summary` events), and measures a different question (utility vs. coverage; see Proposal B body).
- **Proposal C (memory-block pool knob)** tunes the existing `memoryBlockService` relevance path, which AKR's shared retrieval engine will subsume eventually — but the knob is a 20-LOC change that lands value today and degrades gracefully when AKR's ranker takes over.

**Open question for the reviewer.** Are these three proposals genuinely additive, or does any of them better fold into the AKR build itself? Our reading is that they are additive; pressure-test it.

---

## 5. Rejected ideas (from the original four borrow candidates)

Documented explicitly so the reviewer can challenge the rejection if the reasoning is wrong.

### Rejected — SPO entity graph for multi-hop retrieval

**Why we rejected.**
1. **No user pain signal.** Searched 90+ build slugs, `tasks/todo.md`, and `KNOWLEDGE.md` for any complaint about multi-hop retrieval, connecting entities, or joining across memory rows. Zero hits. This is a marketing-driven idea, not a feedback-driven one.
2. **A prior internal audit already rejected it.** `docs/ai-agent-repo-research-report.md:316-326` explicitly concluded *"The graph layer (Neo4j) adds infrastructure complexity not yet justified."* That is a standing decision, not a fresh question.
3. **Our existing belief layer is already ~80% of the value.** `agent_beliefs` already stores (subject, predicate, value) triples with confidence, supersession, and entity-key cross-references. Memvid's multi-hop edge is more plausibly explained by query decomposition at retrieval time (re-querying with entities surfaced from the first pass) than by the storage format. That can be prototyped in `retrievalServicePure.ts` with no schema change if we ever want to test the hypothesis.
4. **Cheaper alternative exists.** If multi-hop becomes a real complaint, the smaller win is to make `agent_beliefs.value` foreign-key to `workspace_entities` when it parses as a known entity. Most of the multi-hop benefit, no parallel extraction pipeline.

**When to revisit.** Multi-hop becomes a complaint backed by measurement (Proposal B), AND the query-decomposition prototype proves insufficient.

---

### Rejected — Single consolidated memory surface (Mnemo's MNEMO-CONTEXT.md pattern)

**Why we rejected.**
1. **Our injection is already structured, with intent.** Memory is split across six sections (`## Shared Context`, `## Your Briefing`, `## Your Beliefs`, `## Workspace Memory`, `## Known Workspace Entities`, subaccount state). The split is not accidental.
2. **The split is load-bearing for prompt caching.** `agentExecutionService.ts:1254-1257` deliberately separates a stable prefix (memory blocks, briefing) from a dynamic suffix (workspace memory, beliefs). Collapsing them invalidates the prefix cache on every entry write — a real cost increase for zero measurable benefit.
3. **The split is load-bearing for prompt-injection defence.** `workspaceMemoryService.ts:1213-1223` wraps workspace-memory content in `MEMORY_BOUNDARY_START / END` markers specifically because that content is operator-untrusted user data, while `## Shared Context` is operator-authored configuration. Merging them removes a security boundary.

Mnemo's MNEMO-CONTEXT pattern works for a solo-developer's single agent with no caching pipeline and no injection threat model. It is the wrong pattern for a multi-tenant SaaS.

**When to revisit.** Never — unless the cache or injection-defence reasoning above turns out to be wrong, in which case we have a bigger problem to fix first.

---

## 6. Recommended next steps

1. **External reviewer reads this brief.** Specifically pressure-test the rejections in §5 (those are the most likely to be wrong), the scope choices for Proposals A and C, and the additivity claim in §4 (that A/B/C don't fold into the AKR build).
2. **Resume `auto-knowledge-retrieval` separately.** Operator decision on chatgpt-plan-review unblocks Phase 2 step 4 and the remaining 25 chunks.
3. **Proposals A and C ship independently** of AKR — different files, different surfaces, no shared cutover risk. Either can land first.
4. **Proposal B sequences after AKR Phase 4** so the utility metric can consume the `retrieval.summary` event stream that phase emits. Until then, B can ship a partial version on the legacy `applied_memory_block_citations` data if there's appetite for early signal.
5. Two months after A, B, and AKR land, **check the citation-rate dashboard.** If memory injection is well-utilised, we're done; if not, the dashboard tells us where to look next (and gives us a measurable baseline for any further change).

---

## 7. What this brief deliberately does NOT do

- **No tech spec.** Schema columns, API shapes, and UI mockups are sketched only where needed for the reviewer to judge feasibility. Final shapes come in the spec phase.
- **No re-scoping of `auto-knowledge-retrieval`.** That build is treated as a given. If the operator's investigation of why it stalled reveals that the spec needs amendment, this brief's Proposal B sequencing assumption may need to be revisited — but the AKR spec itself is not in scope here.
- **No promises about benchmark numbers.** The external projects we audited made specific claims (+35%, +76%, +56%) that did not survive scrutiny. We are deliberately not stating equivalent numbers for our own changes because we don't have a benchmark harness to measure them on. Proposal B is the first step toward having one.

