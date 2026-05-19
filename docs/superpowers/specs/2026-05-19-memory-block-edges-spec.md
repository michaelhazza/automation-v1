# Memory Block Supersession + Amendment-Citation Provenance — Spec v2

**Status:** draft
**Spec date:** 2026-05-19
**Last updated:** 2026-05-19
**Author:** spec-coordinator (Opus, inline)
**Build slug:** `memory-block-edges`
**Source brief:** `tasks/builds/memory-block-edges/brief.md` (DRAFT v2 2026-05-19)
**Source intent:** `tasks/builds/memory-block-edges/intent.md` (v2 2026-05-19)
**Task class:** Standard (re-classified from Significant at 2026-05-19 after grill-me scope cuts)
**Source branch:** `claude/build-memory-block-edges-7jIyt`

> **v2 supersedes v1.** The v1 spec at this same path was deleted from the working tree on 2026-05-19 (preserved in git history at commit `544c5142`). v1 framed a generalised typed-edge graph; v2 narrows to two provenance surfaces. See `tasks/builds/memory-block-edges/progress.md § v1 abandonment` for the transition record.

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Memory & Knowledge |
| Capability owner | placeholder — operator-assigned at first registration (per `tasks/builds/development-lifecycle-governance-upgrade/spec.md §7.4.3`) |
| Lifecycle state on launch | Inception |
| Risk surface | server/db/schema, server/routes, RLS migrations |
| Review cadence | on-incident-only |

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | L | No commercial equivalent — provenance ledger is bespoke to the platform's amendment-memory write paths. |
| Build | S | One column + one join table + two service modifications + four audit checks + two log events. Around 5–7 file changes. |
| Carry | S | Append-only writes; service-layer convention; no DB triggers; no flag; no rollout gate; no UI. |
| decommission | S | Schema-down migration drops the column + table; service code revert is a straight back-out; no data migration required. |

## Table of contents

1. Context (v1 → v2 transition)
2. Goals
3. Non-goals
4. Framing assumptions
5. File inventory
6. Schema additions
7. Service modifications
8. RLS posture
9. Contracts
10. Execution model
11. Audit-script extension
12. Observability
13. Phase plan
14. Execution-safety contracts
15. Testing posture
16. Deferred items
17. Open questions
18. Self-consistency notes

---

## 1. Context (v1 → v2 transition)

v1 of this spec (same file path; deleted from working tree 2026-05-19; preserved in git history at commit `544c5142`) framed a generalised typed-edge graph on memory blocks: six edge types (`contradicts | validates | invalidates | derived_from | supersedes | relates_to`), bounded RRF-fused retrieval traversal, behaviour flag `MEMORY_BLOCK_EDGES_ENABLED`, four-weekly staging gate, peer contradiction-detector job, four new observability events, six-phase build.

A local `grill-me` pass on 2026-05-19 (13 questions, Q1–Q13 logged verbatim in `tasks/builds/memory-block-edges/brief.md § Provenance`) cut that scope. The dropped items and reasons:

| Element | Disposition | Reason (grill-me 2026-05-19) |
|---|---|---|
| `contradicts` edge | DROPPED | Non-LLM triple extraction has no mechanism; LLM inference is out of scope per `docs/spec-context.md`. |
| `derived_from` edge | DROPPED | Already exists as `memory_block_version_sources` (workspace-entry → block-version lineage). Block→block lineage would fire only on block-of-blocks synthesis, which is rare and out of scope. |
| `relates_to` edge | DROPPED | No writer mechanism; weak signal even if a writer existed. |
| `supersedes` edge | KEPT (re-shaped) | Collapsed to a single nullable column `replaced_by_block_id` on `memory_blocks` — no edge table, no polymorphic FK. 1:1 successor pointer only. |
| `validates` / `invalidates` edge | KEPT (re-shaped) | Moved to a dedicated `skill_amendment_memory_citations` join table (amendment ↔ block, not block ↔ block). Append-only event log via mirror `invalidates` rows on retire. |
| Retrieval traversal | DROPPED | v1 brief stated "no retrieval effect in v1"; the v2 surface is pure provenance ledger with zero retrieval-time reads. |
| `MEMORY_BLOCK_EDGES_ENABLED` flag | DROPPED | No behaviour change to gate. |
| Four-weekly staging gate | DROPPED | No behaviour change to validate. |
| Contradiction detector job | DROPPED | Tied to `contradicts` edge; without that edge the detector has no output channel. |

Net v2 surface: one new column + one new join table + two service modifications + four audit-script checks + two structured-log events. Around 5–7 file changes.

## 2. Goals

Two changes, both purely additive provenance — no retrieval effect, no flag, no behaviour change to existing read paths.

**G1. Successor pointer on `memory_blocks`.** Add `replaced_by_block_id uuid` (FK to `memory_blocks.id`, nullable, `ON DELETE SET NULL`) with `CHECK (replaced_by_block_id IS NULL OR replaced_by_block_id <> id)` preventing direct self-supersession. Written atomically by `ruleLibraryService.deprecateRule()` when an optional `replacedBy` parameter is supplied AND `reason ∈ {'user_replaced', 'conflict_resolved'}`. Backwards-compatible — existing callers omit the parameter and the column stays NULL.

**G2. Amendment-citation join table.** Add `skill_amendment_memory_citations` with `(amendment_id, memory_block_id, kind)` shape, `kind ∈ {'validates', 'invalidates'}`, RLS on `organisation_id`, UNIQUE `(amendment_id, memory_block_id, kind)` for idempotency. Written by `skillAmendmentService` on accept (one `validates` row per cited block in the structured RCA payload) and on retire (one mirror `invalidates` row per prior `validates`, append-only).

**G3. Audit-script extension.** Append four checks to `scripts/audit/audit-memory-consolidation.ts` covering orphan-successor (warn), supersession-cycle (fail), citation-pair-sanity (fail), RLS-isolation-fuzz (fail).

**G4. Observability.** Two new structured-log events: `memory.block.replaced_by_set` and `memory.amendment_citation_written`.

## 3. Non-goals

Per intent.md §3 and brief §4, all enumerated below for unambiguous scope closure:

- **No general typed-edge graph.** No `memory_block_edges` table; one nullable column + one join table only.
- **No edge types beyond `validates`/`invalidates` (citations) and `supersedes` (column).** `contradicts`, `derived_from`, `relates_to` dropped per grill-me 2026-05-19.
- **No auto-detection jobs.** No contradiction detector, similarity-cluster writer, or other mechanism-less inference.
- **No retrieval effect.** `graphExpansion.ts`, `hybridRetrieve`, `rankByPrecedencePure`, block-injection pipeline, retrieval-time scoring — all untouched.
- **No feature flag.** No behaviour change to gate.
- **No multi-week staging gate.** No behaviour change to validate.
- **No operator UI.** Follow-up build.
- **No LLM-inferred citations.** Structured RCA payload only.
- **No cross-tenant traversal.** Both surfaces RLS-scoped on `organisation_id`; service-layer subaccount filtering per canonical posture.
- **No hard-delete of citation rows on retire.** Append-only via mirror `invalidates`.
- **No backfill.** Forward-only from ship date — no historical amendments or deprecations are walked.
- **No multi-successor supersession.** Column is 1:1; an op that needs N successors writes them out as N deprecations chained.
- **No setting of `replaced_by_block_id` without an operator-supplied id.** Column stays NULL when `replacedBy` is omitted, even for `reason='user_replaced'`.
- **No DB trigger enforcing append-only on the citation table.** Service-layer convention only — `skillAmendmentService` is the sole writer.

## 4. Framing assumptions

Tracked against `docs/spec-context.md` (last reviewed 2026-05-11; framing block applies):

- **Pre-production, rapid evolution, no live users.** Rollout model is `commit_and_revert`. No flag, no staged rollout — consistent with `feature_flags: only_for_behaviour_modes` (no behaviour mode to gate here).
- **Testing posture `static_gates_primary` + `runtime_tests: pure_function_only`.** Vitest pure-function tests for citation-row construction and the `replacedBy` validation branching; targeted integration tests for accept/retire idempotency and RLS isolation. No frontend tests, no API contract tests, no E2E.
- **Accepted primitives used:** `withOrgTx` / `getOrgScopedDb` (transaction + scoped query); `RLS_PROTECTED_TABLES` manifest (new entry for citation table); `verify-rls-coverage.sh` / `verify-rls-contract-compliance.sh` CI gates (enforced automatically). No new primitives introduced.
- **No new service layer.** Modify two existing services (`ruleLibraryService`, `skillAmendmentService`) and one existing audit script (`audit-memory-consolidation.ts`). The brief's "5–7 file changes" claim derives from this.
- **No retrieval contract change.** Block-injection invariant unchanged (Success Criterion 8: byte-identical block-injection contracts before vs after this build).
- **`closed-loop-skill-improvement` (PR #353) is the predecessor for the citation surface.** `memory-tiered-consolidation` (PR #351) is the predecessor for the audit-script extension point. Both merged 2026-05-18.

## 5. File inventory

Locked at spec authoring; every prose reference elsewhere in the spec reconciles to this table.

### 5.1 New files

| Path | Purpose |
|---|---|
| `migrations/0379_memory_block_supersession_and_amendment_citations.sql` | Up migration: adds `replaced_by_block_id` column + CHECK on `memory_blocks`; creates `skill_amendment_memory_citations` table with RLS policy + two indexes. |
| `migrations/0379_memory_block_supersession_and_amendment_citations.down.sql` | Down migration: drops the table, drops the column. Defensive `IF EXISTS` / `IF NOT EXISTS` per repo convention. |
| `server/db/schema/skillAmendmentMemoryCitations.ts` | Drizzle schema for the new join table. |
| `server/services/skillAmendmentMemoryCitationService.ts` (or pure helper) | Pure helpers for building citation rows from RCA payload + mirror-invalidate construction. Pure-function module per repo convention; service-layer call sites stay in `skillAmendmentService.ts`. |

### 5.2 Modified files

| Path | Change |
|---|---|
| `server/db/schema/memoryBlocks.ts` | Add `replacedByBlockId: uuid('replaced_by_block_id').references(() => memoryBlocks.id, { onDelete: 'set null' })`. Self-reference managed via deferred FK; mirrors the existing `activeVersionId` self-FK pattern (line 105). |
| `server/db/schema/index.ts` | Append export of `skillAmendmentMemoryCitations` schema. |
| `server/config/rlsProtectedTables.ts` | Append `skill_amendment_memory_citations` entry referencing migration `0379`. |
| `server/services/ruleLibraryService.ts` | Extend `deprecateRule(ruleId, organisationId, reason, replacedBy?)` signature with the optional fourth parameter; atomic write of `replaced_by_block_id` when `replacedBy` is supplied AND `reason ∈ {'user_replaced', 'conflict_resolved'}`; structured-log warning when `replacedBy` is supplied for any other reason and column stays NULL. |
| `server/services/skillAmendmentService.ts` | On amendment accept transaction, build `validates` citation rows from the structured RCA payload and insert via the new pure helper; catch 23505 unique-violation as idempotent skip + structured log. On amendment retire transaction, read prior `validates` rows for the amendment and write mirror `invalidates` rows. |
| `server/routes/<deprecation-route>.ts` (location TBD at Phase 1 of construction; `grep -rn "deprecateRule(" server/routes/`) | Accept optional `replacedBy: string` in the request body; pass through to service. Additive, backwards-compatible. |
| `scripts/audit/audit-memory-consolidation.ts` | Append four checks per §11. |
| Vitest test files (under `server/services/__tests__/` and `server/db/schema/__tests__/`) | New pure-function unit tests; targeted integration tests for accept/retire idempotency and RLS isolation. |

### 5.3 Numeric-count reconciliation

- **Migrations: 2 files (one up, one down) — counts as 1 migration pair.**
- **New schema files: 1** (`skillAmendmentMemoryCitations.ts`).
- **New service / pure-helper files: 1** (`skillAmendmentMemoryCitationService.ts`).
- **Modified schema files: 2** (`memoryBlocks.ts`, `index.ts`).
- **Modified service files: 2** (`ruleLibraryService.ts`, `skillAmendmentService.ts`).
- **Modified config files: 1** (`rlsProtectedTables.ts`).
- **Modified routes files: 1** (deprecation route, exact path locked at construction).
- **Modified audit scripts: 1** (`audit-memory-consolidation.ts`).
- **New columns: 1** (`memory_blocks.replaced_by_block_id`).
- **New tables: 1** (`skill_amendment_memory_citations`).
- **New checks: 4** (audit-script).
- **New log events: 2** (`memory.block.replaced_by_set`, `memory.amendment_citation_written`).
- **Total file-change count (excluding tests): 9–10 files.** Brief's "5–7" estimate excluded the new pure-helper and the route modification; reconciled upward here. Tests add 2–4 additional files.

## 6. Schema additions

### 6.1 `memory_blocks` column

```sql
ALTER TABLE memory_blocks
  ADD COLUMN replaced_by_block_id uuid REFERENCES memory_blocks(id) ON DELETE SET NULL;

ALTER TABLE memory_blocks
  ADD CONSTRAINT memory_blocks_no_direct_self_supersession
  CHECK (replaced_by_block_id IS NULL OR replaced_by_block_id <> id);
```

`ON DELETE SET NULL` ensures hard-deleting a successor block (rare; should not happen given soft-delete via `deletedAt`) does not cascade-orphan the deprecation pointer. The CHECK prevents A→A only; indirect cycles (A→B→A) are caught by audit-script Check 2 per §11.

No new index on this column — the column is read by audits and forward queries only, not by hot-path retrieval. Index can be added later if a real read pattern emerges.

### 6.2 `skill_amendment_memory_citations` table

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
ALTER TABLE skill_amendment_memory_citations FORCE ROW LEVEL SECURITY;

CREATE POLICY skill_amendment_memory_citations_isolation
  ON skill_amendment_memory_citations
  USING (organisation_id = current_setting('app.organisation_id')::uuid);

CREATE INDEX idx_sa_mem_citations_block
  ON skill_amendment_memory_citations (memory_block_id, created_at DESC);

CREATE INDEX idx_sa_mem_citations_amendment
  ON skill_amendment_memory_citations (amendment_id, kind);
```

`subaccount_id` is nullable to mirror `memory_blocks.subaccount_id` nullability (some blocks are org-scoped, not subaccount-scoped). Service-layer subaccount filtering applies per canonical posture (§8).

`FORCE ROW LEVEL SECURITY` matches the post-2026-05-15 hardening convention; the migration uses `FORCE` rather than relying on the table-owner-bypass default.

Both indexes ship in the same migration. `(memory_block_id, created_at DESC)` supports the `memory-outcome-feedback` sister build's "what amendments validated/invalidated this block, newest first" query. `(amendment_id, kind)` supports the "what blocks did this amendment cite" reverse lookup.

## 7. Service modifications

### 7.1 `ruleLibraryService.deprecateRule()`

Current signature at `server/services/ruleLibraryService.ts:147`:

```ts
export async function deprecateRule(
  ruleId: string,
  organisationId: string,
  reason: MemoryBlockDeprecationReason = 'user_deleted',
): Promise<boolean>
```

New signature:

```ts
export async function deprecateRule(
  ruleId: string,
  organisationId: string,
  reason: MemoryBlockDeprecationReason = 'user_deleted',
  replacedBy?: string,  // optional successor block id
): Promise<boolean>
```

**Behaviour table:**

| `reason` | `replacedBy` supplied? | `replaced_by_block_id` written? | Structured log |
|---|---|---|---|
| `user_replaced` | yes (uuid) | yes | `memory.block.replaced_by_set` |
| `user_replaced` | no | no (column stays NULL) | none |
| `conflict_resolved` | yes (uuid) | yes | `memory.block.replaced_by_set` |
| `conflict_resolved` | no | no (column stays NULL) | none |
| `low_quality` | yes (uuid) | no (column stays NULL — reason not in supersession set) | warn: `memory.block.replaced_by_ignored_for_reason` |
| `low_quality` | no | no | none |
| `user_deleted` | yes (uuid) | no (column stays NULL) | warn: `memory.block.replaced_by_ignored_for_reason` |
| `user_deleted` | no | no | none |

The deprecation UPDATE is a single SQL statement; the `replaced_by_block_id` field is included in the same `.set()` call when applicable, making the write atomic with the deprecation.

**Implementation sketch:**

```ts
const setClause: Partial<typeof memoryBlocks.$inferInsert> = {
  deprecatedAt: new Date(),
  deprecationReason: reason,
  updatedAt: new Date(),
};

const supersessionReasons: MemoryBlockDeprecationReason[] = ['user_replaced', 'conflict_resolved'];
if (replacedBy && supersessionReasons.includes(reason)) {
  setClause.replacedByBlockId = replacedBy;
} else if (replacedBy) {
  logger.warn({
    event: 'memory.block.replaced_by_ignored_for_reason',
    block_id: ruleId,
    reason,
    supplied_replaced_by: replacedBy,
  }, 'replacedBy supplied for non-supersession reason; column unchanged');
}

const scopedDb = getOrgScopedDb('ruleLibraryService.deprecateRule');
const [updated] = await scopedDb
  .update(memoryBlocks)
  .set(setClause)
  .where(and(eq(memoryBlocks.id, ruleId), eq(memoryBlocks.organisationId, organisationId)))
  .returning({ id: memoryBlocks.id });

if (updated && replacedBy && supersessionReasons.includes(reason)) {
  logger.info({
    event: 'memory.block.replaced_by_set',
    block_id: ruleId,
    replaced_by_block_id: replacedBy,
    organisation_id: organisationId,
    reason,
  }, 'block deprecation recorded supersession pointer');
}

return updated !== undefined;
```

Service-layer subaccount filtering not required for `deprecateRule()` itself — the caller (route handler) is already subaccount-aware via the existing permission middleware, and the FK relationship inside `memory_blocks` enforces both successor and original belong to the same organisation (RLS).

### 7.2 `skillAmendmentService` accept and retire transactions

The existing accept and retire entry points wrap their state-transition UPDATEs in `withOrgTx()`. The new citation writes piggyback on those transactions — no new transaction boundary.

**On accept:**

```ts
// Inside the existing accept transaction, after the status UPDATE returns success.
const citedBlockIds = extractCitedBlockIds(amendment.rcaJson);  // pure helper
for (const blockId of citedBlockIds) {
  try {
    await tx.insert(skillAmendmentMemoryCitations).values({
      organisationId: amendment.orgId,
      subaccountId: amendment.subaccountId,
      amendmentId: amendment.id,
      memoryBlockId: blockId,
      kind: 'validates',
    });
    logger.info({
      event: 'memory.amendment_citation_written',
      amendment_id: amendment.id,
      memory_block_id: blockId,
      kind: 'validates',
      organisation_id: amendment.orgId,
      subaccount_id: amendment.subaccountId,
    }, 'amendment citation row written');
  } catch (err) {
    if (isUniqueViolation(err)) {
      // 23505 — idempotent skip; the citation already exists from a prior accept attempt.
      logger.debug({ amendment_id: amendment.id, memory_block_id: blockId, kind: 'validates' },
        'citation already exists; skipping');
      continue;
    }
    throw err;  // non-duplicate insert error rolls back the entire accept transaction
  }
}
```

**On retire:**

```ts
// Inside the existing retire transaction, after the status UPDATE.
const priorValidates = await tx
  .select({ memoryBlockId: skillAmendmentMemoryCitations.memoryBlockId })
  .from(skillAmendmentMemoryCitations)
  .where(and(
    eq(skillAmendmentMemoryCitations.amendmentId, amendment.id),
    eq(skillAmendmentMemoryCitations.kind, 'validates'),
  ));

for (const row of priorValidates) {
  try {
    await tx.insert(skillAmendmentMemoryCitations).values({
      organisationId: amendment.orgId,
      subaccountId: amendment.subaccountId,
      amendmentId: amendment.id,
      memoryBlockId: row.memoryBlockId,
      kind: 'invalidates',
    });
    logger.info({
      event: 'memory.amendment_citation_written',
      amendment_id: amendment.id,
      memory_block_id: row.memoryBlockId,
      kind: 'invalidates',
      organisation_id: amendment.orgId,
      subaccount_id: amendment.subaccountId,
    }, 'amendment retirement recorded mirror invalidation');
  } catch (err) {
    if (isUniqueViolation(err)) {
      // 23505 — idempotent skip (retire fired twice).
      continue;
    }
    throw err;  // rolls back the retire
  }
}
```

The pure helper `extractCitedBlockIds(rcaJson: unknown): string[]` is defined in `skillAmendmentMemoryCitationService.ts` (or equivalent pure module). It:

- Returns an empty array when `rcaJson` is null, undefined, or shape-incompatible.
- Reads `rcaJson.cited_memory_block_ids` if the field exists and is a string array; otherwise returns `[]`.
- Filters out duplicates within the same payload (the DB UNIQUE absorbs cross-payload duplicates).
- Does NOT parse RCA prose — if the field is absent, no citations are written (per Non-goal: no LLM-inferred citations).

### 7.3 RCA payload field — `cited_memory_block_ids`

Open Question 1 (intent.md §8) is locked here. The `skill_amendments.rcaJson` payload is extended with an optional `cited_memory_block_ids: string[]` field:

- **Validator:** Zod schema in `shared/types/skillAmendments.ts` (or equivalent) adds `cited_memory_block_ids: z.array(z.string().uuid()).optional()`.
- **Producer:** the RCA-proposer job (closed-loop-skill-improvement) is extended to populate this field when the RCA references memory blocks. Out of scope for this build — closed-loop-skill-improvement's RCA writer may already produce structured block IDs in some form; the spec-author of this build's Phase 1 confirms by reading the actual writer at `server/jobs/<rca-proposer>.ts` (path TBD at construction).
- **Consumer:** `extractCitedBlockIds()` reads it.
- **Backwards-compat:** existing amendments with `rcaJson` lacking the field produce zero citation rows — no behaviour regression.

If at construction time the closed-loop RCA writer does NOT produce structured block IDs, the build adds the Zod field but no citations are written until the RCA writer is updated. The build is still useful — the supersession pointer surface is independent. The amendment-citation surface becomes operationally meaningful only once the RCA writer populates the new field.

## 8. RLS posture

Canonical sentence applies: **RLS enforces the organisation boundary; subaccount filtering is service-layer.**

- `memory_blocks` already has RLS via migration 0088. The new `replaced_by_block_id` column inherits that policy — no new policy needed.
- `skill_amendment_memory_citations` ships with its own RLS policy in migration 0379 (see §6.2). Policy enforces `organisation_id = current_setting('app.organisation_id')::uuid`. `FORCE ROW LEVEL SECURITY` is applied to defeat table-owner bypass.
- Subaccount filtering applies at the service layer. Both writers (`ruleLibraryService.deprecateRule` and `skillAmendmentService`'s accept/retire) already operate inside `getOrgScopedDb` / `withOrgTx` contexts; the GUC is set before the transaction begins.
- `RLS_PROTECTED_TABLES` manifest in `server/config/rlsProtectedTables.ts` gains one entry for `skill_amendment_memory_citations` referencing migration `0379`. The existing `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` CI gates enforce this automatically.
- No new permission key. The existing deprecation route's permission guard (in the route handler — confirmed at construction) covers the `replacedBy` parameter extension. No new HTTP surface gains exposure.

## 9. Contracts

### 9.1 Citation row shape (DB → service)

```ts
type SkillAmendmentMemoryCitation = {
  id: string;                       // uuid, server-generated
  organisationId: string;           // uuid, NOT NULL
  subaccountId: string | null;      // uuid, nullable (mirrors memory_blocks.subaccountId)
  amendmentId: string;              // uuid, NOT NULL, FK to skill_amendments.id
  memoryBlockId: string;            // uuid, NOT NULL, FK to memory_blocks.id
  kind: 'validates' | 'invalidates'; // text, CHECK-constrained
  createdAt: Date;                  // timestamptz, server-generated
};
```

**Producer:** `skillAmendmentService` (accept + retire transactions; via `skillAmendmentMemoryCitationService.ts` helper).
**Consumer:** `memory-outcome-feedback` (sister build, queries by `memory_block_id` for time-ordered citation history); audit-script (queries for cycle / pair / RLS checks per §11).
**Source-of-truth precedence:** the row is the source of truth for "amendment X cited block Y as kind Z at time T." If the amendment's `rcaJson` is later edited (out of scope for this build), the citation rows are not retroactively updated — the rows reflect what was cited at the lifecycle event time.

### 9.2 RCA payload extension (service → DB)

```ts
// Inside skill_amendments.rcaJson — the structured RCA payload.
type RcaPayload = {
  // ... existing fields owned by closed-loop-skill-improvement ...
  cited_memory_block_ids?: string[];  // NEW — uuid array; optional; empty array equivalent to absent.
};
```

**Producer:** RCA-proposer job (out of scope here — produces this field; consumer of this spec).
**Consumer:** `extractCitedBlockIds()` pure helper in this build.
**Validation:** Zod schema rejects non-uuid strings at write time. Reader is defensive — non-array, missing, or non-uuid-array values resolve to `[]`.

### 9.3 Deprecation API extension (HTTP route → service)

Request body of the existing deprecation route gains:

```ts
// Existing fields preserved verbatim.
{
  // ... existing body fields ...
  reason?: MemoryBlockDeprecationReason;   // existing
  replacedBy?: string;                     // NEW — optional uuid
}
```

**Producer:** operator-driven UI / API caller.
**Consumer:** route handler → `ruleLibraryService.deprecateRule(id, orgId, reason, replacedBy)`.
**Behaviour:** documented in §7.1 behaviour table.

### 9.4 Structured log events

| Event | Trigger | Required fields |
|---|---|---|
| `memory.block.replaced_by_set` | `deprecateRule` writes a non-null `replaced_by_block_id` | `block_id`, `replaced_by_block_id`, `organisation_id`, `subaccount_id` (nullable), `reason` |
| `memory.block.replaced_by_ignored_for_reason` | `deprecateRule` receives `replacedBy` with non-supersession reason | `block_id`, `reason`, `supplied_replaced_by` |
| `memory.amendment_citation_written` | citation row inserted (per row, both `validates` and `invalidates`) | `amendment_id`, `memory_block_id`, `kind`, `organisation_id`, `subaccount_id` (nullable) |

Spec inventory says 2 new log events. The intermediate `memory.block.replaced_by_ignored_for_reason` is a warning subclass of the first event family — same prefix, defensive surface; does not count as a separate event in the brief's inventory.

## 10. Execution model

All three write paths are **inline / synchronous** within the calling transaction. No pg-boss jobs. No cache layers. No prompt partitions.

| Operation | Boundary | Reasoning |
|---|---|---|
| `replaced_by_block_id` write | Same SQL UPDATE as `deprecateRule()`'s existing deprecation UPDATE | Atomic with the deprecation status flip; no separate transaction. |
| `validates` citation rows on amendment accept | Same `withOrgTx()` boundary as the accept's status UPDATE | Citation rows must persist iff the accept transaction commits. If any non-23505 insert fails, the entire accept rolls back. |
| `invalidates` mirror rows on amendment retire | Same `withOrgTx()` boundary as the retire's status UPDATE | Same rollback semantics as accept. |

The pure helpers (`extractCitedBlockIds`, mirror-row construction) are synchronous in-memory operations — no I/O.

No new write hot-path. The amendment lifecycle transactions already exist and already commit on accept / retire; this build appends rows to them.

## 11. Audit-script extension

`scripts/audit/audit-memory-consolidation.ts` gains four checks. Each check is a function returning `{ pass: boolean; severity: 'warn' | 'fail'; findings: string[] }`. Findings serialise to a structured-log JSON line.

### Check 11.1 — Orphan successor (severity: warn)

A `memory_blocks` row has `replaced_by_block_id IS NOT NULL` but the target block has `deletedAt IS NOT NULL`.

**Query:**
```sql
SELECT id, replaced_by_block_id, organisation_id
FROM memory_blocks src
WHERE replaced_by_block_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM memory_blocks tgt
    WHERE tgt.id = src.replaced_by_block_id
      AND tgt.deleted_at IS NOT NULL
  );
```

Severity warn — orphan successors are operationally awkward but do not break correctness; the pointer remains queryable.

### Check 11.2 — Supersession cycle (severity: fail)

Cycles in the `replaced_by_block_id` graph — A→B→A or A→B→C→A.

**Approach:** recursive CTE walking the `replaced_by_block_id` chain with depth cap (e.g. 50). If a row's id appears in its own ancestor set, cycle detected.

```sql
WITH RECURSIVE chain AS (
  SELECT id, replaced_by_block_id, ARRAY[id] AS visited, 1 AS depth
  FROM memory_blocks
  WHERE replaced_by_block_id IS NOT NULL

  UNION ALL

  SELECT mb.id, mb.replaced_by_block_id, chain.visited || mb.id, chain.depth + 1
  FROM chain
  JOIN memory_blocks mb ON mb.id = chain.replaced_by_block_id
  WHERE mb.replaced_by_block_id IS NOT NULL
    AND mb.id <> ALL(chain.visited)
    AND chain.depth < 50
)
SELECT DISTINCT chain.visited[1] AS cycle_start
FROM chain
JOIN memory_blocks mb ON mb.id = chain.replaced_by_block_id
WHERE mb.id = ANY(chain.visited);
```

Severity fail — cycles indicate write-path bug; the CHECK constraint should make direct A→A impossible, but indirect cycles must still be defended.

### Check 11.3 — Citation-pair sanity (severity: fail)

Every `kind='invalidates'` row must have a corresponding earlier `kind='validates'` row for the same `(amendment_id, memory_block_id)` pair.

**Query:**
```sql
SELECT inv.amendment_id, inv.memory_block_id
FROM skill_amendment_memory_citations inv
WHERE inv.kind = 'invalidates'
  AND NOT EXISTS (
    SELECT 1 FROM skill_amendment_memory_citations val
    WHERE val.amendment_id = inv.amendment_id
      AND val.memory_block_id = inv.memory_block_id
      AND val.kind = 'validates'
      AND val.created_at < inv.created_at
  );
```

Severity fail — an orphan `invalidates` signals a retire fired without a prior accept's citation row, which violates the event-history invariant.

### Check 11.4 — RLS isolation fuzz (severity: fail)

No citation row's `memory_block_id` may point to a block in a different organisation than the row itself, and no `amendment_id` may point cross-org. Equivalent check for `memory_blocks.replaced_by_block_id` pointing cross-org.

**Approach:** join citation table to `memory_blocks` and `skill_amendments` on the referenced id columns and assert organisation_id matches.

```sql
-- Citation cross-org check
SELECT c.id
FROM skill_amendment_memory_citations c
JOIN memory_blocks mb ON mb.id = c.memory_block_id
WHERE c.organisation_id <> mb.organisation_id;

-- Amendment cross-org check
SELECT c.id
FROM skill_amendment_memory_citations c
JOIN skill_amendments a ON a.id = c.amendment_id
WHERE c.organisation_id <> a.org_id;

-- Supersession cross-org check
SELECT src.id
FROM memory_blocks src
JOIN memory_blocks tgt ON tgt.id = src.replaced_by_block_id
WHERE src.replaced_by_block_id IS NOT NULL
  AND src.organisation_id <> tgt.organisation_id;
```

Severity fail — any cross-org row is a tenant-isolation breach. Reuses the same fuzz pattern that `memory-tiered-consolidation`'s audit extension uses for its Tier 4 surfaces.

### Audit run semantics

Each check produces a JSON line on stdout matching the existing audit-script output convention (severity, check-id, organisation count, finding count, finding details). The script's overall exit code is 0 if no `fail`-severity findings; non-zero otherwise. Warn findings do not affect exit code (matches existing convention).

## 12. Observability

Two new structured-log event names per §9.4. Plus one warn-only event for the defensive `replacedBy`-with-wrong-reason path.

| Event name | Severity | Volume estimate |
|---|---|---|
| `memory.block.replaced_by_set` | info | One per deprecation that supplies a valid `replacedBy` — low volume; operator-driven. |
| `memory.block.replaced_by_ignored_for_reason` | warn | One per ill-formed call — should be near-zero in normal operation. |
| `memory.amendment_citation_written` | info | One per row inserted. On accept: N where N = `cited_memory_block_ids.length`. On retire: same N. Volume bounded by amendment count × average cited blocks per amendment. |

Events flow through the existing logger pipeline; no new transport. No dashboard work in this build — analytics consumers (Grafana / Mission Control) can read the events at any time. Operator surfacing is a follow-up build.

The Live Agent Execution Log (LAEL) does NOT consume these events. They are audit-only structured logs, not per-run timeline entries. If a future build wants the citation events on the run timeline, that's a separate spec.

## 13. Phase plan

Standard-class build with a single phase. Architect at Phase 2 entry decomposes into chunks (estimated 4–6).

| Phase | Scope | Acceptance |
|---|---|---|
| Phase 1 (single) | All of §5–§12: migration up/down, Drizzle schema additions, service modifications, route extension, audit-script extension, RLS-manifest entry, pure helpers, tests. | Migration runs forward and backward cleanly against staging DB; `npm run lint`, `npm run typecheck`, targeted Vitest pure tests for `extractCitedBlockIds` and the `deprecateRule` validation branching all pass; new RLS-manifest entry surfaces in `verify-rls-coverage.sh`; audit-script runs the four new checks against a seeded fixture set without crashing; existing retrieval-path output is byte-identical (manually verified by running one representative agent run before and after on a staging fixture). |

No multi-phase sequencing required — the surface is too narrow to benefit from phase split.

**Chunk-level breakdown (architect locks at Phase 2):**

1. Migration up + down + RLS-manifest entry.
2. Drizzle schema for new table + new column on `memoryBlocks.ts`.
3. Pure-helper module (`extractCitedBlockIds` + mirror-row construction) + unit tests.
4. `ruleLibraryService.deprecateRule()` extension + behaviour-table tests.
5. `skillAmendmentService` accept + retire transaction extensions + integration tests.
6. Route extension (deprecation route adds `replacedBy` in request body).
7. Audit-script extension (four checks) + targeted fixture seeding.
8. RLS isolation integration test for the new table.

(Chunks 1–8 — architect re-numbers and re-bundles as fits.)

## 14. Execution-safety contracts

Per `docs/spec-authoring-checklist.md §10`. Each new write path declares idempotency, retry, concurrency, terminal-event, and unique-constraint-to-HTTP mapping.

### 14.1 `replaced_by_block_id` write (deprecation)

| Field | Value |
|---|---|
| Idempotency posture | **state-based.** UPDATE is qualified by `WHERE id = $1 AND organisation_id = $2`; replay-safe because `replaced_by_block_id` is set, not appended — second call with same args is a no-op semantically. |
| Retry classification | **safe.** Repeating the UPDATE produces the same DB state. |
| Concurrency guard | Optimistic — last write wins. The deprecation is operator-driven; two operators racing to deprecate the same block is rare. Existing `deprecateRule()` behaviour preserved. |
| Terminal event | n/a — `deprecateRule` returns a boolean; no cross-flow chain. |
| Unique-constraint-to-HTTP mapping | n/a — no unique constraint on this path. |

### 14.2 `validates` citation write (amendment accept)

| Field | Value |
|---|---|
| Idempotency posture | **key-based.** UNIQUE `(amendment_id, memory_block_id, kind)` absorbs duplicates; 23505 catch-and-skip. |
| Retry classification | **guarded.** A failed accept transaction rolls back the citation rows; a retried accept re-inserts cleanly (no-op for already-existing rows due to UNIQUE). |
| Concurrency guard | DB UNIQUE constraint — first commit wins. If two concurrent accept attempts fire (e.g. operator double-click), one transaction's INSERT raises 23505 and the catch logs an idempotent skip. |
| Terminal event | n/a per build — the citation row is a side-effect of the amendment accept terminal event (which is owned by `closed-loop-skill-improvement`). |
| Unique-constraint-to-HTTP mapping | 23505 from a duplicate citation insert is caught in service code → logged as info → does not propagate to HTTP. The accept route returns 200 normally. |

### 14.3 `invalidates` mirror citation write (amendment retire)

Same shape as 14.2 — UNIQUE catch-and-skip; first commit wins; 23505 caught and logged.

Additionally: a retire that finds **zero prior `validates` rows** writes **zero** `invalidates` rows. This is operationally normal — an amendment that was accepted before this build shipped has no `validates` rows; its retire produces no mirror rows. Not an error; not logged at warn level.

### 14.4 Append-only enforcement

Service-layer convention only. `skillAmendmentService` is the sole writer to the citation table. No UPDATE statements anywhere; no DELETE statements except cascade-on-FK (when an amendment or memory block is hard-deleted, citation rows cascade per the FKs in §6.2). No DB trigger.

If a future operation needs to mutate citation rows (out of scope here), that's a spec amendment.

### 14.5 State machine — n/a

This build introduces no state machine. The amendment lifecycle state machine is owned by `closed-loop-skill-improvement`; this build emits events on transitions but does not modify the state set.

## 15. Testing posture

Per `docs/spec-context.md` (`testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`, `frontend_tests: none_for_now`, `api_contract_tests: none_for_now`, `e2e_tests_of_own_app: none_for_now`).

### 15.1 Pure-function unit tests (Vitest)

- `extractCitedBlockIds()` against varied `rcaJson` shapes:
  - missing field → `[]`
  - empty array → `[]`
  - array with duplicates → deduplicated
  - non-uuid strings → filtered out (defensive)
  - non-array value → `[]`
  - null / undefined payload → `[]`
- Mirror-row construction: given an array of prior `validates` rows, produces an array of `invalidates` row inputs with correct organisation/subaccount inheritance.
- `deprecateRule` reason-vs-replacedBy branching (pure logic extracted, if practical, into a `decideReplacedByWrite(reason, replacedBy)` helper returning a discriminated union — testable without DB).

### 15.2 Integration tests (Vitest + real DB)

- Accept transaction with non-empty `cited_memory_block_ids` inserts the correct number of `validates` rows; row contents match the helper's output.
- Accept transaction with empty `cited_memory_block_ids` inserts zero rows; transaction commits normally.
- Retire after a prior accept produces mirror `invalidates` rows; original `validates` rows still present.
- Retire with no prior accept produces zero rows; transaction commits normally.
- Double-accept (idempotency): two concurrent accept transactions on the same amendment with overlapping cited blocks — DB UNIQUE absorbs duplicates without error.
- Cross-org RLS test: under org A's `app.organisation_id` GUC, queries to the citation table return zero rows from org B's amendments / blocks.

### 15.3 Audit-script fixture tests

Seed test fixtures simulating each of the four audit-script findings (orphan successor, cycle, citation pair orphan, cross-org pointer) and assert the script:
- Detects the warn-orphan, exits 0.
- Detects the fail-cycle, exits non-zero.
- Detects the fail-pair-orphan, exits non-zero.
- Detects the fail-cross-org, exits non-zero.

### 15.4 Framing-deviation declarations

None. The testing plan stays entirely within the `pure_function_only` + `static_gates_primary` envelope. No frontend tests, no API contract tests, no E2E.

## 16. Deferred items

| Item | Trigger to revisit | Why deferred |
|---|---|---|
| Operator UI for browsing citation history / supersession graph | Operator demand surfaces (Govern page request) | Pure provenance ledger has no required UI; follow-up build owns this. |
| Edge types beyond `validates`/`invalidates`/`supersedes` | LLM-inference budget green-lit OR demand pattern emerges | `contradicts`/`derived_from`/`relates_to` dropped at grill-me 2026-05-19 per §1. |
| Retrieval-side traversal of provenance ledger | Retrieval-quality build prioritised | v2 is pure ledger; retrieval reads come later. |
| Backfill of historical amendments / deprecations | Operator request OR audit-finding pressure | Forward-only avoids accidental data corruption on a write surface that doesn't yet exist in production. |
| Multi-successor supersession (block has N successors) | Concrete data-flow demand | 1:1 covers the operator-deprecation case the brief identifies. |
| LLM-inferred citations from RCA prose | LLM-inference budget AND deterministic-extractor pattern proven | Out of envelope per `docs/spec-context.md` (`accepted_primitives` does not include LLM-extractor primitives). |
| DB trigger preventing UPDATE/DELETE on citation table | Audit finds service-layer drift OR a second writer is introduced | Service-layer convention is sufficient for one-writer surfaces; trigger adds maintenance overhead without current value. |
| Per-org citation-row volume telemetry / quotas | Volume becomes load-bearing | Volume is bounded by amendment count × cited-block count; no expected pressure on storage. |

## 17. Open questions

Locked at spec authoring (intent.md §8 carried forward; lock decisions documented):

1. **RCA payload format for cited block IDs.** Locked: extend `rcaJson` with a Zod-validated optional `cited_memory_block_ids: string[]` field per §7.3. Backwards-compat with existing amendments lacking the field.
2. **`replacedBy` validation when reason does not match.** Locked: silent NULL with structured-log warn per §7.1 behaviour table. Backwards-compat for callers passing `replacedBy` for non-supersession reasons.
3. **Cycle detection scope.** Locked: DB CHECK catches direct self-supersession (A→A); audit-script Check 2 catches indirect cycles. No DB trigger.
4. **Subaccount scoping.** Locked: canonical RLS posture — RLS on `organisation_id`; service-layer subaccount filtering. Citation table mirrors `memory_blocks.subaccountId` nullability.
5. **Migration numbering.** Locked: `0379` (latest on main is `0378_vision_inference_calls`). Phase 1 of construction re-confirms; renumber if 0379 has shifted up by parallel work (`memory-outcome-feedback`, `mcp-vendor-server-onboarding`, `iee-worker-retirement`).
6. **Citation table indexes.** Locked: ship both `(memory_block_id, created_at DESC)` and `(amendment_id, kind)` per §6.2.
7. **Append-only invariant enforcement.** Locked: service-layer convention only; no DB trigger.
8. **Transactional boundary for citation writes.** Locked: writes inside the existing `withOrgTx()` at the call site. 23505 unique-violation caught and logged as idempotent skip; non-duplicate errors propagate and roll back the lifecycle transition.

No questions remain open for the architect or builder. The Phase 2 plan-gate review will confirm the chunk plan against this spec; any new question that surfaces during planning is routed back to `tasks/builds/memory-block-edges/intent.md § Open Questions` per the standard playbook.

## 18. Self-consistency notes

### Goals ↔ Implementation match

- §2 G1 "successor pointer on memory_blocks" ↔ §6.1 column + §7.1 service modification + §11.1 + §11.2 audit checks ↔ §14.1 safety contract. **Match.**
- §2 G2 "amendment-citation join table" ↔ §6.2 table + §7.2 service writes + §7.3 RCA payload extension + §11.3 audit check + §11.4 fuzz ↔ §14.2 + §14.3 + §14.4 safety contracts. **Match.**
- §2 G3 "audit-script extension" ↔ §11.1–§11.4 four checks. **Match (4 = 4).**
- §2 G4 "observability — two new events" ↔ §9.4 + §12 (plus one defensive warn subclass not counted as separate event). **Match.**

### Load-bearing-claim mechanisms

- "Atomic with deprecation" — mechanism: same SQL UPDATE in `deprecateRule()` (§7.1 code sketch).
- "Atomic with accept/retire" — mechanism: writes inside existing `withOrgTx()` (§7.2 + §14.2).
- "Idempotent on duplicate writes" — mechanism: DB UNIQUE `(amendment_id, memory_block_id, kind)` + 23505 catch (§6.2 + §14.2).
- "Cross-tenant safety" — mechanism: RLS policy in migration 0379 (§6.2 + §8) + audit-script Check 11.4.
- "Forward-only" — mechanism: no migration step walks historical rows; service writes are triggered only by NEW lifecycle events (§7.2). Audit-script Check 11.3 enforces no orphan `invalidates` without prior `validates`.
- "Append-only" — mechanism: service-layer convention; only `skillAmendmentService` writes (§14.4).

### Numeric-count reconciliation (grep against this file)

- "Two new structured-log events" — §2 G4, §9.4 (2 main + 1 warn subclass), §12 (3 rows including warn subclass). Reconciled as "2 new events plus 1 warning subclass of the first family" — the 2 in inventory excludes the warning subclass per §9.4 note.
- "Four audit-script checks" — §2 G3, §11.1/§11.2/§11.3/§11.4 (4 numbered subsections), §15.3 (4 fixture cases). **Match (4=4=4).**
- "One new column" — §2 G1, §6.1, §5.2 row (`memoryBlocks.ts` modification), §5.3 count. **Match.**
- "One new table" — §2 G2, §6.2, §5.3 count. **Match.**
- "5–7 file changes" (intent assertion) vs "9–10 files (excluding tests)" (§5.3 reconciliation) — §5.3 explicitly reconciles upward to include the pure-helper module + route modification that the brief's count missed.

### Source-of-truth precedence

For the citation row contract: the DB row is the source of truth for "amendment X cited block Y as kind Z at time T" (§9.1). The `rcaJson.cited_memory_block_ids` field is an INPUT to the row construction, not a parallel source — if the payload is mutated post-accept (out of scope here), the rows are not retroactively updated. The rows reflect what was cited at the lifecycle event time.

### Phase dependency graph

Single phase. No backward references. No orphaned deferrals (every "deferred" item in §16 has an explicit trigger). No phase-boundary contradictions.

### Convention compliance check

- `accepted_primitives` (`docs/spec-context.md`): uses `withOrgTx`, `getOrgScopedDb`, `RLS_PROTECTED_TABLES`. No new primitive introduced.
- `convention_rejections`: no flag (consistent with `feature_flags: only_for_behaviour_modes`); no staged rollout; no LLM-inference primitive; no E2E / frontend / API-contract tests.
- `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` CI gates: new table enters the manifest, CI enforces.

### Open risks tracked

- The RCA-writer side of `closed-loop-skill-improvement` may not yet emit `cited_memory_block_ids`. If true at construction, this build still ships the receiving surface; the field stays empty until the RCA writer is updated. §7.3 documents this explicitly; not a blocker.
- Migration number collision: if 0379 is taken by parallel work between this spec and construction, Phase 1 chunk 1 renumbers. Recorded in §17 Open Question 5 with explicit re-confirmation step.

End of spec.
