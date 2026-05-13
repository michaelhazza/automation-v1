# PR Review Log — memory-improvements branch (Phase 2 Step 8.3 + 8.5 fix-loop)

**Spec:** [`docs/superpowers/specs/2026-05-13-memory-improvements-spec.md`](../../docs/superpowers/specs/2026-05-13-memory-improvements-spec.md)
**Branch:** `claude/add-memvid-integration-ehAOr`
**Build slug:** `memory-improvements`
**Reviewer:** pr-reviewer (Sonnet 4.6, dispatched by feature-coordinator at Phase 2 Step 8.3 then again at Step 8.5 after fix-loop)
**Rounds:** 2

---

## Round 1 — Initial review (CHANGES_REQUESTED)

**Reviewed files**:
- migrations: 0333_memory_block_version_sources.{sql,down.sql}, 0334_injected_entry_manifest.{sql,down.sql}, 0343_memory_utility_30d.{sql,down.sql}
- server/db/schema: memoryBlockVersionSources.ts, mvMemoryUtility30d.ts, agentRuns.ts (delta), index.ts (delta)
- server/services: memoryBlockLineageService.ts, memoryBlockSourcesService.ts, memoryBlockSourcesServicePure.ts, memoryUtilityQueryService.ts, memoryUtilityRefreshService.ts, memoryUtilityDailySeriesPure.ts, retrievalQueryEmbedderPure.ts, retrievalService.ts (delta), memoryBlockSynthesisService.ts (delta), agentScheduleService.ts (delta), agentExecutionService.ts (delta around L1364)
- server/routes: memoryBlockSources.ts, memoryUtility.ts
- server/jobs: refreshMemoryUtility30dJob.ts
- server/config: rlsProtectedTables.ts (delta), server/db/rlsExclusions.ts (delta)
- server/index.ts (delta — route registration)
- tests: memoryBlockSourcesServicePure.test.ts, memoryUtilityDailySeriesPure.test.ts, retrievalQueryEmbedderPure.test.ts
- client: MemoryBlockDetailPage.tsx (delta), MemoryBlockSourcesTab.tsx, MemoryUtilityTab.tsx, UsagePage.tsx (delta)
- shared/types/retrieval.ts (delta)
- architecture.md (delta), KNOWLEDGE.md (delta), docs/capabilities.md (delta)

**Timestamp**: 2026-05-13T05-50-00Z

---

### Verdict header

Blocking: 3 / Should-fix: 5 / Consider: 4
**Verdict:** CHANGES_REQUESTED

---

### 🔴 Blocking

**[🔴] migrations/0333_memory_block_version_sources.sql:28-29** — RLS policy does NOT match the canonical org-isolation template documented in `architecture.md § Layer 1 / Canonical org-isolation policy template`. Missing the `WITH CHECK` clause, missing `IS NOT NULL` / `<> ''` GUC guards, and uses non-canonical policy name `tenant_isolation` instead of `memory_block_version_sources_org_isolation`.
*Why:* Migration is the policy of record; non-canonical shape means a future reader cannot trust `rlsProtectedTables.ts` to imply "canonical isolation". The gate `verify-rls-coverage.sh` only checks for presence, not shape.

**[🔴] server/routes/memoryBlockSources.ts:29-42** — Manual try/catch INSIDE `asyncHandler` violates `architecture.md § Route Conventions / Use asyncHandler`. The service already throws the correct `{ statusCode, message, errorCode }` shape, which `asyncHandler` normalises into the standard envelope `{ error: { code, message }, correlationId }`. The manual catch ALSO produces a non-standard response body (`{ error: e.message, errorCode: e.errorCode }`) that diverges from every other route.
*Why:* Route convention is enforced — bypassing it forks the error envelope shape and loses correlationId, breaking client-side error handling consistency.

**[🔴] server/services/memoryBlockSynthesisService.ts:200-254** — The new lineage write extends a `db.transaction(async (tx) => …)` that is opened on the raw `db` import with no `setOrgGUC(tx, organisationId)` / no `withOrgTx`. Under the canonical FORCE RLS posture (required by migration 0333 once fixed per finding #1), the INSERT to `memory_block_version_sources` will fail policy because `app.organisation_id` is unset on this pooled connection.
*Why:* A row that cannot be inserted is functionally absent from the dataset; the dashboard built on top of it will return empty lineage sets in production once RLS is enforced canonically.

---

### 🟡 Should-fix (carried forward — deferred to handoff)

**[🟡] server/services/memoryBlockSourcesService.ts:74-94 and 114-121** — The lineage read and reverse-lineage read do not include an explicit `eq(memoryBlockVersionSources.organisationId, organisationId)` predicate. DEVELOPMENT_GUIDELINES §1 mandates defence-in-depth: "Always filter by `organisationId` in application code, even with RLS." Also add a `.limit(...)` cap (e.g. 200) on the lineage SELECT to bound the response.
*Why:* When RLS regresses (a real risk during corrective migrations), the application-layer filter is the only thing standing between the caller and a cross-tenant read.

**[🟡] server/services/agentExecutionService.ts:1364-1368** — Fire-and-forget `void db.update(agentRuns)…catch(() => {})` for `injectedEntryIds` mirrors the existing `appliedMemoryBlockIds` pattern, but: (a) bypasses `withOrgTx` / `getOrgScopedDb`, (b) omits explicit `organisationId` filter, and (c) the §8.31 rule cited in the inline comment requires a `tasks/builds/memory-improvements/migration-gaps.md` PLAN_GAP entry naming the residual risk.
*Why:* §8.31 exists so a future maintainer can tell deliberate non-durability from accidental.

**[🟡] server/services/memoryBlockLineageService.ts:119** — `rowsWritten += 1` increments unconditionally after `.onConflictDoNothing()`, so the returned count is "rows attempted" rather than "rows actually inserted". Two synthesis runs over the same cluster will both report N rows written when the second wrote 0.
*Why:* A counter that lies about its semantics tends to be wired into dashboards/alerts that then mis-fire silently.

**[🟡] No test coverage for `getSourcesForBlock` 404 branches** — Given/When/Then: Given an `organisationId` and a `blockId` that does not exist in `memory_blocks`, When `getSourcesForBlock(blockId, organisationId)` is called, Then it throws `{ statusCode: 404, errorCode: 'BLOCK_NOT_FOUND' }`. Same for the `opts.version` path. The pure assembler is well-covered; the DB-backed branch is not.
*Why:* 404 mapping is part of the route contract; the pure-only test surface misses the entire branching.

**[🟡] architecture.md:1091 doc drift** — Lists `writeVersionSourceLinks` as the lineage write function, but the actual exported symbol is `writeLineageRowsForVersion` (see `server/services/memoryBlockLineageService.ts:62`). Doc-sync rule (CLAUDE.md §11) requires the doc to match the code in the same commit.
*Why:* Future agents grep architecture.md for the function name and hit a dead reference.

---

### 💭 Consider (carried forward — deferred to handoff)

**[💭] client/src/pages/MemoryUtilityTab.tsx:131,133** — `'—'` (em-dash) is used as the visual placeholder for null utility values. CLAUDE.md § User Preferences forbids em-dashes in UI copy/labels. Replace with `'-'` or `'·'`.

**[💭] client/src/pages/MemoryBlockSourcesTab.tsx:78-93** — The error-state Retry button inlines a full duplicate of the initial fetch logic. Extract a `load()` closure (mirroring `MemoryUtilityTab.tsx:144-155`).

**[💭] client/src/pages/MemoryUtilityTab.tsx:226** — Dismiss button uses literal `'x'` character. Replace with `×` (U+00D7).

**[💭] server/services/memoryBlockSourcesService.ts:62** — Inline SQL for `ORDER BY` would read more naturally as `desc(memoryBlockVersions.version)` drizzle helper.

---

## Round 2 — Re-review after fix-loop (APPROVED)

**Reviewed files (deltas):**
- `migrations/0333_memory_block_version_sources.sql`
- `server/routes/memoryBlockSources.ts`
- `server/services/memoryBlockSynthesisService.ts` (lines 180–280)
- `server/lib/orgScoping.ts` (supporting helper)
- `migrations/0333_memory_block_version_sources.down.sql` (supporting)

**Timestamp:** 2026-05-13T06-19-45Z

**Verdict:** APPROVED (3 of 3 prior blocking resolved, 0 new blocking, 5 non-blocking carried forward to handoff)

### Prior Blocking Findings — Resolution

**[Resolved] migrations/0333_memory_block_version_sources.sql** — Policy now named `memory_block_version_sources_org_isolation`, preceded by `DROP POLICY IF EXISTS` for idempotency, and includes both `USING` and `WITH CHECK` clauses with `IS NOT NULL` and `<>''` GUC guards plus the `organisation_id = current_setting(...)::uuid` equality. Matches canonical shape. RLS is enabled and FORCED on lines 25-26.

**[Resolved] server/routes/memoryBlockSources.ts** — Handler body now contains only the 403-before-query guard, query-string parsing, and a direct `await getSourcesForBlock(...)` call. Errors propagate to `asyncHandler`. No raw `Error` objects, no swallowed exceptions.

**[Resolved] server/services/memoryBlockSynthesisService.ts** — `await setOrgGUC(tx, organisationId)` is the first statement inside the `db.transaction(async (tx) => { ... })` callback (line 203). `setOrgGUC` (`server/lib/orgScoping.ts:18-21`) uses parameterised `sql` template via `tx.execute`, scopes the GUC with `is_local=true` so it auto-clears on commit/rollback, and validates non-empty `orgId`. All subsequent writes inside the transaction execute under correct tenant isolation. Surgical Option B chosen as instructed.

### Non-blocking carried forward

The 5 Should-fix + 4 Consider findings from Round 1 remain valid and are deferred to handoff for finalisation-coordinator review or operator decision before merge. No re-evaluation in this round per caller scope.

---

**Final verdict (Round 2):** APPROVED. The branch is ready to proceed to reality-checker (Step 8.4).
