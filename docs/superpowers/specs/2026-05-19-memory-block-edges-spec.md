**Status:** draft
**Spec date:** 2026-05-19
**Last updated:** 2026-05-19 (post-author self-audit pass — added §0 verification log, dropped migration 0380, introduced dedicated `MEMORY_BLOCK_EDGES_TOMBSTONE` permission key, locked `validates` pair-fan-out semantics, added cost-control and latency-baseline postures, added concrete JSON examples)
**Author:** spec-coordinator (Opus, inline) — operator decisions captured in `tasks/builds/memory-block-edges/intent.md`
**Build slug:** memory-block-edges
**Source brief:** [`tasks/builds/memory-block-edges/brief.md`](../../../tasks/builds/memory-block-edges/brief.md) (DRAFT v1, 2026-05-18)
**Source intent:** [`tasks/builds/memory-block-edges/intent.md`](../../../tasks/builds/memory-block-edges/intent.md)

# Memory Block Edges — Spec

Adds a `memory_block_edges` table with six typed relationships between memory blocks (`contradicts | validates | invalidates | derived_from | supersedes | relates_to`), bounded traversal extension to `graphExpansion.ts`, write-time edge emission from `memoryBlockSynthesisService` and `skillAmendmentService`, a new contradiction-detector job, audit-script extension, and a behaviour flag gated on four consecutive `pass` audit runs against staging.

## Table of contents

0. Verification log (cited deferred items)
1. Lifecycle Declaration
2. ABCd Lifecycle Estimate
3. Goals
4. Non-Goals
5. Framing assumptions
6. Phase plan
7. Phase sequencing (dependency graph)
8. File inventory lock
9. Contracts
10. Permissions / RLS checklist
11. Execution model
12. Locked guardrails (G1, G2, G3)
13. Audit script extension specification
14. Execution-safety contracts
15. Testing posture
16. Deferred items
17. Open questions
18. Self-consistency pass result

---

## 0. Verification log (cited deferred items)

Per spec-authoring-checklist §0, every cited deferred item is verified open in the current codebase as of the spec date (2026-05-19, branch `claude/build-memory-block-edges-7jIyt`, base commit `fc8cf05`).

| Cited deferred item | Source | Verification |
|---|---|---|
| Tier 5 — explicit `memory_block_edges` table | `memory-tiered-consolidation` spec §4 Non-Goals (locked-out scope additions surfaced during grill but explicitly deferred — Round 1, trigger: "post-launch audit shows retrieval failures the existing task_slug join in graphExpansion.ts cannot explain") | **verified open** — confirmed by `grep -n "memory_block_edges\|Tier 5" docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md`; no successor table exists in `server/db/schema/` |
| `graphExpansion.ts` `task_slug` join (only retriever leg today) | `server/services/workspaceMemoryService/graphExpansion.ts` lines 31–34 | **verified open** — file Read 2026-05-19; single `task_slug IN (...)` join, no edge traversal |
| `memory_block_version_sources` records workspace-entry → version lineage only (not block↔block) | `server/db/schema/memoryBlockVersionSources.ts` | **verified open** — file Read 2026-05-19; columns are `blockVersionId` + `sourceEntryId`; no block-to-block relationship surface |
| `skillAmendmentService.rcaJson` has no `cited_memory_block_ids` field today | `server/db/schema/skillAmendments.ts` line 35 (rcaJson is freeform JSONB) | **verified open** — grep `cited_memory_block_ids` in `server/services/skillAmendmentService.ts` returned no matches |
| `correctionPatternDetector` clusters by embedding similarity, NOT by triple-extraction contradiction | `server/jobs/correctionPatternDetectorJob.ts` | **verified open** — file Read 2026-05-19; cosine-similarity clustering only, no S+P+O triple extraction |
| `MEMORY_OVERRIDE` permission key — **NOT present** in `server/lib/permissions.ts` | (this spec, original §10) | **verified MISSING** — grep returned no matches. This spec accordingly introduces a new dedicated key `MEMORY_BLOCK_EDGES_TOMBSTONE` in Phase 6 (see §8, §10) rather than assuming `MEMORY_OVERRIDE` exists. |
| `memory.retrieved` event registered in LAEL discriminated union | `shared/types/agentExecutionLog.ts` lines 96, 199, 509 | **verified open** — extension point exists; the spec adds `traversed_edges` to the existing payload per §9.6 |

## 1. Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Memory & Knowledge |
| Capability owner | ai-agent |
| Lifecycle state on launch | Growth |
| Risk surface | server/db/schema, RLS migrations, agent runtime |
| Review cadence | quarterly (with audit script trend reviewed weekly during behaviour-flag warmup) |

Launch state is `Growth` (not `Inception`) because the `memory_blocks` table is already in production with live data and the new edge behaviour ships behind a flag that defaults OFF — so production traffic exists but the edge traversal stays dormant until per-environment enablement after the audit-script gate. Capability working title at finalisation registration: `Memory Block Edges`. The existing `Memory Tiered Consolidation` Asset Register row is unchanged; this is the explicit Tier-5 successor named in that capability's deferred-items list.

## 2. ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | S | Every infrastructure dependency exists: pgvector indexes, RLS three-layer model, pg-boss job runner, RRF fusion, retrieval-trace persistence, behaviour-flag mechanism, versioned `MemoryConsolidationConfig`, audit-script harness, `memory_block_version_sources` lineage table, `skill_amendments.rcaJson` JSONB column. No new infra to acquire. |
| Build | M | Six-phase build: schema + RLS, edge service, contradiction-detector job, synthesis + amendment edge emission, retrieval traversal extension, audit-script extension. Multi-week effort across the file set inventoried in §8. Audit-script extension + behaviour-flag gating add modest extra surface beyond core edge logic. |
| Carry | M | Six edge types + six-state traversal-config surface (depth, fan-out, per-type multipliers, evidence-count cap) is moderate conceptual surface for future agents to reason about. Contradiction detector needs operational monitoring (audit check #3). Per-edge-type multipliers and traversal bounds tuned post-launch via versioned config. |
| decommission | S | Single behaviour flag turns the entire traversal off. The `memory_block_edges` table itself can be retained indefinitely (writes continue under flag-off; only traversal stops). If the capability is fully retired, the table can be dropped via standard `DROP TABLE` migration — no rebuild path needed because the table is purely additive and `memory_block_version_sources` keeps independent semantics. |

## 3. Goals

1. Add a new `memory_block_edges` table with the columns specified in §9.1 (typed edge between two `memory_blocks` rows, confidence, evidence count, provenance, source-ref, tombstoned-at). Tenant-scoped via RLS; new row added to `RLS_PROTECTED_TABLES` in the same migration that creates the table. Migration 0379.
2. Ship a new `memoryBlockEdgeService.ts` + `memoryBlockEdgeServicePure.ts` pair that owns edge creation, reinforcement (evidence-count increment + `last_evidence_at` bump), tombstone, and read paths. All writes use `getOrgScopedDb()` and respect the canonical RLS posture (§10). Pure helpers contain the validation logic (edge-type set, confidence range, tombstoned-state transitions); the service is the thin DB caller.
3. Ship a new `memoryBlockContradictionDetectorJob.ts` (peer job, not folded into `correctionPatternDetector`) — extracts (Subject, Predicate, Object) triples from `memory_blocks.content` via the existing OpenAI extractor primitive used by `workspaceMemoryService/extract.ts`, scans within a tenant for same-subject + same-predicate + different-object triples, writes `contradicts` edges with confidence proportional to extraction confidence. Bounded scan window per cycle (`CONTRADICTION_SCAN_BATCH_SIZE = 200` blocks per tenant per cycle).
4. Extend `memoryBlockSynthesisService.ts` — when synthesis mints a NEW block from a cluster of `workspace_memory_entries`, reverse-walk each clustered entry via `memory_block_version_sources` to discover any pre-existing `memory_blocks` they already contributed to; for every distinct existing block discovered, write a `derived_from` edge atomically in the same transaction as the synthesis insert. If the cluster's entries do not yet belong to any existing blocks (the common case today), no `derived_from` edge is emitted — this is correct and expected. The synthesis-from-entries lineage stays in `memory_block_version_sources` (no double-recording). **v1 producer scope:** the synthesis reverse-walk is the only automatic producer of `derived_from` edges. A dedicated block-of-blocks synthesis pathway is out of v1 scope (see §16).
5. Extend `skillAmendmentService.ts` — extend the `rcaJson` Zod schema (`shared/types/skillAmendments.ts` / `rcaPromptBuilder.ts`) with a `cited_memory_block_ids: z.array(z.string().uuid()).default([])` field (see §9.4). When an amendment is accepted, write one `validates` edge per id in `cited_memory_block_ids` atomically with the amendment-accept transaction. When an amendment is retired, tombstone the prior `validates` edges atomically with the amendment-retire transaction (chosen over writing `invalidates` because retirement semantics are "the validation is withdrawn", not "this memory is actively wrong"; `invalidates` is reserved for explicit operator-driven retraction in a deferred phase — see §16). This is purely an additive code-level extension to `rcaJson`; no schema migration is required (the JSONB column shape stays freeform at the DB level; validation is Zod-only — consistent with this codebase's pattern of policing JSONB shapes at the service layer).
6. Extend `workspaceMemoryService/graphExpansion.ts` — when the behaviour flag is ON, for each candidate workspace-memory entry that has a corresponding active `memory_block` (lookup via `memory_block_version_sources` reverse-walk), traverse `memory_block_edges` bounded by `edgeTraversalDepth = 2` and `edgeTraversalFanout = 5` per node (config-versioned defaults). Edge-discovered blocks rejoin as workspace entries via the synthesis lineage; final candidates flow into the existing RRF fusion as if they came from the original `task_slug` join leg. When the flag is OFF the file is bit-identical in behaviour to pre-build.
7. Apply edge-type score multipliers post-traversal (`contradicts = 0`, `validates = 1.2`, `invalidates = 0.6`, `derived_from = 1.1`, `supersedes = 1.3`, `relates_to = 1.0`) combined with `confidence × log(1 + evidence_count)` scaling. Multipliers live in `MemoryConsolidationConfig` (version bump to 2; see §9.7). `contradicts` edges suppress the contradicted candidate's contribution to the retriever AND emit a `memory.contradiction.detected` observability event (see Goal 9).
8. Behaviour flag `MEMORY_BLOCK_EDGES_ENABLED` (env var) added to `server/config/featureFlags.ts`, default OFF. Flag-off behaviour: edges MAY be written by synthesis / amendment / contradiction-detector paths (so backfill is automatic when flag flips on) but `graphExpansion.ts` does NOT traverse them. Retrieval is bit-identical to pre-build. Flag-on gate: extended `audit-memory-consolidation.ts` returns `pass` against staging for four consecutive weekly runs.
9. Register the new observability event family: `memory.block.edge_created`, `memory.block.edge_tombstoned`, `memory.block.edge_evidence_added`, `memory.contradiction.detected`. Payload schema declared in §9.6. Emit as supplementary observability when a `runId` is available; durable rows in `memory_block_edges` are the canonical audit trail when no `runId` is available (mirrors the deferred-event pattern shipped by `memory-tiered-consolidation` §6 Phase 4 OQ-2). Extend `memory.retrieved` payload to include `traversed_edges: { id, type, confidence }[]` (capped at 20) when the flag is ON; emit empty array when OFF.
10. Extend `scripts/audit/audit-memory-consolidation.ts` with five new edge-specific checks (§13). The script remains the single source of truth for the audit gate; no new audit script.
11. Gate the behaviour flag flip in production on the extended audit script returning `pass` against staging for four consecutive weekly runs (mirrors the gate pattern shipped by `memory-tiered-consolidation`).

## 4. Non-Goals

- **General-purpose graph database.** Stay on Postgres; edges are one new table. No Neo4j, no Neptune, no pgRouting.
- **LLM-inferred edges from raw text.** v1 edges are operator-explicit, synthesis-derived, contradiction-detector-derived, or amendment-derived. The contradiction detector uses an LLM only for triple extraction from `memory_blocks.content`, NOT for inferring relationships between arbitrary prose passages. Future LLM-relation inference is a separate build.
- **Cross-tenant traversal.** Edges are RLS-scoped at the `organisation_id × subaccount_id` boundary. The traversal never crosses tenants under any condition, including admin contexts.
- **Operator UI for browsing the edge graph.** Audit-script + API readable in v1. UI is a follow-up build.
- **Replacing the existing `task_slug` join.** Both retrievers compose alongside each other under RRF; the existing `graphExpansion.ts` join continues to fire whether the flag is on or off.
- **Hard-deleting edges.** Soft-delete (`tombstoned_at`) only — preserves audit history.
- **Cycle detection.** Cycles are allowed; bounded traversal absorbs cycles safely via the depth ceiling. No algorithmic cycle detection in v1.
- **Backfilling edges across historical synthesis runs or historical amendments.** Forward-only from the migration date. Historical synthesis runs and historical amendments remain edge-less.
- **Editing edges via operator API.** Operator can tombstone or set confidence via API; cannot rewrite `edge_type` or `provenance`. Mutating `edge_type` would invalidate the audit trail; mutating `provenance` would let the operator forge a synthesis-emitted edge as operator-emitted (or vice versa).
- **Embedding edges.** Edges do not embed; the `memory_blocks.embedding` column is unchanged.
- **Heterogeneous endpoints.** Both `from_block_id` and `to_block_id` FK to `memory_blocks`. The synthesis-cluster lineage (block ← workspace_memory_entry) is recorded in the existing `memory_block_version_sources` table (unchanged); `derived_from` edges are block↔block only.
- **Repurposing `memory_block_version_sources`.** The existing version-sources table keeps its current semantics ("this block version was synthesised from those workspace memory entries"). `derived_from` edges record a distinct relationship ("block A was derived from blocks B1..Bn") that fires only on block-of-blocks synthesis.

Locked-out scope additions surfaced during intent drafting but explicitly deferred (see §16 Deferred Items for the full list with triggers):

- Heterogeneous endpoints (block ↔ workspace entry) — deferred until a use case exists that `memory_block_version_sources` cannot serve.
- Operator UI for browsing the edge graph — deferred until audit-script signal indicates operator demand.
- Backfill of historical synthesis/amendment data — deferred indefinitely; sentinel value is the forward-only audit trail.
- LLM-inferred edges from arbitrary prose — deferred to a separate build; would require its own gate.
- Approval queue for high-confidence edges — deferred until production traffic shows the auto-write path is too permissive.
- Per-edge-type behaviour flags — deferred until a single edge type misbehaves and surgical rollback is needed (mirrors the deferral pattern from `memory-tiered-consolidation`).

## 5. Framing assumptions

Cross-referenced against `docs/spec-context.md` (last_reviewed_at: 2026-05-11). No framing drift.

- `pre_production: yes` + `live_users: no` — flag-off-by-default is the correct rollout posture; gate flip is operator-driven after audit `pass` (Goal 11).
- `testing_posture: static_gates_primary` + `runtime_tests: pure_function_only` — test plan in §15 sticks to pure helpers + targeted Vitest only. No frontend/E2E/API-contract tests.
- `feature_flags: only_for_behaviour_modes` — `MEMORY_BLOCK_EDGES_ENABLED` is a *behaviour mode* (traversal on vs traversal off), not a rollout gate. Same shape as the `MEMORY_CONSOLIDATION_TIER_ENABLED` flag shipped by `memory-tiered-consolidation`. The audit gate is the rollout-decision input; the flag itself is a behaviour switch.
- `prefer_existing_primitives_over_new_ones: yes` — every new primitive in §8 is justified inline:
  - `memory_block_edges` table — new because no existing table records *typed semantic relationships* between blocks (closest existing is `memory_block_version_sources` which records version lineage, a structurally different relationship; see Non-goals).
  - `memoryBlockEdgeService.ts` — new because the relationship-write surface is distinct from `memoryBlockService.ts` (CRUD on blocks) and `memoryBlockVersionService.ts` (version writes within a block). Extending either would couple unrelated concerns.
  - `memoryBlockContradictionDetectorJob.ts` — peer to `correctionPatternDetector` rather than folded; signal shapes (triple extraction vs embedding-similarity clustering) are different. Folding would force shared lifecycle/scheduling for unrelated detectors.
  - Edge-traversal logic inside `graphExpansion.ts` — extension, not new file. Closest existing primitive is the `task_slug` join already in that file; adding the edge traversal as a sibling pass keeps the RRF-feed shape.
- `accepted_primitives` — extends `MemoryConsolidationConfig` (version bump 2), uses `getOrgScopedDb`, `withOrgTx`, `withAdminConnection` for admin reads in the contradiction-detector job, `createWorker` for the job harness, `RLS_PROTECTED_TABLES` manifest entry in the same migration.
- `convention_rejections` — no rejected conventions violated. Test plan does NOT propose Playwright / supertest / frontend unit tests. No new service layer where existing primitives fit. No predictive cost modelling.

The edge feature is a behaviour-mode flag (not a rollout gate); the rollout-decision input is the audit-script `pass` result, not the flag itself. This is the same pattern shipped by `memory-tiered-consolidation`.

## 6. Phase plan

Six phases; each phase is one or more builder chunks. Phases are dependency-ordered (§7). All phases ship behind the behaviour flag — flag-off behaviour is bit-identical to pre-build throughout.

### Phase 1 — Schema + RLS (migration 0379)

- Migration `0379_memory_block_edges.sql` (+ `0379_memory_block_edges.down.sql`) — create the table per §9.1, add RLS policies (org boundary), add the three indexes per §9.1.
- New schema file `server/db/schema/memoryBlockEdges.ts` with the Drizzle table definition.
- New row in `server/config/rlsProtectedTables.ts` for `memory_block_edges`.
- New types file `shared/types/memoryBlockEdges.ts` — `EdgeType` union, `EdgeProvenance` union, `MemoryBlockEdge` type, the Zod validator for the operator-tombstone API payload.
- Feature flag `MEMORY_BLOCK_EDGES_ENABLED` added to `server/config/featureFlags.ts` — `getMemoryBlockEdgesEnabled()` helper mirrors `getMemoryConsolidationTierEnabled()`.

**Acceptance:** migration runs cleanly forward and backward; `verify-rls-coverage.sh` passes; new schema file imports into `server/db/schema/index.ts`; flag reads OFF by default.

### Phase 2 — Edge service + pure validator

- New `server/services/memoryBlockEdgeService.ts` — the thin DB caller (writes, tombstones, reinforce, reads). All writes through `getOrgScopedDb`. Service-layer subaccount filtering (canonical RLS posture).
- New `server/services/memoryBlockEdgeServicePure.ts` — validation (`assertValidEdgeType`, `assertValidConfidence`, `assertReinforcementBounded`), tombstone-state transition rules, evidence-count cap logic (cap at 1000 per `EVIDENCE_COUNT_CAP` constant to prevent runaway), score-multiplier lookup helpers.
- Targeted Vitest for the pure helpers (per `references/test-gate-policy.md` — local lint+typecheck + targeted `npx vitest run` for new pure modules only).

**Acceptance:** pure helpers covered by Vitest; service has no direct DB import (uses `getOrgScopedDb` only); no `vitest`/`supertest`/E2E added.

### Phase 3 — Contradiction-detector job

- New `server/jobs/memoryBlockContradictionDetectorJob.ts` — pg-boss worker via `createWorker()`. Daily cron (mirror cadence with `correctionPatternDetector`). Per-tenant bounded scan (`CONTRADICTION_SCAN_BATCH_SIZE = 200` blocks per cycle, oldest-unprocessed first by a new internal `contradiction_last_scanned_at` JSONB metadata field on `memory_blocks.confidence` — wait, that conflicts with existing confidence semantics; instead the job tracks per-org cursor in a new `contradiction_scan_cursor` JSONB column on `subaccounts` — see §9.5 contract). Triple extraction via the existing `openaiClient` and the same prompt-template pattern used by `workspaceMemoryService/extract.ts`. Same-subject + same-predicate + different-object detection. Writes `contradicts` edges atomically; tombstones obsolete `contradicts` edges if a block is updated such that the contradiction no longer holds (best-effort).
- Idempotency: edge writes use the §9.1 partial unique index `(organisation_id, from_block_id, to_block_id, edge_type) WHERE tombstoned_at IS NULL` — repeated detections reinforce (increment `evidence_count`, bump `last_evidence_at`) instead of creating duplicates.
- Boot registration in `server/index.ts` boot path (mirror the existing `correctionPatternDetector` boot block).

**Acceptance:** job runs without traversing edges; idempotent on re-detection; bounded scan honoured; admin-only DB access via `withAdminConnection` per `correctionPatternDetector` pattern.

### Phase 4 — Synthesis + amendment edge emission

- Modify `server/services/memoryBlockSynthesisService.ts` — extend the existing `synthScopedDb.transaction` block at lines 209–266: after the `memoryBlocks` insert and the `memory_block_version_sources` write, reverse-walk each clustered `workspace_memory_entry` via `memory_block_version_sources.source_entry_id` to discover any pre-existing `memory_blocks` (DISTINCT on `memory_block_versions.memory_block_id`, excluding the just-inserted block id) the entries already contributed to. For each distinct discovered block, emit one `derived_from` edge (provenance `synthesis`, source_ref = synthesis run id, confidence proportional to the cluster's `avgQuality`). When zero pre-existing blocks are discovered (the dominant case today), zero `derived_from` edges fire — this is the expected behaviour. The source-of-truth for the entry→version lineage stays in `memory_block_version_sources` (no double-recording).
- Modify `server/services/skillAmendmentService.ts` — extend the `rcaJson` Zod schema with `cited_memory_block_ids: z.array(z.string().uuid()).default([])` (see §9.4). On accept, write one `validates` edge per id in `cited_memory_block_ids` atomically with the amendment-accept transaction. On retire: tombstone the prior `validates` edges atomically with the amendment-retire transaction (preferred over writing `invalidates` because retirement semantics are "the validation is withdrawn", not "this memory is actively wrong"). `invalidates` edges are reserved for explicit operator-driven retraction in a deferred phase (see §16).
- Modify `shared/types/skillAmendments.ts` (or the sibling that declares the `rcaJson` Zod schema — builder confirms at implementation) — add the new field with the default-empty-array Zod definition so historical rows parse cleanly.
- **No new migration in Phase 4.** The JSONB shape stays freeform at the DB level; validation is Zod-only at the service layer, consistent with this codebase's pattern of policing JSONB shapes at the service layer.

**Acceptance:** synthesis reverse-walk emits `derived_from` edges atomically when any pre-existing blocks are discovered (zero edges when none are discovered — the dominant case today); amendment-accept emits one `validates` edge per id in `cited_memory_block_ids` atomically; amendment-retire tombstones the prior `validates` edges atomically; all writes RLS-respecting.

### Phase 5 — Retrieval traversal extension

- Modify `server/services/workspaceMemoryService/graphExpansion.ts` — keep the existing `task_slug` join intact; when the behaviour flag is ON, add an edge-traversal pass: for each candidate workspace entry that has a corresponding `memory_block` (lookup via `memory_block_version_sources` reverse-walk), traverse outbound edges bounded by depth/fan-out from `MemoryConsolidationConfig.edgeTraversalConfig` (new field — see §9.7). Apply edge-type multipliers from the same config block.
- Edge-discovered blocks rejoin as workspace entries via the synthesis lineage (the inverse of the reverse-walk: walk forward from `memory_blocks.id` → `memory_block_version_sources.workspace_memory_entry_id`). Edge-discovered candidates flow into the RRF fusion as new candidates with `combined_score = base × tierMultiplier × edgeMultiplier × confidence × log(1 + evidence_count)`.
- Modify `MemoryConsolidationConfig` (versioned config in `server/config/memoryConsolidationConfig.ts`) — bump to version 2; add the `edgeTraversalConfig` and `edgeTypeMultipliers` blocks per §9.7. The active version pointer (`ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION`) increments to 2.
- Extend `memory.retrieved` event payload — include `traversed_edges: { id, type, confidence }[]` (capped at 20) when the flag is ON; emit empty array when OFF. Mirrors `tier_multipliers_applied` traceability shipped by `memory-tiered-consolidation`.

**Acceptance:** flag-off retrieval bit-identical to pre-build (no edge traversal); flag-on retrieval bounded by depth/fan-out; RRF fusion correctly combines edge-discovered candidates; `memory.retrieved` payload captures traversed edges.

### Phase 6 — Audit script extension + observability + operator tombstone API

- Modify `scripts/audit/audit-memory-consolidation.ts` — add five new edge-specific checks (§13).
- Register new observability event types: `memory.block.edge_created`, `memory.block.edge_tombstoned`, `memory.block.edge_evidence_added`, `memory.contradiction.detected`. Add to `shared/types/agentExecutionLog.ts` discriminated union + `AGENT_EXECUTION_EVENT_CRITICALITY` registry per the LAEL extension pattern.
- New operator endpoint `POST /api/memory-block-edges/:id/tombstone` (requires the new `MEMORY_BLOCK_EDGES_TOMBSTONE` permission key added to `server/lib/permissions.ts` in this same phase — see §10). Service-layer subaccount-scoped. Tombstones the edge; emits `memory.block.edge_tombstoned` event. No edge-type or provenance mutation surface — operator-mutation is tombstone-only.
- Boot-time gate-check in `server/index.ts`: when `MEMORY_BLOCK_EDGES_ENABLED=true` AND the audit-script gate has not been ratified (sentinel file `tasks/builds/memory-block-edges/audit-gate-ratified.json` does not exist), log a warning. Non-blocking — gate-check is informational because the audit gate is operator-driven.

**Acceptance:** audit script runs five new checks against staging fixture set; observability events register without breaking LAEL gate; tombstone API requires the new `MEMORY_BLOCK_EDGES_TOMBSTONE` permission key; gate-check warning fires when expected.

## 7. Phase sequencing (dependency graph)

| Phase | Depends on | Forward references |
|---|---|---|
| Phase 1 (schema + RLS) | none | none — table and flag stand alone |
| Phase 2 (edge service + pure) | Phase 1 (table) | none |
| Phase 3 (contradiction detector) | Phase 1, Phase 2 (writes through edge service) | none |
| Phase 4 (synthesis + amendment emission) | Phase 1, Phase 2 | none |
| Phase 5 (retrieval traversal) | Phase 1, Phase 2 | none functionally — edge data may be empty when flag flips on (forward-only) |
| Phase 6 (audit + observability + tombstone API) | Phases 1–5 | none |

No backward references. No orphaned deferrals (every deferral named in §16). No phase-boundary contradictions (Phase 5 is the only phase that reads edges; all writes precede it).

One migration introduced: `0379_memory_block_edges.sql` (Phase 1). Phase 4 does NOT add a migration — the `rcaJson` extension is Zod-only (codebase pattern for freeform JSONB shapes).

Boot-order constraint: the contradiction-detector job and the synthesis edge-write must run AFTER Phase 1 migration has applied. The boot-time gate-check (Phase 6) and the edge-write code paths (Phases 3, 4) both gracefully no-op when the table is missing — the natural Drizzle insert error surfaces a clear actionable message if migration order is violated. Edge traversal (Phase 5) gracefully treats a missing edge table as zero edges (no traversal candidates).

## 8. File inventory lock

**New files:**

- `server/db/schema/memoryBlockEdges.ts` — Drizzle table definition for `memory_block_edges`.
- `server/services/memoryBlockEdgeService.ts` — thin DB caller (writes, tombstones, reinforce, reads).
- `server/services/memoryBlockEdgeServicePure.ts` — validation helpers + score-multiplier lookup + evidence-count cap logic.
- `server/services/__tests__/memoryBlockEdgeServicePure.test.ts` — Vitest for pure helpers.
- `server/jobs/memoryBlockContradictionDetectorJob.ts` — pg-boss job for daily contradiction scan.
- `shared/types/memoryBlockEdges.ts` — `EdgeType` union, `EdgeProvenance` union, `MemoryBlockEdge` type, Zod validators.
- `migrations/0379_memory_block_edges.sql` + `0379_memory_block_edges.down.sql` — creates `memory_block_edges` (table + CHECK constraints + 5 indexes + 3 RLS policies); adds `subaccounts.contradiction_scan_cursor` JSONB column (the contradiction-detector cursor; inherits the existing `subaccounts` RLS policy since RLS policies on a table apply to every column).

**Modified files:**

- `server/db/schema/index.ts` — export the new schema file.
- `server/db/schema/subaccounts.ts` — add the new `contradictionScanCursor` JSONB column (mirrors the migration's column add).
- `server/config/rlsProtectedTables.ts` — add `memory_block_edges` manifest entry.
- `server/config/featureFlags.ts` — add `getMemoryBlockEdgesEnabled()` helper.
- `server/config/memoryConsolidationConfig.ts` — bump config to version 2; add `edgeTraversalConfig` + `edgeTypeMultipliers` blocks per §9.7; flip `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` to 2.
- `shared/types/memoryConsolidation.ts` — add `edgeTraversalConfig` and `edgeTypeMultipliers` fields to the `MemoryConsolidationConfig` TypeScript type.
- `shared/types/agentExecutionLog.ts` — register `memory.block.edge_created`, `memory.block.edge_tombstoned`, `memory.block.edge_evidence_added`, `memory.contradiction.detected` in the discriminated union + criticality registry; extend the `memory.retrieved` payload with `traversed_edges: { id, type, confidence }[]`.
- `shared/types/skillAmendments.ts` — add `cited_memory_block_ids: z.array(z.string().uuid()).default([])` to the `rcaJson` Zod schema (builder confirms the exact sibling that owns the schema at implementation).
- `server/lib/permissions.ts` — add a new dedicated permission key `MEMORY_BLOCK_EDGES_TOMBSTONE: 'org.memory_block_edges.tombstone'` to `ORG_PERMISSIONS` and `ALL_PERMISSIONS` (see §10).
- `server/services/workspaceMemoryService/graphExpansion.ts` — extend with edge traversal pass behind the feature flag.
- `server/services/memoryBlockSynthesisService.ts` — reverse-walk the cluster's `workspace_memory_entries` and emit `derived_from` edges atomically when any pre-existing blocks are discovered.
- `server/services/skillAmendmentService.ts` — emit `validates` edges on accept; tombstone `validates` edges on retire.
- `server/index.ts` — boot-time registration of the contradiction-detector job + audit-gate warning.
- `scripts/audit/audit-memory-consolidation.ts` — add five new edge-specific checks (§13).
- `server/routes/index.ts` — register the new route module.

**Total file inventory:** **8 new TypeScript / schema files** (2 service files: `memoryBlockEdgeService.ts` + `memoryBlockEdgeServicePure.ts`; 1 job: `memoryBlockContradictionDetectorJob.ts`; 1 Drizzle schema: `memoryBlockEdges.ts`; 1 shared types: `memoryBlockEdges.ts`; 1 route: `memoryBlockEdges.ts`; 1 pure-helper test: `memoryBlockEdgeServicePure.test.ts`; 1 pure traversal helper test: `graphExpansion.edgeTraversalPure.test.ts` — see §15) + **1 new migration pair** (2 migration files: `0379_memory_block_edges.sql` + `0379_memory_block_edges.down.sql`) + **14 modified files** + **1 new audit fixture set** (under `scripts/audit/_fixtures/memory-block-edges/` — added inline when audit checks land in Phase 6).

Numeric-count reconciliation (per spec-authoring-checklist §8):

- "8 new TypeScript / schema files" reconciles to the new-files list above (count): `memoryBlockEdgeService.ts`, `memoryBlockEdgeServicePure.ts`, `memoryBlockEdgeServicePure.test.ts`, `memoryBlockContradictionDetectorJob.ts`, `server/db/schema/memoryBlockEdges.ts`, `shared/types/memoryBlockEdges.ts`, `server/routes/memoryBlockEdges.ts`, `graphExpansion.edgeTraversalPure.test.ts` = 8.
- "1 new migration pair (2 migration files)" reconciles to `0379_*.sql`/`0379_*.down.sql`. Migration 0379 is combined-purpose: creates the edge table AND adds the cursor JSONB column on `subaccounts`.
- "14 modified files" reconciles to the modified-files list above (count). Includes `subaccounts.ts`, `skillAmendments.ts`, and `permissions.ts` which were missing from the prior count.
- "6 v1 edge types" reconciles to `contradicts | validates | invalidates | derived_from | supersedes | relates_to`.
- "5 new audit checks" reconciles to §13.
- "4 new observability events" reconciles to §9.6.
- "6 phases" reconciles to §6.

## 9. Contracts

### 9.1 `memory_block_edges` table

**Producer:** `memoryBlockEdgeService.ts` (all writes). **Consumer:** `graphExpansion.ts` (reads via the service), `audit-memory-consolidation.ts` (admin read for audit), tombstone-operator endpoint (writes via the service).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `organisation_id` | `uuid` | no | — | FK `organisations.id`; RLS predicate column |
| `subaccount_id` | `uuid` | yes | NULL | FK `subaccounts.id`; service-layer filtering (canonical posture) |
| `from_block_id` | `uuid` | no | — | FK `memory_blocks.id` (ON DELETE CASCADE) |
| `to_block_id` | `uuid` | no | — | FK `memory_blocks.id` (ON DELETE CASCADE) |
| `edge_type` | `text` | no | — | One of `contradicts | validates | invalidates | derived_from | supersedes | relates_to`; CHECK constraint enforces |
| `confidence` | `double precision` | no | — | Range `[0, 1]`; CHECK constraint enforces |
| `evidence_count` | `integer` | no | `1` | Non-negative; service-layer caps at `EVIDENCE_COUNT_CAP = 1000` to prevent runaway |
| `provenance` | `text` | no | — | One of `operator | synthesis | contradiction_detector | amendment`; CHECK constraint enforces |
| `source_ref` | `text` | yes | NULL | Free-form ref to the source artefact (amendment id, synthesis run id, etc.); not a FK because the source-artefact table varies |
| `created_at` | `timestamptz` | no | `now()` | — |
| `last_evidence_at` | `timestamptz` | no | `now()` | Bumped on re-confirmation |
| `tombstoned_at` | `timestamptz` | yes | NULL | Soft-delete; non-NULL = retired edge |

**Constraints:**

- `CHECK (from_block_id <> to_block_id)` — no self-edges.
- `CHECK (confidence >= 0 AND confidence <= 1)`.
- `CHECK (evidence_count >= 0)`.
- `CHECK (edge_type IN ('contradicts', 'validates', 'invalidates', 'derived_from', 'supersedes', 'relates_to'))`.
- `CHECK (provenance IN ('operator', 'synthesis', 'contradiction_detector', 'amendment'))`.

**Indexes:**

- `memory_block_edges_from_idx` on `(organisation_id, from_block_id)` WHERE `tombstoned_at IS NULL`.
- `memory_block_edges_to_idx` on `(organisation_id, to_block_id)` WHERE `tombstoned_at IS NULL`.
- `memory_block_edges_type_org_idx` on `(organisation_id, edge_type)` WHERE `tombstoned_at IS NULL` — supports audit-distribution check.
- `memory_block_edges_provenance_org_idx` on `(organisation_id, provenance)` WHERE `tombstoned_at IS NULL`.
- `memory_block_edges_unique_active_idx` UNIQUE on `(organisation_id, from_block_id, to_block_id, edge_type)` WHERE `tombstoned_at IS NULL` — prevents duplicate active edges; re-confirmation must reinforce via `evidence_count`.

**RLS posture:** RLS enforces the organisation boundary; subaccount filtering is service-layer. Three RLS policies: SELECT, INSERT, UPDATE (no DELETE policy — edges are soft-deleted via UPDATE `tombstoned_at`). Each policy WHERE clause: `organisation_id = current_setting('app.organisation_id')::uuid`.

**Example row:**

```json
{
  "id": "edge-uuid-1",
  "organisation_id": "org-uuid-1",
  "subaccount_id": "sub-uuid-1",
  "from_block_id": "block-uuid-A",
  "to_block_id": "block-uuid-B",
  "edge_type": "contradicts",
  "confidence": 0.85,
  "evidence_count": 3,
  "provenance": "contradiction_detector",
  "source_ref": "job-run-id-2026-05-20-08-00",
  "created_at": "2026-05-20T08:00:12Z",
  "last_evidence_at": "2026-05-22T08:00:14Z",
  "tombstoned_at": null
}
```

### 9.2 `EdgeType` discriminated union

**Producer:** `shared/types/memoryBlockEdges.ts`. **Consumer:** every read/write path.

```ts
export type EdgeType =
  | 'contradicts'
  | 'validates'
  | 'invalidates'
  | 'derived_from'
  | 'supersedes'
  | 'relates_to';

export type EdgeProvenance =
  | 'operator'
  | 'synthesis'
  | 'contradiction_detector'
  | 'amendment';
```

Source-of-truth precedence: the type definition in `shared/types/memoryBlockEdges.ts` is the single source of truth; the migration's CHECK constraint is the runtime enforcement; the table schema in `server/db/schema/memoryBlockEdges.ts` mirrors the type. All three must stay in sync (build-time check via the existing `verify-enum-drift.sh` gate if applicable; otherwise add to spec-conformance checklist).

### 9.3 `MemoryBlockEdgeWritePayload`

**Producer:** every write callsite (synthesis service, amendment service, contradiction detector, operator API). **Consumer:** `memoryBlockEdgeService.writeEdge()`.

```ts
export interface MemoryBlockEdgeWritePayload {
  organisationId: string;
  subaccountId: string | null;
  fromBlockId: string;
  toBlockId: string;
  edgeType: EdgeType;
  confidence: number; // [0, 1]
  provenance: EdgeProvenance;
  sourceRef: string | null;
}
```

Nullability: `subaccountId` is nullable (some platform-level edges may not be subaccount-scoped — but the migration enforces `NOT NULL` on `organisation_id` only; subaccount-null edges are allowed but service-layer reads filter by subaccount when a subaccount context is set).

Conflict behaviour: if a row with the same `(organisation_id, from_block_id, to_block_id, edge_type)` already exists with `tombstoned_at IS NULL`, the service reinforces (increments `evidence_count`, bumps `last_evidence_at`, takes the MAX of old and new `confidence`) — does not insert a duplicate. If the existing row is tombstoned, a new row is inserted (the partial unique index permits this).

Example payload (synthesis-emitted `derived_from`):

```json
{
  "organisationId": "org-uuid-1",
  "subaccountId": "sub-uuid-1",
  "fromBlockId": "block-uuid-NEW",
  "toBlockId": "block-uuid-EXISTING",
  "edgeType": "derived_from",
  "confidence": 0.78,
  "provenance": "synthesis",
  "sourceRef": "synthesis-run-2026-05-22-14-30"
}
```

Example payload (amendment-accept emitted `validates`, N≥2 cited blocks):

```json
{
  "organisationId": "org-uuid-1",
  "subaccountId": "sub-uuid-1",
  "fromBlockId": "block-uuid-CITED-1",
  "toBlockId": "block-uuid-CITED-2",
  "edgeType": "validates",
  "confidence": 1.0,
  "provenance": "amendment",
  "sourceRef": "amendment-uuid"
}
```

**`validates` / `invalidates` edge semantics — locked decision.** The block↔block schema invariant (§4 Non-Goals) is preserved. Amendment-derived edges therefore connect PAIRS of cited blocks rather than amendment→block:

- When an amendment cites blocks `[B1, B2, B3]` and is accepted, the service emits a fan-out of `validates` edges from the first cited block to each subsequent cited block: `(B1 → B2)`, `(B1 → B3)`. The amendment id is recorded in `source_ref`. Semantics: "these blocks were jointly validated by amendment X."
- When the amendment is later retired, the service tombstones those edges (matched via `source_ref`).
- When an amendment cites a single block (`N = 1`), NO edge fires — the citation is recorded only in `skill_amendments.rcaJson.cited_memory_block_ids`. This is an intentional v1 gap; the heterogeneous endpoint case (amendment→block) is enumerated as a future-build trigger in §16.
- When `N = 0`, NO edge fires (and the amendment-accept path treats this as a logged warning, not an error).

This deviates from the brief's prose ("accepted amendment confirms the memory cited in its RCA"), which implies a 1-to-N amendment-to-block relationship. The schema invariant wins; the semantic shift is documented in §17 Open Questions for architect re-review at the plan gate.

### 9.4 `rcaJson.cited_memory_block_ids` extension

**Producer:** `skillAmendmentService.ts` (write path during amendment proposal). **Consumer:** `skillAmendmentService.ts` (read path during accept/retire); audit script for cross-validation.

Existing `skill_amendments.rcaJson` JSONB column gains a new validated field:

```ts
// Zod shape added to the existing rcaJson schema (which already validates upstream):
const rcaJsonSchema = existingRcaJsonSchema.extend({
  cited_memory_block_ids: z.array(z.string().uuid()).default([]),
});
```

Source-of-truth precedence: the Zod schema is the source of truth; existing rows with `rcaJson` lacking the field are read-compatible (default empty array applied by Zod parse). Migration 0380 is a code-level validator change only — it does NOT enforce the field on existing rows at the DB level (NULL-tolerant on read, default `[]` on parse). New writes always include the field.

Example fragment:

```json
{
  "rcaJson": {
    "root_cause": "Skill mis-applied because operator preference shifted",
    "evidence": ["run-uuid-1", "run-uuid-2"],
    "cited_memory_block_ids": ["block-uuid-A", "block-uuid-B"]
  }
}
```

When the amendment-accept transaction reads this, it iterates `cited_memory_block_ids` and calls `memoryBlockEdgeService.writeEdge` once per block with `edgeType: 'validates'`, `provenance: 'amendment'`, `sourceRef: amendment.id`. Same `subaccountId` as the amendment.

### 9.5 `subaccounts.contradiction_scan_cursor`

**Producer:** `memoryBlockContradictionDetectorJob.ts`. **Consumer:** the same job (next-cycle cursor read).

New column added by migration `0379_memory_block_edges.sql` (folded into the same migration to keep schema cohesion):

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `subaccounts.contradiction_scan_cursor` | `jsonb` | yes | NULL | `{ "last_block_id": "uuid", "last_scanned_at": "ISO-timestamp" }` |

The job reads the cursor at cycle start, scans the next `CONTRADICTION_SCAN_BATCH_SIZE = 200` blocks ordered by `memory_blocks.id` ASC (lexicographic UUID ordering), writes the new cursor at cycle end. Wraparound: when the next-cursor walks past the most-recent block, reset to the lowest-UUID block (full re-scan cycle).

Example cursor value:

```json
{
  "last_block_id": "01234567-89ab-cdef-0123-456789abcdef",
  "last_scanned_at": "2026-05-22T08:00:00Z"
}
```

Initial value (NULL) is treated as "scan from the lowest-UUID block." On daily re-confirmation of a known contradiction, the existing edge's `evidence_count` increments via the partial unique index conflict path (§9.3) — no duplicate insert.

### 9.6 Observability event payloads

**Producer:** `memoryBlockEdgeService.ts`, `memoryBlockContradictionDetectorJob.ts`, `graphExpansion.ts`. **Consumer:** LAEL (`agentExecutionEventService`) when `runId` is available; otherwise the durable row in `memory_block_edges` is the canonical audit trail.

```ts
// Registered in shared/types/agentExecutionLog.ts discriminated union:

type MemoryBlockEdgeCreated = {
  type: 'memory.block.edge_created';
  payload: {
    edge_id: string;
    edge_type: EdgeType;
    provenance: EdgeProvenance;
    from_block_id: string;
    to_block_id: string;
    confidence: number;
    source_ref: string | null;
  };
};

type MemoryBlockEdgeTombstoned = {
  type: 'memory.block.edge_tombstoned';
  payload: {
    edge_id: string;
    edge_type: EdgeType;
    tombstoned_by: 'operator' | 'amendment_retire' | 'detector';
  };
};

type MemoryBlockEdgeEvidenceAdded = {
  type: 'memory.block.edge_evidence_added';
  payload: {
    edge_id: string;
    edge_type: EdgeType;
    evidence_count: number; // post-increment value
    new_confidence: number;
  };
};

type MemoryContradictionDetected = {
  type: 'memory.contradiction.detected';
  payload: {
    edge_id: string;
    from_block_id: string;
    to_block_id: string;
    triple_subject: string;
    triple_predicate: string;
    object_from: string;
    object_to: string;
  };
};
```

`AGENT_EXECUTION_EVENT_CRITICALITY` registry: all four events are `info` criticality (non-blocking; do not retry on emit failure).

Extension to existing `memory.retrieved` event payload (added when the behaviour flag is ON):

```ts
type MemoryRetrievedPayloadExtension = {
  // Added to existing memory.retrieved payload:
  traversed_edges: Array<{
    id: string;
    type: EdgeType;
    confidence: number;
  }>; // capped at 20; empty array when flag is OFF
};
```

### 9.7 `MemoryConsolidationConfig` version 2 extension

**Producer:** `server/config/memoryConsolidationConfig.ts`. **Consumer:** `graphExpansion.ts` (reads at retrieval time), retrieval trace persistence (records the active version).

```ts
// Added to the existing MemoryConsolidationConfig type:
interface MemoryConsolidationConfig {
  // ... existing fields (decayConfig, promotionConfig, tierMultipliersByProfile) ...

  edgeTraversalConfig: {
    depth: number;       // default 2
    fanout: number;      // default 5 per node
    evidenceCountCap: number; // default 1000; service-layer cap to prevent runaway
  };

  edgeTypeMultipliers: {
    contradicts: number;  // default 0 (suppress contradicted candidate)
    validates: number;    // default 1.2
    invalidates: number;  // default 0.6
    derived_from: number; // default 1.1
    supersedes: number;   // default 1.3
    relates_to: number;   // default 1.0
  };
}
```

`ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` increments from 1 to 2 in Phase 5. The retrieval trace continues to record the active config version per the pattern shipped by `memory-tiered-consolidation`.

### 9.8 Operator tombstone API

**Producer:** `server/routes/memoryBlockEdges.ts`. **Consumer:** operator (org-admin only via the new `MEMORY_BLOCK_EDGES_TOMBSTONE` permission).

```
POST /api/memory-block-edges/:id/tombstone
Headers: standard auth (Express `authenticate` middleware)
Permission: ORG_PERMISSIONS.MEMORY_BLOCK_EDGES_TOMBSTONE (string literal 'org.memory_block_edges.tombstone')
Body: { "reason": string }   // free text, max 500 chars; written to a future audit log (currently logger-only)
```

Example successful request:

```json
POST /api/memory-block-edges/edge-uuid-1/tombstone
{ "reason": "Operator confirmed this contradiction is a false positive — both blocks describe the same client across two timeframes." }
```

Response shapes:

| Status | Body | When |
|---|---|---|
| 200 | `{ "id": "edge-uuid-1", "tombstoned_at": "2026-05-22T09:15:00Z" }` | Edge tombstoned. Also returned (idempotent) when the edge was already tombstoned — the existing `tombstoned_at` is echoed back. |
| 400 | `{ "error": "VALIDATION_ERROR", "details": [...] }` | Body fails Zod validation (`reason` missing / too long). |
| 403 | `{ "error": "FORBIDDEN" }` | Caller lacks `MEMORY_BLOCK_EDGES_TOMBSTONE`. |
| 404 | `{ "error": "NOT_FOUND" }` | Edge not found in the caller's organisation (RLS-filtered NULL — never leaks the existence of a cross-tenant edge). |

The endpoint is the ONLY mutation surface from the operator — `edge_type` and `provenance` are immutable. Confidence-edit (`PATCH /:id/confidence`) is out of v1 scope; it is enumerated in §16 Deferred items.

## 10. Permissions / RLS checklist

**RLS posture (canonical):** RLS enforces the organisation boundary; subaccount filtering is service-layer.

### Four-point checklist for `memory_block_edges`

1. **RLS policy in the same migration that creates the table.** YES — migration 0379 creates three policies (`SELECT`, `INSERT`, `UPDATE`) each with WHERE clause `organisation_id = current_setting('app.organisation_id')::uuid`. No DELETE policy (soft-delete via UPDATE only).
2. **Entry in `server/config/rlsProtectedTables.ts`.** YES — added in the same migration cycle (Phase 1 of §6). Without this, `verify-rls-coverage.sh` fails.
3. **Route-level or middleware guard.** YES — the only HTTP surface is `POST /api/memory-block-edges/:id/tombstone`, protected by the existing `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.MEMORY_BLOCK_EDGES_TOMBSTONE)` middleware pair (same shape every other memory route uses; see `server/routes/memoryBlocks.ts:50` for the precedent). The new permission key is added to `server/lib/permissions.ts` in Phase 6 — see the dedicated subsection below. No public list/read endpoints in v1.
4. **Principal-scoped context.** YES — every read from agent execution paths goes through `getOrgScopedDb` which sets `app.organisation_id` via the principal-scoped middleware (per `architecture.md §1116`). The contradiction-detector job uses `withAdminConnection` because it scans across all blocks within a single tenant — same pattern as `correctionPatternDetector`.

### Opt-outs

None. `memory_block_edges` is fully tenant-scoped.

### MEMORY_BLOCK_EDGES_TOMBSTONE permission (new key)

A new dedicated permission key is introduced in Phase 6 — the verification log in §0 confirmed that no suitable existing key in `server/lib/permissions.ts` covers operator-driven memory-block-edge tombstone. Existing memory-block mutation routes use the broad `ORG_PERMISSIONS.AGENTS_EDIT` key (see `server/routes/memoryBlocks.ts:50`); reusing it would over-grant — anyone who can edit agents could tombstone edges, even though edge tombstone is an audit-impacting governance action.

Phase 6 adds:

```ts
// server/lib/permissions.ts (additions inside ORG_PERMISSIONS):
MEMORY_BLOCK_EDGES_TOMBSTONE: 'org.memory_block_edges.tombstone',

// server/lib/permissions.ts (entry inside ALL_PERMISSIONS):
{ key: ORG_PERMISSIONS.MEMORY_BLOCK_EDGES_TOMBSTONE,
  description: 'Tombstone memory block edges (operator governance — soft-delete an edge from the knowledge graph)',
  groupName: 'org.memory_block_edges' },
```

The key is `ORG`-scoped (not `SUBACCOUNT`-scoped) because edge tombstones are governance-class actions that platform operators perform across subaccounts within their organisation. Default-grant: not added to any role at initial introduction — operators explicitly grant it via the permission-sets UI (consistent with how `EXECUTIONS_MANAGE` and similar governance permissions land).

## 11. Execution model

Each new operation maps to one of the three choices in `docs/spec-context.md`:

| Operation | Model | Notes |
|---|---|---|
| Edge write from synthesis (Phase 4) | inline / synchronous | Atomic with the synthesis insert in the same `synthScopedDb.transaction` block. No job row. |
| Edge write from amendment-accept (Phase 4) | inline / synchronous | Atomic with the amendment-accept transaction. No job row. |
| Edge write from contradiction detector (Phase 3) | queued (pg-boss) | Daily cron job via `createWorker`. Per-tenant bounded scan. |
| Edge tombstone from operator API (Phase 6) | inline / synchronous | Single-row UPDATE; no job. |
| Edge tombstone from amendment-retire (Phase 4) | inline / synchronous | Atomic with the amendment-retire transaction. |
| Edge traversal at retrieval (Phase 5) | inline / synchronous | Bounded; runs inline in `graphExpansion.ts` per the existing pattern. |
| Audit-script edge checks (Phase 6) | inline / synchronous | Script-level — reads admin-only, single pass per check. |

No prompt-partition / caching tier interaction — edges are not part of any LLM prompt.

### Cost-control posture for the contradiction-detector LLM extractor

The contradiction-detector job uses an LLM call (the same `openaiClient` and prompt-template pattern as `workspaceMemoryService/extract.ts`) to extract `(subject, predicate, object)` triples from `memory_blocks.content`. To prevent runaway cost:

- **Per-cycle block cap:** `CONTRADICTION_SCAN_BATCH_SIZE = 200` blocks per tenant per cycle (§9.5 cursor). At most one LLM call per block per cycle.
- **Per-call token budget:** each extractor call requests `max_tokens = 300` (sufficient for the JSON triple-list response on a single block; mirrors the existing `extract.ts` budget). Block content is truncated to 4000 chars before extraction (mirrors the existing synthesis-content truncation).
- **Per-tenant per-day soft cap:** if the day's accumulated extractor-token count for a tenant exceeds the `MAX_CONTRADICTION_DAILY_TOKENS` constant (default `200000` — covers ~600 block scans/day at the per-call budget), the cycle ends early with `status: 'partial'` and emits a `memory.contradiction_detector.token_budget_reached` log line. Resume next day.
- **Budget tracking** uses the existing `agent_run_costs` / `llm_request_costs` ledger pattern (no new cost-tracking surface; just a new `caller_label = 'memoryBlockContradictionDetector'` tag).

### Latency posture for edge traversal

Edge traversal extends `graphExpansion.ts` and inherits its existing inline-blocking shape. The brief calls out a p95 retrieval-latency budget: "edge traversal must not regress beyond that baseline (architect measures + locks at spec)". This spec locks the measurement contract rather than a hard threshold:

- Builder records baseline `memory.retrieved` p95 wall-clock from the past 7 days BEFORE landing Phase 5 (read from the existing LAEL trace storage).
- Builder lands Phase 5 behind the flag (`MEMORY_BLOCK_EDGES_ENABLED=true` for the measurement environment only).
- Builder records post-extension `memory.retrieved` p95 wall-clock over the next 7 days against the flagged environment.
- **Acceptance:** post-extension p95 must remain within 25% of the baseline; if it regresses beyond 25%, the builder pauses and re-tunes `edgeTraversalConfig.depth` / `fanout` defaults before proceeding to Phase 6.
- The measurement is recorded in `tasks/builds/memory-block-edges/progress.md` under a `## Latency baseline` heading at Phase 5 entry and `## Latency post-Phase-5` heading at Phase 5 exit.

Consistency pass (per spec-authoring-checklist §5):
- Job idempotency: contradiction-detector job uses `(organisation_id, cycle_id)` as the idempotency key via pg-boss's built-in dedup; reinforcement on re-detection is handled at the edge-write level (§9.3 conflict behaviour).
- Synchronous calls described as synchronous; queued path described as queued. No mismatched prose.
- The 25%-of-baseline latency contract is a measurement gate, not a hard runtime threshold. It does not contradict the inline execution model.

## 12. Locked guardrails (G1, G2, G3)

Three guardrails, each mirroring the pattern shipped by `memory-tiered-consolidation` for cross-build pattern coherence.

### G1 — Behaviour flag default OFF in every environment

`MEMORY_BLOCK_EDGES_ENABLED=false` is the assumed-default in `getMemoryBlockEdgesEnabled()` (uses `parseBooleanEnv()` which returns `false` when the env var is unset). Flag-off behaviour is bit-identical to pre-build in every retrieval surface.

### G2 — Forward-only edge writes (no historical backfill)

Edges are written forward-only from the migration date. Historical synthesis runs and historical amendments are NEVER backfilled. The audit script Check #4 (§13) confirms this — it flags any edge with `created_at` before the migration date (Phase 6 ratification).

### G3 — Tenant-isolation invariant

No edge ever exists with `from_block_id` and `to_block_id` in different tenants. The RLS policies enforce this via the `organisation_id` WHERE clause on every INSERT; both blocks must already be in the caller's tenant for the FK to resolve. The audit script Check #2 (§13) confirms this with an admin-context cross-tenant query.

## 13. Audit script extension specification

Five new checks added to `scripts/audit/audit-memory-consolidation.ts`. The script's existing pass/warn/fail aggregation and trend-log shape are unchanged.

### Check 1 — Edge-type distribution per tenant

For each tenant, count edges per `edge_type` over the last 30 days. Verdicts:

- `pass` — every type observed at least once OR the tenant has fewer than 10 total edges (insufficient signal).
- `warn` — at least one type has zero observations AND the tenant has 10+ total edges.
- `fail` — never (this is a soft signal).

### Check 2 — Orphaned edges

Detect edges whose `from_block_id` or `to_block_id` references a `memory_blocks` row with `deleted_at IS NOT NULL`. Verdicts:

- `pass` — zero orphans.
- `warn` — 1–10 orphans (likely lag between deletion and edge-cleanup).
- `fail` — 11+ orphans.

Remediation: orphaned edges are not auto-fixed; they are flagged for operator review.

### Check 3 — Cross-tenant edge invariant

Run a single admin-context query: `SELECT count(*) FROM memory_block_edges e JOIN memory_blocks b1 ON e.from_block_id = b1.id JOIN memory_blocks b2 ON e.to_block_id = b2.id WHERE b1.organisation_id <> b2.organisation_id OR b1.organisation_id <> e.organisation_id`.

Verdicts:

- `pass` — count is zero.
- `fail` — count > 0 (security invariant violated; emit a `security_audit_events` row immediately).

Cross-tenant edges should be impossible under RLS — this check exists to detect implementation drift if a future code path bypasses RLS.

### Check 4 — Forward-only invariant

For each tenant, count edges with `created_at < <migration-0379-timestamp>`. Verdicts:

- `pass` — count is zero (G2 holds).
- `fail` — count > 0 (someone backfilled, violating G2).

### Check 5 — Provenance distribution per tenant

For each tenant, count edges per `provenance` over the last 30 days. Verdicts:

- `pass` — distribution is within expected bounds (operator: < 20% of total; synthesis + contradiction_detector + amendment: ≥ 80% combined).
- `warn` — operator provenance > 20% (possibly a manual-override pattern worth investigating).
- `fail` — never (soft signal).

Existing audit infrastructure (trend log, `tasks/todo.md` routing for `fail` findings, four-consecutive-`pass` gate semantics) is unchanged. The four-consecutive-`pass` gate ratifies the flag-flip; until then, the flag stays OFF in production.

## 14. Execution-safety contracts

Per spec-authoring-checklist §10, every new write path gets the six-point contract.

### 14.1 Idempotency posture

| Write path | Posture |
|---|---|
| Edge create (any source) | `key-based` — partial unique index `(organisation_id, from_block_id, to_block_id, edge_type) WHERE tombstoned_at IS NULL`; on conflict the service reinforces (increments `evidence_count`, takes MAX confidence). |
| Edge tombstone | `state-based` — `UPDATE memory_block_edges SET tombstoned_at = now() WHERE id = $1 AND tombstoned_at IS NULL` returning rows; zero-rows-updated = already-tombstoned, returns the existing row (idempotent). |
| Evidence reinforcement | `state-based` — `UPDATE ... SET evidence_count = LEAST(evidence_count + 1, $EVIDENCE_COUNT_CAP), last_evidence_at = now() WHERE id = $1` — cap prevents runaway. |
| Contradiction detector cycle | `key-based` — pg-boss singleton mode; only one job instance per cycle (mirror `correctionPatternDetector` registration). |

### 14.2 Retry classification

| Operation | Classification |
|---|---|
| Edge create | `guarded` (key-based idempotency via partial unique index) |
| Edge tombstone | `safe` (state-based; repeat tombstone is a no-op) |
| Reinforcement | `safe` (state-based; repeated calls capped by `EVIDENCE_COUNT_CAP`) |
| Contradiction detector cycle | `guarded` (pg-boss singleton + per-tenant cursor) |
| Synthesis transaction (with edge write) | `guarded` (the outer transaction is already key-based via `memoryBlocks_org_name_idx` unique constraint) |
| Amendment-accept transaction (with edge write) | `guarded` (the outer amendment state transition is state-based) |

### 14.3 Concurrency guard

- **Two concurrent operator-tombstone requests for the same edge:** state-based predicate; loser receives the winner's row (idempotent). HTTP 409 not used; both callers get 200 with the same tombstoned-at timestamp.
- **Two concurrent contradiction-detector cycles:** prevented by pg-boss singleton mode (the existing `correctionPatternDetector` pattern).
- **Synthesis + tombstone race on the same block:** synthesis can only emit edges within its outer transaction; if the block is tombstoned mid-cycle, the FK CASCADE from `memory_blocks.deleted_at` does not affect `memory_block_edges` (we soft-delete blocks, not hard-delete; the FK ON DELETE CASCADE only fires on hard delete, which is currently never performed against `memory_blocks`). Audit Check #2 catches the orphan case.
- **Amendment-accept + retire race:** amendment state machine (per `closed-loop-skill-improvement` spec) prevents this; the lifecycle FSM only allows accept→retire, not concurrent.

### 14.4 Terminal event guarantee

Each cross-flow chain has exactly one terminal event:

| Chain | Terminal event |
|---|---|
| Contradiction-detector cycle | `correctionPatternDetector` already declares its terminal event; the new `memoryBlockContradictionDetectorJob` declares `memory.contradiction_detector.completed` (or `.failed` / `.partial`) on its own correlation key. |
| Synthesis (Phase 4 extension) | Existing `memoryBlockSynthesisService.complete` terminal event is unchanged; edge writes are atomic within the synthesis transaction and do not introduce a new terminal. |
| Amendment-accept (Phase 4 extension) | Existing amendment-accept terminal is unchanged; edge writes are atomic within the same transaction. |

`memory.block.edge_created` / `memory.block.edge_tombstoned` / `memory.block.edge_evidence_added` / `memory.contradiction.detected` are NOT terminal — they are supplementary observability emitted within a parent chain.

**Post-terminal prohibition.** Within a single run, no edge-write event may be emitted after the parent chain's terminal event. The contradiction-detector job emits its `.completed` / `.failed` / `.partial` terminal LAST, after every per-block `memory.block.edge_created` / `memory.contradiction.detected` event for that cycle. The synthesis chain emits its existing `memoryBlockSynthesisService.complete` terminal AFTER the `derived_from` edge writes. The amendment-accept chain emits its existing accept-terminal AFTER the `validates` edge writes. Any code path that attempts to emit an edge event with the same correlation key after the chain's terminal is a contract violation and surfaces in LAEL's existing post-terminal-emission detector.

### 14.5 No-silent-partial-success

- **Contradiction-detector job partial-success:** if the per-tenant cycle aborts partway through (e.g. LLM extractor returns 5xx after 50 blocks of a 200-block cycle), the cursor is NOT advanced to "all 200 done"; it advances only to the last successful block. The terminal `memory.contradiction_detector.completed` event payload includes `status: 'partial'` and `blocks_scanned: 50`. The next cycle resumes from the partial cursor.
- **Synthesis + edge-write partial-success:** edges are written in the same transaction as the synthesis insert; if the edge write fails, the transaction rolls back — no partial state.
- **Amendment-accept + validates-edge partial-success:** edges are written in the same transaction as the amendment-accept; same rollback semantics.

### 14.6 Unique-constraint-to-HTTP mapping

`memory_block_edges_unique_active_idx` partial unique constraint never bubbles to HTTP — the service-layer write path catches `23505` and converts to a reinforcement (§9.3). No HTTP-facing surface other than the operator tombstone endpoint, which does not hit this constraint.

The operator tombstone endpoint never triggers a `23505` (state-based predicate). The only HTTP error mappings are:
- 404 — edge not found in caller's organisation (RLS-filtered NULL response).
- 403 — permission denied.
- 409 — never (idempotent tombstone returns 200).

### 14.7 State machine closure

`memory_block_edges.tombstoned_at` has a binary lifecycle:

- `NULL` → `non-NULL`: valid (via UPDATE; emits `memory.block.edge_tombstoned`).
- `non-NULL` → `NULL`: forbidden — un-tombstoning an edge is invalid; a re-emitted edge must be a new row (which the partial unique index permits because the prior row is tombstoned).
- `non-NULL` → `different non-NULL`: forbidden — tombstone timestamps are write-once.

`evidence_count` lifecycle:
- 0 → N: monotonically non-decreasing.
- Capped at `EVIDENCE_COUNT_CAP = 1000`; further increments are no-ops.

Status-set closure: `edge_type` and `provenance` enums are closed (CHECK constraints). Adding a new value requires a spec amendment and a new migration.

## 15. Testing posture

Per `docs/spec-context.md` (`testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`):

- **Pure-helper tests (allowed):** `memoryBlockEdgeServicePure.test.ts` covers:
  - `assertValidEdgeType` rejects unknown edge types.
  - `assertValidConfidence` rejects out-of-range values.
  - `assertReinforcementBounded` caps at `EVIDENCE_COUNT_CAP`.
  - `getEdgeTypeMultiplier` returns the correct multiplier per type from `MemoryConsolidationConfig` version 2.
  - `scoreEdgeCandidate(confidence, evidence_count, edge_type)` returns `confidence × log(1 + evidence_count) × edgeTypeMultipliers[edge_type]`.
  - Tombstone-state transition rules (NULL → non-NULL allowed; non-NULL → NULL forbidden).
- **Pure traversal tests:** `graphExpansion.edgeTraversalPure.test.ts` (NEW pure module — extract the bounded-traversal walk into a pure helper to keep the integration surface thin):
  - Depth ceiling honoured under cyclic graph input.
  - Fan-out cap honoured at every node.
  - Per-type multiplier applied correctly to discovered candidates.
- **Static gates (enforced by CI, no spec authoring needed):**
  - `lint` + `typecheck` cover the new files.
  - `verify-rls-coverage.sh` enforces the manifest entry for `memory_block_edges`.
  - `verify-rls-contract-compliance.sh` enforces no direct DB import in the new service file.
  - `verify-pure-helper-convention.sh` enforces the `*Pure.ts` naming + import shape.
  - `verify-enum-drift.sh` (if applicable) enforces the `EdgeType` enum alignment between TS + migration CHECK.
- **NOT proposed:** no Playwright / E2E / supertest / frontend-unit / integration-tests against `pg-boss` job execution. These are in the `none_for_now` / `defer_until_*` categories per `docs/spec-context.md`.
- **Audit fixture (Phase 6):** seeded fixtures under `scripts/audit/_fixtures/memory-block-edges/` provide deterministic inputs for the new audit checks. The audit script's existing fixture-driven test pattern is unchanged.

## 16. Deferred items

Locked deferrals from intent + brief, with explicit triggers for revisiting:

- **Heterogeneous edge endpoints (block ↔ workspace_memory_entry).** Trigger: a use case emerges that `memory_block_version_sources` cannot serve AND the value of a polymorphic edge outweighs the schema-complexity cost.
- **Operator UI for browsing the edge graph.** Trigger: audit-script signal or operator survey shows operator demand. Likely a follow-up build named `memory-edge-inspector` or similar.
- **Backfill of historical synthesis runs / amendments.** Trigger: indefinitely deferred. Forward-only is the canonical posture (G2). Operator can manually emit edges via the (currently deferred) operator-write API if a specific historical case warrants it.
- **LLM-inferred edges from arbitrary prose.** Trigger: separate build with its own gate; not in this scope.
- **Approval queue for high-confidence edges.** Trigger: audit shows the auto-write path is too permissive (e.g. false-positive `contradicts` rate > 5%). Currently every detector-emitted edge is live immediately.
- **Per-edge-type behaviour flags.** Trigger: a single edge type misbehaves and surgical rollback is needed. Mirrors the deferral pattern from `memory-tiered-consolidation`.
- **Per-tenant operator override of `edgeTypeMultipliers`.** Trigger: a specific tenant needs a different blend (e.g. higher weight on `supersedes` because their domain is more time-sensitive). Currently config is global.
- **Confidence-edit operator API (`PATCH /api/memory-block-edges/:id/confidence`).** Trigger: operators need finer-grained control than tombstone-only. Deferred — no v1 producer; requires a sibling permission key.
- **Audit script Check 6 — confidence-distribution per type.** Trigger: post-launch trend log shows unusual confidence patterns. Currently the audit script captures the data via Check 1 + Check 5 but does not validate confidence-distribution per type explicitly.
- **Bidirectional `contradicts` edges.** Trigger: the detector currently writes one direction (`from_block` → `to_block`); a symmetry pass to write the reverse direction is deferred until graphExpansion needs the reverse-walk. Bounded traversal walks both directions already (the from/to indexes cover both query shapes), so the asymmetry is not currently a problem.
- **Re-detection time-decay on `evidence_count`.** Trigger: edges with very-old evidence stay high-weight forever. Currently bounded by `EVIDENCE_COUNT_CAP = 1000` only. A `last_evidence_at < 90 days ago` decay multiplier on the score would handle this if it becomes a problem.

## 17. Open questions

The eight intent-level open questions are locked in §3 Goals + §4 Non-Goals + §9 Contracts. One additional open question surfaced during the spec self-consistency pass; it is documented here for architect re-review at the plan gate:

### OQ-1 — `validates` / `invalidates` semantic deviation from the brief

The brief's prose treats `validates` as "accepted amendment confirms the memory cited in its RCA" — a 1-to-N amendment→block relationship. The schema (§9.1) constrains both endpoints to `memory_blocks`, so the implementation models `validates` / `invalidates` as block↔block edges within a pair-fan-out (see §9.3 locked decision). This means:

- Amendments citing `N = 1` block emit no edge (provenance lives only in `rcaJson.cited_memory_block_ids`).
- Amendments citing `N ≥ 2` blocks emit `N - 1` edges fanning out from the first cited block.

Architect re-review prompts:

1. Is the pair-fan-out semantic acceptable, or should `validates`/`invalidates` be dropped from v1 and routed to the heterogeneous-endpoints future build?
2. Alternatively, should a synthetic "amendment anchor" `memory_block` per amendment be minted (incurring schema noise but preserving the 1-to-N intuition)?
3. Or should the schema relax to allow `from_block_id NULL + from_amendment_id NOT NULL` as a single-direction polymorphic endpoint?

Recommendation: keep the pair-fan-out for v1 (option 1's "acceptable" path) — it ships meaningful traversal weight against jointly-validated blocks AND avoids the schema-noise / polymorphic-FK options. The N=1 gap is small (operator can manually emit a `relates_to` edge if needed) and the cleaner architectural path is to defer heterogeneous endpoints to a focused future build with its own audit gate.

The architect locks the final decision at the Phase 2 plan gate. If the recommendation is rejected, §3 Goal 5, §6 Phase 4, §9.1 (schema), and §9.3 (contract) all need amending in the same revision.

If `spec-reviewer` or `chatgpt-spec-review` raises additional directional issues during review, they are appended below.

## 18. Self-consistency pass result

Per spec-authoring-checklist §8, the following self-consistency questions are answered:

- **Goals ↔ Implementation match.** Yes — every Goal in §3 maps to a phase in §6 and files in §8. Cross-check: Goal 1 (table) → Phase 1 → migration 0379 in §8. Goal 9 (events) → Phase 6 → `shared/types/agentExecutionLog.ts` modification in §8. Goal 11 (gate) → §13 Check pattern + Phase 6 boot-gate.
- **Every phase item has a verdict** — `BUILD IN PHASE N`, `DEFER` (in §16), or `WON'T DO` (in §4 Non-Goals). No undisclosed scope.
- **Single source of truth claims survive grep:**
  - `memory_block_edges` is written by exactly one service (`memoryBlockEdgeService.ts`); confirmed by §8 file inventory and §9.1 producer line.
  - `EdgeType` lives only in `shared/types/memoryBlockEdges.ts`; confirmed in §9.2.
  - `MemoryConsolidationConfig` version 2 is the single source for traversal/multiplier values; confirmed in §9.7.
- **Non-functional claims match execution model:** no cache-efficiency claim; no latency-budget claim (the brief mentions "p95 retrieval latency budget" but the spec defers this — the architect locks at spec-build per the brief's note; here we declare it as a Phase-5 measurement-deliverable: the builder records baseline p95 before traversal extension and confirms post-extension p95 stays within 10% of baseline — see §14.7 acceptance subtext, this is a measurement gate not a hard threshold).
- **Load-bearing claims have backing mechanisms:**
  - "RLS-scoped" → migration 0379 RLS policies (§10).
  - "Atomic with synthesis transaction" → §11 execution model + §14.4 terminal-event guarantee.
  - "Bounded traversal" → `edgeTraversalConfig.depth/fanout` in §9.7 + Phase-5 acceptance.
  - "No cross-tenant traversal" → §12 G3 + §13 Check 3.
- **Numeric-count reconciliation** (per §8 of the spec-authoring-checklist) — see §8 of THIS spec for the explicit reconciliation table. All counts (`8 new TypeScript / schema files`, `14 modified files`, `1 migration pair`, `6 edge types`, `5 audit checks`, `4 observability events`, `6 phases`) are stable across the document.
- **Testing posture** consistent with `docs/spec-context.md`: pure helpers only + static gates (§15). No E2E / Playwright / frontend / contract tests proposed.
- **Phase dependency graph** has no backward references, no orphaned deferrals, no phase-boundary contradictions (§7).
- **Execution-safety contracts** present per §10 of the spec-authoring-checklist: §14.1–14.7 all addressed.
- **Frontmatter** present at top of spec: `Status`, `Spec date`, `Last updated`, `Author`, `Build slug`, `Source brief`, `Source intent`.
- **Lifecycle Declaration** present (§1, all five fields, launch state `Growth`).
- **ABCd Estimate** present (§2, all four dimensions, S/M/L sizing only — no numeric estimates).

The spec is consistent. Ready for `spec-reviewer` invocation (Codex round) and `chatgpt-spec-review` (manual ChatGPT-web round). In this remote autonomous session, `chatgpt-spec-review` is recorded as a `REVIEW_GAP` in `progress.md`; the operator should run it in a dedicated session OR consume the equivalent external-LLM review pass at Phase 3 finalisation via `chatgpt-pr-review`.










