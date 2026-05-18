# Brief — Tiered memory consolidation (consolidation-tier semantic model + Ebbinghaus decay + reinforcement)

**Status:** DRAFT v4.0 (2026-05-18) — re-grounded against shipped state; scope narrowed to genuinely-new content; spec-ready
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `memory-tiered-consolidation`
**Class:** Significant (architect to confirm Major upgrade at spec authoring)
**Source pattern:** [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) (Apache-2.0, pattern lift only — no code adoption)

**Supersedes:** v3.1 (2026-05-18). Earlier revisions assumed `workspaceMemoryService` was a flat store without RRF or graph retrieval. A 2026-05-18 deep code audit (`tasks/builds/memory-tiered-consolidation/progress.md § Revise loop`) showed that RRF fusion, graph expansion via `task_slug`, intent-classified retrieval profiles, HyDE caching, reranker integration, and a `memory_blocks.tier smallint` column (different semantics) are all already shipped. This rewrite scopes down to the content that has no shipped equivalent.

## Table of contents

1. What already exists (extends — does NOT re-introduce)
2. Problem
3. Goal
4. Tier column collision (must resolve at spec)
5. Governance invariants
6. Proposed approach (architect locks at spec)
   - Tier 1 — Schema extension (consolidation tier + access timestamp)
   - Tier 2 — Consolidation / promotion logic (extending memoryBlockSynthesisService)
   - Tier 3 — Ebbinghaus decay (extending memoryDecayJob)
   - Tier 4 — Tier-aware retrieval boosting (extending hybridRetrieval)
   - Tier 5 — Optional deeper graph layer (architect decides at spec)
   - Tier 6 — Multi-tenant safety (invariant)
7. Operational constraints
8. Determinism & replayability
9. Rollout & rollback
10. Constraints / non-goals
11. Files in scope (architect locks at spec authoring)
12. Out of scope
13. Success criteria
14. What unblocks when this ships
15. Concurrent safety note
16. Provenance
17. How to start (paste into a new Claude Code session)

---

## What already exists (extends — does NOT re-introduce)

The following primitives are live in production and the spec extends them rather than replaces them:

- **RRF fusion** — `server/services/workspaceMemoryService/hybridRetrieval.ts` uses `RRF_K`, `RRF_MIN_SCORE`, `RRF_OVER_RETRIEVE_MULTIPLIER` from `server/config/limits.ts`.
- **Graph retrieval** — `server/services/workspaceMemoryService/graphExpansion.ts` joins entries by shared `task_slug`.
- **Intent classification + retrieval profiles** — `classifyQueryIntent`, `RETRIEVAL_PROFILES`, profile-keyed retriever weights.
- **HyDE expansion + cache** — `hydeCache.ts`, `HYDE_THRESHOLD`, `HYDE_MAX_TOKENS`.
- **Reranker** — `reranker.ts`, `RERANKER_PROVIDER`, `RERANKER_MODEL`, `RERANKER_TOP_N`.
- **Recency boost** — `RECENCY_BOOST_WINDOW_DAYS`, `RECENCY_BOOST_WEIGHT`.
- **`memory_blocks.tier` column** — migration 0277, semantics `smallint` with values `1 = foundational / 2 = strategic` for F1 baseline-artefact injection filtering. **This is a different concept from the consolidation tier the brief proposes and the two must coexist (see Tier column collision below).**
- **Synthesis confidence routing** — `memoryBlockSynthesisService.ts` uses a `SynthesisTier` (`high|low`) to route synthesis decisions; this is content-quality, not lifecycle.
- **Memory-improvements (PR #298, 2026-05-13)** — synthesis lineage (`memory_block_version_sources`), citation utility metric (`injected_entry_ids`, `mv_memory_utility_30d`, dashboard tab), AKR semantic ranker for the chunk-retrieval path (`AKR_RETRIEVAL_THRESHOLD`, `AKR_SEMANTIC_RANKER_ENABLED`).

---

## Problem

Today's `workspaceMemoryService` ranks and retrieves well but does not distinguish memory by **lifecycle role**. Every memory block lives at the same conceptual layer regardless of whether it is a transient recent observation, a specific historical event, a consolidated fact, or a repeatable procedure. Two operator-reported failures follow:

1. **"The agent forgot what we did last week."** Recent observations age out at the same rate as older blocks. Without a fast-decaying working layer that ranks first while fresh, recent context gets crowded out by older durable facts and the agent loses short-term continuity.
2. **"The same observation keeps re-appearing instead of becoming a learned fact."** The synthesis service can mint blocks but does not promote them through a lifecycle — a recurring observation never crystallises into a generalised semantic block, and a repeated workflow never crystallises into a procedural block, so the same low-confidence content keeps surfacing.

The root cause is the absence of a **consolidation-tier lifecycle** on memory blocks. Decay parameters, retrieval boosting, and synthesis-vs-promotion semantics all want to vary by lifecycle role; today they cannot.

## Goal

Add a **consolidation-tier** lifecycle to memory blocks (`working` / `episodic` / `semantic` / `procedural`) with:

- Tier-aware promotion ("consolidation") driven by multi-signal reinforcement
- Ebbinghaus decay with tier-specific strength constants
- Reinforcement-on-access tracking (async or sampled — never per-retrieval write)
- Tier-aware retrieval boosting integrated into the existing RRF fusion

Preserve every existing primitive — pgvector, embedding pipeline, RLS isolation, hybrid retrieval, graph expansion, reranker, HyDE — and extend the existing decay and synthesis jobs in place. No replacement of shipped functionality.

## Tier column collision (must resolve at spec)

The existing `memory_blocks.tier smallint` (values `1=foundational, 2=strategic` for baseline-artefact injection filtering) collides with the new four-value enum. Three resolution paths the architect chooses between at spec authoring:

- **A — Two columns coexist.** Add `consolidation_tier text` (`working|episodic|semantic|procedural`). Existing `tier smallint` keeps its semantics for baseline-artefact injection. Minimal disruption; clearer separation of concerns. **Default recommendation.**
- **B — Rename existing.** Migrate `tier smallint` → `baseline_tier smallint` (Boy-Scout rename for clarity), then add the new `tier text` enum. More invasive but yields cleaner long-term naming.
- **C — Reuse single column with wider domain.** Out of scope — different concepts; would break F1 baseline-artefacts injection logic.

The brief assumes **Path A** unless the architect overrides with rationale at spec authoring.

## Governance invariants

Memory is data, not policy. Non-negotiable across all four tiers (carried forward from v3.1 with minor edits):

1. **Advisory, not authoritative.** Retrieved memory informs agent reasoning but cannot bypass `PolicyEnvelopeResolver` enforcement.
2. **Procedural memory does not confer execution authority.** A stored procedure is a hint to a human-or-policy-approved workflow, never a trigger for autonomous privileged action.
3. **Synthesised memory remains untrusted output.** Promotion outputs pass through the existing extraction / safety normalisation pipeline.
4. **Consolidation cannot mutate audit history.** Tier promotion, decay, and reinforcement write new rows or update mutable score columns; they never rewrite immutable provenance (existing `memory_block_version_sources` lineage table from `memory-improvements`), citations, or original-block content.
5. **Tenant scoping is enforced at SQL.** No tier promotion, traversal, or decay update ever crosses `organisation_id × subaccount_id`. RLS continues to be the canonical enforcement layer; new columns inherit existing `memory_blocks` policies.
6. **Deletion and redaction cascade through derived data.** Memory deletion, redaction, or tenant cleanup propagates to derived memories, reinforcement records, retrieval traces, and any new graph edges introduced.

## Proposed approach (architect locks at spec)

### Tier 1 — Schema extension (consolidation tier + access timestamp)

Add `consolidation_tier text` to `memory_blocks` per **Path A** above, with values `working | episodic | semantic | procedural`. Add `last_accessed_at timestamptz` (or confirm an equivalent column exists) for the decay function. Inherit RLS policies; add to `rlsProtectedTables.ts` if a new table is introduced.

Backfill: default all existing blocks to `episodic` per the v3.1 invariant. Idempotent backfill job. No regression to behaviour for callers that ignore `consolidation_tier`.

### Tier 2 — Consolidation / promotion logic (extending memoryBlockSynthesisService)

Extend `server/services/memoryBlockSynthesisService.ts` (currently does confidence-tier routing) with **lifecycle promotion** as a distinct concern. Promotion rules driven by multi-signal reinforcement, not access count alone. Candidate signals (architect locks weighting): recency, reinforcement count, contradiction score, retrieval-success score, agent confidence, operator reinforcement, cross-session recurrence.

Transition rules:
- Working → episodic — low reinforcement threshold; routine promotion as a working observation persists across runs.
- Episodic → semantic — N related episodes consolidate into a generalised fact.
- Episodic → procedural — pattern is a repeatable procedure AND clears a **higher threshold** than the other tiers (procedural blast radius is larger). May require explicit operator confirmation; architect decides.

Extend `server/jobs/memoryBlockSynthesisJob.ts` to carry the promotion payload.

### Tier 3 — Ebbinghaus decay (extending memoryDecayJob)

`server/jobs/memoryDecayJob.ts` is today an 18-line stub with no decay formula or tier awareness. Replace with:

- Decay weight = `e^(-t/S)` where `t` is time since last access and `S` is tier-specific strength.
- Tier strengths: working (small `S`, fast decay), episodic (medium), semantic (large), procedural (no automatic decay, or very large `S`).
- **Compute decay at retrieval time, not at write time.** Avoids hot-row updates, write amplification, and audit noise.
- **Reinforcement-on-access is async or sampled, never synchronous-per-retrieval.** Prefer batched async updates or probabilistic reinforcement sampling. Every retrieval mutating a row is unacceptable at tenant scale.

### Tier 4 — Tier-aware retrieval boosting (extending hybridRetrieval)

Existing `hybridRetrieval.ts` produces RRF-fused candidates. Add tier-aware score multipliers applied **after** RRF fusion:

- Working tier — multiplier on candidates in conversational/recent contexts.
- Procedural tier — smaller multiplier in conversational contexts; larger in workflow-execution contexts.
- Semantic and episodic — neutral baseline.

Versioned retrieval configuration: tier multipliers stored as a versioned config (not hardcoded); every retrieval records the config version it ran against (for replayability).

**Do NOT re-implement** the existing graph layer, RRF, intent classification, HyDE, reranker, or recency boost. They are foundations; tier-aware boosting is a thin lens on top of them.

### Tier 5 — Optional deeper graph layer (architect decides at spec)

The current `graphExpansion.ts` joins entries by shared `task_slug`. If the architect determines that an explicit, governed `memory_block_edges` table is needed (with edge types, confidence scores, directionality, traversal-depth ceilings), it ships as part of this build. Otherwise this Tier is dropped and the existing task_slug join is retained.

If the table is introduced, the v3.1 graph-edge governance invariants apply: edge creation rules (explicit vs inferred), directionality, edge-confidence scoring, deletion semantics, contradiction handling, cycle handling, traversal-depth ceiling, per-node fan-out cap. Inferred edges (if used) must carry confidence scores and be distinguishable from explicit edges. Graph traversal is bounded; no unbounded BFS.

### Tier 6 — Multi-tenant safety (invariant)

Every promotion, decay, reinforcement, and (if introduced) edge operation MUST scope by `organisation_id` AND `subaccount_id` enforced at the SQL layer (RLS continues to apply). New `consolidation_tier` column and any new `memory_block_edges` table inherit the existing RLS policies on `memory_blocks` before merge.

## Operational constraints

- Decay compute is retrieval-time only — no write-amplification on the hot path.
- Reinforcement updates are async or sampled (architect locks strategy and rate).
- Promotion job batch size and cadence sized at spec; never unbounded scans.
- Tier-aware retrieval boost stays within the existing p95 latency budget for `workspaceMemoryService.retrieve` (baseline measured during spec authoring).
- If Tier 5 (explicit graph table) ships: explicit traversal-depth ceiling and per-node fan-out cap; no unbounded BFS.

## Determinism & replayability

- **Versioned retrieval configuration.** Tier multipliers and per-tier decay strengths stored as a versioned config; every retrieval records the config version.
- **Traceable retrieval decisions.** For each agent run, the top-k candidate set, per-retriever ranks, RRF scores, and post-fusion tier multipliers are persisted (or recomputable from persisted seeds) so a run can be replayed with identical ordering.

## Rollout & rollback

Tier-aware promotion, decay, and boosting ship behind a **behaviour flag** and stay flagged until validated against the curated evaluation set. Flipping the flag off must return retrieval ordering to today's behaviour (RRF + intent profiles + HyDE + reranker + recency boost — all already shipped) using the existing path. The new column(s) and any new tables remain in place (unused) so we never need to reverse a migration to recover.

## Constraints / non-goals

Stays from v3.1:
- **DO NOT** embed the agentmemory code or its `iii` engine. Pattern lift only.
- **DO NOT** swap embedding providers. Keep OpenAI `text-embedding-3-small`.
- **DO NOT** introduce a new vector DB. Stay on pgvector.
- **DO NOT** break existing memory consumers. Retrieval API surface stays stable; consolidation tier and decay are internals.
- **DO NOT** ship without a migration plan for existing flat-store blocks. Default existing blocks to `episodic`; document.

Added in v4.0:
- **DO NOT re-implement** RRF, graph expansion, intent classification, HyDE, reranker, or recency boost. They are shipped; extend them.
- **DO NOT** create a parallel retrieval module. Tier-aware boosting integrates into the existing `hybridRetrieval.ts` pipeline.
- **DO NOT** alter `memory_block_version_sources` (lineage) or `injected_entry_ids` (utility) shipped by memory-improvements. They compose against the new consolidation work; they do not get rebuilt.
- **DO NOT** repurpose the existing `tier smallint` column (F1 baseline artefacts). New column required per Path A above.
- **DO NOT** change `SynthesisTier` semantics in `memoryBlockSynthesisService.ts` (confidence routing). Lifecycle promotion is a distinct concern; architect locks the separation at spec.

## Files in scope (architect locks at spec authoring)

- `server/db/schema/memoryBlocks.ts` — add `consolidation_tier text` (and `last_accessed_at timestamptz` if not present)
- New migration under `server/db/migrations/` — column add + default backfill (`episodic`) + RLS inheritance audit
- `server/services/workspaceMemoryService/hybridRetrieval.ts` — tier-aware post-fusion boost (small, additive change)
- `server/services/workspaceMemoryService/retrieve.ts` — surface tier in candidate shape; persist tier metadata in retrieval trace
- `server/services/memoryBlockSynthesisService.ts` — promotion logic as distinct concern from confidence routing
- `server/jobs/memoryBlockSynthesisJob.ts` — payload extended for promotion
- `server/jobs/memoryDecayJob.ts` — replace stub with tier-aware Ebbinghaus implementation (compute at retrieval; this job only updates last-access markers)
- New: reinforcement tracker (async or sampled)
- Possibly: new `server/db/schema/memoryBlockEdges.ts` + migration + `rlsProtectedTables.ts` entry (Tier 5 — architect decides)
- `server/config/limits.ts` — new constants for tier multipliers, decay strengths, reinforcement sampling rate
- Tests: pure functions for tier-promotion rules, decay computation, reinforcement sampling, tier-boost application

## Out of scope

From v3.1 (carried forward):
- New memory write APIs for agents
- Cross-tenant memory sharing of any kind
- Memory export / import tooling
- A per-tenant UI for browsing the memory store
- Replacing the embedding model
- Memory-to-RAG integration with external knowledge bases
- Procedural memory granting autonomous execution authority

New in v4.0 (explicit non-rebuild list):
- RRF fusion (shipped; extend)
- Graph expansion via `task_slug` (shipped; extend if Tier 5 ships)
- Intent classification + retrieval profiles (shipped; reuse)
- HyDE, reranker, recency boost (all shipped; reuse)
- AKR semantic ranker (shipped under memory-improvements; separate path, no overlap)
- Lineage tracking (shipped under memory-improvements; consume, do not rebuild)
- Citation utility metric (shipped under memory-improvements; downstream consumer of the new consolidation work)

## Success criteria

Refreshed from v3.1 to acknowledge shipped baseline:

1. **Retrieval R@5 improves on a curated test set of 50 historical operator conversations** measured against current shipped behaviour (RRF + intent profiles + HyDE + reranker), not against a pre-shipping baseline. Spec author defines the test set.
2. **Existing memory consumers preserve API compatibility.** `workspaceMemoryService.retrieve` shape unchanged; tier and decay are internals. Regression evaluation set passes.
3. **Tenant isolation invariants hold under fuzz testing** for promotion, decay, reinforcement, and (if shipped) edge operations.
4. **Backfill of existing blocks to `episodic`** completes idempotently on every tenant without manual intervention.
5. **p95 retrieval latency stays within budget.** Baseline = current shipped `workspaceMemoryService.retrieve` p95 (measured during spec authoring); tier boost must not materially slow agents.
6. **Retrieval is replayable.** Given the same query, the same memory store, and the same retrieval-config version, RRF + tier-boost ordering reproduces identically.
7. **Memory-improvements compatibility.** Lineage rows continue to be written correctly by promotion paths; `injected_entry_ids` continues to be populated; no regression in `mv_memory_utility_30d`.

## What unblocks when this ships

- Personal Assistant agents distinguish "what we did this morning" (working) from "the decision we made last quarter" (semantic).
- Reporting Agents stop re-surfacing transient working observations as durable facts.
- A learned procedure for a repeating workflow can be promoted to `procedural` and surfaced in the right context, replacing one-shot regenerations.
- The reinforcement signal becomes the foundation for future learn-from-correction loops (composing with Trust & Verification Layer).

## Concurrent safety note

This build is isolated from the other in-flight pattern lifts (browser-vision-grounding, browser-hardening-primitives, task-preview-mode). Touches `server/services/workspaceMemoryService/`, `server/jobs/memoryDecayJob.ts`, `server/services/memoryBlockSynthesisService.ts`, and one schema column on `memory_blocks` — no overlap with the other concurrent work.

## Provenance

External repo deep-dive 2026-05-17 surfaced agentmemory as the highest-leverage pattern from the weekly trend roundup. Operator-ratified: pattern lift only, no code adoption (Sheets row 1, column D records the decision).

External performance and popularity claims (89k stars, R@5 95.2% on LongMemEval-S, flat-store baselines under 70%) are provenance context only. Spec acceptance relies on our own curated evaluation set, regression results, and tenant-safety tests — measured against current shipped behaviour, not against the agentmemory paper's baseline.

**v4.0 rewrite provenance:** 2026-05-18 deep code audit during spec-coordinator Step 3a (`tasks/builds/memory-tiered-consolidation/progress.md § Revise loop`) showed that v3.1 assumed missing primitives that are in fact shipped. Operator chose "Rewrite brief to scope-down" at the Step 3a gate. This rewrite re-frames every section against current `main` and drops the proposed re-introduction of shipped primitives.

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/memory-tiered-consolidation/brief.md
```
