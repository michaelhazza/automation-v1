# Intent — Memory Block Edges

**Build slug:** `memory-block-edges`
**Drafted:** 2026-05-19
**Author:** spec-coordinator (Opus, inline)
**Source brief:** `tasks/builds/memory-block-edges/brief.md` (DRAFT v1)
**Task class:** Significant
**UI-touching:** no — backend feature, operator UI explicitly deferred in brief

## Table of contents

1. Problem Statement
2. Desired Outcome
3. Non-Goals
4. Affected Capability Area
5. User / Operator Impact
6. Risk Surface
7. Assumptions
8. Open Questions
9. Duplication / Strategy Check
10. Grill-me Q&A

## Problem Statement

`memory-tiered-consolidation` (PR #351, merged 2026-05-18) deferred its Tier 5 — an explicit `memory_block_edges` table for typed relationships between memory blocks. Four concrete retrieval / governance failures already live in that gap today:

1. **Contradictions are invisible** — two memory blocks can hold contradictory facts; the ranker may surface either with no signal that they conflict.
2. **Synthesis lineage is partial** — version lineage exists ("block v2 was derived from block v1") but not semantic-block-derived-from-episodic-blocks.
3. **Amendment ↔ memory provenance is implicit** — the closed-loop RCA references memory blocks in prose; the "this amendment validates / invalidates these memories" link is not first-class.
4. **Cross-task / cross-skill connections are not retrievable** — a memory matters for tasks of shape X regardless of `task_slug`; the current `graphExpansion.ts` join cannot express this.

The brief escalates the deferred Tier 5 priority pre-emptively (rather than waiting for the audit-trigger named in `memory-tiered-consolidation`'s deferred-items list).

## Desired Outcome

A new `memory_block_edges` table with typed relationships between memory blocks, written transactionally by the source operation that produces them (synthesis, amendment lifecycle, contradiction detector, operator action). Edges are RLS-scoped, soft-delete-only, and feed into the existing RRF fusion pipeline through bounded traversal alongside the current `task_slug` join. Six v1 edge types: `contradicts`, `validates`, `invalidates`, `derived_from`, `supersedes`, `relates_to`. Behind feature flag `MEMORY_BLOCK_EDGES_ENABLED` (default OFF), with flag-on gated on an extended audit script returning `pass` across four consecutive weekly runs (mirrors the `memory-tiered-consolidation` gate pattern).

## Non-Goals

- General-purpose graph database — stay on Postgres; edges are one new table.
- LLM-inferred edges from raw text — v1 edges are operator-explicit, synthesis-derived, contradiction-detector-derived, or amendment-derived.
- Cross-tenant traversal — edges are RLS-scoped and never cross `organisation_id × subaccount_id`.
- Operator UI for browsing the edge graph — follow-up build.
- Replacing the existing `task_slug` join — both retrievers compose alongside each other under RRF.
- Hard-deleting edges — soft-delete (`tombstoned_at`) only.
- Cycle detection — bounded traversal absorbs cycles safely; no algorithmic cycle detection in v1.
- Backfilling edges across historical synthesis runs or historical amendments — forward-only from flag-on; historical data remains edge-less.
- Editing edges via operator API — operator can tombstone or set confidence; cannot rewrite `edge_type` or `provenance`.

## Affected Capability Area

Memory & Knowledge

## User / Operator Impact

No new operator surface in v1. Operators see indirect impact through retrieval quality: agents reason from more cleanly-connected memory (contradictions surfaced, lineage traversable, amendment provenance explicit). The audit script's new edge checks land as structured logs only — no dashboard. Operator-facing UI is explicitly out of scope and routed to a follow-up build.

## Risk Surface

server/db/schema, RLS migrations, agent runtime

## Assumptions

- The existing `memory_blocks`, `memory_block_version_sources`, `memory_block_versions`, `skill_amendments` tables, the `memoryConsolidationConfig` versioned-config primitive, the `featureFlags.ts` env-var pattern, and the `RLS_PROTECTED_TABLES` manifest all remain stable on the timescale of this build.
- The audit script `scripts/audit/audit-memory-consolidation.ts` already exists (shipped with `memory-tiered-consolidation`) and is the canonical extension point for new edge-specific checks — no new audit script is created.
- The `correctionPatternDetector` job is the natural sibling for the contradiction-detector logic; whether to fold or run as a peer job is an architecture call locked at spec.
- The `skill_amendments.rcaJson` JSONB column can be extended with a `cited_memory_block_ids: string[]` field (or equivalent) — `closed-loop-skill-improvement` (PR #353, merged 2026-05-18) gives the amendment service a stable surface to write to.
- The `memory.block.edge_*` event family is new and additive; LAEL's discriminated-union validator accepts the new event types via the existing extension pattern.
- The `memory.retrieved` event payload can be extended with edge-traversal trace fields when the flag is on (mirrors the tier-multiplier traceability pattern shipped by `memory-tiered-consolidation`).
- pgvector / embedding shape stays unchanged — edges do not embed.

## Open Questions

1. **Edge endpoint scope** — the brief declares `from_block_id` / `to_block_id` both FK to `memory_blocks`. But `memoryBlockSynthesisService` clusters `workspace_memory_entries` (not blocks) to mint a new memory_block. The natural `derived_from` edge has heterogeneous endpoints. Options: (a) constrain endpoints to block↔block; record "synthesised from this cluster" in the existing `memory_block_version_sources` only and let `derived_from` edges fire only between distinct blocks; (b) widen schema with optional entry-endpoint columns; (c) polymorphic `(target_kind, target_id)`. **Locked at spec: option (a)** — preserves the brief's block↔block invariant and avoids polymorphic-FK pitfalls; `derived_from` records the "this semantic block was derived from those other blocks" relationship that the brief's Problem #2 actually describes. The synthesis-cluster→workspace-entry lineage stays in `memory_block_version_sources`.

2. **Retrieval surface** — brief says "Extend `graphExpansion.ts`" but that file operates on `workspace_memory_entries`, not `memory_blocks`. Options: (i) extend `graphExpansion.ts` to walk one hop into the block graph for any candidate workspace entry that has a corresponding active memory_block (lookup via `memory_block_version_sources` reverse-walk), then traverse block edges from there. Edge-discovered blocks rejoin as workspace entries via the synthesis lineage; (ii) run as a parallel retriever on the memory_blocks injection path. **Locked at spec: option (i)** — keeps the RRF surface single-leg.

3. **Skill-amendment ↔ memory_block linkage** — `skill_amendments.rcaJson` is freeform JSONB. **Locked at spec:** extend the `rcaJson` shape to add a `cited_memory_block_ids: string[]` field, validated by Zod at write time. The amendment-accept and amendment-retire transactions then read that array and emit `validates` / `invalidates` edges atomically.

4. **Contradiction detector — fold or peer?** — brief says "architect may fold into `correctionPatternDetector`". **Locked at spec: peer job (`memoryBlockContradictionDetectorJob.ts`)** — triple-extraction (S+P+O) is meaningfully different from embedding-similarity clustering; folding risks coupling unrelated detector lifecycles.

5. **`derived_from` edge vs `memory_block_version_sources` overlap** — the existing version-sources table records "block version derived from those workspace entries"; the new `derived_from` edge records "block A derived from block B". **Locked at spec:** document the boundary in non-goals; `memory_block_version_sources` keeps its current semantics; `derived_from` edges fire only when synthesis takes existing blocks as inputs (block-of-blocks synthesis, currently rare but planned).

6. **Bounded traversal — depth ceiling + fan-out cap defaults** — brief says configurable via `MemoryConsolidationConfig`. **Locked at spec: default `edgeTraversalDepth = 2`, `edgeTraversalFanout = 5` per node, behind config version bump 2.**

7. **Edge-type-specific score multipliers** — brief says architect locks. **Locked at spec:** `contradicts = 0` (suppress the contradicted candidate's contribution to the retriever; emit a contradiction signal separately); `validates = 1.2`; `invalidates = 0.6`; `derived_from = 1.1`; `supersedes = 1.3`; `relates_to = 1.0`. Combined with `confidence × log(1+evidence_count)` scaling.

8. **`memory.retrieved` payload extension** — should the retrieved-event payload include traversed-edge IDs and types? **Locked at spec: yes** — include `traversed_edges: { id, type, confidence }[]` (capped at 20) when the flag is ON; emit empty array when OFF. Mirrors the `memory_consolidation_config_version` traceability shipped by `memory-tiered-consolidation`.

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

**Asset Register row scan (cluster: Memory & Knowledge):**

- `memory-knowledge-system` (Mature) — multi-layered memory architecture with provenance and drift detection. **No overlap** — typed edges between blocks are an additive surface, not present in the existing capability shape.
- `Memory Tiered Consolidation` (Growth, added 2026-05-18) — four-tier consolidation lifecycle. **No overlap** — this build is the Tier-5 deferred extension explicitly named in that capability's deferred-items list; it is the successor, not a competitor.
- `document-bundles-cached-context` (Growth) — reusable document libraries. **No overlap** — different memory layer.
- `memory-injection-utility` (Growth) — citation tracking + utility metrics. **No overlap** — read/analytics surface; this build is a write-time relationship surface.

**In-flight spec scan (`tasks/builds/*/intent.md`, `*/spec.md`, `*/brief.md`):**

- `memory-tiered-consolidation` — MERGED (PR #351). This build is the explicit Tier-5 deferred extension named in that build's deferred-items list.
- `closed-loop-skill-improvement` — MERGED (PR #353). This build consumes the amendment-accept lifecycle that build delivered to emit `validates` / `invalidates` edges. Confirmed prerequisite.
- `memory-outcome-feedback` (sister brief at `tasks/builds/memory-outcome-feedback/brief.md`) — concurrency-noted in the source brief: "Should NOT run concurrent with `memory-outcome-feedback` if both are scoped at the same time. Sequence them." This build runs first.

**Strategic fit:** Memory & Knowledge cluster is in `Mature`/`Growth` lifecycle states (per Asset Register). Extension is normal. `clear` per spec-coordinator §3a tie-break (no Sunset-track rows). Single-cluster intent — no supplementary per-cluster rows needed.

**Recommendation: proceed.**

## Grill-me Q&A

**SKIPPED — REVIEW_GAP.** Remote autonomous session; no operator interview channel available. Per spec-coordinator §3b skip rule, the brief comprehensively addresses the grill topics: scope boundaries (Non-goals + Out of scope), dependency assumptions (Concurrent safety note + Prerequisites), failure modes (Operational constraints), operator surfaces (out of scope — explicit), capability cluster fit (Memory & Knowledge, this intent §Affected Capability Area), and open questions (8 enumerated above with locked recommendations). The "every entry in Open Questions" topic is covered by the locked recommendations inline. Recorded in `progress.md § REVIEW_GAP entries`.


