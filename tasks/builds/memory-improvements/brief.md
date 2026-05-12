# Memory System Improvements — Pre-Spec Brief

**Status:** Draft, for external review
**Revision:** 3 (applies first round of external-review feedback: B split into measurement substrate + dashboard, D rollout contract hardened, A defaults to join table, C reframed as config hygiene, brief-level invariants added)
**Date:** 2026-05-12
**Purpose:** Stress-test a set of memory-system improvements before committing to a spec. Each proposal has been vetted against the codebase.

## Table of contents

1. Context and the AKR correction
2. Current state — what is actually shipped today
3. Proposals
   - Proposal A — Synthesis lineage on memory-block versions
   - Proposal B — Citation-rate utility (B1 measurement substrate + B2 operator dashboard)
   - Proposal C — Memory-block candidate-pool knob (opportunistic cleanup)
   - Proposal D — Semantic ranker for the auto-knowledge retrieval path
4. Brief-level invariants (applied across all proposals)
5. UI surfaces affected (mockups)
6. Rejected ideas
   - SPO entity graph
   - Single consolidated memory surface
7. Recommended next steps
8. What this brief deliberately does NOT do

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

**How.** Add a `memory_block_version_sources` join table — `(block_version_id, source_entry_id, content_hash, quality_score_at_capture, contribution_rank)`. Populate at the version-insert site inside `memoryBlockSynthesisService.ts:195-206`. Surface via a new admin route `/api/memory-blocks/:id/sources` that joins through to source entries and the runs that produced them. Per-version, so future re-syntheses preserve their own cluster.

**Why a join table is now the default (revised per reviewer F4).** Rev 2 of this brief leaned toward `source_entry_ids uuid[]` as the cheaper option. The reviewer pushed back: if the audit UX will ever answer either "where else did this source entry contribute?" or "which auto-synthesised blocks came from this run?", the array shape paints us into a corner that costs a second migration later. Both questions are plausible given the Trust & Verification angle. A join table is more queryable, indexable, and naturally extends with per-source metadata (`content_hash`, `quality_score_at_capture`, `contribution_rank`, optional `snapshot_excerpt`). The cost difference today is small — one extra table vs. one extra column — and the option-value is large.

**Why not cascade-delete.** The nightly decay job soft-deletes low-quality workspace memory entries. If `source_entry_id` were a foreign key with `ON DELETE CASCADE`, decay could nuke historical lineage exactly when an auditor needs it most. Use `ON DELETE SET NULL` and keep the row with `content_hash` populated so the snapshot survives source deletion.

**Scope.** ~100 LOC, one migration, one admin route, one UI section on the existing `MemoryBlockDetailPage`. No agent-prompt change — lineage is operator-facing only.

**Why now, not later.** The Trust & Verification Layer pill is the trigger. If we ship that pill without lineage behind the `Auto` case, we ship a dead-end UX. Cheaper to add lineage now (one migration) than to retrofit when operators start clicking and find nothing.

**Open questions for the reviewer:**
- Should we ship `snapshot_excerpt` (first ~140 chars of the source entry at capture time) so lineage survives even if the source entry is hard-deleted via GDPR / right-to-be-forgotten flows? Adds storage cost; gains durability.
- Should we backfill historical blocks? Cannot — the clusters were never persisted. Acceptable to start from migration forward?
- Should the agent itself see source entries? Default no (prompt bloat); reconsider only if a `cite_sources` tool call wants it.

---

### Proposal B — Citation-rate utility (RECOMMEND, split into B1 + B2 per reviewer F1)

**Why.** Every retrieval-quality decision we'd want to make — should we widen k, turn on the reranker by default, change synthesis thresholds, ship the Proposal D semantic ranker — depends on a feedback signal we don't currently surface. We persist per-run citation data (`agent_runs.cited_entry_ids`, `agent_runs.applied_memory_block_citations`, `memory_citation_scores`). What's missing is the aggregate question: of the memory we inject into prompts, what percentage is actually used by the agent?

`KNOWLEDGE.md` §236 flagged this explicitly and it was never built. Without it, every retrieval change is unfalsifiable — we can ship "improvements" indefinitely with no way to know if they helped.

**Why this is NOT a duplicate of AKR's observability.** AKR shipped `retrievalObservabilityService` (147 LOC across both files). What it actually emits in production: payload truncation, degraded-reason builders, and always-available capacity warnings (30 docs / 30k tokens). It does **not** emit per-document coverage ("loaded in N of last 30 runs") even though §11 of the AKR spec described it. It does **not** emit any utility metric. The reviewer should treat utility and coverage as separate questions: *coverage* answers "which memory got loaded into the prompt?" — *utility* answers "of what got loaded, how much did the agent actually use?" Coverage belongs as an extension of the existing `retrievalObservabilityService` (same code-owner, same event substrate). Utility is what this proposal adds.

**Why split into B1 + B2 (revised per reviewer F1).** Rev 2 combined the measurement substrate, rollup job, materialised view, and dashboard UI into one proposal. The reviewer pointed out that Proposal D's dependency is actually on the metric and the rollback signal — not on polished dashboard chrome. Splitting the proposal lets D ship into `shadow` / `sampled` modes (see Proposal D rollout invariant) once B1 is queryable, without waiting on B2's UI polish.

#### B1 — Measurement substrate

**What ships.** A materialised view (refreshed nightly) that exposes, per run / agent / workspace / memory category, the counts and ratios needed for utility tracking:
- `injected_entry_count`, `cited_entry_count`, `entry_utility_rate` (per workspace memory)
- `injected_block_count`, `cited_block_count`, `block_utility_rate` (per memory block)
- Rolling 7-day and 30-day aggregates, per agent and per workspace.

Derived from existing `agent_runs.cited_entry_ids`, `agent_runs.applied_memory_block_citations`, `memory_citation_scores`. No new source-of-truth tables. The view is queryable from `psql`, from admin scripts, and from spot-check during D rollout — all without any UI.

**Scope.** ~80 LOC. One migration adding the materialised view + refresh function. One nightly job to refresh. No UI.

#### B2 — Operator dashboard

**What ships.** Charts and a per-agent breakdown over the B1 substrate, surfaced on the admin observability page. Two utility charts (entries, blocks), one per-agent breakdown table with a minimum-runs gate (~10 runs / window) to suppress noise on low-volume agents.

**Why B2 can lag B1.** Per the reviewer's F1 framing: as long as the substrate is queryable and reviewable, D can run in shadow / sampled mode and operators can spot-check with SQL. The dashboard is the durability layer — what makes utility a permanent operating concern rather than a one-off review-period query.

**Scope.** ~100 LOC. One chart component, one breakdown table, route additions. See §5 for mockups.

**B-D dependency contract (per reviewer):** Proposal D depends on **B1**, not B2. D must not ship beyond `shadow` mode until B1 is live and queryable.

**Caveats (apply to both layers).**
- Citation detection is heuristic (`memoryCitationDetector.ts`). False negatives (agent uses memory without quoting it) understate utility. False positives (paraphrase collision) overstate it. The metric is directional, not absolute.
- Per-agent breakdowns get noisy on low-volume agents. B2's minimum-runs gate handles this for the UI; B1 exposes raw counts for callers who want to set their own threshold.

**Open questions:**
- Window — 7d, 30d, both? 30d is more stable; 7d catches regressions faster. Recommend: surface both, default chart view 30d.
- Should we also audit `memoryCitationDetector.ts` accuracy before shipping B1, so the reviewer knows the signal-to-noise floor?
- Should B2 include a "shadow mode comparison" view tied to Proposal D's shadow rollout (see §5 mockups)? Likely yes — the same dashboard becomes D's rollout instrument.

---

### Proposal C — Memory-block candidate-pool knob (OPPORTUNISTIC CLEANUP, reframed per reviewer F5)

**Framing change.** Rev 2 listed C alongside A, B, D as a strategic memory-system improvement. The reviewer pushed back: C is a config-hygiene knob, not in the same class as the other three. Reframed here as an opportunistic cleanup item to ship alongside B or D, or as a standalone tiny PR, but **not as an independent strategic recommendation**.

**Why it still belongs in this brief.** The hardcoded `poolSize = topK * 3 = 15` at `memoryBlockService.ts:177,199` is the only memory-block tunable still living as a magic number rather than alongside the other knobs in `server/config/limits.ts`. The Cohere reranker (when enabled) prices the same for 5 or 100 candidates per call, so the ceiling is artificial. The cleanup is ~20 LOC.

**How.** Promote `BLOCK_RELEVANCE_TOP_K` and the `* 3` multiplier to env-overridable constants (`MEMORY_BLOCK_POOL_MULTIPLIER`, default 3) in `server/config/limits.ts`. Default unchanged; no behaviour change unless an operator sets the env var.

**Caveats.**
- Widening only helps if recall is the bottleneck. Without B1's substrate, we cannot verify it is. Treat C as a knob to turn after B1 / B2 tells us recall is the lever to pull.
- The dominance gate in `workspaceMemoryService.ts:441-447` short-circuits the reranker when top-two scores are close. Widening matters most when the result set is ambiguous; that gate limits the upside.
- The `MAX_MEMORY_SCAN = 1000` candidate-pool ceiling means widening past ~250 has diminishing returns. We are nowhere near that today.

**Scope.** ~20 LOC, no migration, no UI.

**Open questions:**
- Should this be per-tenant (column on a workspace-settings table) rather than a global env? Per-tenant is more aligned with how the rest of the stack handles tunables, but adds settings-page work disproportionate to the win. Recommend env-only for v1.
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

**D-Rollout invariant (per reviewer F2).** The semantic ranker must ship in one of four explicit modes, with the first production deploy restricted to `off` or `shadow`:

| Mode | Behaviour |
|---|---|
| `off` | Current production: `finalScore = 0`, threshold = 0, all eligible chunks pass. No change vs. today. |
| `shadow` | Compute query embedding, per-candidate cosine score, threshold filter, and a hypothetical selected-payload — emit it to telemetry as `retrieval.shadow_compare` — **but preserve the existing production payload as the actual loaded set.** No agent-visible change. |
| `sampled` | Apply the ranked payload to a bounded percentage of runs (or to a specific allow-listed set of tenants/agents). Remainder stay on legacy behaviour. |
| `on` | Apply the ranked payload by default for all runs in the org. |

Mode is configured per-org by an env-driven default with a per-org override on `organisations` (column shape TBD in spec). The first production deploy of D is `shadow` for all orgs. Progression to `sampled` and `on` requires B1 telemetry showing no regression in citation utility, no spike in truncation, and no rise in empty-result fallback events (see recall invariant below).

**D-Recall invariant (per reviewer F3).** Semantic filtering must not silently reduce a previously non-empty eligible candidate set to zero. The current AKR path loads every in-scope active block / chunk; turning on real scores is quality-positive, but **only if the fallback prevents accidental memory starvation.** Concretely:

- For each retrieval category (memory blocks, reference-document chunks), if semantic filtering at the configured threshold would return zero candidates from a previously non-empty pool, the system must either:
  - **fall back** to the top-N legacy ordering (scope-tier → recency) and load that set, **or**
  - in `shadow` / `sampled` modes, preserve the legacy payload and emit a `retrieval.empty_after_semantic` degraded reason on the run trace.
- A `recall_invariant_check` flag on the per-run retrieval telemetry indicates whether the invariant fired. The fallback-fired rate is a Phase-3 release gate alongside utility regression.

**Cost.**
- One OpenAI embedding call per agent run (~$0.00002 at `text-embedding-3-small` pricing). Negligible. In `shadow` mode the cost is doubled relative to off (embedding + telemetry write); still negligible.
- ~50 LOC for the cosine + threshold work, ~50 LOC for the shadow-compare telemetry emitter, ~30 LOC for the mode resolver. Total ~150 LOC, behind a feature flag.
- Risk profile: moderate, materially reduced by the rollout invariant. The `shadow` step lets us observe the candidate-set delta against real production runs without any agent-visible behaviour change.

**What this does NOT do.**
- No re-ranking layer (Cohere or LLM). Pure cosine, consistent with AKR spec §1.2 ("no cross-encoder re-ranking. Pure cosine for v1.").
- No version-aware retrieval (continues to retrieve the latest version of each document, per AKR spec §1.2).
- No backfill of historical chunks — they are already embedded as part of AKR's ingestion pipeline.
- No new UI. Operator-facing surfaces stay the same; the agent prompt continues to receive what the budget allows, just from a higher-quality candidate set.

**Sequencing.** Proposal D depends on **B1** (the measurement substrate), not B2's dashboard. D ships in `shadow` mode once B1 is queryable — operators can spot-check shadow-vs-legacy comparisons in SQL during the first week. Progression to `sampled` and `on` requires either B2 live, or operator confidence built via SQL drill-downs and the per-run shadow-compare view in the retrieval observability surface (see §5 mockups).

**Open questions for the reviewer:**
- Query definition — is "task description" the right choice over "task description + conversation summary" or "task description + agent master prompt summary"? Combining inputs is plausible; the trade-off is signal-to-noise and embedding cost (per-component embeddings, then weighted average vs. concatenated single embedding).
- Threshold starting point — 0.30 is a guess based on `text-embedding-3-small` norms. Worth validating against a sample of production runs before defaulting.
- Feature-flag scope — global, per-tenant, or per-agent? Per-tenant is the natural compromise (operator opt-in, blast radius bounded).
- Should we revisit the AKR spec §1.2 "no cross-encoder re-ranking" stance once D ships? Cohere rerank-v3.5 is already in the codebase for workspace-memory retrieval (`server/lib/reranker.ts`); reusing it on the AKR path is a one-line plumbing change once cosine ranking is live. Defer the decision until citation-rate data is in.
- Is D big enough to be its own spec rather than a section of this brief? Recommend: yes if the reviewer pressure-tests it and finds open design questions in the "query definition" axis; no if the task-description approach is accepted.

---

## 4. Brief-level invariants (apply across all proposals)

These invariants emerged from the first round of external review and apply across the proposal set. Listing them once here so the spec phase can reference them without re-deriving.

**A-Lineage decision.** The spec must explicitly choose between one-way `block-version → source` lookup and bidirectional lineage. Bidirectional lineage requires a join table; `uuid[]` is acceptable only if reverse lookup is intentionally out of scope. Default recommendation in Rev 3: join table (`memory_block_version_sources`).

**B-D dependency.** Proposal D depends on Proposal **B1** (measurement substrate), not on B2's polished dashboard UX. Dashboard polish may follow as long as operators can inspect run-level and aggregate citation utility via the substrate during D's rollout.

**D-Rollout invariant.** The semantic ranker must first ship in `off` or `shadow` mode. `shadow` computes query embeddings, scores, thresholds, and the hypothetical selected payload, but preserves the existing production payload as the actual loaded set. Progression to `sampled` and `on` is telemetry-gated, not calendar-gated.

**D-Recall invariant.** Semantic filtering must not silently reduce a previously non-empty eligible candidate set to zero. Empty semantic results require either a legacy-ordering fallback or an explicit `retrieval.empty_after_semantic` degraded reason on the run trace, with safe payload preservation during `shadow` / `sampled` modes.

---

## 5. UI surfaces affected (mockups)

Three operator-facing UI surfaces are touched by this brief. Mockups produced by the `mockup-designer` agent live under `prototypes/memory-improvements/` and are grounded in existing pages and components; new components are introduced only where the existing pattern is genuinely absent.

| Proposal | Surface | Mockup file | Existing page / component extended |
|---|---|---|---|
| A | Memory Block detail — new **Sources** tab | [`prototypes/memory-improvements/memory-block-detail.html`](../../../prototypes/memory-improvements/memory-block-detail.html) | `client/src/pages/MemoryBlockDetailPage.tsx`. Adds a third tab alongside Version History / Diff vs Canonical. Visible only for `auto_synthesised` blocks. Bidirectional lineage as per-row collapsed expander. Version selector lets operator inspect historical synthesis versions. |
| B2 | Citation-rate utility dashboard | [`prototypes/memory-improvements/citation-utility-dashboard.html`](../../../prototypes/memory-improvements/citation-utility-dashboard.html) | `client/src/pages/UsagePage.tsx`. Adds a "Memory Utility" tab alongside existing Runs / Routing / Spend tabs. Two canvas-drawn line charts (entry utility %, block utility %), per-agent breakdown with inline utility bars and a `<10 runs` suppression note. Dismissable heuristic-metric caveat banner. |
| D | Auto-knowledge ranker mode selector + shadow-mode comparison | [`prototypes/memory-improvements/akr-ranker-settings.html`](../../../prototypes/memory-improvements/akr-ranker-settings.html) | Settings / Retrieval page + per-run retrieval trace. Four-mode segmented selector (Off / Shadow / Sampled / On), Sampled reveals a percentage slider, save logs to audit. Embedded shadow-mode comparison panel: two-column Legacy vs Semantic payload diff with Promoted / Dropped / Unchanged badges, hover-tooltip cosine scores, recall-invariant status bar (green at-least-1-per-category, amber if a category would empty). Panel defaults collapsed. |

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

## 7. Recommended next steps (revised sequencing per reviewer)

1. **External reviewer reads this revision.** Most likely places to be wrong now: Proposal D's `shadow → sampled → on` telemetry-gate criteria (do they correctly cover the recall invariant?), the join-table shape in A (is `snapshot_excerpt` worth the storage cost?), Proposal D's query-definition choice ("task description" vs. broader context). Pressure-test those.
2. **Proposal A ships independently.** Choose the lineage storage shape carefully before spec — default to join table; lock the decision via the A-Lineage invariant before writing the migration.
3. **B1 (measurement substrate) ships first, or in the same PR as D's `shadow` mode.** This is the gating change for everything else.
4. **Proposal D ships behind `shadow` mode** in its first production deploy. Telemetry compares legacy-selected vs. semantic-selected payloads per run; recall-invariant fallbacks are tracked.
5. **D progression to `sampled` and `on`** happens only after B1 telemetry shows: (a) no regression in citation utility on sampled runs, (b) no spike in payload truncation, (c) empty-result-fallback rate below an agreed threshold (suggest <1% of runs).
6. **Proposal B2 (operator dashboard)** ships in parallel or shortly after D `shadow` mode goes live. It is not on the critical path for D, but becomes the durable governance surface once D is at `on`.
7. **Proposal C** ships opportunistically — alongside B or D, or as a standalone tiny PR. Default unchanged; ideally land after B telemetry confirms memory-block recall is actually constrained.
8. **Two months after the full set lands, check the utility dashboard.** Consistently high (e.g. >50% of injected entries cited) means we are done. Lower means the dashboard tells us where to look next — and we have a measurable baseline for any further change.

---

## 8. What this brief deliberately does NOT do

- **No tech spec.** Schema columns, API shapes, and UI mockups are sketched only where needed for the reviewer to judge feasibility. Final shapes come in the spec phase. Proposal D in particular may warrant its own spec if the reviewer surfaces design questions on the query-definition axis.
- **No re-opening of AKR's design choices already shipped.** Scope-tier ranking, the Auto / Always-available / Reference-only modes, the chunked-embedding model, and the pure-cosine "no cross-encoder" stance are all in production. Proposal D completes AKR's deferred semantic ranker without revisiting those choices. The reranking question is flagged as a follow-up open question, not a re-opening.
- **No promises about benchmark numbers.** The external projects we audited made specific claims (+35%, +76%, +56%) that did not survive scrutiny. We are deliberately not stating equivalent numbers for our own changes because we don't have a benchmark harness to measure them on. Proposal B's utility metric is the first step toward having one.
- **No commitment to a graph layer or alternative storage.** Both rejected ideas in §4 stay rejected unless a measurable user-facing problem surfaces. The cost of revisiting that decision is one good piece of evidence; the cost of building either is months of engineering. Asymmetric.
