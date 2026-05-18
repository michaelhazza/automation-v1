# Brief — Memory Block Edges (Tier 5: typed relationships between memory blocks)

**Status:** DRAFT v1 (2026-05-18) — promoted from `memory-tiered-consolidation` deferred Tier 5; operator-captured from LinkedIn trend analysis
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `memory-block-edges`
**Class:** Significant
**Source pattern:** dreamgraph (https://github.com/mmethodz/dreamgraph) typed-edge taxonomy and confidence/evidence/provenance schema; localmem (https://github.com/jordanaftermidnight/localmem) temporal-triple contradiction detection. Pattern lift only — no code adoption.
**Surfaces validated against main:** commit `6e48183` (2026-05-19). Extension targets confirmed: `server/services/workspaceMemoryService/graphExpansion.ts`, `server/services/memoryBlockSynthesisService.ts`, `server/services/skillAmendmentService.ts`, `server/jobs/correctionPatternDetectorJob.ts`, `server/config/memoryConsolidationConfig.ts`. No competing in-flight spec (verified against `docs/superpowers/specs/` and `tasks/builds/` on 2026-05-19).

## Table of contents

1. What already exists (extends — does NOT re-introduce)
2. Problem
3. Goal
4. Non-goals
5. Proposed approach (architect locks at spec)
6. Operational constraints
7. Determinism & replayability
8. Rollout & rollback
9. Files in scope
10. Out of scope
11. Success criteria
12. What unblocks when this ships
13. Concurrent safety note
14. Provenance
15. How to start

---

## What already exists (extends — does NOT re-introduce)

- **Graph expansion via shared `task_slug`** — `server/services/workspaceMemoryService/graphExpansion.ts` is the current "graph retriever" leg of RRF fusion. It joins memory entries that share a `task_slug`.
- **Memory block version lineage** — `memory_block_version_sources` (shipped under `memory-improvements`, PR #298) records parent → child relationships between *versions of the same block*. This is structural lineage, not semantic relationship between distinct blocks.
- **Synthesis output** — `memoryBlockSynthesisService` mints consolidated blocks (`high|low` confidence routing). The "this semantic block was derived from those episodic blocks" relationship is implicit in the synthesis payload but not first-class in the graph.
- **`correctionPatternDetector`** — daily clusters memory blocks by embedding similarity. Cluster membership is computed; cluster *relationships* (this contradicts that) are not stored.
- **`skill_amendments`** — accepted amendments cite their RCA; the RCA references memory blocks but the "this amendment validates that memory" link is not stored.

## Problem

`memory-tiered-consolidation` (PR #351, merged 2026-05-18) deferred its **Tier 5** — an explicit `memory_block_edges` table for typed relationships between memory blocks. The deferred-items list in that handoff names the trigger condition as "audit shows the `task_slug` join is too coarse for operator-experienced retrieval failures." This brief escalates the priority pre-emptively because four concrete retrieval / governance failures already live in that gap today:

1. **Contradictions are invisible.** Two memory blocks can hold contradictory facts (same subject + predicate, different object — e.g. "client prefers Slack" → later "client prefers email"). The retrieval ranker may surface either; nothing flags the contradiction. localmem's temporal-triple contradiction pattern resolves this cleanly; we have no schema surface to record it.
2. **Synthesis lineage is partial.** Version-lineage exists for "block v2 was derived from block v1" but not for "semantic block B was derived from episodic blocks A1, A2, A3." Operators (and audits) cannot answer "why did the agent believe this semantic fact?"
3. **Amendment ↔ memory provenance is implicit.** When a skill amendment is accepted, the closed-loop RCA references memory blocks that informed the failed run. The "this amendment validates / invalidates these memories" edge is implicit in RCA prose, not first-class — so the `memory-outcome-feedback` work (sister brief) has to re-derive it from prompt-injection logs rather than reading an edge.
4. **Cross-task / cross-skill connections are not retrievable.** A memory block matters for tasks of *shape* X regardless of `task_slug`. The current join cannot express this. RRF compensates partially via embedding similarity, but explicit semantic relationships are the cleaner signal.

Adding typed edges unlocks all four cases without changing how memory blocks themselves are stored.

## Goal

Add an explicit `memory_block_edges` table with typed relationships between memory blocks (and from memory blocks to skill amendments). v1 edge types:

- `contradicts` — block A asserts a fact that block B contradicts
- `validates` — accepted amendment confirms the memory cited in its RCA
- `invalidates` — accepted amendment shows the memory cited was wrong (or retired amendment that previously validated)
- `derived_from` — synthesis emitted block A from source blocks A1..An
- `supersedes` — block A is the newer canonical version of block B (distinct from version-lineage; this is *semantic* supersession across distinct blocks)
- `relates_to` — coarse cross-task semantic relationship (intent-classifier-derived; lowest confidence)

Every edge carries: `confidence` ∈ [0, 1], `evidence_count` (incremented on re-confirmation), `provenance` (one of `operator | synthesis | contradiction_detector | amendment`), `source_ref` (FK to source artefact when applicable — amendment id, synthesis run id, etc.), directionality, `tombstoned_at` (soft-delete; never hard-delete edges).

`graphExpansion.ts` extended to traverse typed edges *in addition to* the existing `task_slug` join. Both retrievers contribute candidates to the existing RRF fusion. Bounded traversal (depth ceiling + per-node fan-out cap; no unbounded BFS).

Ships behind a feature flag `MEMORY_BLOCK_EDGES_ENABLED`, default OFF. Flag-on per environment after the existing memory-consolidation audit script (extended) confirms edge quality across four consecutive weekly runs (mirrors the gate pattern shipped by `memory-tiered-consolidation`).

## Non-goals

- **DO NOT** introduce a general-purpose graph database. Stay on Postgres; edges are one new table.
- **DO NOT** infer edges from raw text via LLM. v1 edges are operator-explicit, synthesis-derived, contradiction-detector-derived, or amendment-derived — never LLM-inferred from prose alone. (Future bet, not v1.)
- **DO NOT** cross tenant boundaries. Edges are RLS-scoped. No cross-tenant traversal under any condition.
- **DO NOT** ship an operator UI for browsing the edge graph. Edges are API + audit-script readable in v1. UI is a follow-up.
- **DO NOT** replace the existing `task_slug` join. Both retrievers compose alongside each other under RRF.
- **DO NOT** hard-delete edges. Soft-delete (`tombstoned_at`) only — preserves audit history.
- **DO NOT** detect cycles in v1. Cycles are allowed; traversal is bounded by depth ceiling so cycles do not cause infinite loops.
- **DO NOT** require every memory block to have edges. Edge-less blocks are valid; the existing retriever path handles them.

## Proposed approach (architect locks at spec)

### Schema
New table `memory_block_edges`:
- `id` — UUID
- `org_id`, `subaccount_id` — tenancy
- `from_block_id`, `to_block_id` — FKs to `memory_blocks`
- `edge_type` — enum (`contradicts | validates | invalidates | derived_from | supersedes | relates_to`)
- `confidence` — float [0, 1]
- `evidence_count` — int (incremented on re-confirmation; bounded to prevent runaway)
- `provenance` — enum (`operator | synthesis | contradiction_detector | amendment`)
- `source_ref` — nullable text (amendment id, synthesis run id, etc., depending on provenance)
- `created_at`, `last_evidence_at`, `tombstoned_at` (nullable)
- RLS-protected; indexes on `(from_block_id)`, `(to_block_id)`, `(edge_type, org_id)`, `(provenance, org_id)`

### Services
- New `memoryBlockEdgeService.ts` + `*Pure.ts` — write/read/tombstone with RLS scoping
- New `memoryBlockContradictionDetectorJob.ts` (architect may instead fold into `correctionPatternDetector`) — scans memory blocks within a tenant for same-subject + same-predicate + different-object triples; writes `contradicts` edges with confidence; bounded scan window per cycle
- Extend `memoryBlockSynthesisService.ts` — when a semantic block is minted from episodic sources, write `derived_from` edges atomically in the same transaction as the synthesis output
- Extend `skillAmendmentService.ts` — when an amendment accepts, write `validates` edges to memory blocks cited in the RCA atomically; when an amendment is retired, write `invalidates` edges (or tombstone the prior `validates`)

### Retrieval
- Extend `graphExpansion.ts` — add typed-edge traversal alongside the existing `task_slug` join. Both retrievers feed RRF.
- Bounded: depth ceiling and fan-out cap configurable per retrieval profile via `MemoryConsolidationConfig`.
- Edge traversal scoring: edge contribution scaled by `confidence × evidence_count_log` × edge-type-specific multiplier (architect locks the multipliers).

### Observability
- New events: `memory.block.edge_created`, `memory.block.edge_tombstoned`, `memory.block.edge_evidence_added` — payload includes `edge_type`, `provenance`, `from_block_id`, `to_block_id`, `confidence`
- Counters per edge type per tenant per day in structured logs
- Edge data included in retrieval trace (for replayability)

### Audit-script extension
- Extend `scripts/audit/audit-memory-consolidation.ts`:
  - Check: edge-type distribution per tenant. Flags tenants where a type is empty after the warmup period.
  - Check: orphaned edges (FK target tombstoned but edge live).
  - Check: cycle-density warning (informational; does not fail audit).
  - Check: edge confidence distribution per type (flags unusually low or unusually uniform distributions).
  - Check: provenance distribution (flags tenants with disproportionate `operator` provenance — possibly a manual override pattern worth investigating).

## Operational constraints

- Contradiction-detector scan is bounded per cycle; cannot scan an unbounded portion of a tenant's memory in one run.
- Traversal is bounded — explicit depth ceiling and per-node fan-out cap. No unbounded BFS.
- Edge writes are transactional with their source operation (synthesis, amendment accept). No fire-and-forget edge writes.
- Tenant isolation enforced at SQL via RLS on the new table.
- p95 retrieval latency budget — tier-aware boost already shipped under memory-tiered-consolidation set the latency budget; edge traversal must not regress beyond that baseline (architect measures + locks at spec).

## Determinism & replayability

- Edge traversal is deterministic given the same edges + same retrieval config version (already recorded in retrieval trace by memory-tiered-consolidation).
- Edge-type multipliers, traversal depth, and fan-out cap stored in `MemoryConsolidationConfig`. Bump config version on change.

## Rollout & rollback

- Feature flag `MEMORY_BLOCK_EDGES_ENABLED`, default OFF in every environment.
- Flag-off behaviour: edges may be written by synthesis / amendment paths (so backfill is automatic when flag flips on), but `graphExpansion.ts` does NOT traverse them. Retrieval is identical to pre-build.
- Flag-on gate: audit script returns `pass` against staging for 4 consecutive weekly runs (mirrors memory-tiered-consolidation's gate pattern).
- Rollback: flip flag OFF. Edges remain in place; not traversed.

## Files in scope (architect locks at spec authoring)

- New schema: `server/db/schema/memoryBlockEdges.ts`; migration under `server/db/migrations/` — table + RLS policies + indexes
- Update `rlsProtectedTables.ts`
- New service: `server/services/memoryBlockEdgeService.ts` + `*Pure.ts`
- New job: `server/jobs/memoryBlockContradictionDetectorJob.ts` (architect may fold into `correctionPatternDetector`)
- Modify `server/services/workspaceMemoryService/graphExpansion.ts` — typed-edge traversal alongside task_slug join
- Modify `server/services/memoryBlockSynthesisService.ts` — emit `derived_from` edges on synthesis
- Modify `server/services/skillAmendmentService.ts` — emit `validates` edges on amendment accept; tombstone or invalidate on retire
- Modify `server/config/memoryConsolidationConfig.ts` — edge-type multipliers, depth ceiling, fan-out cap; bump config version
- Modify `scripts/audit/audit-memory-consolidation.ts` — new edge-specific checks
- Feature flag: `MEMORY_BLOCK_EDGES_ENABLED` in `server/config/featureFlags.ts`
- Tests: pure edge-write validation; contradiction-detector idempotency; traversal-depth ceiling; fan-out cap; RLS isolation across tenants; cycle-bounded traversal; synthesis-emits-derived_from atomically; amendment-emits-validates atomically

## Out of scope

- LLM-inferred edges from raw text (future bet)
- Operator UI for browsing the edge graph (follow-up)
- Hard-deletion of edges (soft-delete only)
- Cross-tenant edges (explicitly out)
- Cycle detection (bounded traversal absorbs cycles safely)
- Backfilling edges across historical synthesis runs or historical amendments (forward-only from flag-on; historical data remains edge-less)
- Editing edges via operator API (operator can tombstone or set confidence via API; cannot rewrite `edge_type` or `provenance`)

## Success criteria

1. Contradictory memory blocks within a tenant are auto-tagged with `contradicts` edges by the detector job; visible via API and audit script.
2. Synthesis emits `derived_from` edges atomically every time a semantic block is minted from episodic sources; lineage queries through edges produce the same results as version-lineage queries (overlap is intentional; one is structural, one is semantic).
3. Amendment-derived `validates` edges land atomically with the amendment accept transaction; `invalidates` (or tombstone) on retire.
4. Retrieval R@5 on a curated test set improves measurably when edges are flag-on vs flag-off, on cases the audit script's seeded fixtures cover.
5. Tenant isolation invariants hold under fuzz testing — no edge ever crosses `organisation_id × subaccount_id`. RLS fuzz tests pass.
6. Traversal is bounded — depth ceiling and fan-out cap hold under adversarial graph shapes. Retrieval never scans an unbounded subgraph.
7. Audit script's new edge checks pass against a seeded fixture set.
8. Flag-off behaviour: edges may be written but never traversed. Retrieval bit-identical to pre-build.

## What unblocks when this ships

- Contradiction detection becomes first-class instead of buried in retrieval ranking.
- Synthesis lineage becomes traversable across distinct blocks (not just versions of the same block).
- `memory-outcome-feedback` (sister brief) gains a cleaner provenance surface — instead of re-deriving "which memories did this amendment validate" from prompt-injection logs, it reads `validates` / `invalidates` edges directly.
- Closed-loop amendments and memory consolidation share a relational surface; the two systems compose.
- Foundation for an operator-facing memory inspector UI (follow-up).
- Foundation for richer retrieval profiles that exploit specific edge types per task shape.
- Removes the implicit dependency on `task_slug` as the only graph signal.

## Concurrent safety note

Touches `workspaceMemoryService/graphExpansion.ts`, `memoryBlockSynthesisService.ts`, and `skillAmendmentService.ts`.

Prerequisites — both must be merged before this brief proceeds:
- `memory-tiered-consolidation` — merged 2026-05-18 (PR #351) ✓
- `closed-loop-skill-improvement` — merged 2026-05-18 (PR #353) ✓

Should NOT run concurrent with `memory-outcome-feedback` if both are scoped at the same time — both touch the retrieval signal layer and the amendment-write path. Sequence them. Recommendation: run `memory-block-edges` first because it gives `memory-outcome-feedback` a cleaner provenance surface; the order also matches the cleaner dependency direction (outcome-feedback can consume `validates` / `invalidates` edges once they exist).

No collision with `task-preview-mode`, `browser-vision-grounding`, or `browser-hardening-primitives`.

## Provenance

Deferred from `memory-tiered-consolidation` brief v4.0 (Tier 5, operator decision Round 1 — "defer; trigger: audit shows task_slug join too coarse"). LinkedIn trend analysis 2026-05-18 (operator-anchored deep dive on persistent-memory / overnight-agent post) escalates the priority pre-emptively based on four concrete in-codebase use cases that benefit from typed edges today, without waiting for the audit trigger.

External pattern provenance:
- Edge-type taxonomy (`contradicts | validates | invalidates | derived_from | supersedes | relates_to`) and confidence / evidence / provenance schema lifted from dreamgraph's `DreamEdge` shape
- Contradiction-detection pattern (same-subject + same-predicate + different-object) lifted from localmem's temporal-triple supersession
- No external code adoption; pattern lift only

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/memory-block-edges/brief.md
```
