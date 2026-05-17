**Status:** Draft v1 — for review before implementation
**Build slug:** iee-worker-retirement
**Date drafted:** 2026-05-17
**Author:** main session (operator-driven)
**Classification:** Standard (deletion / dead-code cleanup, no new product behaviour)

# Retire the IEE worker process & clean up post-e2b legacy code

## Contents

- [1. TL;DR recommendation](#1-tldr-recommendation)
- [2. Why this is safe now (context)](#2-why-this-is-safe-now-context)
- [3. Current state inventory](#3-current-state-inventory)
- [4. Migration sequence (chunked plan)](#4-migration-sequence-chunked-plan)
- [5. Verification gates](#5-verification-gates)
- [6. Risks & rollback](#6-risks--rollback)
- [7. Non-goals](#7-non-goals)
- [8. Open questions](#8-open-questions)
- [9. Estimated effort](#9-estimated-effort)

## 1. TL;DR recommendation

The standalone IEE worker process (`worker/` directory) is obsolete in the current architecture. All v1-critical execution (OpenClaw / `operator_managed`, browser-on-e2b) is orchestrated from the main server. The worker today consumes only two pg-boss queues, one of which (`iee-dev-task`) is parked from v1 scope, and one of which (`iee-cost-rollup-daily`) is a trivial daily cron that belongs on the main server anyway.

**Recommended actions:**

1. **Delete the entire `worker/` directory.** Migrate the cost-rollup cron into the main server first (5–10 lines).
2. **Delete the dead `worker/src/browser/` Playwright code.** Superseded by the e2b sandbox harness at `infra/sandbox-templates/iee-browser/harness/`. Not referenced by any registered handler.
3. **Delete `tasks/builds/openclaw-adapter/scope.md`** — stale placeholder superseded by the shipped `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`.
4. **Keep `ieeDevBackend` registered in the main server** with a prominent header comment that no queue consumer exists in this deployment. Cheaper than removing the registration (which cascades into registry tests, the finaliser, and the adapter contract spec).
5. **Update three doc references** that point at deleted worker code so audits do not surface false positives.

Net effect: one less service to think about, one less deployment artefact, ~30 fewer files in audit grep results, no behavioural change for any v1 capability.

## 2. Why this is safe now (context)

- **OpenClaw / `operator_managed` runs in the main server.** `server/index.ts:735–783` registers the adapter and all four pg-boss handlers. The worker has zero involvement.
- **Browser-on-e2b runs in the main server.** `ieeBrowserBackend` dispatches into the e2b sandbox via `sandboxExecutionService`. The actual browser harness runs inside the e2b sandbox (`infra/sandbox-templates/iee-browser/harness/`), not inside the worker.
- **Worker today registers only two handlers:** `iee-dev-task` (parked from v1) and `iee-cost-rollup-daily` (one daily SQL upsert).
- **`worker/src/browser/` is unreferenced.** The worker entry point (`worker/src/index.ts:14–22`) does not register a browser handler. The Playwright code in `worker/src/browser/` is import-orphaned dead code.

## 3. Current state inventory

### 3.1 Worker code — wired and consumed today

| File / dir | Wired by | Disposition |
|---|---|---|
| `worker/src/index.ts` | entry point | DELETE (after step 4) |
| `worker/src/bootstrap.ts` | entry point | DELETE |
| `worker/src/db.ts`, `logger.ts`, `config/` | infra | DELETE |
| `worker/src/handlers/devTask.ts` | `iee-dev-task` queue (parked v1) | DELETE |
| `worker/src/handlers/costRollup.ts` | `iee-cost-rollup-daily` cron | **MIGRATE to main server, then DELETE** |
| `worker/src/loop/`, `runtime/`, `llm/`, `dev/` | dev-task execution loop | DELETE (carries with dev-task handler) |
| `worker/src/persistence/runs.ts`, `reconcile.ts`, `steps.ts`, `integrationConnections.ts` | dev-task handler | DELETE |
| `worker/package.json`, `worker/tsconfig.json`, `worker/scripts/`, `worker/tests/` | worker build | DELETE |

### 3.2 Worker code — already dead (import-orphaned)

| File / dir | Why dead | Disposition |
|---|---|---|
| `worker/src/browser/` (executor, login, observe, playwrightContext, captureStreamingVideo, contractEnforcedPage, artifactValidator) | Superseded by `infra/sandbox-templates/iee-browser/harness/`. No registered handler consumes these. | DELETE |

### 3.3 Main-server code that references the worker (cosmetic)

| File | Reference | Action |
|---|---|---|
| `Dockerfile:8` | comment: "For the IEE worker, see worker/Dockerfile." | Remove line |
| `docker-compose.yml:12–17, 56–61` | worker-service comments | Replace with one-line "IEE worker retired 2026-05" comment |
| `server/jobs/ieeRunCompletedHandler.ts:5` | doc comment: "(see worker/src/persistence/runs.ts::finalizeRun)" | Remove reference; the handler stays |

### 3.4 Stale spec / planning docs

| File | Why stale | Disposition |
|---|---|---|
| `tasks/builds/openclaw-adapter/scope.md` | "Drafted after Specs A, B, C lock" — but Spec D (`docs/superpowers/specs/2026-05-12-operator-backend-spec.md`) already shipped. Future sessions risk reading this as authoritative. | DELETE (git history preserves it) |
| `docs/iee-development-spec.md § 4` (Worker service skeleton, bootstrap, tsconfig, Docker) | Describes the worker process that this spec retires. | Add a "**SUPERSEDED 2026-05-17**" banner at the top of § 4 pointing to this spec. Do not delete the doc — other sections (data model, job contracts, execution loop) remain authoritative for OpenClaw. |
| `docs/iee-on-e2b-rollout.md` | Mid-migration doc; some sections describe the now-completed transition. | Add a "**Migration complete 2026-05-17**" banner. Keep the rest — useful as an architectural decision record. |

### 3.5 Code that stays (with rationale)

| Item | Why it stays |
|---|---|
| `ieeDevBackend` registration in `server/index.ts:740` | Removing cascades into `registry.ts`, `contractPure.test.ts`, the registered-set in the adapter contract spec, and `_ieeShared.ts`. Cheaper to keep + comment than to unwind. **Action:** add a 5-line header comment to `ieeDevBackend.ts` stating "No queue consumer is registered in this deployment. Dispatch will enqueue an `iee-dev-task` payload that no handler will drain. Re-enable by registering a handler — recommended path is to re-implement using the `operator_managed` pattern, not the legacy worker process." |
| `iee-dev-task` and related queue definitions in `server/config/jobConfig.ts` | Same reasoning — leaving the definitions is cost-free; removing them ripples into config tests and the fixture file. |
| `iee_runs` schema and `ieeRunCompletedHandler` | Live: `ieeBrowserBackend` writes terminal rows. Stays. |

## 4. Migration sequence (chunked plan)

Implementation should follow this order to keep main green at every step:

**Chunk 1 — Migrate cost-rollup to main server.**
- Copy the `runRollup()` SQL from `worker/src/handlers/costRollup.ts` into a new file at `server/jobs/ieeCostRollupDailyJob.ts`.
- Register the handler and cron schedule (`10 2 * * *` UTC) in `server/index.ts` inside the existing pg-boss block.
- Verify: targeted test confirms the SQL upsert still writes to `cost_aggregates`. Run the cron once manually with `boss.send('iee-cost-rollup-daily', {})`.
- Do NOT delete the worker file in this chunk.

**Chunk 2 — Add deprecation header to `ieeDevBackend.ts`.**
- 5-line header comment per § 3.5.

**Chunk 3 — Delete the worker directory.**
- `git rm -r worker/`
- Update root `package.json` if it references worker scripts (verify with grep).
- Update `Dockerfile`, `docker-compose.yml` per § 3.3.
- Update `server/jobs/ieeRunCompletedHandler.ts` doc comment per § 3.3.

**Chunk 4 — Update stale spec docs.**
- Delete `tasks/builds/openclaw-adapter/scope.md`.
- Add "SUPERSEDED" banner to `docs/iee-development-spec.md § 4`.
- Add "Migration complete" banner to `docs/iee-on-e2b-rollout.md`.

**Chunk 5 — Verify nothing references deleted code.**
- `grep -r "worker/src\|from.*worker/" server/ shared/ client/` returns zero hits.
- `npm run typecheck` and `npm run lint` pass.
- `npm run build:server` and `npm run build:client` succeed.

## 5. Verification gates

- **G1 (per chunk):** lint + typecheck + targeted unit tests for any code touched.
- **G2 (post-chunk-5):** full `npm run build` + `npm run typecheck` green.
- **Manual smoke:** boot the server locally and confirm the cost-rollup cron registers (look for the `iee.costrollup.schedule_failed` log line — its absence proves success).
- **Audit-runner targeted pass:** run `audit-runner` on the `worker/` removal to confirm no orphaned references remain.

## 6. Risks & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| `iee-dev-task` enqueued by a forgotten code path goes to dead queue | Low — `ieeExecutionService.ts:182` is the only producer; user has confirmed dev tasks are not v1 | Header comment on `ieeDevBackend` + pg-boss DLQ catches anything that leaks. Alarm via existing DLQ monitor. |
| Cost-rollup migration introduces an SQL or scheduling bug | Low | Daily cron; observable next day; backfillable for 2 days (the look-back window is already 2 days per the existing implementation) |
| Worker code resurrected later for a new use case | Possible but cheap | Git history preserves the directory in full; revert is a single `git revert` of the deletion commit. |
| Worker referenced by a CI gate or audit script we missed | Low | Chunk 5 grep + targeted audit-runner pass catches it. |

Rollback for the whole spec: `git revert` the merge commit. No data migration, no schema change, no irreversible action.

## 7. Non-goals

- **Not deleting `ieeDevBackend` registration.** Out of scope — would ripple into the adapter contract spec and the registry test suite. Header comment is sufficient.
- **Not deleting `iee_runs` schema or the browser handler.** Browser-on-e2b still uses them; the schema is shared.
- **Not migrating the dev-task feature itself.** If re-enabled later, the recommended pattern is to model dev tasks as a new `operator_managed`-style backend, not to rehydrate the old worker.
- **Not changing the hosting topology decision.** Whether to run on Render, Replit, or elsewhere is settled separately (see hosting provider evaluation). This spec is provider-agnostic.

## 8. Open questions

None blocking. Two minor items to confirm during implementation:

1. **Root `package.json` scripts.** Verify whether any npm scripts reference `worker/` (e.g., a `dev:worker` or `build:worker`). If present, remove in chunk 3.
2. **CI gate `verify-no-do-references.sh`.** Confirm it does not also assert the *presence* of `worker/Dockerfile` (it should not — the script's name suggests it only asserts absence of DigitalOcean refs). If it does reference worker paths, update in chunk 3.

## 9. Estimated effort

ABCd estimate: **a-b**. One half-day session for an experienced contributor. No new tests required beyond a targeted check for the cost-rollup migration. No schema changes. No customer-visible behaviour change.

---

## End

This spec replaces the placeholder `tasks/builds/openclaw-adapter/scope.md` (which is itself deleted by this spec) as the source of truth for cleanup work in this area. Once executed, the codebase's "what runs where" story becomes: main server runs everything; e2b runs sandboxed workloads on demand; nothing else exists.
