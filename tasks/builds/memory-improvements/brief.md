# Memory System Improvements — Pre-Spec Brief

**Status:** **LOCKED** for spec handoff (Rev 6.1 — outstanding open questions resolved by author, all favouring minimum UI)
**Revision:** 6.1 (resolved open questions in A and B in favour of minimum UI: no edit/view-source cross-links on Sources tab; 30d window only on Memory Utility; pre-migration exclusion surfaced as one caveat-banner line, not a new visual element)
**Date:** 2026-05-12
**Spec-handoff non-negotiables** (Rev 6 simplified): B1 must add `injected_entry_ids` before entry utility is reported. B1 aggregate queries must distinguish "not measured" from "0% utility" for pre-migration runs. D ships behind a single env on/off flag (no user-facing UI, no four-mode rollout). **D-Recall invariant:** semantic filtering must never silently empty a previously non-empty candidate category. **D-Embedding-failure invariant:** OpenAI failures fail open to legacy retrieval and emit a degraded reason on the run trace; they must not block agent execution. A must use the join table unless the spec explicitly rejects bidirectional lineage; lineage row retains deletion-safe snapshot metadata even when `source_entry_id` becomes NULL.
**Purpose:** Stress-test a set of memory-system improvements before committing to a spec. Each proposal has been vetted against the codebase.

## Table of contents

1. Context and the AKR correction
2. Current state — what is actually shipped today
3. Proposals
   - Proposal A — Synthesis lineage on memory-block versions
   - Proposal B — Citation-rate utility (B1 measurement substrate + B2 operator dashboard)
   - Proposal D — Semantic ranker for the auto-knowledge retrieval path
4. Brief-level invariants (applied across all proposals)
5. UI surfaces affected (mockups)
6. Rejected ideas
   - SPO entity graph
   - Single consolidated memory surface
7. Recommended next steps
8. What this brief deliberately does NOT do
9. Opportunistic cleanup discovered during review

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

All three strategic proposals, plus the opportunistic cleanup item in §9, are scoped to be additive to what AKR already shipped (chunked embeddings, scoping modes, observability scaffolding, Files/Documents UI), not in competition with it.

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

**How.** Add a `memory_block_version_sources` join table. **Required columns** (locked by the A-Deletion invariant in §4): `block_version_id`, `source_entry_id` (nullable FK, `ON DELETE SET NULL`), `source_entry_id_hash`, `content_hash`, `source_type`, `captured_at`, `quality_score_at_capture`, `contribution_rank`. `snapshot_excerpt` is **out of scope for v1** per the A-Deletion invariant. Populate at the version-insert site inside `memoryBlockSynthesisService.ts:195-206`. Surface via a new admin route `/api/memory-blocks/:id/sources` that joins through to source entries (or surfaces snapshot metadata when the source row is null) and the runs that produced them. Per-version, so future re-syntheses preserve their own cluster.

**Why a join table is now the default (revised per reviewer F4).** Rev 2 of this brief leaned toward `source_entry_ids uuid[]` as the cheaper option. The reviewer pushed back: if the audit UX will ever answer either "where else did this source entry contribute?" or "which auto-synthesised blocks came from this run?", the array shape paints us into a corner that costs a second migration later. Both questions are plausible given the Trust & Verification angle. A join table is more queryable, indexable, and naturally extends with per-source metadata (`content_hash`, `quality_score_at_capture`, `contribution_rank`, optional `snapshot_excerpt`). The cost difference today is small — one extra table vs. one extra column — and the option-value is large.

**Why not cascade-delete.** The nightly decay job soft-deletes low-quality workspace memory entries. If `source_entry_id` were a foreign key with `ON DELETE CASCADE`, decay could nuke historical lineage exactly when an auditor needs it most. Use `ON DELETE SET NULL` and keep the row populated with the full snapshot-metadata set (per the A-Deletion invariant) so the audit story survives source deletion.

**Scope.** ~100 LOC, one migration, one admin route, one UI section on the existing `MemoryBlockDetailPage`. No agent-prompt change — lineage is operator-facing only.

**Why now, not later.** The Trust & Verification Layer pill is the trigger. If we ship that pill without lineage behind the `Auto` case, we ship a dead-end UX. Cheaper to add lineage now (one migration) than to retrofit when operators start clicking and find nothing.

**Resolved decisions (Rev 6.1, all favouring minimum UI):**
- **No "edit this block" cross-link from the Sources tab.** Operators who need to correct a block use the existing "Diff vs Canonical" tab on the same page, which already supports manual edits via `updateBlock` (creates a `manual_edit` version). Adding a second edit affordance on Sources is duplicative.
- **No "view source entry" navigation from each row.** The Sources tab is the read-only audit floor. The run-link per row goes to the run trace (existing surface). Operators who want to inspect a specific workspace memory entry navigate to it via the existing workspace memory admin page; no new affordance needed.
- **No "regenerate this block" action.** If a source is wrong, operators (a) edit the source entry directly in workspace memory, (b) wait for next weekly synthesis to re-cluster, or (c) manually edit the block via Diff vs Canonical. The closed-loop "exclude this source and regenerate just this block" flow is a documented follow-up, not v1.
- **Backfill historical blocks:** not possible — clusters were never persisted. Lineage starts from migration forward. Accepted.

**Open questions for the spec:**
- Should the agent itself see source entries? Default no (prompt bloat); reconsider only if a `cite_sources` tool call wants it.

---

### Proposal B — Citation-rate utility (RECOMMEND, split into B1 + B2 per reviewer F1)

**Why.** Every retrieval-quality decision we'd want to make — should we widen k, turn on the reranker by default, change synthesis thresholds, ship the Proposal D semantic ranker — depends on a feedback signal we don't currently surface. We persist per-run citation data (`agent_runs.cited_entry_ids`, `agent_runs.applied_memory_block_citations`, `memory_citation_scores`). What's missing is the aggregate question: of the memory we inject into prompts, what percentage is actually used by the agent?

`KNOWLEDGE.md` §236 flagged this explicitly and it was never built. Without it, every retrieval change is unfalsifiable — we can ship "improvements" indefinitely with no way to know if they helped.

**Why this is NOT a duplicate of AKR's observability.** AKR shipped `retrievalObservabilityService` (147 LOC across both files). What it actually emits in production: payload truncation, degraded-reason builders, and always-available capacity warnings (30 docs / 30k tokens). It does **not** emit per-document coverage ("loaded in N of last 30 runs") even though §11 of the AKR spec described it. It does **not** emit any utility metric. The reviewer should treat utility and coverage as separate questions: *coverage* answers "which memory got loaded into the prompt?" — *utility* answers "of what got loaded, how much did the agent actually use?" Coverage belongs as an extension of the existing `retrievalObservabilityService` (same code-owner, same event substrate). Utility is what this proposal adds.

**Why split into B1 + B2 (per reviewer F1).** Rev 2 combined the measurement substrate, rollup job, materialised view, and dashboard UI into one proposal. The reviewer pointed out that Proposal D's dependency is actually on the metric and the rollback signal — not on polished dashboard chrome. Splitting the proposal lets D be enabled (Rev 6: via env flag) once B1 is queryable, without waiting on B2's UI polish.

#### B1 — Measurement substrate

**What ships.** A materialised view (refreshed nightly) that exposes, per run / agent / workspace / memory category, the counts and ratios needed for utility tracking:
- `injected_entry_count`, `cited_entry_count`, `entry_utility_rate` (per workspace memory)
- `injected_block_count`, `cited_block_count`, `block_utility_rate` (per memory block)
- Rolling 7-day and 30-day aggregates, per agent and per workspace.

**The denominator problem (reviewer F2, evidence-verified).** Codebase audit confirms:
- `agent_runs.appliedMemoryBlockIds` (jsonb string[], migration 0199) **is** the denominator for memory-block utility. Persisted today.
- `agent_runs.citedEntryIds` is the **numerator** for entry utility, but **there is no corresponding `injectedEntryIds`** column. The entry denominator is **not persisted in production today.**

This means B1 cannot be purely derivative for workspace-memory entries. It must add a bounded **injected-entry manifest** at prompt-assembly time. Concrete shape (subject to spec):
- New column `agent_runs.injected_entry_ids jsonb` (string[]), populated in `agentExecutionService.ts` at the same site where workspace memory is composed into the prompt.
- Bounded by the existing per-run memory cap; no unbounded growth risk.
- Migration is backward-compatible (default `[]`); existing runs have null/empty manifests and are excluded from entry-utility aggregates (window-bounded by definition).

Without this, entry-utility on the dashboard would have a numerator but no trustworthy denominator. Block-utility has both today and works without this change.

**B1 acceptance — historical runs must be visibly "not measured", not "0%".** Aggregate queries must distinguish runs that have no `injected_entry_ids` manifest (pre-migration, or where the manifest was not yet wired) from runs that genuinely had an empty injection set. Surface the distinction in both the substrate (`measured: boolean` per-run flag, or a NULL vs `[]` discriminator) and B2's dashboard (e.g. dim or annotate periods with insufficient coverage). Otherwise early dashboards will accidentally imply terrible utility when the denominator was simply unavailable.

**Scope.** ~100 LOC. One migration (materialised view + refresh function + `injected_entry_ids` column). One write-site change in `agentExecutionService.ts` at the memory-composition point. One nightly refresh job. No UI.

#### B2 — Operator dashboard

**What ships.** Charts and a per-agent breakdown over the B1 substrate, surfaced on the admin observability page. Two utility charts (entries, blocks), one per-agent breakdown table with a minimum-runs gate (~10 runs / window) to suppress noise on low-volume agents.

**Why B2 can lag B1.** Per the reviewer's F1 framing: as long as the substrate is queryable and reviewable, engineering can enable D via the env flag and spot-check utility with SQL. The dashboard is the durability layer — what makes utility a permanent operating concern rather than a one-off review-period query.

**Scope.** ~100 LOC. One chart component, one breakdown table, route additions. See §5 for mockups.

**B-D dependency contract (per reviewer; Rev 6 wording):** Proposal D depends on **B1**, not B2. D's env flag should not be flipped on until B1 is live and queryable — otherwise we have no quality signal to know whether the ranker is helping.

**Caveats (apply to both layers).**
- Citation detection is heuristic (`memoryCitationDetector.ts`). False negatives (agent uses memory without quoting it) understate utility. False positives (paraphrase collision) overstate it. The metric is directional, not absolute.
- Per-agent breakdowns get noisy on low-volume agents. B2's minimum-runs gate handles this for the UI; B1 exposes raw counts for callers who want to set their own threshold.

**Resolved decisions (Rev 6.1, all favouring minimum UI):**
- **30-day rolling window only.** No 7d/30d toggle in v1. Adds a UI control and tab state for marginal benefit; B1's substrate exposes raw counts so operators wanting a 7d view can SQL it during the dev period. Promote to a UI toggle only if regression-investigation cadence later justifies it.
- **"Not measured" vs "0% utility" surfaced as one extra sentence in the existing heuristic-caveat banner.** The B1 acceptance invariant (pre-migration runs distinguishable from genuine 0%) is honoured in the substrate via NULL vs `[]` discriminator. The dashboard surfaces it with one line: *"Runs predating the entry-manifest migration are excluded from utility calculations."* No greyed time-axis bands, no separate annotation, no new visual element.
- **No shadow-mode comparison view on the dashboard.** That view existed under Rev 5's staged-rollout machinery, which Rev 6 retired. B2 stays focused on utility, not on D-rollout investigation.
- **Citation-detector accuracy audit:** deferred. The metric is explicitly directional; detector accuracy can be revisited once dashboards expose obvious anomalies in real data.

---

### Proposal D — Semantic ranker for the auto-knowledge retrieval path (RECOMMEND, highest leverage)

**Why.** AKR shipped, but the `assembleKnowledgeForRun` function — wired live into every agent run at `agentExecutionService.ts:919-920` — has no semantic ranking. `retrievalService.ts:19-21` explicitly says: *"v1 simplification: no query embedding available at run time. Use threshold=0 (all eligible chunks pass)."* Lines 197 and 276 set `finalScore: 0` for every retrieved chunk. The AKR spec described this as a v1 simplification with a v2 follow-up implied; v2 did not happen, and the simplification is now production behaviour.

This is the single biggest retrieval-quality lever in the codebase. The infrastructure to support semantic ranking is already shipped — chunked embeddings, observability scaffolding, scoping modes, pure ranker scaffold (`retrievalServicePure.ts`). What is missing is **the query embedding at retrieval time and a non-zero threshold.** Everything downstream of those two inputs already works.

**How.** Three pieces of work, all small:

1. **Define the query.** At the moment `assembleKnowledgeForRun(runId)` is called, the run has: agent ID, task description (the run's input prompt or task message), agent master prompt, and active workspace context. The natural query is the **task description** because that captures intent for this specific run; the agent master prompt is too generic (every run for that agent retrieves the same set) and conversation history is too noisy. Embed the task description with the same model used for chunk embeddings (`text-embedding-3-small`, 1536 dims) and pass the vector into `retrievalServicePure.scoreCandidates`.

2. **Compute a real `finalScore`.** Replace the `finalScore: 0` literals at `retrievalService.ts:197,276` with cosine similarity between the query embedding and each candidate's chunk embedding. The downstream `retrievalServicePure.rankAndBudget` function already handles threshold filtering, budget capping, and rejection-reason emission; it just needs a real score to filter on.

3. **Set a threshold.** AKR's pure ranker already accepts a `threshold` parameter that is currently always `V1_RETRIEVAL_THRESHOLD = 0`. Set a starting threshold via env (`AKR_RETRIEVAL_THRESHOLD`, default ~0.30 based on `text-embedding-3-small` cosine-distance norms). Tune from the citation-rate dashboard once Proposal B ships.

**Why this is a real follow-up to AKR and not a new build.** Everything except those three pieces is already in production. The pure ranker (`retrievalServicePure.ts:38-91`) has the comparator chain, threshold logic, budget loop, and rejection-reason emission. The observability service emits the truncated payload contract. The schema, indexes, modes, ingestion jobs, UI tabs, and tenant-isolation invariants are live. We are completing a deliberate v1 simplification, not designing a new system.

**Enablement (Rev 6 simplified).** D ships behind a single env-driven on/off flag. When the flag is set, the ranker runs (query embedding → cosine score → threshold filter → budget cap). When unset, the existing legacy behaviour stands unchanged (`finalScore = 0`, threshold = 0, scope-tier + recency + budget). No user-facing UI, no four-mode rollout, no shadow telemetry, no per-subaccount sampling. Engineering controls the flag; if a regression surfaces during internal testing, the flag flips off and the system is back to today's behaviour in seconds.

**Why simpler is correct here.** Earlier revisions (Rev 5.x) locked an Off → Shadow → Sampled → On rollout with per-subaccount baseline windows, shadow telemetry persistence, and a recall-fallback flag tied to each mode. That machinery was designed for a production-deployment risk profile. `docs/spec-context.md` records this codebase as `pre_production: yes, live_users: no, feature_stability: low` — the risk model the staged rollout was guarding against does not yet exist. Building the machinery now is over-engineering. The two algorithm safety invariants (recall + embedding failure, both in §4) are the load-bearing guardrails; they remain mandatory. The rollout discussion can be reopened when this codebase approaches live-user readiness.

**Cost (Rev 6).**
- One OpenAI embedding call per agent run when the flag is on (~$0.00002 at `text-embedding-3-small` pricing). Negligible.
- ~80 LOC: query construction, embedding call, cosine score wiring at `retrievalService.ts:197,276`, env-flag resolver, recall-invariant fallback path. No telemetry-persistence schema, no mode resolver, no sampling logic.
- Risk profile: low given the small surface area and the recall + embedding-failure invariants. If a regression appears in dev testing, flip the env flag off.

**What this does NOT do.**
- No re-ranking layer (Cohere or LLM). Pure cosine, consistent with AKR spec §1.2.
- No version-aware retrieval (continues to retrieve the latest version of each document, per AKR spec §1.2).
- No backfill of historical chunks — they are already embedded as part of AKR's ingestion pipeline.
- **No new UI at all.** No agent-facing change, no subaccount-admin settings page, no shadow-comparison panel. The flag is engineering-controlled config; users see only the resulting retrieval quality.
- No staged rollout machinery. No shadow mode, no sampled %, no baseline window, no shadow-telemetry persistence schema.

**Sequencing.** Proposal D depends on **B1** (the measurement substrate). Order: B1 ships first so engineering has a quality signal; D's env flag can then be enabled, and B1's utility numbers tell us whether the ranker is helping or hurting. If hurting, flip the flag off. B2's dashboard polish can land in parallel or after.

**Open questions for the reviewer:**
- Query definition — is "task description" the right choice over "task description + conversation summary" or "task description + agent master prompt summary"? This is the highest-leverage spec-phase question because it determines what the embedding actually represents.
- Threshold starting point — 0.30 is a guess based on `text-embedding-3-small` norms. Worth validating against a sample of dev-environment runs before defaulting.
- Should we revisit the AKR spec §1.2 "no cross-encoder re-ranking" stance once D ships? Cohere rerank-v3.5 is already in the codebase for workspace-memory retrieval (`server/lib/reranker.ts`); reusing it on the AKR path is a one-line plumbing change once cosine ranking is live. Defer the decision until B1 utility data is in.
- Is D big enough to be its own spec rather than a section of this brief? Recommend: yes if the reviewer pressure-tests it and finds open design questions in the "query definition" axis; no if the task-description approach is accepted.

---

## 4. Brief-level invariants (apply across all proposals)

These invariants emerged from the first round of external review and apply across the proposal set. Listing them once here so the spec phase can reference them without re-deriving.

**A-Lineage decision.** The spec must explicitly choose between one-way `block-version → source` lookup and bidirectional lineage. Bidirectional lineage requires a join table; `uuid[]` is acceptable only if reverse lookup is intentionally out of scope. Default recommendation: join table (`memory_block_version_sources`).

**A-Deletion invariant (reviewer F3).** If `source_entry_id` can become NULL (it can: source entries are soft-deletable today and may be hard-deleted via privacy flows), the lineage row must retain enough non-sensitive snapshot metadata to remain audit-useful even after source loss. **Required at minimum:** `source_entry_id_hash`, `content_hash`, `source_type`, `captured_at`, `quality_score_at_capture`, `contribution_rank`. `content_hash` alone is insufficient — it proves content integrity only if the content is still recoverable. `snapshot_excerpt` is **out of scope for v1** unless privacy review explicitly approves it; v1 lineage relies on the required metadata only. This keeps v1 clean and avoids accidental sensitive-content retention.

**B-D dependency.** Proposal D depends on Proposal **B1** (measurement substrate), not on B2's polished dashboard UX. B1 gives engineering the post-enablement quality signal needed to verify the ranker is helping rather than hurting; dashboard polish may follow.

**B1 denominator invariant (reviewer F2).** B1 must verify that every injected workspace-memory entry ID and memory-block version ID is persisted per run before declaring the substrate complete. Codebase audit confirms blocks are persisted (`appliedMemoryBlockIds`) but entry injection IDs are **not**. B1 therefore must add a bounded injected-entry manifest at prompt-assembly time; without it, citation utility has a numerator but no trustworthy denominator and the dashboard looks scientific while being wrong.

**D-Recall invariant.** Semantic filtering must not silently reduce a previously non-empty eligible candidate set to zero. The current AKR path loads every in-scope active block / chunk; turning on real cosine scores is quality-positive only if a fallback prevents accidental memory starvation. If semantic filtering at the configured threshold would return zero candidates from a previously non-empty pool, the ranker must fall back to top-N legacy ordering (scope-tier → recency) for that category and emit a `retrieval.empty_after_semantic` event on the run trace. This is an algorithm safety property, not a rollout discipline — it applies on day one regardless of feature-flag state.

**D-Embedding-failure invariant.** Embedding failures (OpenAI 5xx, timeout, network error) must **fail open to legacy retrieval behaviour** (scope-tier + recency, threshold 0) and emit a `retrieval.embedding_failed` degraded reason on the run trace. They must **not** block agent execution. Retrieval quality must degrade safely, not interrupt runs.

**D-Rollout simplicity (CEO Rev 6 correction).** Earlier revisions of this brief locked a four-mode staged rollout (off / shadow / sampled / on) plus a per-subaccount baseline window, plus shadow-telemetry persistence. **All of that was dropped in Rev 6.** This codebase is pre-production (`live_users: no`, `feature_stability: low` per `docs/spec-context.md`); the staged-rollout machinery was guarding against a production risk profile we are not yet in. D ships behind a single env-driven on/off flag — when set, the semantic ranker runs; when not, legacy behaviour stands. No user-facing mode UI. No shadow telemetry. No baseline window. No sampling. The recall and embedding-failure invariants above are algorithm safety properties and remain mandatory. The staged-rollout discussion can be reopened when we approach live-user readiness and the risk model materially changes.

---

## 5. UI surfaces affected (mockups)

Three operator-facing UI surfaces are touched by this brief. Mockups produced by the `mockup-designer` agent live under `prototypes/memory-improvements/` and are grounded in existing pages and components; new components are introduced only where the existing pattern is genuinely absent.

| Proposal | Surface | Mockup file | Existing page / component extended |
|---|---|---|---|
| A | Memory Block detail — new **Sources** tab | [`prototypes/memory-improvements/memory-block-detail.html`](../../../prototypes/memory-improvements/memory-block-detail.html) | `client/src/pages/MemoryBlockDetailPage.tsx`. Adds a third tab alongside Version History / Diff vs Canonical. Visible only for `auto_synthesised` blocks. Bidirectional lineage as per-row collapsed expander. Version selector lets operator inspect historical synthesis versions. |
| B2 | Citation-rate utility dashboard | [`prototypes/memory-improvements/citation-utility-dashboard.html`](../../../prototypes/memory-improvements/citation-utility-dashboard.html) | `client/src/pages/UsagePage.tsx`. Adds a "Memory Utility" tab alongside existing Runs / Routing / Spend tabs. Two canvas-drawn line charts (entry utility %, block utility %), per-agent breakdown with inline utility bars and a `<10 runs` suppression note. Dismissable heuristic-metric caveat banner. |
| D | — | — | **No user-facing UI in Rev 6.** D ships as backend algorithm change behind an env on/off flag. The Rev 5.x mockup (`akr-ranker-settings.html`) was retired when the staged-rollout machinery was dropped — see Rev 6 simplification note in Proposal D body. Engineering controls enablement; users see only the resulting retrieval quality. |

Index page linking all three: [`prototypes/memory-improvements/index.html`](../../../prototypes/memory-improvements/index.html). Per-round summary and codebase-grounding file enumeration: [`tasks/builds/memory-improvements/mockup-log.md`](./mockup-log.md). No net-new components introduced — all surfaces reuse existing tab strips, cards, tables, and chart-canvas patterns. The mockups are advisory, not contractual — the spec phase finalises exact shapes.

---

## 6. Rejected ideas

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

**When to revisit.** Do not revisit unless the cache-boundary or trust-boundary assumptions are invalidated by a future prompt-assembly redesign. The rejection is durable but not unconditional — if either assumption changes, this section should be reread before that redesign locks.

---

## 7. Recommended next steps (Rev 6 simplified sequencing)

1. **Spec author uses this locked brief as input.** The highest-risk design points to preserve are: A's join-table lineage shape (with deletion-safe metadata), B1's injected-entry denominator, D's query-definition choice ("task description" vs. broader context), and the two D algorithm safety invariants (recall + embedding-failure). Carry the §4 invariants forward as explicit spec invariants.
2. **Proposal A ships independently.** Choose the lineage storage shape carefully before spec — default to join table; lock the A-Deletion invariant in the migration shape.
3. **B1 (measurement substrate) ships before or with D.** B1 is what tells engineering whether the D ranker is helping; without it, D's enablement is unfalsifiable.
4. **Proposal D ships behind a single env on/off flag.** Off by default in dev. Engineering flips on, watches B1 utility numbers, flips off if it regresses. No staged rollout, no shadow telemetry, no per-subaccount UI.
5. **Proposal B2 (operator dashboard)** ships in parallel or after, as a durability layer over B1. Not on the critical path.
6. **Opportunistic cleanup (§9)** ships only if convenient — alongside B or D, or as a standalone tiny PR. Default unchanged.
7. **When the codebase approaches live-user readiness**, reopen the staged-rollout discussion. The Rev 5 invariants (off / shadow / sampled / on, per-subaccount baseline windows, shadow telemetry persistence) are not deleted — they are deliberately deferred. The reasoning and shapes are preserved in git history under Rev 5.x for that re-evaluation.
8. **Two months after the full set lands, check the utility dashboard.** Consistently high (e.g. >50% of injected entries cited) means we are done for now. Lower means the dashboard tells us where to look next — and we have a measurable baseline for any further change.

---

## 8. What this brief deliberately does NOT do

- **No tech spec.** Schema columns, API shapes, and UI mockups are sketched only where needed for the reviewer to judge feasibility. Final shapes come in the spec phase. Proposal D in particular may warrant its own spec if the reviewer surfaces design questions on the query-definition axis.
- **No re-opening of AKR's design choices already shipped.** Scope-tier ranking, the Auto / Always-available / Reference-only modes, the chunked-embedding model, and the pure-cosine "no cross-encoder" stance are all in production. Proposal D completes AKR's deferred semantic ranker without revisiting those choices. The reranking question is flagged as a follow-up open question, not a re-opening.
- **No promises about benchmark numbers.** The external projects we audited made specific claims (+35%, +76%, +56%) that did not survive scrutiny. We are deliberately not stating equivalent numbers for our own changes because we don't have a benchmark harness to measure them on. Proposal B's utility metric is the first step toward having one.
- **No commitment to a graph layer or alternative storage.** Both rejected ideas in §6 stay rejected unless a measurable user-facing problem surfaces. The cost of revisiting that decision is one good piece of evidence; the cost of building either is months of engineering. Asymmetric.

---

## 9. Opportunistic cleanup discovered during review

Not a strategic proposal. A small config-hygiene item surfaced during the audit, recorded here so it isn't lost. Ship it opportunistically alongside B or D, or as a standalone tiny PR. **Not required for the brief to land.**

### Memory-block candidate-pool size as an env knob

The memory-block relevance path (`memoryBlockService.getRelevantBlocks`) retrieves `poolSize = topK * 3 = 15` candidates before token-budget eviction and emits topK=5. The pool of 15 is hardcoded at `memoryBlockService.ts:177,199` — the only memory-block tunable still living as a magic number rather than alongside the other knobs in `server/config/limits.ts`. The Cohere reranker (when enabled) prices the same for 5 or 100 candidates per call, so the ceiling is artificial.

**How.** Promote `BLOCK_RELEVANCE_TOP_K` and the `* 3` multiplier to env-overridable constants (`MEMORY_BLOCK_POOL_MULTIPLIER`, default 3) in `server/config/limits.ts`. Default unchanged; no behaviour change unless an operator sets the env var.

**Scope.** ~20 LOC, no migration, no UI.

**Caveats.**
- Widening only helps if recall is the bottleneck. Without B1's substrate, we cannot verify it is.
- The `MAX_MEMORY_SCAN = 1000` ceiling means widening past ~250 has diminishing returns. We are nowhere near that today.
- Does not apply to the AKR auto-knowledge path. That path has no semantic ranker; widening it loads more zero-scored candidates into the budget cap. The fix there is Proposal D, not pool widening.
