# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md`
**Spec commit at check:** unchanged on this branch (spec text is the source of truth at HEAD)
**Branch:** `claude/deferred-quality-fixes-ZKgVV`
**Base:** `399f3864b5187d2be99ca9f9807793699560ece7` (= main HEAD; merge-base equals main)
**Scope:** all 21 in-scope items (Waves 1+2+3 per progress.md); F2 explicitly parked per user instruction
**Changed-code set:** 117 files in audit-remediation-followups footprint (filtered from 792 total branch-vs-main diff)
**Run at:** 2026-04-26T05:34:10Z
**Commit at finish:** `3c8faf9190bfcf103b88a5ef61b5edf0ee0566c4`

---

## Contents

- [Summary](#summary)
- [Requirements extracted (full checklist)](#requirements-extracted-full-checklist)
  - [Group A — Defence-in-depth gaps](#group-a--defence-in-depth-gaps)
  - [Group B — Test coverage gaps](#group-b--test-coverage-gaps)
  - [Group C — Observability / drift guards](#group-c--observability--drift-guards)
  - [Group D — Pre-existing pre-merge gates](#group-d--pre-existing-pre-merge-gates)
  - [Group E — Pre-existing test/gate failures](#group-e--pre-existing-testgate-failures)
  - [Group F — Performance / efficiency](#group-f--performance--efficiency)
  - [Group G — Operational / pre-deploy gates](#group-g--operational--pre-deploy-gates)
  - [Group H — System-level invariants](#group-h--system-level-invariants)
- [Mechanical fixes applied](#mechanical-fixes-applied)
- [Directional / ambiguous gaps (routed to tasks/todo.md)](#directional--ambiguous-gaps-routed-to-tasksstodomd)
- [Files modified by this run](#files-modified-by-this-run)
- [Next step](#next-step)

---

## Summary

- Requirements extracted:     59
- PASS:                       56
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 3
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     1 (F2 — documented park per user)

**Verdict:** NON_CONFORMANT (3 directional gaps — see deferred items in `tasks/todo.md`)

The branch substantially implements the spec: every named primitive exists, every named test exists, every named architecture.md rule lands, and 56/59 verifiable requirements pass. The three directional gaps all concern A2/H1 acceptance criteria where the spec demanded an executable, falsifiable signal (gate exits 0; fixture must fail; per-service tests exercise the contract) and the implementation shipped scaffolding without the runtime proof. Each is a discrete follow-up; none requires re-architecting the work already shipped.

---

## Requirements extracted (full checklist)

### Group A — Defence-in-depth gaps

| REQ | Section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 1 | A1a | Every `canonicalDataService` method accepts `PrincipalContext` as first parameter | PASS | `server/services/canonicalDataService.ts:44–855` — 34 method signatures match `principal: PrincipalContext` |
| 2 | A1a | Every non-test caller passes `fromOrgId(...)` or a typed `PrincipalContext` | PASS | `server/config/actionRegistry.ts`, `server/services/connectorPollingService.ts:125,151`, `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts:43,60,73,86,100,112,120,130`, `server/routes/webhooks/ghlWebhook.ts:112`, `server/services/intelligenceSkillExecutor.ts:81,164,272,430,572,647` |
| 3 | A1a | `requirePrincipal` guard throws BEFORE any DB work when `principal` is null/missing | PASS | `server/services/canonicalDataService.ts:35–39` |
| 4 | A1a | `npm run build:server` passes | PASS | confirmed in this run |
| 5 | A1a | New unit test `canonicalDataService.principalContext.test.ts` covers reads + writes + null-throws | PASS | 7/7 tests pass; covers `getAccountById`, `upsertAccount`, `getAccountsByOrg`, `findAccountBySubaccountId`, `listInactiveContacts` null-throws + `fromOrgId` returns shape |
| 6 | A1b | All `// @deprecated — remove in A1b` overloads deleted | PASS | grep returns 0 hits |
| 7 | A1b | Gate fails when any `canonicalDataService.<method>(` call passes a non-`PrincipalContext` first argument | PASS | `scripts/verify-principal-context-propagation.sh:103–122` `classify_first_arg` matches positive allowlist (`fromOrgId(`, `withPrincipalContext(`, typed identifier); rejects bare identifiers / object literals / spread |
| 8 | A1b | Gate emits `[GATE] principal-context-propagation: violations=<count>` | PASS | line 206 invokes `emit_summary`; live run confirms `[GATE] principal-context-propagation: violations=0` |
| 9 | A1b | Fixture self-tests under `scripts/__tests__/principal-context-propagation/` exercise each accepted-shape category | PASS | `bash scripts/__tests__/principal-context-propagation/run-fixture-check.sh` returns 5 PASS lines (bare-identifier=1, object-literal=1, spread=1, fromOrgId=0, typed-variable=0) |
| 10 | A1b | Pre-condition shim-usage greps run before A1b | PASS | A1a left no shims (progress.md "A1a left no shims to remove"); pre-flight is no-op |
| 11 | A1b | `@principal-context-import-only` annotation supported and used where appropriate | PASS | `server/config/actionRegistry.ts:1`; `crmQueryPlannerService.ts` per progress |
| 12 | A2-Phase1 | `scripts/verify-rls-protected-tables.sh` schema-vs-registry diff implemented | PASS | script lines 33–145 do exactly that |
| 13 | A2-Phase1 | `scripts/rls-not-applicable-allowlist.txt` exists with rationale-line shape | PASS | file exists; format documented in header |
| 14 | A2-Phase1 | Header path correction in `rlsProtectedTables.ts` (no `gates/` subdir) | PASS | `server/config/rlsProtectedTables.ts:8` references `scripts/verify-rls-coverage.sh` (correct) |
| 15 | A2-Phase1 | `bash scripts/verify-rls-protected-tables.sh` exits 0 on the current main | **DIRECTIONAL_GAP** | Gate exits 1; reports 64 violations (60 unregistered tenant tables + 4 stale registry entries). See deferred item SC-2026-04-26-1. |
| 16 | A2-Phase1 | Gate emits `[GATE] rls-protected-tables: violations=<count>` | PASS | live run shows the line |
| 17 | A2-Phase2 | `.claude/hooks/rls-migration-guard.js` exists as advisory PostToolUse hook | PASS | file exists, registered in `.claude/settings.json` |
| 18 | A2-Phase3 | `server/lib/rlsBoundaryGuard.ts` exports `assertRlsAwareWrite`, `wrapWithBoundary`, `withOrgScopedBoundary`, `withAdminConnectionGuarded`, `RlsBoundaryUnregistered`, `RlsBoundaryAdminWriteToProtectedTable` | PASS | all six symbols verified at lines 53–208 |
| 19 | A2-Phase3 | 6-case unit test in `server/lib/__tests__/rlsBoundaryGuard.test.ts` | PASS | 11 tests pass (6 spec cases + production-mode no-op + direct API) |
| 20 | A2-Phase3 | `allowRlsBypass: true` justification check in gate (blocking) | PASS | `verify-rls-protected-tables.sh:147–` enforces ±1 line comment |
| 21 | A2-Phase3 | Write-path advisory check (raw `.execute(sql)` near tenant tables) | PASS | gate emits "advisory write-path coverage: 19 potential gaps" |
| 22 | A2-Phase3 | architecture.md updated with the RLS write-boundary paragraph | PASS | line 3054 |
| 23 | A3 | `briefVisibilityService` uses `getOrgScopedDb` | PASS | `server/services/briefVisibilityService.ts:9,30,50` |
| 24 | A3 | `onboardingStateService` uses `getOrgScopedDb` | PASS | `server/services/onboardingStateService.ts:13,50` |
| 25 | A3 | New pure tests under `briefVisibilityServicePure.test.ts` + `onboardingStateServicePure.test.ts` | PASS | both files exist |

### Group B — Test coverage gaps

| REQ | Section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 26 | B1 | `skillStudioServicePure.test.ts` exists with 3 assertions (org/subaccount/system) | PASS | 3/3 tests pass via `tsx --test` |
| 27 | B1 | Tests use `node:test` + `node:assert.rejects` | PASS | imports confirmed |
| 28 | B2 | All 4 jobs carry standard `Idempotency model:` header | PASS | grep across all four files |
| 29 | B2 | Each job has a sequential double-invocation regression test | PASS | 4 idempotency test files; 4/4 pass via `tsx --test` |
| 30 | B2 | Structured `{ status: 'noop', reason, jobName }` return shape | PASS | grep across all four files |
| 31 | B2 | `job_noop:` INFO log line emitted on noop | PASS | `bundleUtilizationJob.ts:90` etc. |
| 32 | B2-ext | All 4 jobs carry `Concurrency model:` header | PASS | grep across all four files |
| 33 | B2-ext | Per-org `pg_advisory_xact_lock` for `bundleUtilizationJob`, `measureInterventionOutcomeJob`; global lock with rationale for `ruleAutoDeprecateJob`; existing lease for `connectorPollingSync` | PASS | header comments + lock-acquisition lines |
| 34 | B2-ext | `__testHooks` seam exposed on all 4 jobs with production-safety guard | PASS | grep across all four files |
| 35 | B2-ext | Parallel double-invocation test using `__testHooks` | PASS | 4 idempotency test files reference `__testHooks` |
| 36 | B2-ext | architecture.md paragraph for Job concurrency + idempotency standard | PASS | line 3056 |

### Group C — Observability / drift guards

| REQ | Section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 37 | C1 | `emit_summary` in `scripts/lib/guard-utils.sh` emits the `[GATE]` line | PASS | line 130 |
| 38 | C1 | `[GATE]` line is the last application-level line | PASS | live runs confirm; grep-based parser succeeds |
| 39 | C1 | architecture.md paragraph documenting the standard | PASS | line 3050 |
| 40 | C2 | `scripts/verify-architect-context.sh` exists | PASS | file exists |
| 41 | C2 | `scripts/architect-context-expected.txt` lists 5 paths in order | PASS | matches `architect.md:48–52` (item 6 is non-file, correctly skipped) |
| 42 | C2 | Failure-mode fixtures under `scripts/__tests__/architect-context/` | PASS | 3 fixture variants exist |
| 43 | C2 | Gate emits `[GATE] architect-context: violations=<count>` and exits 0 today | PASS | live run confirms |
| 44 | C3 | `canonicalRegistryDriftPure.test.ts` exists with set-containment assertions | PASS | 4/4 tests pass |
| 45 | C3 | C3 follow-up entry in `tasks/todo.md` with owner + trigger + Phase-5A coupling | PASS | `tasks/todo.md:957–974` |
| 46 | C4 | actionRegistry.ts comment accurately describes its relationship to `canonicalDataService` | PASS | line 1 carries `@principal-context-import-only` annotation; no dead `fromOrgId` import |

### Group D — Pre-existing pre-merge gates

| REQ | Section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 47 | D1 | Baseline counts captured in `tasks/builds/audit-remediation/progress.md` | PASS | lines 142–149 record 44 + 13 |
| 48 | D2 | Operator framing decision recorded in source spec | PASS | source spec line 1860 records option (c) |
| 49 | D3 | Calibration constant updated from 2 to 7 with grep-pattern listing per occurrence | PASS | `scripts/verify-skill-read-paths.sh:13–25` carries pattern listing; live run shows `PASS: verify-skill-read-paths`, gate violations=0 |

### Group E — Pre-existing test/gate failures

| REQ | Section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 50 | E1 | All 4 pre-existing failing tests dispositioned (fixed / deleted / `node:test` skip) | PASS | progress.md confirms all four fixed; `KNOWLEDGE.md:836` carries triage entries |
| 51 | E2 | `pure-helper-convention` baseline=0 | PASS | `scripts/guard-baselines.json` line 11 |
| 52 | E2 | `integration-reference` baseline recorded under same JSON file | PASS | `scripts/guard-baselines.json` line 22 (=26) |

### Group F — Performance / efficiency

| REQ | Section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 53 | F1 | `findAccountBySubaccountId(principal, subaccountId)` exists on `canonicalDataService` | PASS | `server/services/canonicalDataService.ts:52–63` |
| 54 | F1 | `measureInterventionOutcomeJob` consumer migrated | PASS | `server/jobs/measureInterventionOutcomeJob.ts:283–292` uses the new method |
| 55 | F1 | New unit test asserts targeted SELECT shape | PASS | 5 tests pass via `tsx --test` |
| 56 | F2 | F2 explicitly deferred (Phase-5A `rateLimitStoreService.ts` not yet on main) | OUT_OF_SCOPE | per user invocation; `tasks/builds/audit-remediation-followups/progress.md` documents the park |

### Group G — Operational / pre-deploy gates

| REQ | Section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 57 | G1 | `scripts/verify-migration-sequencing.sh` re-runnable script committed | PASS | file exists with 4 checks |
| 58 | G2 | Runbook + KNOWLEDGE template committed | PASS | `tasks/runbooks/audit-remediation-post-merge-smoke.md` + `KNOWLEDGE.md:812` |

### Group H — System-level invariants

| REQ | Section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 59a | H1 | architecture.md rule codified | PASS | line 3052 carries the Derived-data null-safety paragraph |
| 59b | H1 | `server/lib/derivedDataMissingLog.ts` exports `logDataDependencyMissing` (Pattern A or B) | PASS | Pattern B implemented; export at line 42 |
| 59c | H1 | All in-scope read sites null-safe | PASS | progress.md inventory shows 7 sites already null-safe; 0 refactors needed |
| 59d | H1 | `tasks/builds/<slug>/null-safety-call-sites.md` documents touched + deliberately-not-touched sites | PASS | file exists with full per-domain breakdown |
| 59e | H1 | Allowlist `scripts/derived-data-null-safety-fields.txt` lists ONLY four-domain fields | PASS | 4 fields, all from bundleUtilizationJob + connectorPollingSync (the two writers with named output fields) |
| 59f | H1 | Gate exists in advisory mode | PASS | `scripts/verify-derived-data-null-safety.sh` exits 0 unconditionally; live run confirms |
| 59g | H1 | Per-service unit tests cover the "upstream not yet populated" path | **DIRECTIONAL_GAP** | Helper has zero tests; the spec's rate-limit / debug-downgrade behaviour is uncovered. Progress.md correctly notes 0 refactors were needed (so no per-service tests were authored), but the helper itself still requires tests per spec H1 step 3 + Approach. See deferred item SC-2026-04-26-2. |
| 59h | H1 | Gate self-test: deliberate-violation fixture must fail | **DIRECTIONAL_GAP** | Fixture exists at `scripts/__tests__/derived-data-null-safety/fixture-with-violation.ts` but (a) lives outside the gate's scan path (`server/` only), and (b) carries `// @null-safety-exempt: test fixture`. The gate cannot fail on the fixture as written. No fixture-runner script. See deferred item SC-2026-04-26-3. |
| 59i | H1 | WARN log helper used uniformly | PASS | helper exists; 0 call sites is consistent with progress.md "0 refactors needed" |

---

## Mechanical fixes applied

None. All conformance gaps were classified DIRECTIONAL — auto-fix would require either domain-knowledge triage (A2: which of 64 tables actually have RLS policies vs which legitimately don't) or design choices (H1: where to relocate the fixture, whether to add a fixture runner, whether to remove the `@null-safety-exempt` and the path-exclusion).

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

- **SC-2026-04-26-1** — A2 schema-vs-registry gate fails on current main (64 violations: 60 unregistered tenant tables + 4 stale registry entries). Spec acceptance criterion *"`bash scripts/verify-rls-protected-tables.sh` exits 0 on the current main"* not met. → see `tasks/todo.md` § *Deferred from spec-conformance review*.
- **SC-2026-04-26-2** — H1 helper has no unit tests. Spec H1 Approach step 3 ("Add unit tests asserting the 'upstream not populated yet' path") + Approach step 5 ("Tests cover both the first-occurrence emit AND the rate-limited-skip / debug-downgrade behaviour") not satisfied for `server/lib/derivedDataMissingLog.ts`. → see `tasks/todo.md`.
- **SC-2026-04-26-3** — H1 gate self-test fixture cannot fail. Fixture at `scripts/__tests__/derived-data-null-safety/fixture-with-violation.ts` is outside the gate's scan path AND carries an exempt annotation. Spec H1 acceptance criterion *"Gate self-test: deliberate-violation fixture must fail"* not met. → see `tasks/todo.md`.

---

## Files modified by this run

None on the implementation side. Two persistence files were authored:

- `tasks/review-logs/spec-conformance-log-audit-remediation-followups-2026-04-26T05-34-10Z.md` (this log)
- `tasks/todo.md` (appended one *Deferred from spec-conformance review* section)

---

## Next step

**NON_CONFORMANT** — 3 directional gaps must be addressed by the main session before opening a PR.

Triage suggestion (cheapest first):
1. **SC-2026-04-26-3** (H1 fixture): smallest. Either move the fixture into `server/lib/__tests__/derived-data/` and remove the `@null-safety-exempt` annotation, OR write a tiny shell runner under `scripts/__tests__/derived-data-null-safety/` that invokes the gate against the fixture and asserts a violation lands. <30 min.
2. **SC-2026-04-26-2** (H1 helper tests): one new test file `server/lib/__tests__/derivedDataMissingLog.test.ts` with three cases (first-occurrence WARN, repeat → DEBUG, reset between tests). <60 min.
3. **SC-2026-04-26-1** (A2 gate): largest. Iterate the 60 missing tables, decide register-vs-allowlist for each, ship the registry entries (and their `CREATE POLICY` migrations where missing) or allowlist entries. Multi-day.

After SC-1/2/3 close, re-run `spec-conformance` once more — expect `CONFORMANT_AFTER_FIXES` — then `pr-reviewer`.
