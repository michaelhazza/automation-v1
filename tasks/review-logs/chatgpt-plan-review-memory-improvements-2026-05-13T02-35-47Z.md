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

**Round count:** 1 / 3 cap. Operator may request Round 2 if additional concerns surface during plan-gate review.

**Next step:** plan-gate — operator approves (`proceed`) or revises (`revise` with feedback).

**Auto-commit:** see commit message `docs(memory-improvements): chatgpt-plan-review R1 — apply 2 blockers + 6 tightenings`.
