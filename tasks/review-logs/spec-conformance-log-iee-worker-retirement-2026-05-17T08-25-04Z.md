# Spec Conformance Log (Re-run)

**Spec:** `tasks/builds/iee-worker-retirement/spec.md`
**Spec commit at check:** `3b9cccb7`
**Branch:** `claude/hosting-provider-evaluation-oqQDV`
**Base:** `86730eea` (merge-base with `main`)
**Head:** `f3b05d7c`
**Scope:** All-of-spec — Standard build, all 5 chunks per spec §4 claimed complete. This is a re-run focused on closing the 7 deferred items from the prior log.
**Prior log:** `tasks/review-logs/spec-conformance-log-iee-worker-retirement-2026-05-17T07-59-28Z.md` (NON_CONFORMANT, 7 deferred)
**Changed-code set:** 20 modified + 4 untracked + 38 staged deletions = same working-tree implementation as the prior run, now with mechanical fixes applied for items IEE-WR-1 through IEE-WR-4 (and operator-verified for IEE-WR-7).
**Run at:** 2026-05-17T08:25:04Z

---

## Contents

- Summary
- Per-item re-verification (the 7 prior deferreds)
- Sanity check on prior PASSes
- Informational observations (not new gaps)
- Files modified by this run
- Next step

---

## Summary

| Metric | Prior run | This re-run |
|---|---|---|
| Requirements extracted | 22 | 22 (unchanged) |
| PASS | 15 | 20 |
| MECHANICAL_GAP → fixed | 0 | 0 (operator pre-applied; this run verifies) |
| DIRECTIONAL_GAP → deferred | 6 | 2 (operator action items: smoke + audit-runner) |
| AMBIGUOUS → deferred | 1 | 0 |
| OUT_OF_SCOPE → skipped | 0 | 0 |

**Verdict:** CONFORMANT_AFTER_FIXES — 5 of 7 prior deferred items resolved by main-session fix pass; 2 remaining items are operator-only acceptance gates per spec §5 (manual smoke, audit-runner targeted pass) and do NOT block `pr-reviewer`. They are independent operational verifications scheduled separately.

## Per-item re-verification

### IEE-WR-1 — `verify-knip-config.sh` CI gate (PRIOR DIRECTIONAL_GAP → PASS)

**Verified.** `scripts/lib/check-knip-config.mjs` `required` array (line 36–42) no longer contains the `worker entry (worker/src/index.ts)` row. `scripts/verify-knip-config.sh` header comment (lines 7–11) no longer lists `worker/src/index.ts`. Live smoke confirms: `KNIP_CONFIG_FILE=knip.json node scripts/lib/check-knip-config.mjs` prints `0` and exits `0`. CI gate is no longer a blocker.

### IEE-WR-2 — Six stale worker-path code comments (PRIOR DIRECTIONAL_GAP → PASS)

**Verified.** All six locations carry refreshed comments:

| File | Refreshed comment summary |
|---|---|
| `shared/iee/observation.ts:38` | "Runner was retired with the IEE worker; the schema stays for contract compatibility with `iee_dev_backend_retired`." |
| `shared/iee/jobPayload.ts:7+` | "The standalone worker process that previously consumed the dev payload was retired 2026-05 — see `tasks/builds/iee-worker-retirement/spec.md`." |
| `shared/iee/jobPayload.ts:21` | "(now via the e2b harness, formerly the worker browser loop)" |
| `shared/iee/jobPayload.ts:88` | "The runner was retired with the IEE worker process; the schema stays for contract compatibility behind the `iee_dev_backend_retired` fail-closed guard." |
| `shared/iee/failureReason.ts:117` | TERMINAL FAILURE-TAXONOMY comment block points at the live adapter / harness boundary. |
| `server/services/agentExecutionLoop.ts:466` | "IEE-delegated runs are stopped at the adapter / harness boundary, so this guard is for the in-process API path only." |
| `server/routes/webLoginConnections.ts:291` | "browser harness navigates there after login" (no worker reference) |
| `server/db/schema/ieeRuns.ts:111` | "An inline enum subset previously lived here and drifted relative to the shared enum; mirroring the shared enum directly keeps any future extension propagating automatically." |

### IEE-WR-3 — `iee-development-spec.md` Parts 1 and 12 (PRIOR DIRECTIONAL_GAP → PASS)

**Verified.** Part 1 line 126 has been inline-revised: the prior `"This decision is documented inline in worker/src/actions/schema.ts."` is replaced by `"_Previously documented inline in the now-retired worker/src/actions/schema.ts; the action vocabulary now lives in shared/iee/actionSchema.ts and is consumed by the e2b browser harness._"` — the worker path is now historical context, the live path is named.

Part 12 received a top-level partial-supersession banner directly under the heading (line 1662) explaining that worker-process-specific mitigations (heartbeat reconciliation against `workerInstanceId`, worker startup scan, denylist runner, system-prompt loader inside `worker/src/`) no longer apply, while the underlying risk-tightening patterns (graceful degradation, anti-stagnation, denylist semantics) still inform the e2b harness implementation. This is the spec-prescribed acceptable resolution.

### IEE-WR-4 — Cost-rollup SQL test (PRIOR DIRECTIONAL_GAP → PASS)

**Verified.** A third test was added to `server/jobs/__tests__/ieeCostRollupDailyJob.test.ts` (`'runIeeCostRollup emits two cost_aggregates upserts both supplying organisation_id (migration-0272 regression guard)'`). The test mocks `withAdminConnection` to capture every SQL template `runIeeCostRollup` issues, then asserts: two `INSERT INTO cost_aggregates` statements emitted (one for `entity_type='iee_run'`, one for `entity_type='iee_runtime'`), both include `organisation_id` in the INSERT column list (the regression guard against the pre-migration-0272 shape returning), both include `FROM iee_runs`, `GROUP BY organisation_id`, and `ON CONFLICT` clauses.

Live run via `npx vitest run server/jobs/__tests__/ieeCostRollupDailyJob.test.ts`: 3 tests passed. The SQL itself is now executed by the test (against the mock), not just inspected for function existence. Satisfies the spec §4 Chunk 1 requirement.

### IEE-WR-5 — Manual smoke (still DIRECTIONAL_GAP — operator action item)

**Not addressed.** Per the operator's invocation message: manual-smoke operator action item per spec §5. Carryover; remains routed in `tasks/todo.md`.

### IEE-WR-6 — Audit-runner targeted pass (still DIRECTIONAL_GAP — operator action item)

**Not addressed.** Per the operator's invocation message: audit-runner operator action item per spec §5. Carryover; remains routed in `tasks/todo.md`.

### IEE-WR-7 — `build:server` / `build:client` re-verification (PRIOR AMBIGUOUS → PASS)

**Verified by operator.** The main session re-ran `npm run build:server` and `npm run build:client` during the fix pass and both went green. Per CLAUDE.md "Test gates are CI-only" rule this agent does not re-run them; the operator's claim plus CI's pre-merge build gate close the chain.

## Sanity check on prior PASSes

Spot-checked the 15 prior PASS items to confirm none have regressed:

- `server/jobs/ieeCostRollupDailyJob.ts` exists, exports `registerIeeCostRollupDailyJob` and `runIeeCostRollup`; cron `10 2 * * *` UTC; idempotent by name via `boss.schedule` — PASS retained
- `ieeDevBackend.dispatch()` fail-closed guard at lines 150–164 — PASS retained
- `iee_dev_backend_retired` value in `FailureReason` enum — PASS retained
- 5-line header comment on the guard at `ieeDevBackend.ts:151–156` — PASS retained
- `worker/` directory deleted (38 files staged deletions; `worker/` absent on disk) — PASS retained
- `Dockerfile` no longer mentions worker — PASS retained
- `docker-compose.yml` retains only the spec-prescribed retirement comment block at lines 11–13 and 50–53 — PASS retained
- `server/jobs/ieeRunCompletedHandler.ts:5` no longer references `(see worker/src/persistence/runs.ts::finalizeRun)` — PASS retained
- `tasks/builds/openclaw-adapter/scope.md` is the 5-line tombstone — PASS retained
- `docs/iee-on-e2b-rollout.md` "Migration complete 2026-05-17" banner — PASS retained
- `docs/iee-development-spec.md` Parts 4–8 carry per-part `SUPERSEDED 2026-05-17` banners — PASS retained
- Deploy/entrypoint grep — only intentional match in `scripts/gates/verify-no-do-references.sh` deletion-guard array — PASS retained
- `npm run lint` returns 0 errors, 883 pre-existing warnings — PASS retained
- `npm run typecheck` clean — PASS retained
- `ieeDevBackendRetiredGuard.test.ts` — 2 tests pass under `npx vitest run` — PASS retained

No regressions detected.

## Informational observations (not new gaps)

The Chunk 5 grep pattern in the spec is path-based (`worker/src|from ['"][^'"]*worker/|require\(['"][^'"]*worker/`). Two comments mention "worker" as an actor (not as a path) and so do NOT match the spec's prescribed regex:

- `server/jobs/ieeRunCompletedHandler.ts:15` — "worker retry sweep re-emits unemitted events"
- `server/services/executionBackends/_ieeShared.ts:528` — "worker's retry sweep stops re-firing"

The retry-sweep mechanism (event-emission idempotency / unemitted-event re-publication) still exists in the main server. The comments are factually stale on the *actor* but conceptually correct on the *pattern*. They were not flagged in the prior run because the spec's prescribed grep is path-based, and they are surfaced here only as informational adjacent-doc-drift — not a new conformance gap. Operator may refresh independently.

## Files modified by this run

- `tasks/todo.md` — Deferred section updated to mark IEE-WR-1 through IEE-WR-4 and IEE-WR-7 as RESOLVED 2026-05-17T08-25-04Z; IEE-WR-5 and IEE-WR-6 remain open with their operator-action notes; appended a "Re-run observations" subsection covering the two informational doc-drift comments.

(No code changes — this run is a re-verification of operator-applied fixes from the prior round. The fixes themselves landed before this agent was invoked.)

## Next step

**CONFORMANT_AFTER_FIXES** — 5 of 7 prior gaps resolved; 2 remaining items (IEE-WR-5 manual smoke, IEE-WR-6 audit-runner) are operator action items per spec §5, not code gaps, and do NOT block `pr-reviewer`.

Recommended order:

1. Proceed to `pr-reviewer` on the current branch. The mechanical fix pass touched several files (`scripts/lib/check-knip-config.mjs`, `scripts/verify-knip-config.sh`, six comment locations, `docs/iee-development-spec.md` Part 1 line 126 + Part 12 banner, and the new third test in `ieeCostRollupDailyJob.test.ts`) — the reviewer needs to see this expanded set.
2. After `pr-reviewer` clears, run IEE-WR-5 (manual smoke: `npm run dev` and grep boot logs for `iee.costrollup.scheduled`) and IEE-WR-6 (`audit-runner` targeted pass on worker retirement). Record both in `progress.md`.
3. Once §5 gates pass, proceed to PR creation / merge.
