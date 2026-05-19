# Brief — Memory Block Supersession + Amendment-Citation Provenance

**Status:** DRAFT v2 (2026-05-19) — supersedes v1; rewritten after grill-me pass narrowed scope from a typed-edge graph to two focused provenance surfaces. Original v1 brief preserved in git history at commit `544c5142`.
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `memory-block-edges` (slug retained for directory/branch continuity; "typed edges" framing dropped)
**Class:** Significant → likely Standard after scope cuts (architect re-classifies at spec authoring)
**Source pattern:** dreamgraph's `validates`/`invalidates` lifecycle on amendment-citation pairs; existing `memoryBlocks.deprecationReason` mechanism for the successor pointer. Pattern lift only — no code adoption.
**Surfaces validated against main:** commit `6e48183` (2026-05-19). Extension targets confirmed: `server/db/schema/memoryBlocks.ts`, `server/services/skillAmendmentService.ts`, `server/services/ruleLibraryService.ts` (existing `deprecateRule`), `scripts/audit/audit-memory-consolidation.ts`.

## Scope summary (post-grill 2026-05-19)

The v1 brief proposed a generalised typed-edge graph on memory blocks (six edge types, retrieval-side traversal, contradiction detector, feature flag, four-weekly staging gate). A grill-me pass narrowed scope to two narrow provenance surfaces that survive on their own merits. The remainder was either redundant with existing schema, mechanism-less without LLM inference, or out-of-scope for the actual audit gaps.

| Concept | v1 disposition | v2 disposition |
|---|---|---|
| `contradicts` edge | auto-detector job | DROPPED — non-LLM triple extraction has no mechanism; defer |
| `derived_from` edge | new edge type | DROPPED — already exists as `memory_block_version_sources` |
| `relates_to` edge | "intent-classifier-derived" | DROPPED — no actual writer; weak signal |
| `validates` / `invalidates` | edges on `memory_block_edges` | KEPT — moved to dedicated `skill_amendment_memory_citations` join table (amendment to block, not block to block) |
| `supersedes` edge | edge on `memory_block_edges` | KEPT — collapsed to a single `replaced_by_block_id` column on `memory_blocks` (no new table) |
| Retrieval traversal | extend `graphExpansion.ts` | DROPPED — no retrieval effect in v1; pure provenance ledger |
| Feature flag | `MEMORY_BLOCK_EDGES_ENABLED` | DROPPED — no flag needed; nothing reads the data behaviourally |
| Four-weekly staging gate | inherited from `memory-tiered-consolidation` | DROPPED — no behaviour change to gate |

Net: one new column on `memory_blocks`, one new join table, two service modifications, around 5 to 7 file changes.

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

## 1. What already exists (extends — does NOT re-introduce)

- **Block deprecation flow** — `memoryBlocks.deprecatedAt` + `memoryBlocks.deprecationReason` (`'low_quality' | 'user_replaced' | 'conflict_resolved' | 'user_deleted'`) ship today. The service surface is `ruleLibraryService.deprecateRule()` at `server/services/ruleLibraryService.ts:147`. When an operator deprecates with reason `user_replaced` or `conflict_resolved`, a successor block conceptually exists but the pointer is not stored. This brief adds the pointer.
- **Memory block version lineage** — `memory_block_version_sources` already records "block version X was synthesised from these entries." Covers the `derived_from` semantics the v1 brief proposed; no new edge needed.
- **Amendment RCA** — accepted skill amendments produce an RCA payload that references memory blocks. The references are unstructured prose today. This brief makes them queryable.
- **Skill amendments** — `skill_amendments` table at `server/db/schema/skillAmendments.ts` (closed-loop-skill-improvement, PR #353).
- **Memory blocks** — `memory_blocks` table at `server/db/schema/memoryBlocks.ts`. Tenancy via `organisation_id` x `subaccount_id`; RLS-protected.

## 2. Problem

Two narrow gaps in memory-provenance auditability:

1. **Successor pointer is implicit.** When an operator deprecates a block with reason `user_replaced` or `conflict_resolved`, the successor block exists conceptually but is not stored. Audits and future memory-inspector queries cannot answer "which block replaced this one?"
2. **Amendment-citation is prose-only.** Accepted amendments cite memory blocks in their RCA payload, but the citation is unstructured. The sister build `memory-outcome-feedback` needs to read "which amendment validated / invalidated this block" but currently has to parse RCA prose. This brief makes that relation first-class.

The wider "typed-edge graph" framing from the v1 brief was identified as redundant with existing schema, mechanism-less without LLM inference, or out-of-scope for the gaps above. Deferred or rejected.

## 3. Goal

Two changes, both purely additive provenance — no retrieval effect, no flag, no behaviour change to existing read paths.

### 3.1 Successor pointer on `memory_blocks`

Add a `replaced_by_block_id uuid` column to `memory_blocks` (FK to `memory_blocks.id`, nullable, `ON DELETE SET NULL`), with a CHECK constraint preventing direct self-supersession: `CHECK (replaced_by_block_id IS NULL OR replaced_by_block_id <> id)`.

Written by the existing block-deprecation flow when:
- `deprecationReason` is one of `'user_replaced'` or `'conflict_resolved'`, AND
- The deprecation API call supplies an optional `replacedBy` block id.

Backwards-compat: existing deprecation calls without `replacedBy` continue to work — the column stays NULL. No data migration. No new route. No new permission key.

### 3.2 New table `skill_amendment_memory_citations`

```sql
CREATE TABLE skill_amendment_memory_citations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id   uuid REFERENCES subaccounts(id) ON DELETE CASCADE,
  amendment_id    uuid NOT NULL REFERENCES skill_amendments(id) ON DELETE CASCADE,
  memory_block_id uuid NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('validates', 'invalidates')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (amendment_id, memory_block_id, kind)
);

ALTER TABLE skill_amendment_memory_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY skill_amendment_memory_citations_isolation
  ON skill_amendment_memory_citations
  USING (organisation_id = current_setting('app.organisation_id')::uuid);

CREATE INDEX idx_sa_mem_citations_block
  ON skill_amendment_memory_citations (memory_block_id, created_at DESC);
CREATE INDEX idx_sa_mem_citations_amendment
  ON skill_amendment_memory_citations (amendment_id, kind);
```

Written by `skillAmendmentService`:
- **On accept** — for each memory block cited in the amendment's RCA payload, write a `kind='validates'` row inside the accept transaction.
- **On retire** — read the prior `validates` rows for this amendment; write a mirror `kind='invalidates'` row for each, inside the retire transaction. The original `validates` rows stay untouched (append-only; preserves event history).

The UNIQUE constraint on `(amendment_id, memory_block_id, kind)` prevents duplicate rows of the same kind per amendment-block pair. An amendment carries at most two rows per cited block across its lifetime: one `validates` at accept, one `invalidates` at retire.

## 4. Non-goals

- **DO NOT** introduce a general typed-edge graph table. Single column on `memory_blocks` + single join table.
- **DO NOT** introduce edge types `contradicts`, `derived_from`, or `relates_to`. All deferred or rejected per grill-me 2026-05-19.
- **DO NOT** introduce any auto-detection job (contradiction detector, similarity-cluster-edge writer, etc.).
- **DO NOT** affect retrieval. No changes to `graphExpansion.ts`, `hybridRetrieve`, `rankByPrecedencePure`, the block-injection path, or any retrieval-time scoring. The build is pure provenance.
- **DO NOT** introduce a feature flag. Nothing reads the data behaviourally; there is no behaviour to flag-gate.
- **DO NOT** introduce a multi-week staging gate. No behaviour change to validate.
- **DO NOT** ship an operator UI. UI is a follow-up build.
- **DO NOT** infer citations from LLM. Citations come from the existing structured RCA payload only; if the RCA doesn't name a block, no citation row is written.
- **DO NOT** cross tenant boundaries. Both surfaces RLS-scoped on `organisation_id`; service layer filters subaccount.
- **DO NOT** hard-delete citation rows on retire. Append-only — write a new `invalidates` row; the original `validates` row stays.
- **DO NOT** backfill historical amendments or historical deprecations. Forward-only from ship date.
- **DO NOT** mark blocks as "replaced" without an operator-supplied successor id. The column stays NULL when `replacedBy` is omitted, even for `reason='user_replaced'`.
- **DO NOT** support multi-successor supersession. The column is 1:1 (one block, one successor).

## 5. Proposed approach (architect locks at spec)

### 5.1 Schema

- New migration: add `replaced_by_block_id uuid NULL REFERENCES memory_blocks(id) ON DELETE SET NULL` to `memory_blocks` with the self-supersession CHECK; create `skill_amendment_memory_citations` table with RLS policy and the two indexes above.
- Update `server/db/schema/memoryBlocks.ts` with the new Drizzle column.
- New schema file: `server/db/schema/skillAmendmentMemoryCitations.ts`.
- Append `skill_amendment_memory_citations` entry to `server/config/rlsProtectedTables.ts`.

### 5.2 Services

- **Modify `server/services/ruleLibraryService.ts` (`deprecateRule`)** — accept an optional `replacedBy: string` parameter. When supplied AND `reason` is one of `'user_replaced'` or `'conflict_resolved'`, write `replaced_by_block_id` atomically with the deprecation UPDATE. Existing callers omit the parameter; behaviour unchanged for them.
- **Modify `server/services/skillAmendmentService.ts`** — on amendment accept, write `validates` citation rows in the accept transaction for each block referenced in the structured RCA payload. On amendment retire, read prior `validates` rows for this amendment and write mirror `invalidates` rows in the retire transaction. UNIQUE-constraint violations (23505) are caught and logged as idempotent skips; no error propagated.

### 5.3 Routes

No new routes. No permission key changes. The existing deprecation route gains an optional `replacedBy` field in its request body — additive, backwards-compatible.

### 5.4 Observability

Two new structured log events:
- `memory.block.replaced_by_set` — `{ block_id, replaced_by_block_id, organisation_id, subaccount_id, reason }` — fired when the column is set.
- `memory.amendment_citation_written` — `{ amendment_id, memory_block_id, kind, organisation_id, subaccount_id }` — fired on every citation row insert (one log per row).

### 5.5 Audit-script extension

Extend `scripts/audit/audit-memory-consolidation.ts` with four checks:

- **Orphan successor (informational).** A block has `replaced_by_block_id` set but the target block is soft-deleted (`deletedAt IS NOT NULL`). Warn; do not fail audit.
- **Supersession cycle (fail).** Detect any cycle in the `replaced_by_block_id` graph (e.g. A→B→A, A→B→C→A). Fail audit. Should be impossible if write path is correct; this is defence-in-depth.
- **Citation-pair sanity (fail).** Every `kind='invalidates'` row must have a corresponding earlier `kind='validates'` row for the same `(amendment_id, memory_block_id)` pair. An orphan `invalidates` signals a write-path bug.
- **RLS isolation fuzz (fail).** No citation row's `memory_block_id` or `amendment_id` ever points across `organisation_id`; no `replaced_by_block_id` ever points across `organisation_id`. Same fuzz pattern used by `memory-tiered-consolidation`.

## 6. Operational constraints

- All writes transactional with their source operation (amendment accept, amendment retire, block deprecation). No fire-and-forget.
- Tenant isolation enforced at SQL via RLS on `skill_amendment_memory_citations`. `replaced_by_block_id` inherits RLS via the existing `memory_blocks` policy.
- No LLM in the write path. Citations come from the structured RCA payload only.
- No new write hot path. Both writes piggyback on existing transactions.
- Idempotency: citation-table UNIQUE constraint absorbs duplicate writes (e.g. amendment-retire fired twice); 23505 caught and logged. The supersession column update is set-not-append, so duplicate calls are naturally idempotent.

## 7. Determinism & replayability

- Both writes are deterministic given the same source event (amendment accept/retire with identical RCA payload; operator deprecation API call with the same `replacedBy`).
- Citations are append-only: replaying the accept/retire event stream produces the same rows. No config-version dependency — citations don't use the consolidation config; they're raw provenance.
- Supersession column is set-once-per-deprecation; replaying produces the same NULL or value.

## 8. Rollout & rollback

No feature flag. No staging gate. The build is purely additive.

- **Ship:** migration applies the column and table additively. Existing deprecation calls continue to work without `replacedBy`. Amendment-citation writes begin on the next accept/retire after deploy.
- **Rollback:** schema-down migration drops the column and the table. No data migration required; historical data unaffected. Service-code rollback is a straight revert.

Existing callers and consumers see no behaviour change before, during, or after rollout.

## 9. Files in scope (architect locks at spec authoring)

- New migration under `server/db/migrations/` — adds `replaced_by_block_id` column with CHECK on `memory_blocks`; creates `skill_amendment_memory_citations` table with RLS policy and indexes.
- Modify `server/db/schema/memoryBlocks.ts` — add `replacedByBlockId` Drizzle column.
- New schema file `server/db/schema/skillAmendmentMemoryCitations.ts`.
- Modify `server/config/rlsProtectedTables.ts` — append `skill_amendment_memory_citations` entry referencing the new migration.
- Modify `server/services/ruleLibraryService.ts` — extend `deprecateRule()` with optional `replacedBy` parameter; atomic write of `replaced_by_block_id` when supplied and reason matches.
- Modify `server/services/skillAmendmentService.ts` — emit citation rows on accept and retire transactions.
- Modify `scripts/audit/audit-memory-consolidation.ts` — append the four checks in §5.5.
- Vitest: pure-function tests for citation-row construction from RCA payload; integration tests for accept/retire idempotency; targeted RLS isolation tests for the new surfaces.

## 10. Out of scope

- Operator UI for browsing citation history or the supersession graph (follow-up build).
- Edge types other than `validates`/`invalidates` on citations and `replaced_by_block_id` on memory_blocks (deferred per grill-me 2026-05-19).
- Retrieval-side reads of any provenance data here (deferred to a future retrieval-quality build).
- Backfill of historical amendments or historical deprecations (forward-only).
- Multi-successor supersession; 1:1 only.
- LLM-inferred citations from RCA prose; structured RCA payload only.
- Modification of any retrieval path — `hybridRetrieve`, `graphExpansion`, `rankByPrecedencePure`, block-injection pipeline all untouched.

## 11. Success criteria

1. Operator deprecates a block with `reason='user_replaced'` and supplies `replacedBy` — `memory_blocks.replaced_by_block_id` is set atomically with the deprecation.
2. Operator deprecates a block with `reason='user_replaced'` and omits `replacedBy` — column stays NULL; deprecation succeeds.
3. Operator deprecates a block with `reason='low_quality'` and supplies `replacedBy` — column stays NULL (reason is not in the supersession set); deprecation succeeds with a structured-log warning.
4. Amendment accepts and its RCA payload cites blocks A, B, C — three `validates` rows land in `skill_amendment_memory_citations` atomically with the accept transaction.
5. Amendment retires after acceptance — three mirror `invalidates` rows land atomically with the retire transaction; the original `validates` rows are untouched.
6. Tenant isolation holds — RLS fuzz tests confirm no citation row or `replaced_by_block_id` crosses `organisation_id`.
7. All four audit-script checks (§5.5) pass against a seeded fixture set.
8. No retrieval path's output changes before vs after this build (byte-identical block-injection contracts).

## 12. What unblocks when this ships

- `memory-outcome-feedback` (sister build) reads `skill_amendment_memory_citations` directly instead of parsing RCA prose for "which memory did this amendment validate / invalidate."
- Future memory-inspector UI gains query targets for "what amendments confirmed this block?" and "what replaced this deprecated block?"
- Audit visibility into amendment-memory provenance becomes first-class instead of buried in unstructured RCA prose.
- Operator deprecation flow gains a successor pointer that closes a long-standing audit gap.

## 13. Concurrent safety note

After grill-me scope cuts, this build and `memory-outcome-feedback` share zero source files and operate on different memory layers:

- `memory-outcome-feedback` writes against `workspace_memory_entries` via `agent_runs.injected_entry_ids`; modifies `scorecardJudgeJob.ts`, `taskApprovalService.ts`, `memoryBlockSynthesisService.ts`, `reinforcementBatch.ts`, `memoryConsolidationConfig.ts`, `audit-memory-consolidation.ts`.
- This build writes against `memory_blocks` via the deprecation flow and against `skill_amendments` via the amendment-citation join; modifies `skillAmendmentService.ts`, `ruleLibraryService.ts`, `memoryBlocks.ts` schema, `rlsProtectedTables.ts`, `audit-memory-consolidation.ts`.

The only shared file is `scripts/audit/audit-memory-consolidation.ts`, and both builds append checks at the end of the file — no semantic conflict, low merge friction (append-only edits). The "should NOT run concurrent with `memory-outcome-feedback`" warning from the v1 brief is stale and is removed here.

Prerequisites (unchanged from v1):
- `memory-tiered-consolidation` — merged 2026-05-18 (PR #351) ✓
- `closed-loop-skill-improvement` — merged 2026-05-18 (PR #353) ✓

No collision with `task-preview-mode`, `browser-vision-grounding`, `browser-hardening-primitives`, or `memory-outcome-feedback`.

## 14. Provenance

Deferred from `memory-tiered-consolidation` brief v4.0 (Tier 5, operator decision Round 1 — "defer; trigger: audit shows task_slug join too coarse"). LinkedIn trend analysis 2026-05-18 escalated priority on a generalised typed-edge graph; the grill-me pass on 2026-05-19 cut that scope to two narrow gaps that survive on their own merits without the broader graph framing.

External pattern provenance:
- `validates` / `invalidates` lifecycle on amendment-citation pairs lifted from dreamgraph's `DreamEdge` shape — the one dreamgraph concept that survived the scope cut.
- Successor-pointer pattern is native to the existing `memoryBlocks.deprecationReason` mechanism; no external lift.
- No external code adoption; pattern lift only.

Grill-me decisions (one-line audit trail, 2026-05-19):
- Q1: Edge layer → block layer only (not entry layer).
- Q2: `contradicts` → DROPPED (no non-LLM triple-extraction mechanism).
- Q3: `derived_from` → DROPPED (already exists as `memory_block_version_sources`).
- Q4: `relates_to` → DROPPED (no writer mechanism).
- Q5: `supersedes` → KEPT, operator-API only, paired with deprecation.
- Q6: Amendment endpoint → separate `skill_amendment_memory_citations` table, NOT polymorphic edge table.
- Q7: Retrieval effect → NONE; pure provenance ledger; no flag; no staging gate.
- Q8: Amendment retire → append separate `invalidates` rows; no tombstone column.
- Q9: `supersedes` schema → single `replaced_by_block_id` column on `memory_blocks`; no `memory_block_edges` table.
- Q10: Operator API → extend `ruleLibraryService.deprecateRule()`; no new route.
- Q11: Backfill → forward-only.
- Q12: Audit-script → four checks (orphan successor, cycle, citation pair, RLS).
- Q13: Concurrent-safety warning → removed.

## 15. How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/memory-block-edges/brief.md
```
