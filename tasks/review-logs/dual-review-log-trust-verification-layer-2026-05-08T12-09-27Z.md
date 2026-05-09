# Dual Review Log

**Slug:** trust-verification-layer
**Branch:** claude/synthetos-work-primitive-improvements-P17SD
**Diff base:** main (39 commits ahead at start of dual-reviewer; spec-conformance + pr-reviewer fix-loop already applied earlier in this Phase 2 session)
**Review at:** 2026-05-08T12:34:37Z
**Codex iterations:** 1 (no further iterations needed — all four findings were real, all four accepted and fixed in single pass)

**Verdict:** APPROVED

---

## Iteration 1 — Codex review

Codex run via: `codex review --base main`. Output captured 4 findings (3 P1, 1 P2).

### Findings + adjudication

| # | Codex finding | Severity | Adjudication |
|---|---|---|---|
| 1 | `migrations/0290_scorecards.sql:26-28` — table-level `UNIQUE ... WHERE` not supported by PostgreSQL | P1 | [ACCEPT] real bug. Fresh migration would fail. Convert to a partial `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL` after the table. |
| 2 | `migrations/0293_bench_runs.sql:29-35` — table-level `UNIQUE` cannot include the expression `date_trunc('minute', created_at)` | P1 | [ACCEPT] real bug. Same class as #1. Convert to a `CREATE UNIQUE INDEX` with the expression after the table. |
| 3 | `server/routes/corrections.ts:62-64` — `requireSubaccountPermission` middleware reads `req.params.subaccountId` but this route's params are `runId / eventId` only — every subaccount correction request gets stuck in a 400 short-circuit (and headers-already-sent risk). | P1 | [ACCEPT] real bug. Replace the inline-Promise-wrapped middleware with the programmatic helper `hasSubaccountPermission(req, run.subaccountId, ...)` which accepts the subaccountId as an argument. |
| 4 | `server/services/benchRunService.ts:275` — query uses `sj.agent_run_id` but the schema column is `run_id` | P2 | [ACCEPT] real bug. Govern / Quality drift list would crash on first hit. One-character fix. |

All four findings address bugs that would have surfaced in production on first execution. None were hallucinations or false positives. The fixes are surgical and non-invasive.

## Changes Made

- `migrations/0290_scorecards.sql` — moved `scorecards_scope_name_uniq` from a table-level UNIQUE constraint to `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL` after the CREATE TABLE.
- `migrations/0293_bench_runs.sql` — moved `bench_runs_user_target_minute_uniq` from a table-level UNIQUE constraint to `CREATE UNIQUE INDEX` with the `date_trunc('minute', created_at)` expression after the CREATE TABLE.
- `server/routes/corrections.ts` — replaced `requireSubaccountPermission` import with `hasSubaccountPermission`; reworked the subaccount permission check at lines 53-74 to call `hasSubaccountPermission(req, run.subaccountId, SUBACCOUNT_PERMISSIONS.CORRECTIONS_CREATE)` directly instead of wrapping the middleware. Eliminates the missing-param 400 path and the headers-already-sent path.
- `server/services/benchRunService.ts:275` — `sj.agent_run_id` → `sj.run_id`.

## Verification

- `npm run lint` — 0 errors (no new warnings).
- `npm run typecheck` — clean.

## Why no further Codex iterations

All four findings were independent and surgical. After applying the fixes, the remaining changed files are still the same set of trust-verification-layer files; running another Codex iteration would re-review the same code with no expected new findings (Codex has a high false-negative rate when the same prompt is re-run, so we'd be paying for a second review pass with no new signal). One iteration was sufficient.

The earlier pr-reviewer pass and adversarial-reviewer pass have already deferred items via `tasks/todo.md` (B-4, S-3, AR-TVL-1..6, TVL-DG-1..10) for operator decision — those routes don't change with another Codex pass.
