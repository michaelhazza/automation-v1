# Intent — Memory Block Supersession + Amendment-Citation Provenance

**Build slug:** `memory-block-edges`
**Drafted:** 2026-05-19 (v2; supersedes v1 intent of same date)
**Author:** spec-coordinator (Opus, inline)
**Source brief:** `tasks/builds/memory-block-edges/brief.md` (DRAFT v2 2026-05-19)
**Task class:** Standard (re-classified from Significant after grill-me 2026-05-19 scope cuts)
**UI-touching:** no — backend feature, operator UI explicitly out of scope per brief §10

## v2 supersedes v1 (2026-05-19)

This intent replaces the v1 intent of the same date. v1 framed a generalised typed-edge graph (six edge types, retrieval traversal, feature flag, four-weekly staging gate); the 2026-05-19 local `grill-me` pass cut that scope to two narrow provenance surfaces. v1 spec at `docs/superpowers/specs/2026-05-19-memory-block-edges-spec.md` has been removed from the working tree (preserved in git history at commit `544c5142`). See `tasks/builds/memory-block-edges/progress.md § v1 abandonment` for the full transition record.

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

## Problem Statement

Two narrow gaps in memory-provenance auditability:

1. **Successor pointer is implicit.** When an operator deprecates a memory block with `reason='user_replaced'` or `reason='conflict_resolved'`, the successor block exists conceptually but no pointer is stored. `memoryBlocks.deprecatedAt` + `memoryBlocks.deprecationReason` ship today (enum already `'low_quality' | 'user_replaced' | 'conflict_resolved' | 'user_deleted'` at `server/db/schema/memoryBlocks.ts:34`), but neither audits nor future memory-inspector queries can answer "which block replaced this one?"

2. **Amendment-citation is prose-only.** Accepted skill amendments produce an RCA payload (`skill_amendments.rcaJson` jsonb at `server/db/schema/skillAmendments.ts:35`) that references memory blocks in unstructured prose. The sister build `memory-outcome-feedback` (brief at `tasks/builds/memory-outcome-feedback/brief.md`) needs to read "which amendment validated / invalidated this block" but currently has to parse RCA text.

The v1 brief's wider "typed-edge graph" framing (six edge types, retrieval traversal, feature flag, staging gate, contradiction detector) was identified at grill-me 2026-05-19 as either redundant with existing schema (`derived_from` is already `memory_block_version_sources`), mechanism-less without LLM inference (`contradicts`, `relates_to`), or out-of-scope for the actual provenance gaps. Deferred or rejected per the 13-question grill log in `brief.md § Provenance`.

## Desired Outcome

Two changes, both purely additive provenance — no retrieval effect, no flag, no behaviour change to existing read paths.

1. **Successor pointer.** Add `replaced_by_block_id uuid` to `memory_blocks` (FK to `memory_blocks.id`, nullable, `ON DELETE SET NULL`) with `CHECK (replaced_by_block_id IS NULL OR replaced_by_block_id <> id)` preventing direct self-supersession. Written atomically by `ruleLibraryService.deprecateRule()` when an optional `replacedBy` parameter is supplied AND `reason ∈ {'user_replaced', 'conflict_resolved'}`. Existing callers omit the parameter and the column stays NULL — backwards-compatible.

2. **Amendment citation join table.** New `skill_amendment_memory_citations` table with `(amendment_id, memory_block_id, kind)` shape and `kind ∈ {'validates', 'invalidates'}`. RLS on `organisation_id`. UNIQUE `(amendment_id, memory_block_id, kind)` absorbs duplicate writes via 23505 catch-and-log. Written by `skillAmendmentService`:
   - On accept — one `validates` row per memory block cited in the structured RCA payload, inside the existing accept transaction.
   - On retire — one mirror `invalidates` row per prior `validates` for the amendment, inside the existing retire transaction. Original `validates` rows stay untouched (append-only event history).

3. **Audit-script extension.** Append four checks to `scripts/audit/audit-memory-consolidation.ts`: orphan successor (warn), supersession cycle (fail), citation-pair sanity (fail), RLS isolation fuzz (fail).

Net surface: one new column + one new table + two service modifications + four audit checks + two structured log events. Around 5–7 file changes.

## Non-Goals

- General typed-edge graph table. v2 ships one nullable column + one join table; no `memory_block_edges` table.
- Edge types `contradicts`, `derived_from`, `relates_to`. Dropped at grill-me 2026-05-19.
- Auto-detection jobs (contradiction detector, similarity-cluster edge writer). Mechanism-less without LLM inference.
- Any retrieval effect. No changes to `graphExpansion.ts`, `hybridRetrieve`, `rankByPrecedencePure`, block-injection, or retrieval-time scoring.
- Feature flag. No behaviour change to gate.
- Multi-week staging gate. No behaviour change to validate.
- Operator UI. Follow-up build.
- LLM-inferred citations. Structured RCA payload only; if the RCA does not name a block, no citation row is written.
- Cross-tenant traversal. Citation table RLS-scoped on `organisation_id`; `replaced_by_block_id` inherits RLS via `memory_blocks` policy.
- Hard-delete of citation rows on retire. Append-only via mirror `invalidates`.
- Backfill of historical amendments or historical deprecations. Forward-only from ship date.
- Multi-successor supersession. Column is 1:1.
- Marking blocks as "replaced" without an operator-supplied successor id. Column stays NULL when `replacedBy` is omitted, even for `reason='user_replaced'`.

## Affected Capability Area

Memory & Knowledge

## User / Operator Impact

No new operator surface in v2. Operators see indirect impact through audit visibility: deprecation history gains a successor pointer that closes a long-standing audit gap; amendment-memory provenance becomes queryable instead of buried in RCA prose. The sister build `memory-outcome-feedback` reads this table directly. The audit script gains four new structured-log checks. Operator UI is explicitly out of scope and routed to a follow-up build.

## Risk Surface

server/db/schema, server/routes, RLS migrations

- `server/db/schema` — `replaced_by_block_id` column added to `memory_blocks`; new `skill_amendment_memory_citations` table.
- `server/routes` — the existing memory-block deprecation route gains an optional `replacedBy` field in its request body. Additive, backwards-compatible. No new routes.
- `RLS migrations` — new policy on `skill_amendment_memory_citations`; `replaced_by_block_id` inherits RLS via existing `memory_blocks` policy.

Not touching: auth/permission services, middleware, webhook handlers, billing surfaces, external messaging, agent runtime, approvals.

## Assumptions

- `memoryBlocks.deprecationReason` enum stable on this build's timescale (`'low_quality' | 'user_replaced' | 'conflict_resolved' | 'user_deleted'`, declared at `server/db/schema/memoryBlocks.ts:34`).
- `ruleLibraryService.deprecateRule()` at `server/services/ruleLibraryService.ts:147` is the canonical deprecation entry point. Spec authoring will grep for any other writer of `deprecatedAt` to confirm.
- `skillAmendmentService` at `server/services/skillAmendmentService.ts` (553 LOC) is the canonical amendment-lifecycle service — accept and retire transitions both flow through it.
- `skill_amendments.rcaJson` (jsonb, nullable, declared at `server/db/schema/skillAmendments.ts:35`) is the source of cited block IDs. Whether the existing payload already carries a structured `cited_memory_block_ids: string[]` field — or whether the spec adds a Zod-validated field at this build — is Open Question 1 below.
- `scripts/audit/audit-memory-consolidation.ts` (25 KB on disk, shipped with `memory-tiered-consolidation` PR #351) is the canonical extension point for memory-provenance audits. No new audit script is created.
- `server/config/rlsProtectedTables.ts` manifest pattern is stable — new table appends one entry referencing its policy migration. `memory_blocks` already entered at policy migration `0088`; `skill_amendments` at `0374`.
- `memory_block_version_sources` (table at `server/db/schema/memoryBlockVersionSources.ts`, migration 0333) keeps its existing workspace-entry → block-version lineage semantics. The new `replaced_by_block_id` column expresses block→block supersession only.
- `closed-loop-skill-improvement` (PR #353, merged 2026-05-18) gives the amendment service a stable surface to write citation rows from.
- `memory-tiered-consolidation` (PR #351, merged 2026-05-18) is the predecessor; this build is the narrow successor of its deferred Tier 5 item.

## Open Questions

1. **RCA payload format for cited block IDs.** Does the existing `skill_amendments.rcaJson` already carry block IDs in a structured shape, or does this build add one? **Locked at spec authoring:** grep `closed-loop-skill-improvement` artefacts and current `rcaJson` writer paths; if a structured field exists, reuse it; otherwise add a Zod-validated `cited_memory_block_ids: string[]` field to the existing payload schema. EITHER WAY, no LLM in the write path — citations come from the structured payload only.

2. **`replacedBy` validation when reason does not match.** Should `deprecateRule()` reject `replacedBy` when `reason ∉ {'user_replaced', 'conflict_resolved'}`, or silently NULL-out the column with a structured warning? **Locked at spec:** silent NULL with structured-log warning per brief §11 Success Criteria #3. Reason: backwards-compat for existing callers that may pass `replacedBy` through from form state even when reason isn't supersession-bearing.

3. **Cycle detection scope.** The DB CHECK prevents direct self-supersession (A→A). Indirect cycles (A→B→A) are out-of-band defence-in-depth. **Locked at spec:** cycle detection lives in audit-script Check 2 ("Supersession cycle — fail"); DB CHECK only catches A→A.

4. **Subaccount scoping.** Both `memory_blocks` and `skill_amendments` carry `subaccountId`. **Locked at spec:** canonical RLS posture — "RLS enforces the organisation boundary; subaccount filtering is service-layer." Citation table carries `organisation_id` (NOT NULL) and `subaccount_id` (NULLABLE — mirrors `memory_blocks.subaccountId` nullability).

5. **Migration numbering.** Brief assumes one migration. **Locked at spec authoring:** Phase 1 of construction confirms the next-available migration number against `server/db/migrations/`. If the assumed number is taken by parallel work (mcp-vendor-server-onboarding, iee-worker-retirement, or memory-outcome-feedback), renumber. Single migration covers both schema additions (column + table + RLS policy + indexes).

6. **Citation table indexes.** Brief proposes `(memory_block_id, created_at DESC)` and `(amendment_id, kind)`. **Locked at spec:** ship both. The `created_at DESC` ordering supports time-ordered reads by the sister `memory-outcome-feedback` build.

7. **Append-only invariant enforcement.** Brief says no hard-deletes; retire appends a mirror `invalidates` row. Service-layer convention or DB trigger? **Locked at spec:** service-layer convention only — `skillAmendmentService` is the only writer; no DB trigger needed (matches the existing append-only pattern for `memory_block_version_sources`).

8. **Transactional boundary for citation writes.** Accept transaction writes the amendment status change + the `validates` rows together; retire transaction writes the status change + `invalidates` rows together. **Locked at spec:** writes are inside the existing `withOrgTx()` boundary at the call site. Non-duplicate insert errors roll back the entire lifecycle transition. UNIQUE-constraint duplicate (23505) is caught and logged as an idempotent skip per brief §6.

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

**Asset Register row scan (cluster: Memory & Knowledge), `docs/capabilities.md` 2026-05-19 read:**

- `memory-knowledge-system` (Mature) — multi-layered memory architecture with provenance and drift detection. **No overlap** — successor pointer on `memory_blocks` and amendment-citation join table are additive surfaces, not present in the existing capability shape.
- `Memory Tiered Consolidation` (Growth, added 2026-05-18) — four-tier consolidation lifecycle. **No overlap** — v2 brief drops the v1 framing as Tier-5 successor; the actual two surfaces (successor pointer + amendment citations) are orthogonal to tier consolidation.
- `document-bundles-cached-context` (Growth) — reusable document libraries. **No overlap** — different memory layer.
- `memory-injection-utility` (Growth) — citation tracking + utility metrics. **No overlap** — read/analytics surface; this build is a write-time provenance ledger that the existing utility could later consume.

**In-flight spec scan (`tasks/builds/*/intent.md`, `*/spec.md`, `*/brief.md`):**

- `memory-tiered-consolidation` — MERGED (PR #351). v2 narrows away from being the explicit Tier-5 successor; this build now stands on its own as two narrow provenance surfaces.
- `closed-loop-skill-improvement` — MERGED (PR #353). v2 consumes the amendment-accept and amendment-retire lifecycles that build delivered to write citation rows. Confirmed prerequisite.
- `memory-outcome-feedback` (sister brief at `tasks/builds/memory-outcome-feedback/brief.md`, DRAFT v1) — operates on `workspace_memory_entries` via `agent_runs.injected_entry_ids`; modifies `scorecardJudgeJob.ts`, `taskApprovalService.ts`, `memoryBlockSynthesisService.ts`, `reinforcementBatch.ts`, `memoryConsolidationConfig.ts`. v2 brief §13 confirms: "After grill-me scope cuts, this build and `memory-outcome-feedback` share zero source files." Only shared file is `scripts/audit/audit-memory-consolidation.ts`, both append checks at the end — low merge friction. Concurrent-safe per the v2 brief's explicit removal of the v1 "should NOT run concurrent" warning.

**Strategic fit:** Memory & Knowledge cluster is in `Mature` / `Growth` lifecycle states per the Asset Register read above. Extension is normal — `clear` per spec-coordinator §3a tie-break (no `Sunset`-track rows in this cluster). Single-cluster intent — no supplementary per-cluster rows needed.

**Recommendation: proceed.**
