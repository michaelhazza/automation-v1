# CI Readiness Report

Read-only audit of the Automation OS repo, produced as input to the GitHub Actions CI implementation prompt. Captures the exact commands, paths, env vars, and gotchas a follow-up implementation pass needs.

Scope of the audit: the entire repository as of branch `claude/add-github-actions-ci-1Ldda`, no files modified except this report.

## Table of contents

1. Test runner and commands
2. Database setup
3. Existing workflows
4. Required environment variables for CI
5. Node version to use
6. Repository structure notes
7. Risks and recommendations

---

## 1. Test runner and commands

### Runner

There is no test framework installed. No Vitest, no Jest, no Mocha. Test files use one of two patterns, both run via `tsx`:

1. A handwritten `test()` / `assert()` helper at the top of each file, with a per-file pass/fail tally printed at the bottom. This is the dominant pattern, codified in `docs/testing-conventions.md`.
2. Node's built-in test runner (`import test from 'node:test'`, `import assert from 'node:assert/strict'`). Used by 50 of the 245 `.test.ts` files. Compatible with `tsx` because each file is invoked directly.

Both patterns are runnable via `npx tsx <path-to-test-file>`. The `scripts/run-all-unit-tests.sh` discovery loop uses exactly that invocation.

### Three test layers

The repo has three layers per `docs/testing-conventions.md`. CI must run all three.

| Layer | Script | What it does |
|-------|--------|--------------|
| Static gates | `scripts/run-all-gates.sh` | 50+ `verify-*.sh` scripts that grep the codebase for structural invariants. Sub-second each. |
| QA spec checks | `scripts/run-all-qa-tests.sh` | Bash check-list asserting file existence, schema fields, route presence. |
| Runtime unit tests | `scripts/run-all-unit-tests.sh` | Discovers every `**/__tests__/*.test.ts` and runs each via `npx tsx`. |

### Exact `package.json` script entries

```json
"test": "npm run test:gates && npm run test:qa && npm run test:unit",
"test:gates": "bash scripts/run-all-gates.sh",
"test:qa": "bash scripts/run-all-qa-tests.sh",
"test:unit": "bash scripts/run-all-unit-tests.sh",
"playbooks:test": "tsx server/lib/workflow/__tests__/workflow.test.ts",
"test:trajectories": "tsx scripts/run-trajectory-tests.ts"
```

`CLAUDE.md` § "Test gates are CI-only" explicitly states these are not to be run in local dev sessions. CI is the intended consumer.

### Recommended CI test command

```bash
npm test
```

This chains `test:gates && test:qa && test:unit` and exits non-zero on the first failure. Equivalent to running the three sub-scripts in order. No flag is needed for excluding integration tests, because they self-skip (see § 7).

### Test file inventory

| Pattern | Count | Location |
|---------|-------|----------|
| `**/__tests__/*.test.ts` | 275 | All under `server/`, `shared/`, `worker/scripts/` |
| `*.integration.test.ts` (subset of above) | 10 | Under `server/services/__tests__/`, `server/jobs/__tests__/`, `server/routes/__tests__/`, `server/services/crmQueryPlanner/__tests__/`, `server/services/systemMonitor/triage/__tests__/`, `server/lib/__tests__/` |
| Test files outside `__tests__/` | 2 | `shared/lib/parseContextSwitchCommand.test.ts`, `server/services/scopeResolutionService.test.ts` (NOT discovered by `run-all-unit-tests.sh`, which requires the `__tests__/` segment) |
| Trajectory fixtures | 5 JSON files in `tests/trajectories/` | Run via `npm run test:trajectories`, not part of `npm test`. |

### Real external API calls in tests

None found. The only matches for hardcoded external hostnames in `**/*.test.ts` are:

- `'https://hooks.slack.com/services/...'` in `server/services/__tests__/notifyOperatorFanoutServicePure.test.ts`. Static string fixture, not invoked.
- `fetch(...)` calls in `server/services/__tests__/fixtures/__tests__/fakeWebhookReceiver.test.ts`. These hit a locally started fake webhook server (`startFakeWebhookReceiver()`), not a real URL.

No tests import HubSpot, Stripe, GHL (`leadconnectorhq.com`), Gmail, OpenAI, Anthropic, SendGrid, or Resend SDKs at the test boundary.

### Playwright

Playwright is installed (`playwright`, `@playwright/test`) but only consumed by the IEE worker runtime under `worker/src/browser/*`, not by the test suite. Zero `*.test.ts` files import `@playwright/test`. CI does not need to install browsers.

### pg-boss

Zero `*.test.ts` files import `pg-boss`. The 10 integration tests that touch queue behaviour use the real `db` module via the integration gate (`NODE_ENV=integration` + `DATABASE_URL`), but no test boots a pg-boss worker.

---

## 2. Database setup

### ORM

Drizzle ORM. Confirmed via `package.json` (`drizzle-orm@^0.45.1`, `drizzle-kit@^0.31.10`) and `drizzle.config.ts`:

```ts
export default defineConfig({
  schema: './server/db/schema/*',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

### Migration command for CI

```bash
npm run migrate
```

This script is `tsx scripts/migrate.ts`. It is a custom forward-only SQL runner, NOT `drizzle-kit migrate` and NOT `drizzle-kit push`. The header comment in `scripts/migrate.ts` explains why:

> Replaces drizzle-kit migrate. Reads `migrations/*.sql` in lexical order, tracks applied files in a `schema_migrations` table, and applies any pending files in their own transaction. drizzle-kit migrate only applies migrations registered in `migrations/meta/_journal.json`. The team has been hand-writing SQL files (numbered 0041+) without registering them in the journal, so drizzle-kit silently skipped them.

What `npm run migrate` does on a fresh database:

1. Acquires a Postgres advisory lock (key `4242_0001`).
2. Runs `CREATE EXTENSION IF NOT EXISTS pgcrypto`. Required by migration `0018` (`gen_random_bytes`).
3. Creates `schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)`.
4. Discovers every file matching `^\d{4}_.*\.sql$` under `migrations/`, sorted lexically.
5. Applies each pending file in its own transaction.

Re-runnable. Safe to invoke every CI run.

The legacy entry `migrate:drizzle-legacy` (`drizzle-kit migrate`) exists in `package.json` but must NOT be used by CI. It only applies migrations registered in `_journal.json`, which is incomplete past file `0040`.

### Migration file count and IEE coverage

`migrations/` currently contains 247 files matching the SQL pattern, numbered `0000_*.sql` through `0243_*.sql` (plus `*.down.sql` partners and a `_down/`, `meta/` subdirectory).

The IEE-specific tables (`iee_runs`, `iee_steps`, `iee_artifacts`, plus `llm_requests` columns) are migrated via:

- `0070_iee_execution_environment.sql`
- `0071_iee_event_emitted_at.sql`
- `0176_iee_run_id_and_inflight_index.sql`

These are normal numbered migrations applied by `npm run migrate`. There is no manual SQL approach in play. CI's migration step does cover them.

### Test-database setup

There is no dedicated test database setup script. The integration tests connect to whatever `DATABASE_URL` points at. The recommended CI pattern:

1. Boot a Postgres 16 service container.
2. Set `DATABASE_URL` to point at it.
3. Run `npm run migrate` to bring the schema up.
4. Run `npm test`.

### Postgres extension requirement

`pgcrypto` is auto-created by the migration runner, so CI does NOT need to install the extension via SQL. As long as the Postgres image bundles `pgcrypto` (the official `postgres:16` image does), the runner handles bootstrap.

### Seed scripts

`scripts/seed.ts` exists (`npm run seed`) and a production variant (`npm run seed:production`). Tests do NOT depend on seeded data. The `loadFixtures.ts` helper at `server/services/__tests__/fixtures/loadFixtures.ts` produces pure TypeScript fixture objects that integration tests consume directly. CI does NOT need to run seeds before tests.

---

## 3. Existing workflows

`.github/` contains exactly one file:

- `.github/pull_request_template.md`

There is no `.github/workflows/` directory. There are no workflow files. There is no `.github/dependabot.yml`. There is no `.github/actions/` directory.

There are no existing CI processes that would conflict with or overlap the planned workflow. The implementation can create `.github/workflows/ci.yml` cleanly.

The planned workflow will be the first CI configured for this repo.

---

## 4. Required environment variables for CI

`.env.example` declares around 50 variables. The vast majority are runtime-only and not consumed by any test file. The only env vars actually referenced by `**/*.test.ts` (via `grep -oE 'process\.env\.[A-Z_]+'`) are:

```
DATABASE_URL
EMAIL_FROM
JWT_SECRET
NODE_ENV
ROUTER_FORCE_FRONTIER
SECRET
SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS
SYSTEM_INCIDENT_INGEST_ENABLED
SYSTEM_INCIDENT_THROTTLE_MS
SYSTEM_MONITOR_COVERAGE_LOOKBACK_TICKS
SYSTEM_MONITOR_COVERAGE_THRESHOLD
SYSTEM_MONITOR_ENABLED
SYSTEM_MONITOR_MAX_TRIAGE_PER_FINGERPRINT
```

### Definitely needed in CI

| Variable | Why |
|----------|-----|
| `DATABASE_URL` | Required by `npm run migrate` (the runner exits 1 if absent). Also probed by every integration test as their skip-gate. |
| `NODE_ENV` | Set to `integration` to opt the integration tests in, or leave unset to make them self-skip. Recommendation: leave unset on PR runs so the suite stays fast and deterministic. The integration tests check `process.env.NODE_ENV !== 'integration'` and skip. |
| `JWT_SECRET` | Some unit tests (e.g. tests touching auth helpers) import modules that read this at module-load time. A throwaway value is fine. |
| `EMAIL_FROM` | Same shape: imported transitively by some tests via the email service. A throwaway value is fine. |

### Probably mockable / safe defaults

The `SYSTEM_MONITOR_*` and `SYSTEM_INCIDENT_*` flags have defaults baked into their consumers and only need to be set if a specific test wants to override them. The tests that read them set them inside the test body, so CI does not need to provide values.

`ROUTER_FORCE_FRONTIER` and `SECRET` are similarly test-local overrides, set inside the test that needs them. CI does not need to provide values.

### Definitely needs mocking (or skipping in CI)

There are no env vars in this category. No test reads provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STRIPE_KEY`, `HUBSPOT_*`, `GHL_*`, `SENDGRID_API_KEY`, `RESEND_API_KEY`). The provider-facing code lives behind adapters that are stubbed at the module boundary in tests (see `server/services/__tests__/fixtures/fakeProviderAdapter.ts`).

### Minimum CI env block

```yaml
env:
  DATABASE_URL: postgres://postgres:postgres@localhost:5432/automation_os_test
  JWT_SECRET: ci-throwaway-jwt-secret
  EMAIL_FROM: ci@automation-os.local
  NODE_ENV: test
```

`NODE_ENV: test` (or leaving it unset) keeps the 10 `*.integration.test.ts` files in skip mode. Do NOT set `NODE_ENV=integration` on the PR-gating job: those tests boot pg-boss queues, take longer, and add flake risk.

### Variables NOT needed by tests but read at module-load time

Some service modules read env vars at import time. If a test transitively imports such a module, CI may need a placeholder so the import does not throw. Searching `**/*.test.ts` for direct `process.env.X` access produced the list above; the four "definitely needed" entries cover the import-time reads observed across the suite. If a CI run surfaces a `Missing required env: FOO` error from `server/lib/env.ts`, add `FOO` to the env block with a throwaway value (the validation runs at module-load, not at request time).

---

## 5. Node version to use

There is no `.nvmrc`, no `.node-version`, and no `engines` field in `package.json`.

Indirect signals all point to Node 20:

- Root `Dockerfile`: `FROM node:20-slim`.
- Root `package.json`: `"@types/node": "^20.11.5"`.
- `tools/mission-control/package.json`: `"@types/node": "^20.11.0"`.
- `.replit`: `modules = ["nodejs-20", "bash", "web", "postgresql-16"]`.

### Recommendation

Pin CI to Node 20 with `actions/setup-node@v4`:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'
```

Pinning to the latest 20.x LTS line matches both the Dockerfile and the Replit production environment. Do NOT pick Node 22 unilaterally; it would diverge from production.

---

## 6. Repository structure notes

### Top-level layout

```
automation-v1/
  .claude/                Claude Code agent + skill definitions
  .github/                pull_request_template.md only (no workflows)
  attached_assets/
  client/                 React + Vite frontend
  companies/
  db-init/
  docs/                   Specs, briefs, this report
  migrations/             247 numbered SQL migrations
  prototypes/
  reports/
  scripts/                Migration runner, gates, QA scripts, seeds
  server/                 Express + Drizzle backend (the bulk of test files)
  shared/                 Shared types and pure helpers (some tests)
  tasks/                  Build artifacts, TODOs, lessons
  tests/                  trajectory JSON fixtures only
  tools/                  Mission Control sub-app
  worker/                 IEE worker process (Playwright runtime)
```

### Monorepo classification

The repo is a SHALLOW monorepo. Three `package.json` files exist:

1. `./package.json`: the main app. Defines `npm test`, all migration scripts, all gate scripts. CI's primary target.
2. `./worker/package.json`: the IEE worker. Deliberately empty of dependencies, per its own header comment: "Runtime dependencies (drizzle-orm, postgres, pg-boss, playwright, zod) and dev tooling are intentionally NOT declared here, they are resolved from the repo root `node_modules` to avoid duplicate package installs that cause TypeScript type-identity conflicts during the Docker build." The worker has no `test` script and no `*.test.ts` files. CI does NOT need to install or build the worker package separately.
3. `./tools/mission-control/package.json`: a self-contained read-only "What's In Flight" dashboard. Has its own `test` script (`tsx server/__tests__/logParsers.test.ts`) but is gated behind `tools/mission-control/` and is NOT discovered by `scripts/run-all-unit-tests.sh` (the runner only matches `**/__tests__/*.test.ts` paths, and the discovery starts from the repo root, but mission-control has its own `node_modules` resolution and is not in scope for the main suite). CI does NOT need to run mission-control tests.

### IEE worker location

In the same repo as the main app, under `worker/`. Source under `worker/src/` (handlers, persistence, browser, runtime). The IEE worker is built and shipped via its own Dockerfile (`worker/Dockerfile`) using the official Playwright base image. The worker's only test-shaped file is `worker/tests/dev/qualityChecks.unit.ts`, which is NOT a `*.test.ts` file and NOT discovered by `run-all-unit-tests.sh`. CI does not exercise it.

### Implication for CI

CI runs from the repo root with a single `npm ci && npm run migrate && npm test`. No sub-package installs, no worker build, no monorepo orchestration tool (no Turborepo, no Nx, no pnpm workspaces).

---

## 7. Risks and recommendations

Specific, named risks that could make CI flaky, slow, or fail on first run.

### R1: Integration tests boot pg-boss and `db` modules with side effects

**Files:**
- `server/lib/__tests__/logger.integration.test.ts`
- `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts`
- `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts`
- `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`
- `server/services/__tests__/briefConversationWriterPostCommit.integration.test.ts`
- `server/services/__tests__/incidentIngestorThrottle.integration.test.ts`
- `server/routes/__tests__/conversationsRouteFollowUp.integration.test.ts`
- `server/routes/__tests__/briefsArtefactsPagination.integration.test.ts`
- `server/services/crmQueryPlanner/__tests__/integration.test.ts`
- `server/services/systemMonitor/triage/__tests__/triageDurability.integration.test.ts`

**Behaviour:** all 10 self-skip via `process.env.NODE_ENV !== 'integration'` and `!process.env.DATABASE_URL`. With `NODE_ENV` left unset (or set to `test`), they print a skip line and exit zero. They are then NO RISK to PR-gating CI.

**Recommendation:** keep `NODE_ENV` unset (or `test`) on the PR-gating job. Do NOT promote these to a hard-run set without first verifying they pass against a real DB locally; some have `// Implementer-supplied:` TODO blocks that mean the test body is incomplete and would no-op even when not skipped.

**No `--exclude` flag is needed.** The existing skip-gates handle this natively.

### R2: `run-all-unit-tests.sh` runs every test file sequentially via `npx tsx`

**Behaviour:** the discovery loop calls `npx tsx <file>` for each of 275 files, one at a time. Each `tsx` invocation pays its own cold-start cost (transpile, module load). On a GitHub Actions standard runner this is 10 to 25 minutes wall-clock for the unit suite alone.

**Recommendation for the implementation prompt:** accept the wall-clock cost on the first iteration; do not introduce a parallel runner in this CI cut. If the suite proves too slow, a later improvement can swap to xargs `-P` or a per-directory chunking strategy. Out of scope for this CI bring-up.

### R3: Static gate scripts are grep-based and assume specific repo layout

**Behaviour:** every `verify-*.sh` greps relative to repo root. They depend on:
- `node_modules/` being present (for some gates that exclude it from search)
- The full source tree (no shallow checkout)

**Recommendation:** use `actions/checkout@v4` with default `fetch-depth: 1` (shallow is fine, gates do not consult git history). Run `npm ci` before any gate.

### R4: Migration runner takes a Postgres advisory lock

**Behaviour:** `scripts/migrate.ts` calls `pg_advisory_lock(4242_0001)` and never releases until the script exits. If two CI jobs share a database, the second blocks until the first finishes. With a per-job service container, this is moot.

**Recommendation:** use a per-job Postgres service container (the standard `services:` block on GitHub Actions). Do NOT share a Postgres instance across jobs.

### R5: First migration run on Postgres 16 needs `pgcrypto`

**Behaviour:** migration `0018` calls `gen_random_bytes()` from `pgcrypto`. The migration runner creates the extension on every run (`CREATE EXTENSION IF NOT EXISTS pgcrypto`).

**Recommendation:** the official `postgres:16` Docker image bundles `pgcrypto` as a contrib module, so `CREATE EXTENSION` works without installing additional packages. No special service-container config required.

### R6: Two test files live outside `__tests__/` and are NOT run by the unit runner

**Files:**
- `shared/lib/parseContextSwitchCommand.test.ts`
- `server/services/scopeResolutionService.test.ts`

**Behaviour:** `run-all-unit-tests.sh` discovers only `**/__tests__/*.test.ts`. These two files are silently skipped today, in local dev and CI alike.

**Recommendation:** out of scope for the CI implementation prompt. Flag for follow-up triage. Either move them under `__tests__/` or extend the discovery glob, but not as part of this CI bring-up.

### R7: `.env.example` declares roughly 50 vars, only 4 are import-time required for tests

**Behaviour:** see § 4. The minimal env block (`DATABASE_URL`, `JWT_SECRET`, `EMAIL_FROM`, `NODE_ENV=test`) covers the observed test imports.

**Recommendation:** start with the minimal block. If a CI run surfaces a `Missing required env: FOO` error, append `FOO=ci-throwaway` and re-run. Do NOT preload the entire `.env.example` into the workflow; most variables are runtime-only and would be noise.

### R8: No frontend tests, no API contract tests

**Behaviour:** zero `*.test.tsx` files, zero supertest, zero React Testing Library. This is a deliberate posture documented in `docs/testing-structure-Apr26.md`.

**Recommendation:** out of scope. CI must NOT attempt to discover or run frontend tests. The implementation prompt should not include any `npm run build:client` step in the test job (that belongs in a separate build job if needed at all).

### R9: No `engines` field, no `.nvmrc`, drift risk

**Behaviour:** Node version is implicit. A future contributor on Node 22 might unintentionally bump APIs that production (Node 20) does not have.

**Recommendation:** out of scope for CI bring-up, but flag for follow-up: add either an `engines` field or a `.nvmrc` to make the Node version explicit at the repo level. CI workflow should pin to Node 20 explicitly regardless.

### R10: Integration test bodies contain TODO placeholders

**Files:** `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts` (and likely others) contain commented-out bodies marked `// Implementer-supplied:`. They self-skip today and would still pass-as-no-op if `NODE_ENV=integration` were set, because the assertions are guarded by absent state.

**Recommendation:** do not enable `NODE_ENV=integration` on PR-gating CI. If integration coverage is wanted, schedule a separate workflow on push-to-main only.

### Summary of recommendations for the implementation prompt

1. Single job named `test`. Steps: checkout, setup-node 20, npm ci, start postgres:16 service, run migrations, run `npm test`, post Slack.
2. Env block: `DATABASE_URL`, `JWT_SECRET`, `EMAIL_FROM`. Leave `NODE_ENV` unset or set to `test`.
3. No `--exclude` flag for tests; integration tests self-skip.
4. No Playwright browser install.
5. No worker build.
6. No frontend build.
7. Use `actions/checkout@v4`, `actions/setup-node@v4` with `cache: 'npm'`.
8. Concurrency group on the ref to cancel superseded runs.
9. PR trigger: `pull_request` on `labeled` and `synchronize`, with a job-level `if` that checks for the `ready-to-merge` label OR a push-to-main event.
