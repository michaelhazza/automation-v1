# chatgpt-plan-review — memory-improvements

**Date:** 2026-05-13
**Plan:** tasks/builds/memory-improvements/plan.md
**Branch:** claude/add-memvid-integration-ehAOr
**Mode:** manual (operator pastes ChatGPT-web responses)
**Round cap:** 3 unless operator says continue

**Pre-review operator decisions (locked, not re-litigated):**
- Plan Q1 (writeVersionRow at synthesis): APPROVED — Chunk 2 wires `writeVersionRow({changeSource: 'auto_synthesis'})` inside the block-insert transaction.
- Plan Q2 (Sources route shape): APPROVED — `/api/orgs/:orgId/memory-blocks/:blockId/sources` (orgId-scoped, not spec-literal `/api/memory-blocks/:id/sources`).

**Triage policy:**
- Technical findings (file paths, signatures, RLS, migration ordering, contract correctness, test posture, error handling) → auto-applied to plan.md.
- User-facing findings (UX behaviour, banner copy, workflow, product policy, scope expansions) → operator approval before applied. Banner copy already operator-approved verbatim; not re-edited.
- Out-of-scope findings → routed to `tasks/todo.md` with ID `MEMIMPROV-PLAN-CHATGPT-Rx-Fy`; do not block the plan.

---

## Round 1 — kickoff (prompt sent to ChatGPT-web)

**Status:** awaiting ChatGPT-web response paste from operator.

**Prompt framing:** "Review this implementation plan for technical issues, missing contracts, or scope gaps. The spec is already locked and reviewed — focus only on the plan."

**Plan size:** 984 lines (~32k tokens). Plan includes 11 chunks (1-3 Phase A lineage; 4-5 Phase B1 substrate; 6-8 Phase B2 dashboard; 9-10 Phase D semantic ranker; 11 doc-sync), self-consistency pass, risks R1-R11, test inventory.

---

## Round 1 — response received + triage applied 2026-05-13

**Operator pasted ChatGPT-web response.** Continuation moved to the main session for triage (SendMessage tool unavailable in this runtime; chatgpt-plan-review agent contract permits inline triage with log persistence + auto-commit, identical outcome).

**Verdict:** CHANGES_REQUESTED — 2 BLOCKERs + 6 TIGHTENINGs. All findings classified TECHNICAL → auto-applied to `tasks/builds/memory-improvements/plan.md` without operator approval per triage policy.

### F1 — BLOCKER (TECHNICAL, AUTO-APPLIED) — Migration 0334 split is unsafe

**Issue:** Plan put `ALTER TABLE agent_runs ADD COLUMN injected_entry_ids` in Chunk 4's `0334_injected_entry_manifest.sql`, then said Chunk 5 would APPEND the materialised view + unique index to the same file. Once a migration file has been applied in any environment, appending more SQL to it is silently skipped — the MV would never land in that environment.

**Recommendation (ChatGPT):** Either fold Chunks 4+5 into one inseparable migration, OR move the MV into its own migration file. Cleaner option 2 because the plan declares chunks independently reviewable.

**Fix applied:** New migration `0343_memory_utility_30d.sql` (next free slot after main's PR #288 occupies 0335-0342). 0334 is now single-purpose (column only). Edits across Chunk 4, Chunk 5, §3, §5 chunk table, TOC, §9 build-phase checklist, §11 self-consistency.

### F2 — BLOCKER (TECHNICAL, AUTO-APPLIED) — REFRESH MATERIALIZED VIEW CONCURRENTLY foot-gun

**Issue:** Unique index `(organisation_id, subaccount_id, agent_id)` is unsafe for CONCURRENTLY because PostgreSQL treats `NULL ≠ NULL`. Two MV rows with the same `(org, agent)` and `subaccount_id IS NULL` would collide on uniqueness at refresh-time, causing REFRESH CONCURRENTLY to error (not at migration time — at refresh time, which means it'd be undetected until first scheduled refresh).

**Recommendation (ChatGPT):** Either confirm subaccount_id cannot be null, use a null-stable unique expression, or include a generated/coalesced key. Add an acceptance check that the index actually enforces uniqueness AND that REFRESH CONCURRENTLY works after migration.

**Fix applied:** Index now uses `COALESCE(subaccount_id, '00000000-0000-0000-0000-000000000000'::uuid)` to collapse NULL to a sentinel UUID. Two new acceptance checks added to Phase 2 of the build-phase checklist:
1. `SELECT organisation_id, subaccount_id, agent_id, COUNT(*) FROM mv_memory_utility_30d GROUP BY 1,2,3 HAVING COUNT(*) > 1;` → 0 rows expected.
2. `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_memory_utility_30d;` must succeed against dev DB.

Also clarified: initial population in the migration uses plain `REFRESH MATERIALIZED VIEW` (CONCURRENTLY requires at least one prior population).

### T1 — TIGHTENING (TECHNICAL, AUTO-APPLIED) — Daily-series 30 vs 31 buckets

**Issue:** Chunk 7 said "exactly 30 entries" + "from `floor(now - 30 days)` through `floor(now)` inclusive" — that's 31 calendar days.

**Fix applied:** Chunk 7 Behaviour now reads "from `floor(now) - 29 days` through `floor(now)`, inclusive (29 day-offsets + today = 30 buckets total)."

### T2 — TIGHTENING (TECHNICAL, AUTO-APPLIED) — Degraded-reason canonical form

**Issue:** §4 R11 used `buildDegradedResult('embedding_failed')` (unprefixed) while Chunk 10 declared the union as `'retrieval.embedding_failed'` (fully qualified). Mismatch would cause typecheck failure.

**Fix applied:** §4 R11 now reads `buildDegradedResult('retrieval.embedding_failed')` with explicit canonical-name note. All other plan mentions verified to use the fully-qualified form already.

### T3 — TIGHTENING (TECHNICAL, AUTO-APPLIED) — Threshold env NaN protection

**Issue:** `Number(process.env.AKR_RETRIEVAL_THRESHOLD ?? '0.30')` returns NaN on malformed values. NaN comparisons silently filter everything (or nothing) — undetectable in production.

**Fix applied:** Chunk 9 `getRetrievalConfig` now uses `Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.30` with WARN log `retrieval.threshold.env_invalid` on fallback. Range `[0, 1]` because cosine is `[-1, 1]` but threshold semantics require non-negative.

### T4 — TIGHTENING (TECHNICAL, AUTO-APPLIED) — Label-resolve catch inside transaction

**Issue:** Chunk 2 said "if the agent-name JOIN fails, catch + log + still write lineage rows." A real query error inside an open Postgres `tx` aborts the transaction; subsequent inserts silently fail.

**Fix applied:** Chunk 2 error-handling now splits the two modes:
- **No row found** (run/agent hard-deleted): write lineage with `source_run_id` + `source_run_id_hash` populated, `source_run_label_at_capture = null`. Log `synthesis.run_label_unresolved` at INFO. NO try/catch.
- **Query error** (connection/syntax/permission): do NOT catch — propagate so `tx` rolls back. pg-boss retries the synthesis job.

### T5 — TIGHTENING (TECHNICAL, AUTO-APPLIED) — Refresh event semantics

**Issue:** Chunk 5 said "exactly one terminal event per scheduled invocation" but also rethrew so pg-boss retries. That emits one `memory_utility.refresh.failed` per failed attempt, not per scheduled invocation.

**Fix applied:** Three-event contract:
- `memory_utility.refresh.completed` (INFO) — once per success.
- `memory_utility.refresh.attempt_failed` (WARN) — once per failed retry attempt.
- `memory_utility.refresh.failed` (ERROR) — only on terminal exhaustion if pg-boss surfaces it; otherwise DLQ landing acts as the exhaustion signal.

### T6 — TIGHTENING (TECHNICAL, AUTO-APPLIED) — Close Q2 in plan text

**Issue:** §10 still listed Q2 (route path) as an open operator question, but operator pre-approved the org-scoped path before plan-gate. Pure plan-text hygiene.

**Fix applied:** §10 restructured into "Resolved before plan-gate" (Q1 writeVersionRow + Q2 route path with spec-deviation note) and "Assumptions (build-phase confirms)" (buildDegradedResult reuse + capability registry deferral).

### Out-of-scope findings

None — every finding fell into TECHNICAL.

### User-facing findings

None — banner copy is locked, route shape locked, scope unchanged.

---

## Outcome

**Verdict:** APPROVED_AFTER_FIXES (all 8 findings closed in-plan; no operator approval needed for any individual fix). Plan re-reviewable at `tasks/builds/memory-improvements/plan.md`.

**Round count:** 1 / 3 cap. Operator requested Round 2 — see below.

**Auto-commit:** see commit `331ee9cc` `docs(memory-improvements): chatgpt-plan-review R1 — apply 2 blockers + 6 tightenings`.

---

## Round 2 — response received + triage applied 2026-05-13

**Operator pasted ChatGPT-web R2 response.** Continuation inline in the main session (SendMessage tool unavailable; agent contract permits inline triage).

**Verdict:** CHANGES_REQUESTED → APPROVED_AFTER_FIXES — 3 BLOCKERs + 4 TIGHTENINGs (plus 1 optional polish). All TECHNICAL, auto-applied. ChatGPT also confirmed all 8 R1 fixes were adequate (no R1-followup findings).

### F1 (R2) — BLOCKER (TECHNICAL, AUTO-APPLIED) — MV aggregate SUMs may return NULL

**Issue:** PostgreSQL `SUM(... FILTER (WHERE measured_entries))` returns NULL when the filtered set is empty, not 0. That blurs the semantic distinction: NULL ratio should mean "denominator unknown / unavailable", 0 count should mean "measured count exists but total is zero". Without COALESCE, `total_injected_entries` etc. become nullable in the Drizzle declaration and the UI must defensively handle both nulls and zeros for the same conceptual state.

**Fix applied:** Migration 0343 restructured into two CTEs:
1. `per_run` — unchanged guarded array-length per row.
2. `per_agent_sums` — wraps every `SUM(...)` in `COALESCE(..., 0)` so totals are never null.
The outer SELECT computes ratios from the COALESCEd totals using `CASE WHEN total > 0 THEN ... ELSE NULL`. Drizzle MV declaration in Chunk 6 updated: totals declared `.notNull()`, ratios remain nullable.

### F2 (R2) — BLOCKER (TECHNICAL, AUTO-APPLIED) — jsonb_array_length can throw on malformed data

**Issue:** `jsonb_array_length()` throws if the argument is not a JSON array (e.g. legacy row with `{}`, malformed shape, or any non-array JSONB value). One bad historical row would brick the nightly refresh.

**Fix applied:** Every `jsonb_array_length` call wrapped in a `CASE WHEN jsonb_typeof(...) = 'array' THEN jsonb_array_length(...) ELSE 0` guard. NULL injected_entry_ids continues to map to NULL (load-bearing for measured/unmeasured discrimination). Other arrays (cited, applied, citations) treat non-array JSONB as 0.

### F3 (R2) — BLOCKER (TECHNICAL, AUTO-APPLIED) — cosineSimilarity/scoreCandidates contract ambiguity

**Issue:** Chunk 9 contract said `cosineSimilarity` throws on length mismatch, then error-handling said length mismatch is treated as candidate-level skip. Real ambiguity: does `scoreCandidates` catch the throw, or does it propagate? Without explicit boundary, one bad embedding could fail the whole ranker.

**Fix applied:** Contract now explicit:
- `cosineSimilarity` may throw on length mismatch, NaN element, or empty vector.
- `scoreCandidates` is the per-candidate boundary that catches the throw, excludes the malformed candidate from the filtered result, and continues scoring the rest. No global fallback. No degraded reason emitted at this granularity.
- New Chunk 9 test case added: "Per-candidate vector-error skip — one malformed candidate in a pool of N does NOT fail the whole `scoreCandidates` call."

### T1 (R2) — TIGHTENING (TECHNICAL, AUTO-APPLIED) — writeVersionRow null acceptance documented

**Issue:** Chunk 2 said `writeVersionRow` returning null (consecutive identical content) causes a skip, but didn't state whether the resulting "Sources tab shows nothing for this block" is acceptable.

**Fix applied:** Chunk 2 now carries an explicit "Acceptance" note: when `writeVersionRow` returns null, lineage rows are deliberately not written — consistent with the lineage contract being "per committed block version". Log line changed from WARN to INFO (`synthesis.lineage_skipped_unchanged_content`) to reflect "intentional, not an error" status.

### T2 (R2) — TIGHTENING (TECHNICAL, AUTO-APPLIED) — 403 check needs UUID canonicalisation

**Issue:** `req.params.orgId !== req.orgId` raw-string compare is brittle if casing differs (path params are user-controlled). Plan said the 403-before-query rule was the canonical cross-tenant defence on the MV route — that defence is undermined by string-comparison fragility.

**Fix applied:** Architecture-notes 403 snippet now reads:
```typescript
const pathOrgId = req.params.orgId?.toLowerCase();
const sessionOrgId = req.orgId?.toLowerCase();
if (!sessionOrgId || pathOrgId !== sessionOrgId) {
  return res.status(403).json({ error: 'Forbidden' });
}
```

### T3 (R2) — TIGHTENING (TECHNICAL, AUTO-APPLIED) — Admin-bypass clarification

**Issue:** Chunk 5 said the MV is "queryable via withAdminConnection() or via the route's getOrgScopedDb() + WHERE filter." That wording accidentally blessed admin reads outside the refresh path.

**Fix applied:** Chunk 5 access-shape contract narrowed:
- `withAdminConnection()` permitted ONLY in `refreshMemoryUtility30dJob.ts` for `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- All product reads must filter by `organisation_id` in SQL after the route-level 403 check.
- No unfiltered MV SELECT exists in any request path.
- Reviewer-grep target: `mvMemoryUtility30d` references outside the refresh job must all carry a `.where(eq(mvMemoryUtility30d.organisationId, ...))` filter.

### T4 (R2) — TIGHTENING (TECHNICAL, AUTO-APPLIED) — DB-anchored time for daily-series window

**Issue:** Chunk 7 helper signature took `now: Date` and Chunk 6 passed `new Date()`. App-server clock drift could shift the 30-day window vs the JS bucket boundaries, leading to "which runs are in window" disagreeing with "which UTC days the buckets represent."

**Fix applied:** Chunk 6 route service now reads `transaction_timestamp()` from the same SQL query that fetches the agent_runs rows, and passes it to `bucketDailySeries(rows, db_now)`. Chunk 7 helper signature comment updated to require DB-derived time, not `new Date()`. Both clocks anchored to the DB.

### Polish (R2) — Optional EXPLAIN target pinned

**Fix applied:** Phase 4 acceptance checklist now lists the suggested EXPLAIN ANALYZE query (`EXPLAIN ANALYZE SELECT transaction_timestamp() AS db_now, ... FROM agent_runs WHERE organisation_id = $1 AND created_at > transaction_timestamp() - interval '30 days';`) and the expected index target (`agent_runs (organisation_id, created_at)`).

### Out-of-scope findings

None. Every R2 finding was TECHNICAL.

### User-facing findings

None. Banner copy, route shape, scope all unchanged.

### Round 1 fix verification

ChatGPT R2 confirmed all 8 Round 1 fixes (F1, F2, T1, T2, T3, T4, T5, T6) are adequate. No R1-followup findings raised.

---

## Outcome — APPROVED, plan locked

**Verdict:** APPROVED. ChatGPT R2 close: *"After F1/F2/F3 are patched [in R2], this plan is strong enough to build."* All three patched.

**Plan header updated:** Status changed from `plan-gate (ready for operator review before execution)` → `LOCKED — ready for Phase 2 execution (Sonnet session, new conversation)`.

**Round count:** 2 / 3 cap consumed. Operator requested one more pass — see Round 3 below.

**Auto-commit:** commit `a5b27331` `docs(memory-improvements): chatgpt-plan-review R2 — apply 3 blockers + 4 tightenings, lock plan`.

---

## Round 3 — response received + triage applied 2026-05-13

**Operator pasted ChatGPT-web R3 response.** Final cleanup pass. ChatGPT confirmed R1+R2 fixes adequate, no remaining blockers — 3 TIGHTENINGs.

**Verdict:** APPROVED — *"No further blockers from me."*

### T1 (R3) — TIGHTENING (TECHNICAL, AUTO-APPLIED) — Chunk 3 had stale raw-string 403 compare

**Issue:** §3 Architecture notes "Route guards" section was updated in R2 T2 to use UUID-canonicalised lowercase compare, but Chunk 3's Contracts section still showed `if (req.params.orgId !== req.orgId) return res.status(403)` — the old raw pattern. Executor copying from Chunk 3 would reintroduce the case-sensitivity fragility.

**Fix applied:** Chunk 3 Contracts middleware bullet now embeds the canonicalised snippet inline and references §3 Route guards as the source of truth. Explicit "do NOT copy the older raw-string compare" warning.

### T2 (R3) — TIGHTENING (TECHNICAL, AUTO-APPLIED) — measured_entries needs array-shape guard

**Issue:** MV defined `(r.injected_entry_ids IS NOT NULL) AS measured_entries`. With the R2 F2 `jsonb_typeof` guards on the array-length expressions, a malformed JSONB value (`{}`, scalar, etc.) would now produce `injected_entry_count = 0` AND `measured_entries = true` — i.e. "measured empty." That's the wrong semantic — malformed data is untrustworthy, not measured-empty.

**Fix applied:** Definition tightened to `(jsonb_typeof(r.injected_entry_ids) = 'array') AS measured_entries` with inline comment documenting the three-way semantic:
- `NULL` / malformed → unmeasured / not trustworthy
- `[]` → measured empty
- `[ids...]` → measured with entries

### T3 (R3) — TIGHTENING (TECHNICAL, AUTO-APPLIED) — Test inventory missing malformed-candidate test

**Issue:** R2 F3 added a "per-candidate vector-error skip" test case to Chunk 9's test list, but the §8 summary test-inventory table for `retrievalQueryEmbedderPure.test.ts` still listed only the original cases. Reviewers cross-checking the inventory against Chunk 9 would miss the new case.

**Fix applied:** §8 inventory row for `retrievalQueryEmbedderPure.test.ts` now explicitly includes the per-candidate-vector-error-skip case in the test-cases summary.

### Out-of-scope findings

None.

### User-facing findings

None.

---

## Outcome — APPROVED, plan LOCKED

**Verdict:** APPROVED — *"After that, I would move to execution."*

**Round count:** 3 / 3 cap consumed. No further plan rounds.

**Plan header:** Status remains LOCKED (no transition needed). Plan-review history updated from "2 rounds, 15 findings" to "3 rounds, 19 findings, all TECHNICAL, all auto-applied."

**Next step:** Operator opens fresh Claude Code session on Sonnet and runs `tasks/builds/memory-improvements/plan.md` per the Phase 2 resume contract documented in `tasks/builds/memory-improvements/handoff.md`.

**Auto-commit:** see commit message `docs(memory-improvements): chatgpt-plan-review R3 — final 3 tightenings, plan APPROVED + LOCKED`.
