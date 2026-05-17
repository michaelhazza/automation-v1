# Spec Conformance Log

**Spec:** `tasks/builds/iee-worker-retirement/spec.md`
**Spec commit at check:** `f2408e87`
**Branch:** `claude/hosting-provider-evaluation-oqQDV`
**Base:** `86730eea` (merge-base with `main`)
**Scope:** All-of-spec — Standard build, all 5 chunks per spec §4 claimed complete per `progress.md`
**Changed-code set:** 17 files (staged deletions + unstaged modifications + untracked additions on the working tree; PR #340 itself contains only `spec.md` + `hosting-provider-evaluation/brief.md` and has already merged — the implementation is the uncommitted working-tree changes)
**Run at:** 2026-05-17T07:59:28Z

---

## Contents

- Summary
- Requirements extracted (full checklist)
- Mechanical fixes applied
- Directional / ambiguous gaps (routed to tasks/todo.md)
- Files modified by this run
- Out-of-spec fixes flagged by the operator (independently reviewed)
- Next step

---

## Summary

- Requirements extracted:     22
- PASS:                       15
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 6
- AMBIGUOUS → deferred:       1
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT — 7 directional/ambiguous gaps must be addressed before `pr-reviewer`. One is a likely CI-blocker (`verify-knip-config.sh` will fail because the gate requires `worker/src/index.ts` as a knip entry, but Chunk 3 removed it from `knip.json` without updating the required-entry list in `scripts/lib/check-knip-config.mjs`). See `tasks/todo.md` under "Deferred from spec-conformance review — iee-worker-retirement (2026-05-17)".

---

## Requirements extracted (full checklist)

### Chunk 1 — Migrate cost-rollup to main server

| # | Spec section | Requirement | Verdict |
|---|---|---|---|
| 1 | §4 Chunk 1 | Create `server/jobs/ieeCostRollupDailyJob.ts` with the `runRollup()` SQL ported from `worker/src/handlers/costRollup.ts` | PASS |
| 2 | §4 Chunk 1 | Register the handler and cron schedule `10 2 * * *` UTC in `server/index.ts` inside the existing pg-boss block | PASS |
| 3 | §4 Chunk 1 | Use `boss.schedule(name, cron, ...)` — idempotent by name | PASS |
| 4 | §4 Chunk 1 | Targeted test confirms the SQL upsert still writes to `cost_aggregates`; manual `boss.send('iee-cost-rollup-daily', {})` smoke | DIRECTIONAL_GAP |
| 5 | §4 Chunk 1 | Do NOT delete the worker file in this chunk | PASS (worker file deleted in Chunk 3 as specified) |

### Chunk 2 — Fail-closed guard on `ieeDevBackend.dispatch()`

| # | Spec section | Requirement | Verdict |
|---|---|---|---|
| 6 | §4 Chunk 2 / §3.5 | Runtime guard at top of `dispatch()` returns `failure('iee_dev_backend_retired', ...)` unless `process.env.IEE_DEV_TASK_CONSUMER === 'enabled'` | PASS |
| 7 | §4 Chunk 2 | New `iee_dev_backend_retired` value added to `FailureReason` enum (`shared/iee/failureReason.ts`) | PASS |
| 8 | §4 Chunk 2 / §3.5 | 5-line header comment explaining the guard and pointing future re-enablers at the `operator_managed` pattern | PASS |
| 9 | §4 Chunk 2 | Targeted unit test calls `ieeDevBackend.dispatch()` without the env var and asserts the typed failure | PASS |

### Chunk 3 — Delete the worker directory

| # | Spec section | Requirement | Verdict |
|---|---|---|---|
| 10 | §4 Chunk 3 | `git rm -r worker/` — directory removed | PASS (38 files staged for deletion) |
| 11 | §4 Chunk 3 / §3.3 | Remove `Dockerfile:8` comment `For the IEE worker, see worker/Dockerfile.` | PASS |
| 12 | §4 Chunk 3 / §3.3 | Replace `docker-compose.yml:12–17, 56–61` worker-service comments with a one-line "IEE worker retired 2026-05" comment | PASS |
| 13 | §4 Chunk 3 / §3.3 | Update `server/jobs/ieeRunCompletedHandler.ts:5` doc comment removing the `(see worker/src/persistence/runs.ts::finalizeRun)` reference; handler stays | PASS |
| 14 | §4 Chunk 3 / §8 | Update root `package.json` if it references worker scripts | PASS (verified — no worker scripts present, no diff needed) |

### Chunk 4 — Update stale spec docs

| # | Spec section | Requirement | Verdict |
|---|---|---|---|
| 15 | §4 Chunk 4 / §3.4 | Replace `tasks/builds/openclaw-adapter/scope.md` with the 5-line tombstone | PASS |
| 16 | §4 Chunk 4 / §3.4 | Add "Migration complete 2026-05-17" banner to `docs/iee-on-e2b-rollout.md` | PASS |
| 17 | §4 Chunk 4 / §3.4 | End-to-end audit of `docs/iee-development-spec.md` — banner every section enclosing a worker reference; record the superseded-section list in `progress.md` | DIRECTIONAL_GAP — partial audit; Parts 4–8 banner-superseded, but Parts 1 (line 126) and 12 (lines 1735+) retain worker references while being declared "still authoritative" |

### Chunk 5 — Repo-wide verification

| # | Spec section | Requirement | Verdict |
|---|---|---|---|
| 18 | §4 Chunk 5 | Source-ref ripgrep returns zero hits for `worker/src` outside excluded paths | DIRECTIONAL_GAP — 8 live-source matches remain (stale code comments + one CI-gate fixture). One is a likely CI-blocker. |
| 19 | §4 Chunk 5 | Deploy/entrypoint grep across `package.json`, `.github/`, `scripts/`, `Dockerfile`, `docker-compose.yml`, `infra/` — zero live deploy/start/build references; permitted matches are tombstones or spec-doc text only | PASS — single match in `scripts/gates/verify-no-do-references.sh` deletion-guard array (intentional; asserts these files do NOT exist) |
| 20 | §4 Chunk 5 | `npm run lint` and `npm run typecheck` pass | PASS (re-verified in this session: 0 errors, 883 pre-existing warnings; typecheck clean) |
| 21 | §4 Chunk 5 | `npm run build:server` and `npm run build:client` succeed | AMBIGUOUS — progress.md claims green; not re-run in this session per CI-only-test-gates rule |

### Verification gates (§5)

| # | Spec section | Requirement | Verdict |
|---|---|---|---|
| 22 | §5 | Manual smoke (positive assertion): boot server locally and confirm `iee-cost-rollup-daily` is registered with pg-boss (`iee.costrollup.scheduled` log line OR `SELECT name FROM pgboss.schedule WHERE name = 'iee-cost-rollup-daily'` returns one row). Absence-of-error is not acceptance. | DIRECTIONAL_GAP — not performed per progress.md |
| 23 | §5 | Audit-runner targeted pass on `worker/` removal — confirm no orphaned references | DIRECTIONAL_GAP — not performed per progress.md |

---

## Mechanical fixes applied

None. All gaps were classified as DIRECTIONAL_GAP or AMBIGUOUS per the conservative criteria in this agent's protocol — see "Directional / ambiguous gaps" below for rationale on each.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

1. **REQ #18 — `verify-knip-config.sh` will fail in CI.** Chunk 3 removed `worker/src/index.ts` from `knip.json` (correct), but `scripts/lib/check-knip-config.mjs` still requires it as a required entry surface (line 39: `{ label: 'worker entry (worker/src/index.ts)', sample: 'worker/src/index.ts' }`). The mismatch will fire the `[GATE] knip-config: violations=1` exit on the next CI run. Routed because the fix touches files outside the changed-code set (`scripts/lib/check-knip-config.mjs`, `scripts/verify-knip-config.sh`) and the spec did not explicitly name these files. This is the single most important finding — it's a build break the operator should treat as the highest-priority item.
2. **REQ #18 — stale worker-path comments in live source.** Six locations carry comments that mention deleted worker paths: `shared/iee/observation.ts:38`, `shared/iee/jobPayload.ts:7` and `:88`, `shared/iee/failureReason.ts:118` (this file IS in the changed-code set but the comment was not refreshed), `server/services/agentExecutionLoop.ts:467`, `server/routes/webLoginConnections.ts:293`, and `server/db/schema/ieeRuns.ts:115` (this file IS in the changed-code set; comment at lines 46-72 was refreshed but line 115 comment still names `worker/src/persistence/runs.ts and steps.ts`). Documentation drift. Low risk but in scope of the spec's Chunk 5 grep requirement.
3. **REQ #17 — `iee-development-spec.md` partial audit.** Per spec Chunk 4, every section enclosing a worker reference should carry a superseded banner. Parts 4–8 received banners (correct). But Part 1 (line 126: `"This decision is documented inline in worker/src/actions/schema.ts."`) and Part 12 (lines 1735, 1741, 1891, 1921, 1932, 1970 — multiple worker references) are declared "still authoritative" in `progress.md` while still containing worker-path strings that no longer exist. The Part 11 line 1513 reference is acknowledged in progress.md as a UI mockup label (acceptable). Part 1 / Part 12 status needs operator judgement on whether to banner them or to inline-strikethrough the specific dead references.
4. **REQ #4 — Cost-rollup SQL test does not exercise the SQL.** Spec §4 Chunk 1 says "targeted test confirms the SQL upsert still writes to `cost_aggregates`". The current `server/jobs/__tests__/ieeCostRollupDailyJob.test.ts` only mocks pg-boss and asserts the registration mechanics (queue name, cron expression, `tz: 'UTC'`). The SQL itself is never executed. A genuine SQL-shape or integration test would catch the migration-0272 schema drift class of bug (which the operator already correctly flagged as out-of-spec fix #1).
5. **REQ #22 — Manual smoke not performed.** Spec §5 prescribes a positive-assertion smoke: boot the server, observe `iee.costrollup.scheduled` log line OR query `pgboss.schedule`. Progress.md does not record this; absence-of-error from G1 PASS is explicitly NOT acceptance per the spec.
6. **REQ #23 — Audit-runner targeted pass not performed.** Spec §5 prescribes `audit-runner` on `worker/` removal. Progress.md does not record this. Routing as deferred so the operator can decide whether to run it before `pr-reviewer` or accept the §3 + Chunk 5 manual grep as the equivalent signal.
7. **REQ #21 — `build:server` / `build:client` not re-verified.** Per CLAUDE.md "Test gates are CI-only" rule, this agent did not re-run builds. Progress.md claims they passed at Chunk 5 completion. Listed as AMBIGUOUS for diagnostic visibility — operator trust in the progress.md claim is reasonable since these are deterministic build commands, but the verification chain has a gap.

---

## Files modified by this run

None. Conservative classification → all gaps routed to `tasks/todo.md` instead of auto-applied.

---

## Out-of-spec fixes flagged by the operator (independently reviewed)

These are operator-applied changes outside the spec's prescribed file set. Reviewed for correctness, not flagged as conformance gaps.

1. **`cost_aggregates.organisation_id` NOT NULL handling in the migrated rollup SQL** — confirmed correct. Migration 0272 makes `organisation_id` NOT NULL on `cost_aggregates`. The original worker SQL (verified by inspecting `worker/src/handlers/costRollup.ts` at commit `8c51aa65`) did NOT supply the column. The migrated `runIeeCostRollup` correctly sources `organisation_id` from the existing `GROUP BY organisation_id` clause and includes it in the INSERT column list. Without this fix the rollup would fail on every insert post-0272. Good catch.
2. **`server/db/schema/ieeRuns.ts` TERMINAL STATUS FINALITY CONTRACT comment refresh** — correct. The previous comment listed three deleted worker callers; the refresh points at the live writers (`_ieeShared.ts::ieeFinalise()`, `_ieeShared.ts::ieeDispatch` orphan branch, `agentRunCancelService.ts`). Reasonable maintenance edit. (Note: a separate comment at line 115 of the same file still mentions `worker/src/persistence/runs.ts and steps.ts` — see deferred item #2 above.)
3. **`eslint.config.js` worker T8 boundary rule removal** — correct. The rule targeted `worker/**/*` and is dead after directory deletion. HITL-approved per progress.md.
4. **`vitest.config.ts` worker/** exclude removal** — correct. Same reasoning. HITL-approved.
5. **`knip.json` worker entries removed** — correct in isolation, but creates the contradiction in `scripts/lib/check-knip-config.mjs` flagged as deferred item #1. The two changes must land together for the gate to stay green.

---

## Next step

**NON_CONFORMANT** — 7 directional/ambiguous gaps must be addressed before `pr-reviewer`.

Recommended order for the main session:

1. Fix the `verify-knip-config.sh` / `check-knip-config.mjs` contradiction (deferred item #1). This is a likely CI-blocker and the highest priority. Edit `scripts/lib/check-knip-config.mjs` to remove the `worker entry` row from the `required` array, and edit the comment header in `scripts/verify-knip-config.sh` to drop the `worker/src/index.ts` line. Both edits are surgical.
2. Sweep the 6 stale worker-path code comments (deferred item #2). Each is a one-line comment update.
3. Operator decision on Part 1 / Part 12 of `iee-development-spec.md` (deferred item #3) — banner them, inline-strike the dead references, or leave them with a note in progress.md explaining the call.
4. Run the §5 manual smoke + audit-runner (deferred items #5, #6) before merging. These are the spec's own acceptance gates.
5. Re-author the cost-rollup test to assert SQL shape (deferred item #4) — or accept the gap and rely on the manual smoke. Operator's call.

After fixes for items #1–#3 land, re-run `spec-conformance` to confirm CONFORMANT, then proceed to `pr-reviewer`.

**Note on PR #340:** PR #340 is already merged and contained only docs (`spec.md` + `hosting-provider-evaluation/brief.md`). The implementation reviewed here is the uncommitted working-tree state on the same branch — committing it will require a new PR.
