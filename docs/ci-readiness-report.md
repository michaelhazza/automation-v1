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
