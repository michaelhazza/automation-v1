**Status:** Draft v2 — for review before implementation
**Build slug:** iee-worker-retirement
**Date drafted:** 2026-05-17 (v1); 2026-05-19 (v2 — pre-freeze hardening added)
**Author:** main session (operator-driven)
**Classification:** Standard — deletion / dead-code cleanup, one runtime job migration (cost-rollup cron from worker to main server), and one pre-freeze production-safety guard (fail-loud on the `OPERATOR_SESSION_IMAGE_TAG` config). No customer-visible product behaviour change.

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
3. **Replace `tasks/builds/openclaw-adapter/scope.md` with a tombstone** pointing to the shipped `docs/superpowers/specs/2026-05-12-operator-backend-spec.md` and this cleanup spec. Outright deletion would lose the breadcrumb — future AI sessions grep `tasks/builds/` and would not see git history. A 5-line tombstone file is cheaper than the confusion.
4. **Keep `ieeDevBackend` registered in the main server, but make it fail closed.** The registration stays for contract compatibility (removing it cascades into registry tests, the finaliser, and the adapter contract spec). The runtime path must refuse to enqueue: `dispatch()` returns a typed `failure('iee_dev_backend_retired', ...)` unless an explicit env gate (`IEE_DEV_TASK_CONSUMER=enabled`) is set. A header comment alone is insufficient because any forgotten call site would silently enqueue to a dead queue.
5. **Update doc references and supersede worker-era sections** of `docs/iee-development-spec.md` and `docs/iee-on-e2b-rollout.md` so audits do not surface false positives. Exact list of superseded sections is determined by the Chunk 4 audit.
6. **Harden `OPERATOR_SESSION_IMAGE_TAG` config (pre-freeze production-safety guard).** Today the env var defaults to the literal string `'latest'` (`server/services/executionBackends/operatorManagedBackend.ts:106`). This is the classic anti-pattern: a forgotten env var silently routes every new OpenClaw session to whatever was most recently published, with no auditable "what's running" answer and no rollback target. Replace the `'latest'` fallback with a fail-loud guard: throw at module load if the env var is unset AND `NODE_ENV === 'production'`. Non-production keeps a documented dev default so local boots still succeed. Pairs with the rollback runbook at `docs/runbooks/operator-session-image-rollback.md`.

Net effect: one less service to think about, one less deployment artefact, ~30 fewer files in audit grep results, plus one pre-freeze production-safety guard. No behavioural change for any v1 capability.

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
| `tasks/builds/openclaw-adapter/scope.md` | "Drafted after Specs A, B, C lock" — but Spec D (`docs/superpowers/specs/2026-05-12-operator-backend-spec.md`) already shipped. Future sessions risk reading this as authoritative. | REPLACE with a 5-line tombstone: `**SUPERSEDED 2026-05-17.** This placeholder has been replaced by the shipped operator-backend spec at `docs/superpowers/specs/2026-05-12-operator-backend-spec.md` and the cleanup spec at `tasks/builds/iee-worker-retirement/spec.md`. Do not treat this directory as an active build.` Git history alone is insufficient because AI sessions grep current file contents, not history. |
| `docs/iee-development-spec.md` (worker-era sections, not § 4 only) | § 4 describes the worker process directly; other sections may reference worker-era execution loops, bootstrap, or process topology that this spec retires. | Audit the doc end-to-end per Chunk 4 — grep for worker references, banner every enclosing section with `**SUPERSEDED 2026-05-17 — see tasks/builds/iee-worker-retirement/spec.md**`. Sections describing data model, job contracts, or OpenClaw execution semantics independent of the worker process remain authoritative. Record the superseded-section list in `progress.md`. |
| `docs/iee-on-e2b-rollout.md` | Mid-migration doc; some sections describe the now-completed transition. | Add a "**Migration complete 2026-05-17**" banner. Keep the rest — useful as an architectural decision record. |

### 3.5 Code that stays (with rationale)

| Item | Why it stays |
|---|---|
| `ieeDevBackend` registration in `server/index.ts:740` | Removing cascades into `registry.ts`, `contractPure.test.ts`, the registered-set in the adapter contract spec, and `_ieeShared.ts`. Cheaper to keep + add a fail-closed guard than to unwind. **Action:** (a) add a runtime fail-closed guard at the top of `dispatch()` in `ieeDevBackend.ts` — return `failure('iee_dev_backend_retired', { reason: 'no consumer in this deployment' })` from `shared/iee/failure.ts` unless `process.env.IEE_DEV_TASK_CONSUMER === 'enabled'`. (b) Add a 5-line header comment explaining the guard and pointing future re-enablers at the `operator_managed` pattern, not the legacy worker process. **Invariant:** `ieeDevBackend` may remain registered for contract compatibility, but production dispatch must fail closed unless an `iee-dev-task` consumer is explicitly enabled. |
| `iee-dev-task` and related queue definitions in `server/config/jobConfig.ts` | Same reasoning — leaving the definitions is cost-free; removing them ripples into config tests and the fixture file. |
| `iee_runs` schema and `ieeRunCompletedHandler` | Live: `ieeBrowserBackend` writes terminal rows. Stays. |

## 4. Migration sequence (chunked plan)

Implementation should follow this order to keep main green at every step:

**Chunk 1 — Migrate cost-rollup to main server.**
- Copy the `runRollup()` SQL from `worker/src/handlers/costRollup.ts` into a new file at `server/jobs/ieeCostRollupDailyJob.ts`.
- Register the handler and cron schedule (`10 2 * * *` UTC) in `server/index.ts` inside the existing pg-boss block.
- **Schedule-registration invariant:** use pg-boss `boss.schedule(name, cron, data, options)`, which is idempotent by `name` (re-registering the same name updates the row, not duplicates it). Confirm only one row exists for `iee-cost-rollup-daily` in `pgboss.schedule` after a fresh boot. No need to pre-delete; pg-boss handles dedup across deploys.
- Verify: targeted test confirms the SQL upsert still writes to `cost_aggregates`. Run the cron once manually with `boss.send('iee-cost-rollup-daily', {})`.
- Do NOT delete the worker file in this chunk.

**Chunk 2 — Add fail-closed guard + deprecation header to `ieeDevBackend.ts`.**
- Runtime guard at the top of `dispatch()`: return `failure('iee_dev_backend_retired', ...)` unless `process.env.IEE_DEV_TASK_CONSUMER === 'enabled'`.
- 5-line header comment per § 3.5 explaining the guard and pointing future re-enablers at the `operator_managed` pattern.
- Verify: add a single targeted unit test that calls `ieeDevBackend.dispatch()` without the env var and asserts the typed failure. No env var = no dispatch.

**Chunk 3 — Delete the worker directory.**
- `git rm -r worker/`
- Update root `package.json` if it references worker scripts (verify with grep).
- Update `Dockerfile`, `docker-compose.yml` per § 3.3.
- Update `server/jobs/ieeRunCompletedHandler.ts` doc comment per § 3.3.

**Chunk 4 — Update stale spec docs.**
- Replace `tasks/builds/openclaw-adapter/scope.md` with the 5-line tombstone per § 3.4 (do not delete the file — keep the breadcrumb for future AI sessions).
- Add "Migration complete" banner to `docs/iee-on-e2b-rollout.md`.
- **Audit `docs/iee-development-spec.md` end-to-end for worker-era references, not just § 4.** Process: grep the file for `worker/`, `worker process`, `bootstrap.ts`, `worker/src/`, `iee-dev-task`, `Worker service`, and the loop/runtime/llm/dev module names from § 3.1. For each match, mark the enclosing section with a `**SUPERSEDED 2026-05-17 — see tasks/builds/iee-worker-retirement/spec.md**` banner. Sections that describe data model, job contracts, or OpenClaw execution semantics independent of the worker process remain authoritative. Record the list of superseded sections in `progress.md` so the supersession scope is explicit and reviewable.

**Chunk 5 — Pre-freeze hardening: fail-loud guard on `OPERATOR_SESSION_IMAGE_TAG`.**
- Edit `server/services/executionBackends/operatorManagedBackend.ts:106`. Current:
  ```ts
  const OPERATOR_SESSION_IMAGE_TAG = process.env.OPERATOR_SESSION_IMAGE_TAG ?? 'latest';
  ```
  Replace with a fail-loud guard that distinguishes production from local-dev:
  ```ts
  const OPERATOR_SESSION_IMAGE_TAG = (() => {
    const v = process.env.OPERATOR_SESSION_IMAGE_TAG;
    if (v && v.length > 0) return v;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'OPERATOR_SESSION_IMAGE_TAG must be set in production. ' +
        'See docs/runbooks/operator-session-image-rollback.md § 2.1.',
      );
    }
    // Local / staging dev fallback. Production never reaches here.
    return 'operator-session:local-dev';
  })();
  ```
- The runbook (`docs/runbooks/operator-session-image-rollback.md`) already documents the env-var pin as a prerequisite (§ 2.1); this chunk makes the runtime enforce it.
- **Why no Render dependency:** the user has confirmed they are not setting up Render at this time. The guard is provider-agnostic — it activates anywhere `NODE_ENV === 'production'`, so it protects whichever host is chosen later without requiring any platform-specific config today.
- **Why operator-session and not iee-browser:** iee-browser already reads its template version from a git-committed `PUBLISHED_VERSION` file (`infra/sandbox-templates/iee-browser/PUBLISHED_VERSION`), so a missing or wrong version surfaces at boot via file-read failure. operator-session is the outlier — env-var-only with an unsafe default — and is the only template currently exposed to the `'latest'` anti-pattern.
- Verify: targeted unit test that imports `operatorManagedBackend` with `NODE_ENV=production` and no env var, asserts the typed throw. Second test with the env var set, asserts the resolved value. Non-prod path needs no test (it's just the fallback string).
- Update `docs/runbooks/operator-session-image-rollback.md` § 2.1 to reference the new fail-loud behaviour: "the runtime now refuses to boot if this env var is unset in production" replaces "if this env var is unset, the runtime silently uses `latest`."

**Chunk 6 — Verify nothing references deleted code.**
- Repo-wide ripgrep (worker refs live in CI, Docker, scripts, docs, packages — not just `server/shared/client/`):
  `rg -n "worker/src|from ['\"][^'\"]*worker/|require\\(['\"][^'\"]*worker/" --glob '!node_modules' --glob '!dist' --glob '!build' --glob '!.git' --glob '!coverage' --glob '!tasks/builds/iee-worker-retirement/**'`
  returns zero hits. The build-slug exclusion prevents the spec itself (which discusses the path strings) from being a false positive.
- Also grep root `package.json`, `.github/workflows/`, `scripts/`, `Dockerfile`, `docker-compose.yml`, and `infra/` explicitly — these are the most likely places to harbour a forgotten worker reference.
- **Deploy / process-entrypoint assertion** (catches the spec-orthogonal failure mode of a CI pipeline or container still trying to *start* the worker even after the source is gone):
  ```
  rg -n "dev:worker|build:worker|start:worker|worker/Dockerfile|node .*worker|tsx .*worker|worker:" \
    package.json package-lock.json .github scripts Dockerfile docker-compose.yml infra \
    --glob '!node_modules'
  ```
  Acceptance: zero live deploy/start/build references. The only permitted matches are intentional tombstone or spec-doc text (e.g. this spec itself, the `openclaw-adapter` tombstone, the `iee-development-spec.md` superseded-section banners). Triage every hit manually — do not auto-pass on count alone.
- `npm run typecheck` and `npm run lint` pass.
- `npm run build:server` and `npm run build:client` succeed.

## 5. Verification gates

- **G1 (per chunk):** lint + typecheck + targeted unit tests for any code touched.
- **G2 (post-chunk-6):** full `npm run build` + `npm run typecheck` green.
- **G3 (post-chunk-5, pre-freeze hardening):** boot the server with `NODE_ENV=production` and no `OPERATOR_SESSION_IMAGE_TAG` set; assert it throws with the documented message. Boot again with the env var set; assert it boots cleanly. This is the positive-assertion proof that the guard works.
- **Manual smoke (positive assertion):** boot the server locally and confirm `iee-cost-rollup-daily` is registered with pg-boss. Acceptance is a positive signal — either an `iee.costrollup.scheduled` log line on boot, or `SELECT name FROM pgboss.schedule WHERE name = 'iee-cost-rollup-daily'` returning one row. Absence of an error log is not acceptance.
- **Audit-runner targeted pass:** run `audit-runner` on the `worker/` removal to confirm no orphaned references remain.

## 6. Risks & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| `iee-dev-task` enqueued by a forgotten code path goes to dead queue | Eliminated — the fail-closed guard in `ieeDevBackend.dispatch()` refuses to enqueue without the explicit `IEE_DEV_TASK_CONSUMER=enabled` env gate | The guard returns a typed `failure('iee_dev_backend_retired', ...)`; pg-boss DLQ remains as defence-in-depth but should never be exercised in v1. |
| Cost-rollup migration introduces an SQL or scheduling bug | Low | Daily cron; observable next day; backfillable for 2 days (the look-back window is already 2 days per the existing implementation) |
| Worker code resurrected later for a new use case | Possible but cheap | Git history preserves the directory in full; revert is a single `git revert` of the deletion commit. |
| Worker referenced by a CI gate or audit script we missed | Low | Chunk 6 grep + targeted audit-runner pass catches it. |
| **Production deploy without `OPERATOR_SESSION_IMAGE_TAG` set** | Eliminated by Chunk 5 fail-loud guard | Boot fails fast with a typed error pointing at the runbook; no silent fallback to `latest`. Operator catches this in their own deploy flow before any customer sees it. |

Rollback for the whole spec: `git revert` the merge commit. No data migration, no schema change, no irreversible action.

## 7. Non-goals

- **Not deleting `ieeDevBackend` registration.** Out of scope — would ripple into the adapter contract spec and the registry test suite. The runtime fail-closed guard (§ 3.5, Chunk 2) is the safety mechanism; a header comment alone is not.
- **Not deleting `iee_runs` schema or the browser handler.** Browser-on-e2b still uses them; the schema is shared.
- **Not migrating the dev-task feature itself.** If re-enabled later, the recommended pattern is to model dev tasks as a new `operator_managed`-style backend, not to rehydrate the old worker.
- **Not changing the hosting topology decision.** Whether to run on Render, Replit, or elsewhere is settled separately (see hosting provider evaluation). This spec is provider-agnostic.

## 8. Open questions

None blocking. Two minor items to confirm during implementation:

1. **Root `package.json` scripts.** Verify whether any npm scripts reference `worker/` (e.g., a `dev:worker` or `build:worker`). If present, remove in chunk 3.
2. **CI gate `verify-no-do-references.sh`.** Confirm it does not also assert the *presence* of `worker/Dockerfile` (it should not — the script's name suggests it only asserts absence of DigitalOcean refs). If it does reference worker paths, update in chunk 3.

## 9. Estimated effort

ABCd estimate: **a-b**. One half-day session for an experienced contributor. Three targeted regression tests required: cost-rollup SQL upsert (Chunk 1), `ieeDevBackend` fail-closed guard (Chunk 2), `OPERATOR_SESSION_IMAGE_TAG` fail-loud guard (Chunk 5). No broader new test suite. No schema changes. No customer-visible behaviour change. Chunk 5 is independent of all other chunks (touches only `operatorManagedBackend.ts` + a runbook line) and could ship as a standalone PR if the worker-retirement portion needs more review iterations.

---

## End

This spec replaces the placeholder `tasks/builds/openclaw-adapter/scope.md` (which this spec converts to a tombstone, see § 3.4) as the source of truth for cleanup work in this area. Once executed, the codebase's "what runs where" story becomes: main server runs everything; e2b runs sandboxed workloads on demand; nothing else exists.
