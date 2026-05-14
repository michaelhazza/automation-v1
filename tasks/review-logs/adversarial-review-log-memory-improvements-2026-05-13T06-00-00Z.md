# Adversarial Review Log — memory-improvements

**Build slug:** memory-improvements
**Branch:** claude/add-memvid-integration-ehAOr
**Reviewer:** adversarial-reviewer (Sonnet 4.6, dispatched by feature-coordinator at Phase 2 Step 8.2)
**Auto-trigger:** §5.1.2 surface match (migrations/, server/db/schema/, server/routes/, server/config/rlsProtectedTables.ts)
**Timestamp:** 2026-05-13T06:00:00Z

## Files reviewed

- migrations/0333_memory_block_version_sources.sql + .down.sql
- migrations/0334_injected_entry_manifest.sql
- migrations/0343_memory_utility_30d.sql + .down.sql
- server/config/rlsProtectedTables.ts (grep-verified)
- server/db/rlsExclusions.ts
- server/db/schema/agentRuns.ts
- server/db/schema/memoryBlockVersionSources.ts
- server/db/schema/mvMemoryUtility30d.ts
- server/routes/memoryBlockSources.ts
- server/routes/memoryUtility.ts
- server/services/memoryBlockSourcesService.ts
- server/services/memoryBlockSourcesServicePure.ts
- server/services/memoryBlockSynthesisService.ts
- server/services/memoryBlockLineageService.ts
- server/services/memoryUtilityQueryService.ts
- server/services/memoryUtilityRefreshService.ts
- server/services/retrievalService.ts
- server/services/retrievalQueryEmbedderPure.ts
- server/jobs/memoryBlockSynthesisJob.ts
- server/jobs/refreshMemoryUtility30dJob.ts
- server/services/agentScheduleService.ts (partial)

---

## Verdict

**HOLES_FOUND** (1 confirmed-hole, 3 likely-holes — non-blocking advisory per playbook §8.2)

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 (confirmed-hole) |
| MEDIUM | 2 (likely-hole) |
| LOW | 1 (likely-hole) |
| INFO | 1 (worth-confirming) |

---

## Findings

### Finding 1 — HIGH `confirmed-hole` — Synthesis service uses bare `db`, bypassing `withOrgTx` / RLS

**File:line:** `server/services/memoryBlockSynthesisService.ts:23` (import), `:73-108` (passive-age queries), `:111-131` (candidate scan), `:200-254` (transaction block)

**Attack scenario:** `memoryBlockSynthesisService.runSynthesisForSubaccount` is a background-job service called by `memoryBlockSynthesisJob.ts`. It imports and uses bare `db` (not `getOrgScopedDb()` and not `withOrgTx`). Per `architecture.md §Service Layer pattern 4`: "Background / maintenance jobs that write tenant data — acquire an admin connection for top-level iteration, then call `withOrgTx(orgId)` per tenant inside the loop. A job that skips this pattern silently no-ops on every write because RLS sees no session var."

The service does open a scoped `db.transaction()` at line 200 but never calls `SET LOCAL app.organisation_id` — it's the global bare `db.transaction()`, not `withOrgTx(organisationId)`. RLS sees no `app.organisation_id` session variable, so the tenant policy on `memory_block_version_sources` (`USING (organisation_id = current_setting('app.organisation_id', true)::uuid)`) returns empty set for writes. Under `FORCE ROW LEVEL SECURITY`, inserts at line 101 (lineage rows) will be rejected by Postgres.

**Resolved in fix-loop (commit pending Phase 2 close):** `setOrgGUC(tx, organisationId)` added as first statement inside the transaction block. See pr-review log Round 2 §"Resolution Status".

---

### Finding 2 — MEDIUM `likely-hole` — Reverse-lineage query lacks explicit `organisationId` filter

**File:line:** `server/services/memoryBlockSourcesService.ts:114-123` (reverse-lineage), `:74-94` (primary lineage)

**Attack scenario:** When `include_reverse=true` is passed, the service executes a second query against `memoryBlockVersionSources` filtered only by `inArray(memoryBlockVersionSources.sourceEntryIdHash, hashes)` — no `eq(memoryBlockVersionSources.organisationId, organisationId)` predicate. `getOrgScopedDb` is called at line 25, so the RLS policy should filter via the session var. But the query itself lacks an explicit `organisationId` filter — if RLS is ever misconfigured or the service is called from a non-request context without `withOrgTx`, the reverse-lineage count query will return counts aggregated across all tenants.

**Status:** Non-blocking — pr-reviewer Round 1 Should-fix; deferred to handoff for follow-up.

---

### Finding 3 — MEDIUM `likely-hole` — Unbounded lineage fetch (DoS surface)

**File:line:** `server/services/memoryBlockSourcesService.ts:74-94` (no LIMIT on primary), `:114-121` (no LIMIT on reverse-lineage)

**Attack scenario:** The main `db.select()` from `memoryBlockVersionSources` on line 74 has no `LIMIT` clause. A single `block_version_id` could theoretically have thousands of source rows. The `inc` index `idx_mbvs_block_version` makes this a fast seek but still materialises all rows into the service layer with no ceiling. The reverse-lineage query at line 114-121 uses `inArray(hashes)` where `hashes` is the deduplicated set from the first query — also unbounded. A caller with `AGENTS_VIEW` can repeatedly hit `include_reverse=true` to trigger two unbounded aggregate queries per request.

**Status:** Non-blocking — pr-reviewer Round 1 Should-fix; deferred to handoff.

---

### Finding 4 — LOW `likely-hole` — Concurrent synthesis runs lack advisory lock

**File:line:** `server/services/memoryBlockSynthesisService.ts:200-254`

**Attack scenario:** Two concurrent synthesis jobs for the same `(subaccountId, organisationId)` could both scan the same candidates and attempt to create the same block. The `db.transaction()` block at line 200 includes all three inserts but does not acquire an advisory lock. `pg-boss teamSize:1` in `queueService.ts:883` provides first-line protection, but the service layer has no explicit dedup guard. Risk reduced by pg-boss but the double-subaccount-processing path (if a subaccount appears twice in the query) has no protection.

**Status:** Non-blocking — pr-reviewer Round 1 deferred; mitigated by pg-boss concurrency.

---

### Finding 5 — INFO `worth-confirming` — Manual try/catch inside asyncHandler

**File:line:** `server/routes/memoryBlockSources.ts:29-42`

**Detail:** Manual try/catch inside `asyncHandler` deprecated pattern per architecture.md route conventions. Closed-enum error mapping required.

**Resolved in fix-loop (commit pending Phase 2 close):** Manual try/catch deleted; service called directly inside asyncHandler. See pr-review log Round 2 §"Resolution Status".

---

## STRIDE summary

| Lens | Verdict |
|---|---|
| Spoofing | Enforced — 403-before-query on both new routes; authenticate middleware first. |
| Tampering | Findings #1 (synthesis write path) + #2 (reverse-lineage filter) — defence-in-depth gaps. |
| Repudiation | Read endpoints not audit-logged (consistent with codebase pattern; low risk). |
| Information Disclosure | No cross-org disclosure; soft-delete state intentional per spec §6.1. |
| Denial of Service | Finding #3 — unbounded lineage fetch + reverse-lineage when `include_reverse=true`. |
| Elevation of Privilege | No EoP surface; `withAdminConnectionGuarded({ allowRlsBypass: true })` on MV refresh is correct pattern. |

## Trust boundaries

| Boundary | Enforcement | Assessment |
|---|---|---|
| client → memoryBlockSources route | authenticate + AGENTS_VIEW + 403-before-query | Enforced |
| client → memoryUtility route | authenticate + SETTINGS_VIEW + 403-before-query | Enforced |
| background job → tenant data (synthesis) | bare `db`; fixed in fix-loop via `setOrgGUC(tx, organisationId)` | Enforced after fix |
| background job → tenant data (MV refresh) | `withAdminConnectionGuarded({allowRlsBypass:true})` + `pg_try_advisory_xact_lock` | Enforced |
| subaccount → org (lineage table) | RLS policy + `getOrgScopedDb()` session var; explicit `organisationId` filter absent on main fetch | Partially enforced (defence-in-depth gap — Finding #2) |

---

## Notes for finalisation

- Findings #1 and #5 are resolved by the fix-loop builder pass. Verification confirmed in pr-reviewer Round 2 (APPROVED).
- Findings #2, #3, #4 remain as non-blocking deferrals — surfaced in the Phase 2 handoff for chatgpt-pr-review in Phase 3 to evaluate.
- The HIGH severity tag on Finding #1 is retained in the audit trail; the actual code now sets the GUC inside the transaction.
