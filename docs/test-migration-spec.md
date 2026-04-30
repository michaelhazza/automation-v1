# Test Migration Spec: Vitest

Implementation plan for migrating the Automation OS unit-test layer from the
current handwritten and `node:test` runners (invoked one-file-at-a-time via
`tsx`) to a single Vitest pipeline. The decision to use Vitest is already made
and not re-litigated here.

This spec is the input to a separate Claude Code session that will execute
the migration. Read `docs/ci-readiness-report.md` first; it is cited by section
number throughout. The fixture inventory, pre-migration test snapshot, and
Vitest config are deliverables of the migration phases below, not of this
spec-drafting task.

## Table of contents

1. Goals
2. Non-goals
3. Risks and mitigations
4. Phased migration plan
5. Concrete file changes
6. Validation and rollback
7. Estimate and sequencing
8. Decisions deferred and follow-ups

---

## 1. Goals

What this migration delivers, framed as observable outcomes the executing
session must hit before declaring a phase complete.

- **Cut unit-layer CI runtime from the readiness report's 10 to 25 minute
  window (readiness report § 7, R2) to under 3 minutes.** The cost driver is
  paying tsx cold-start per file across 275 files. Vitest amortises module
  load across one process tree and runs files in parallel.
- **Consolidate two assertion patterns down to one.** Today the codebase has
  the handwritten `function test(name, fn) { ... }` plus custom `assert` /
  `assertEqual` helpers (about 215 files), the `node:test` plus
  `node:assert/strict` pattern (52 files), and 2 outliers using bare
  top-level `assert.deepStrictEqual` calls with no `test()` wrapper at all.
  After migration, every test uses `import { test, expect } from 'vitest'`
  with `expect(...)` matchers.
- **Discover the two `*.test.ts` files currently outside `__tests__/`.**
  `shared/lib/parseContextSwitchCommand.test.ts` and
  `server/services/scopeResolutionService.test.ts` are silently skipped today
  by `scripts/run-all-unit-tests.sh` because its glob requires the
  `__tests__/` segment (readiness report § 7, R6). Vitest's default glob
  catches them.
- **Enable watch mode, parallel execution, and coverage as built-in capabilities.**
  All three exist out of the box once Vitest is configured.
- **Codify a single, documented testing convention going forward.** Today
  `docs/testing-conventions.md` and `docs/testing-structure-Apr26.md` both
  describe the handwritten pattern as canonical. After migration both
  documents describe Vitest as the single permitted runner.
- **Preserve the static-gate and QA-script layers untouched.** Both layers
  catch a different class of regression (structural drift) and continue to
  run as the first two stages of `npm test`. See § 2 below.

---

## 2. Non-goals

The following are explicitly OUT of scope. Stating them here so the executing
session does not pull them in mid-migration.

- **The static gate layer (`scripts/run-all-gates.sh` and the 54
  `verify-*.sh` scripts) stays as is.** These are grep-based linters, not
  test runners (verified during investigation by reading
  `verify-async-handler.sh`, `verify-pure-helper-convention.sh`, and the
  guard-utils library they share). They catch structural drift, not
  behavioural regressions, and the cost-to-value ratio of porting them is
  negative. They continue to run via `npm run test:gates` as the first
  stage of `npm test`.
- **The QA spec layer (`scripts/run-all-qa-tests.sh`) stays as is.** Same
  shape as the gate layer: bash check-list of file existence, schema
  fields, route presence. Continues to run via `npm run test:qa`.
- **The custom migration runner (`scripts/migrate.ts`) is not changed.**
  Migration semantics including the `pg_advisory_lock(4242_0001)` behaviour
  (readiness report § 2 and § 7, R4) stay exactly as they are.
- **The legacy migrate script's behaviour is not changed.** Phase 6 only
  renames `migrate:drizzle-legacy` to make its broken state obvious; it
  does not change any code path inside `drizzle-kit migrate`.
- **Trajectory tests (`scripts/run-trajectory-tests.ts`) are not migrated.**
  They remain a separate command (`npm run test:trajectories`) with their
  own latency profile and external-dependency surface. Not folded into
  `npm test`.
- **No frontend test infrastructure is added in this migration.** No React
  Testing Library, no MSW, no `*.test.tsx` files. Per
  `docs/testing-structure-Apr26.md` § "Current-phase recommendations", the
  product is iterating UI rapidly and a frontend test investment is
  premature. The eight existing `*.test.ts` files under `client/src/`
  (which all test pure helpers, not React components) are migrated in
  scope, but no new framework or component-test capability is introduced.
- **No API contract test infrastructure is added.** No supertest. Same
  rationale as frontend tests.
- **No coverage thresholds are configured as a CI gate.** Phase 6 wires up
  Vitest's v8 coverage provider and adds a `test:coverage` script, but no
  failure threshold is set. Setting a threshold prematurely drives
  tests-for-coverage rather than tests-for-value. Revisit in 2 to 3 months
  once Vitest infrastructure is stable.
- **No changes to `scripts/run-trajectory-tests.ts` or any trajectory
  fixture under `tests/trajectories/`.**
- **No changes to the worker package (`worker/`).** It has zero
  `*.test.ts` files (readiness report § 6) and is not part of the unit
  layer.
- **No changes to mission-control test wiring.**
  `tools/mission-control/server/__tests__/` has 3 test files (`github.test.ts`,
  `inFlight.test.ts`, `logParsers.test.ts`) which are NOT discovered by
  `scripts/run-all-unit-tests.sh` and not part of the main suite (readiness
  report § 6). Out of scope for this migration. Mission-control keeps its
  own `test` script entry.
- **The CI workflow (`.github/workflows/ci.yml`) is not added by this
  migration.** CI bring-up is a prerequisite that Phase 0 depends on.
  Phase 5 modifies the existing CI workflow once it exists.

---

## 3. Risks and mitigations

Each risk has an identifier (R-M*n*) so commit messages, quarantine comments,
and follow-up tasks can reference it precisely.

### R-M1: Parallelism surfacing hidden shared module state

- **Likelihood:** medium-high. Tests have only ever run sequentially via
  `npx tsx <file>`, one process per file (readiness report § 1). Module
  singletons, in-memory caches, and shared registries have never been
  exercised under concurrent imports.
- **Concrete known suspects.**
  - `server/services/__tests__/fixtures/fakeProviderAdapter.ts` registers
    via `registerProviderAdapter(...)` which is a global registry mutation.
    The harness uses a `restore()`-in-finally pattern that is documented
    to be safe under parallel registration of the same key, but this has
    never been exercised concurrently.
  - Any module that lazily caches connection pools, schema metadata, or
    config singletons.
  - Logger state, ALS context state, in-memory counters in any
    `*Pure.ts` module that closes over module-level variables.
- **Detection plan.** Phase 4 runs the suite 10 consecutive times under
  the default parallel pool. Flake means a real shared-state bug. A
  test that passes in isolation but fails when its peers run in the
  same pool is a parallel-state finding.
- **Mitigation.** Each parallel-failure file is either fixed (extract the
  shared state into a per-test setup) or quarantined under a
  `// @vitest-isolate` comment plus a per-file pool override that pins it
  to its own forked worker.
- **Quarantine contract** (referenced by R-M6, Phase 1, Phase 4, Phase 6,
  and the cross-phase invariants in § 6). Every `// @vitest-isolate`
  comment MUST include four named fields on the same comment block.
  Format:
  ```ts
  // @vitest-isolate
  // reason: <one-line description of the parallel-unsafe behaviour>
  // date: <ISO date the quarantine was added, e.g. 2026-04-29>
  // owner: <team name, individual handle, or "unowned" if genuinely orphaned>
  // follow-up: <tasks/todo.md entry ID that tracks removing this quarantine>
  ```
  All four fields are mandatory. Missing fields fail the Phase 6
  documentation audit (§ 4 Phase 6 item 3) and the cross-phase invariant
  check (§ 6). The `follow-up:` entry MUST exist in `tasks/todo.md`
  when the quarantine lands; a dangling pointer also fails the audit.
  The `owner:` field exists because quarantines without an owner
  reliably never get resolved — `follow-up:` says "this should happen",
  `owner:` says "this person/team is on the hook for it". Use
  `"unowned"` only when no owner can be identified; this acts as a
  visible flag in the Phase 6 audit and triggers an explicit ownership
  decision rather than silently accepting orphaned tech debt.
  Quarantines also have **expiry pressure** (per I-6 in § 6): any
  quarantine older than 30 days from its `date:` field must be
  reviewed at the next quarterly audit and either resolved or
  re-justified by updating `date:`. Without expiry pressure, the
  contract devolves into "temporary workaround" that lives forever.
  Quarantines accumulate easily and rot if ungoverned; this contract
  plus expiry pressure is the only thing standing between "temporary
  workaround" and permanent parallel-unsafe code.

### R-M2: Module-load env validation under parallel workers

- **Likelihood:** medium. Per readiness report § 4, a number of service
  modules read `process.env.X` at import time. The current sequential
  runner pays this validation once per file in a clean process. Vitest
  workers are fresh processes, so each worker re-runs validation, and
  any worker that loads a module the suite hadn't previously exercised
  may surface a `Missing required env: FOO` error.
- **Detection plan.** Phase 1's first full Vitest run will exit non-zero
  on the first missing-var error. Each error names the missing variable.
- **Mitigation.** The CI environment block (`DATABASE_URL`, `JWT_SECRET`,
  `EMAIL_FROM`, `NODE_ENV=test`) per readiness report § 4 is the floor.
  Any additional variable surfaced in Phase 1 or Phase 4 is added with a
  throwaway value to two places at once: the `env` block in
  `vitest.config.ts` (so local runs work) and the CI workflow env block
  (so CI runs work). Variables flow from CI runtime environment, not from
  `.env` files; tests must not need a real `.env` to run.
- **Env-absence invariant.** Some tests legitimately depend on a variable
  being *unset*; the integration skip-gates that probe
  `process.env.DATABASE_URL` are the obvious case, but any test that
  asserts default behaviour ("when no API key is configured, the client
  falls back to X") falls into this category. Over-injecting defaults in
  `vitest.config.ts`'s `env` block silently changes their meaning — a
  test that previously verified "X is undefined therefore Y" now sees X
  defined and Y silently changes. Two rules apply:
  - **Inject only what is required for module-load to succeed.** The
    floor variables (per readiness report § 4) plus whatever Phase 1 / 4
    surfaces as a missing-var error. Convenience defaults are forbidden
    even if they would make a test "easier to write".
  - **No test may depend on the absence of an env var without an
    explicit assertion.** During Phase 2 / Phase 3 conversion, any
    file that branches on `process.env.X === undefined` or
    `!process.env.X` must add an explicit
    `expect(process.env.X).toBeUndefined()` assertion at the top of the
    relevant test (or in `beforeAll`) so the dependency is documented
    and visible. A test that silently relies on absence is a latent bug
    waiting for someone to add a default.

### R-M3: Vite's stricter module resolution rejecting tsx-permissive imports

- **Likelihood:** medium. tsx is permissive about extension elision and
  `.ts` vs `.js` import suffixes. Vite (and therefore Vitest) is stricter,
  especially under `moduleResolution: 'bundler'`. The current `tsconfig.json`
  uses `"moduleResolution": "bundler"` already and tests do consistently
  use `.js` suffixes on relative imports (verified during investigation,
  e.g. `import { processContextPool } from '../runContextLoaderPure.js';`),
  but the codebase has 277 test files and consistency cannot be assumed.
- **Detection plan.** Phase 1 runs Vitest in discovery mode against the
  full glob (`test:unit:vitest`). Any import resolution error fails the
  run with a clear message naming the offending file and import.
- **Mitigation.** Per-file fix as the resolution errors surface. Most
  fixes are mechanical (add the `.js` suffix, fix the relative path).
  If the same error class appears across many files, consider whether
  `vitest.config.ts` should add an `optimizeDeps` or `resolve.extensions`
  entry rather than touching every file.

### R-M4: Integration test skip-gates behaving differently under Vitest

- **Likelihood:** low to medium. The 9 `*.integration.test.ts` files plus
  the CRM Query Planner's `integration.test.ts` (10 integration tests
  total, slightly different from readiness report § 1's count which the
  spec uses as authoritative) self-skip via two patterns:
  - 4 files use `process.env.NODE_ENV !== 'integration'` and call
    `process.exit(0)` (or use `node:test`'s `{ skip: SKIP }` option in
    one case).
  - 6 files probe `process.env.DATABASE_URL` and call `process.exit(0)`
    early when absent. Many of these use top-level `await import(...)` for
    DB modules to avoid triggering module-load env validation under skip.
  Under Vitest, `process.exit(0)` mid-file works but is an anti-pattern;
  Vitest also surfaces every file as having ran rather than skipped.
- **Semantic drift risk** (the subtle one, not in readiness report).
  `process.exit(0)` causes the file to never finish loading: test
  definitions never register, module-level code after the exit never
  runs, no side effects ever fire. `test.skipIf(SKIP)(...)` loads the
  file fully, registers each test, then skips execution. The observable
  CI outcome is identical (suite reports as skipped, exit code 0) but
  the runtime behaviour diverges: any module-level code outside an
  `import` statement now runs even when the suite is "skipped".
  Examples that change meaning under this conversion:
  - Top-level `console.log(...)` that previously never fired (cosmetic).
  - Top-level `await import('./db.js')` that triggers env validation
    (functional — under skip, this now throws if `DATABASE_URL` is
    absent).
  - Registry mutations at module top-level like
    `registerProviderAdapter(...)` (functional — pollutes the registry
    even when the test is skipped).
  - Top-level `await someAsyncSetup()` that runs setup eagerly.
  This is a behavioural change masked as a mechanical conversion. The
  bash runner never exercised it; Vitest does on every run.
- **Detection plan.** Phase 4 verifies all 10 integration files report as
  passing (or skipping if `DATABASE_URL` is absent) without raising. In
  addition, during Phase 2 / Phase 3 conversion of any integration file,
  grep for free-standing top-level statements (anything outside `import`,
  `const` / `let` / `var` declarations, `function` declarations, and
  `describe` / `test` / `beforeAll` / `afterAll` calls). Every flagged
  statement is reviewed individually before the batch lands; many will
  be benign (cosmetic logs) but each must be confirmed not to introduce
  module-load side effects under skip.
- **Mitigation.** During Phase 2 / Phase 3 conversions, replace
  `process.exit(0)` skip patterns with Vitest's
  `test.skipIf(condition)(name, fn)` or top-level `if (skip) test.skip(...)`.
  The result is the same observable behaviour (test reports as skipped,
  CI stays green) but Vitest's reporting now says "skipped" instead of
  "0 tests ran". The dynamic-import-after-skip-check pattern is preserved
  unchanged: the import only happens inside the `test()` body, so a
  skipped test never triggers DB module load.
- **Side-effect invariant** (cross-phase, see § 6). Integration tests
  must not have side effects at module load time. Any work that
  previously gated behind `process.exit(0)` must move inside a `test()`
  / `describe()` body, a `beforeAll` hook, or a dynamic import inside
  the test. The grep above is the per-file enforcement; the cross-phase
  invariant is what holds it in place after the migration.

### R-M5: Database advisory-lock contention

- **Likelihood:** low. Investigation confirmed that no `*.test.ts` file
  invokes `npm run migrate` or imports `scripts/migrate.ts`. Migrations
  are a CI step, not a per-test step. The advisory lock
  (`pg_advisory_lock(4242_0001)` per readiness report § 2 and § 7, R4)
  is held only by the migration runner, never by a test process.
- **Detection plan.** Verify during Phase 1 fixture inventory: if any
  test file under the unit layer is found to import `scripts/migrate.ts`
  or call `pg_advisory_lock` directly, flag it for quarantine.
- **Mitigation.** None required if the verification above passes. If a
  future test does need to advisory-lock, it should use a
  test-specific lock key (not `4242_0001`) so it never collides with the
  migration runner.

### R-M6: Filesystem and port collisions under parallelism

- **Likelihood:** low. Investigation found:
  - Only 2 `*.test.ts` files write to disk:
    `scripts/__tests__/build-code-graph-watcher.test.ts` (writes a
    feedback-probe file under `references/import-graph/` and holds a
    singleton lock at `references/.watcher.lock`) and
    `server/services/__tests__/chatTriageClassifierPure.test.ts` (a single
    `writeFileSync` call; investigation must verify whether the path is
    fixed or per-test before parallelising).
  - Only 1 fixture binds a port:
    `server/services/__tests__/fixtures/fakeWebhookReceiver.ts` uses
    `server.listen(0, '127.0.0.1', ...)` which is OS-assigned, so each
    test gets a unique port. This is parallel-safe by construction.
- **Detection plan.** Phase 4 runs the suite 10 consecutive times and
  flagging file-write races or port-bind failures.
- **Mitigation.** `build-code-graph-watcher.test.ts` is quarantined to a
  forked worker by default in Phase 1 (the test spawns `tsx
  scripts/build-code-graph.ts` subprocesses, holds a singleton lock, and
  takes up to 120 seconds; it is destructive of any in-flight watcher
  state). Phase 1 lands the quarantine pre-emptively to avoid Phase 4
  surfacing it as flake. Investigate `chatTriageClassifierPure.test.ts`'s
  `writeFileSync` during Phase 2 conversion; either rewrite to use an
  in-memory buffer (preferred) or quarantine.

### R-M7: Top-level await and dynamic-import patterns

- **Likelihood:** medium. Several integration tests use top-level
  `await import(...)` after a skip-gate to avoid loading DB modules when
  skipped. Vitest supports top-level await (Vitest is ESM-first) but
  there are subtle differences in how Vite transforms these vs how tsx
  runs them. The pattern itself is fine; the failure mode is "import
  hoisting changes which side effect runs first" which is almost
  always a producer-side bug masked by tsx's serial execution.
- **Detection plan.** Phase 1 runs the integration tests with
  `NODE_ENV` unset. Each must report as skipped (or pass under Vitest's
  `skipIf`) without triggering DB import.
- **Mitigation.** If a top-level-await pattern produces a hoisting issue
  under Vitest, replace the `await import(...)` with an `import()` inside
  the `test()` body. Cost: ~5 lines per affected file.

### R-M8: Two outlier files with no `test()` wrapper

- **Likelihood:** medium. `shared/lib/parseContextSwitchCommand.test.ts`
  and `server/services/scopeResolutionService.test.ts` have NO `test()`
  wrapper at all. They are top-level scripts that call
  `assert.deepStrictEqual` directly. A bare conversion (rewrite asserts
  to `expect`) does not produce valid Vitest tests because Vitest
  requires `test(name, fn)` blocks for the runner to discover.
- **Detection plan.** Visible during Phase 3 conversion: a Vitest run
  reports zero tests found in those files.
- **Mitigation.** Wrap each top-level assertion block in
  `test('descriptive name', () => { ... })` during Phase 3 conversion.
  Group related assertions into the same test block (one block per
  feature being verified). Phase 6 then moves both files into a
  `__tests__/` directory for consistency.

### R-M9: `Implementer-supplied:` placeholder bodies

- **Likelihood:** low. Only 1 file
  (`server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`)
  contains an `Implementer-supplied:` placeholder body that is a no-op
  even when not skipped. The readiness report § 7, R10 mentions "and
  likely others"; investigation confirmed it is exactly one file.
- **Detection plan.** Grep confirms only one file has the marker.
- **Mitigation.** Phase 6 converts the placeholder body to `test.todo()`
  with a tracking comment referencing a follow-up. The test continues to
  exist as a visible TODO in test output rather than a silently-passing
  no-op.

---

## 4. Phased migration plan

Each phase ends with `npm test` running and CI green. Phases 1 through 4 keep
the old runner alive alongside the new one; Phase 5 is the cutover.

### Phase 0: Preconditions and baseline capture

CI must exist and be green before this phase begins. Per readiness report
§ 3, no `.github/workflows/` directory exists today; CI bring-up is a
separate task that this phase depends on.

**Deliverables.**

1. Run `npm test` against a clean checkout on the same Node 20 environment
   CI uses. Capture the full stdout to `docs/pre-migration-test-snapshot.txt`.
   This file is the comparison point for every subsequent phase.
2. If any tests fail, list each failing file in the snapshot. Each is then
   either fixed, deleted, or marked with a tracking comment that names the
   follow-up. Migration does not proceed against a partially-broken baseline.
3. Run `npm run test:gates` and `npm run test:qa` independently and confirm
   both pass cleanly. Same triage rule.
4. Record the exact pass/fail/skip count under the current runner in the
   snapshot. The expected numbers based on investigation:
   - 275 `*.test.ts` files discovered by the unit runner.
   - 2 outlier files NOT discovered (`shared/lib/parseContextSwitchCommand.test.ts`,
     `server/services/scopeResolutionService.test.ts`).
   - 10 integration tests, of which 9 carry the `.integration.test.ts` suffix
     and 1 (`server/services/crmQueryPlanner/__tests__/integration.test.ts`)
     does not. With `NODE_ENV` unset, all 10 self-skip.
5. Capture per-file outcomes alongside the totals. This artifact is the
   oracle for the test-count-parity invariant (Phase 1, § 6) and the
   dual-run consistency check (Phases 2 to 3, § 6). Two outputs are
   produced:
   - `docs/pre-migration-test-snapshot.txt`: full stdout (existing
     deliverable from item 1) plus a `## Per-file outcomes` section
     that lists each test file as `<path>\t<pass|fail|skip>`. The bash
     runner already prints per-file pass/fail; this section is its
     parsed form.
   - `docs/pre-migration-test-snapshot.json` (companion): machine-readable
     equivalent with `[{ file, outcome, testCount }]` entries. The
     `testCount` field is the count of `test(` and `describe(` and
     handwritten `function test(` invocations per file (a grep is
     sufficient — exact precision is not required, but the count must
     be deterministic given the same source). This field anchors the
     parity check in Phase 1.
   - The two outliers (which the bash runner does not discover) are
     listed under a separate `## Outliers (discovered by Vitest only)`
     section in the txt file with their grep-derived `testCount` of 0
     (they have no `test()` wrapper today; Phase 3 R-M8 wraps them).

**Success criteria.** A clean baseline snapshot exists in
`docs/pre-migration-test-snapshot.txt` AND
`docs/pre-migration-test-snapshot.json`. Both list per-file outcomes
and per-file `testCount`. Every test that runs in CI today passes (or is
documented as quarantined). No untriaged failures.

**Rollback.** None required. This phase produces a snapshot file and
optionally a small set of targeted fixes; nothing is deleted or refactored.

### Phase 1: Vitest scaffolding

Add Vitest as a dev dependency and configure it to discover the existing
test files without modifying any of them. The old runner stays the
primary path; Vitest runs alongside it for verification only.

**Deliverables.**

1. Add to `devDependencies` in `package.json`:
   - `vitest@^2.1.0` (latest 2.x at time of execution)
   - `@vitest/coverage-v8@^2.1.0` (matching version)
2. Create `vitest.config.ts` at repo root with:
   ```ts
   import { defineConfig } from 'vitest/config';
   import path from 'node:path';

   export default defineConfig({
     resolve: {
       alias: {
         '@': path.resolve(__dirname, './client/src'),
       },
     },
     test: {
       include: [
         '**/__tests__/**/*.test.ts',
         'shared/lib/parseContextSwitchCommand.test.ts',
         'server/services/scopeResolutionService.test.ts',
       ],
       exclude: [
         '**/node_modules/**',
         '**/dist/**',
         'tools/mission-control/**',
         'worker/**',
       ],
       env: {
         JWT_SECRET: 'ci-throwaway-jwt-secret',
         EMAIL_FROM: 'ci@automation-os.local',
         NODE_ENV: 'test',
       },
       pool: 'forks',
       poolOptions: {
         forks: {
           singleFork: true,
         },
       },
       testTimeout: 30_000,
     },
   });
   ```
   Single-fork mode matches today's sequential behaviour and defers the
   parallelism risk (R-M1) to Phase 4. `DATABASE_URL` flows from the
   runtime environment, never from this config.
3. Add the `@` path alias to vitest's `resolve.alias` so any client test
   that uses `@/...` imports resolves the same way Vite does. Investigation
   found no test files currently use `@/` imports, but the alias exists in
   `tsconfig.json` and the migration must not narrow the supported import
   surface.
4. Pre-emptive quarantine for `scripts/__tests__/build-code-graph-watcher.test.ts`
   (R-M6). Add a per-file pool override at the top of `vitest.config.ts`:
   ```ts
   test: {
     // ... other settings
     poolMatchGlobs: [
       ['scripts/__tests__/build-code-graph-watcher.test.ts',
         'forks'], // already forks; pin sequentially in Phase 4
     ],
   },
   ```
   Plus a `// @vitest-isolate` comment in the file with the four-field
   contract per R-M1 (reason / date / owner / follow-up). The follow-up
   entry in `tasks/todo.md` tracks the work to fix the parallel-unsafe
   behaviour and remove the quarantine; this is the first quarantine the
   migration creates and it sets the precedent for all later ones.
5. Add a new script entry to `package.json`:
   ```json
   "test:unit:vitest": "vitest run"
   ```
   Do NOT touch the existing `test:unit` script. Both runners coexist.
6. Produce a fixture inventory at `docs/test-fixtures-inventory.md`. Each
   entry has: file path, one-line description, list of test files that
   import it. From investigation, the floor for this inventory is:
   - `server/services/__tests__/fixtures/loadFixtures.ts`. Exports
     `loadFixtures()` returning a stable `Fixtures` object with 1 org, 2
     subaccounts, 1 agent, 2 links, 1 task, 1 user, 3 review-code
     methodology output samples. Used by smoke and the carved-out
     integration tests.
   - `server/services/__tests__/fixtures/fakeWebhookReceiver.ts`. Boots
     a localhost HTTP server on an OS-assigned port, records every request,
     supports overrides for status / latency / drop-connection. Used by
     `fakeWebhookReceiver.test.ts` (self-test) and
     `workflowEngineApprovalResumeDispatch.integration.test.ts`.
   - `server/services/__tests__/fixtures/fakeProviderAdapter.ts`.
     Produces an LLM provider adapter with response / error / latency
     overrides. Registers via `registerProviderAdapter` with a
     `restore()`-in-finally contract.
   - Confirm during inventory whether any other shared utility exists
     (e.g. under `server/lib/__tests__/` for the brief contract harness).
7. Establish the test-count-parity check. Two signals are compared
   because grep alone is a weak oracle (matches commented code,
   conditionally-registered tests, dynamically generated tests, helper
   wrappers that internally call `test()`, false positives inside
   strings) and Vitest's discovery is the only semantically-faithful
   count.
   - **Primary signal (source of truth):** `npx vitest list --reporter=json`
     produces a per-file array of registered tests. Persist its output
     to `tasks/builds/vitest-migration/vitest-discovery-baseline.json`
     at the end of Phase 1. This is the authoritative
     post-migration baseline.
   - **Secondary signal (sanity check):** the grep-derived `testCount`
     in `docs/pre-migration-test-snapshot.json` (Phase 0). Catches
     "Vitest silently dropped a file" cases that the primary signal
     can't see (a missing file produces 0 in both Vitest and grep).
   Comparison rules:
   - **I-3a check:** Vitest's discovery count is what matters for
     "did we lose a test". Compare the Phase 1 Vitest count against
     the eventual Phase 5 Vitest count; the only allowed delta is the
     2 outliers gaining `> 0` registered tests in Phase 3.
   - **I-3b check:** the grep count must not diverge from the Vitest
     count beyond explicit whitelisted deltas. Common benign deltas:
     nested `test()` inside `describe()` blocks (grep undercounts),
     conditionally-registered tests (grep overcounts), helper
     wrappers (grep undercounts). Each delta in the report MUST name
     the cause.
   Record the comparison in
   `tasks/builds/vitest-migration/test-count-parity.md` with one of:
   - `MATCH`: per-file counts match exactly between the two signals
     (modulo the outliers).
   - `WHITELISTED DELTA`: a documented divergence with rationale.
   - `MISMATCH`: stop. Investigate. Phase 1 is not complete until the
     parity check produces MATCH or fully WHITELISTED.

**Success criteria.**

- `npm run test:unit:vitest` discovers all 277 files (275 + 2 outliers)
  and produces a complete run report (pass / fail / skip counts).
- The discovery list matches the test-file inventory in the snapshot.
- The fixture inventory file exists and is committed.
- The test-count-parity check at
  `tasks/builds/vitest-migration/test-count-parity.md` shows MATCH or
  WHITELISTED for every file.
- `npm test` continues to work via the old runner.

**Rollback.** `git revert` of the Phase 1 commits removes
`vitest.config.ts`, the new script entry, and the dev-dependency additions.
No existing test file is modified.

### Phase 2: Migrate `node:test` files

The 52 files using `node:test` plus `node:assert/strict` are the
lowest-risk batch. The conversion is largely mechanical because Vitest's
`test()` API matches `node:test`'s signature.

**Migration-fatigue rule (applies to Phases 2 and 3 batches).**
Long migrations decay quietly: early batches are clean and disciplined,
later batches get rushed and invariants get "temporarily" bypassed.
Counter this with a procedural friction point: **any batch that
introduces a WHITELISTED DELTA (in test-count parity) or any unresolved
mismatch (in dual-run consistency) MUST stop and surface to the user
before the next batch starts.** No "we'll fix it in cleanup". The
executing session writes a one-paragraph summary to
`tasks/builds/vitest-migration/escalations.md` (file path, what was
whitelisted or mismatched, why, what the user accepted) and waits for
explicit user acknowledgement. This costs minutes per escalation and
is the difference between a clean migration and one with N silent
"temporary" workarounds at completion.

**Escalation upper bound.** Five individually-reasonable escalations
add up to a structurally compromised migration. If
`tasks/builds/vitest-migration/escalations.md` exceeds 5 entries
across Phases 2 and 3 combined, the executing session pauses and
surfaces the running list to the user with a systemic question:
"is the conversion plan sound, or is something repeatedly going
wrong that calls for a different approach?" This is the difference
between accepting drift one decision at a time and noticing that
you've drifted. Resume only after explicit user acknowledgement.

**Deliverables.**

1. Convert files in batches of approximately 10. After each batch run
   `test:unit:vitest` and confirm the converted batch's tests pass. Commit
   per batch with a message like `test: migrate N node:test files to vitest
   (batch X of Y)`.
2. The conversion is mechanical:
   - Replace `import test from 'node:test'` with
     `import { test } from 'vitest'`.
   - Replace `import { test } from 'node:test'` with
     `import { test } from 'vitest'`.
   - Replace `import assert from 'node:assert/strict'` and
     `import { strict as assert } from 'node:assert'` with
     `import { expect } from 'vitest'`.
   - Replace `import { mock } from 'node:test'` with
     `import { vi } from 'vitest'` and translate per the mapping table
     below.
   - Convert each assertion using the table below.
3. Assertion conversion table (complete from investigation; covers all
   `assert.*` patterns observed across 1179 occurrences in 75 files):

   | `node:assert` | Vitest |
   |---------------|--------|
   | `assert(x, msg)` | `expect(x, msg).toBeTruthy()` |
   | `assert.ok(x)` | `expect(x).toBeTruthy()` |
   | `assert.equal(a, b)` | `expect(a).toBe(b)` |
   | `assert.strictEqual(a, b)` | `expect(a).toBe(b)` |
   | `assert.notEqual(a, b)` | `expect(a).not.toBe(b)` |
   | `assert.notStrictEqual(a, b)` | `expect(a).not.toBe(b)` |
   | `assert.deepEqual(a, b)` | `expect(a).toEqual(b)` |
   | `assert.deepStrictEqual(a, b)` | `expect(a).toStrictEqual(b)` |
   | `assert.notDeepEqual(a, b)` | `expect(a).not.toEqual(b)` |
   | `assert.notDeepStrictEqual(a, b)` | `expect(a).not.toStrictEqual(b)` |
   | `assert.throws(fn)` | `expect(fn).toThrow()` |
   | `assert.throws(fn, /regex/)` | `expect(fn).toThrow(/regex/)` |
   | `assert.throws(fn, ErrorClass)` | `expect(fn).toThrow(ErrorClass)` |
   | `assert.doesNotThrow(fn)` | `expect(fn).not.toThrow()` |
   | `assert.rejects(promise)` | `await expect(promise).rejects.toThrow()` |
   | `assert.rejects(promise, /regex/)` | `await expect(promise).rejects.toThrow(/regex/)` |
   | `assert.doesNotReject(promise)` | `await expect(promise).resolves.not.toThrow()` |
   | `assert.match(str, /regex/)` | `expect(str).toMatch(/regex/)` |
   | `assert.notMatch(str, /regex/)` | `expect(str).not.toMatch(/regex/)` |
   | `assert.fail(msg)` | `expect.fail(msg)` |
   | `assert.ifError(err)` | `if (err) throw err` (no clean Vitest equivalent; use raw throw) |

4. Mocking translation. Two files use `node:test` mocks
   (`mock.method`, `mock.restoreAll`, `mock.fn`):

   | `node:test` mock | Vitest |
   |------------------|--------|
   | `mock.method(obj, 'key', impl)` | `vi.spyOn(obj, 'key').mockImplementation(impl)` |
   | `mock.fn()` | `vi.fn()` |
   | `mock.fn(impl)` | `vi.fn(impl)` |
   | `(fn as any).mock.calls` | `(fn as any).mock.calls` (same shape) |
   | `mock.restoreAll()` | `vi.restoreAllMocks()` |
   | `t.mock.method(...)` (test-scoped) | `vi.spyOn(...)` (combine with `afterEach(() => vi.restoreAllMocks())`) |

5. `beforeEach` / `afterEach` / `describe` translation (3 files use these):

   | `node:test` | Vitest |
   |-------------|--------|
   | `import { beforeEach, afterEach, describe } from 'node:test'` | `import { beforeEach, afterEach, describe } from 'vitest'` |
   | `beforeEach(() => ...)` | `beforeEach(() => ...)` (signature compatible) |
   | `afterEach(() => ...)` | `afterEach(() => ...)` (signature compatible) |
   | `describe('label', () => { ... })` | `describe('label', () => { ... })` (signature compatible) |

6. Skip-gate translation for the 4 integration tests using
   `process.env.NODE_ENV !== 'integration'` and the file using
   `{ skip: SKIP }`:

   | Pattern | Vitest replacement |
   |---------|-------------------|
   | `if (SKIP) { console.log(...); process.exit(0); }` at top of file | Wrap entire file's tests in `describe.skipIf(SKIP)('...', () => { ... })` |
   | `test('name', { skip: SKIP }, fn)` | `test.skipIf(SKIP)('name', fn)` |
   | `if (!process.env.DATABASE_URL) { process.exit(0); }` | `const SKIP = !process.env.DATABASE_URL;` then wrap tests in `describe.skipIf(SKIP)(...)` |

   The dynamic-import-after-skip-check pattern (load DB modules only when
   not skipped) is preserved unchanged: the imports happen inside the
   `test()` body, not at module top-level.

7. Dual-run consistency check per batch. The window where both runners
   exist is the only place behavioural drift can be caught cheaply; once
   Phase 5 deletes the bash runner the oracle is gone. For each batch:
   - **Pre-batch** (before converting): run
     `bash scripts/run-all-unit-tests.sh` filtered to the files in the
     batch, capture per-file outcome (pass / fail). The Phase 0 JSON
     snapshot can be used as the baseline IF none of the files in the
     batch have changed since Phase 0; otherwise re-run.
   - **Convert** the batch.
   - **Post-batch**: run `npx vitest run <file-1> <file-2> ...` against
     the converted files, capture per-file outcome.
   - **Assert**: for every file in the batch, `bash_outcome ===
     vitest_outcome`. A mismatch is a semantic conversion bug — a test
     that passed under tsx but fails under Vitest (or vice versa) is
     not a "different runner" issue, it is an actual behavioural change
     introduced by the conversion.
   - On mismatch: STOP the batch. Diagnose. Fix the conversion (or the
     underlying test if the bash runner was hiding a real bug). Do not
     commit a batch with an unexplained mismatch.
   - Append the batch's results to
     `tasks/builds/vitest-migration/dual-run-consistency.md` with one
     line per file: `<path> bash:<outcome> vitest:<outcome> match:<yes|no>`.
   - **Deep-equality spot-check.** The pass/fail comparison above is
     necessary but not sufficient. `assert.deepEqual` /
     `assert.deepStrictEqual` and Vitest's `toEqual` / `toStrictEqual`
     differ on subtle cases: undefined vs missing fields, prototype
     equality, NaN handling, error-message matching. Two tests can
     both pass while asserting different things. For each batch where
     the conversion involved any of:
     `assert.deepEqual` → `toEqual`,
     `assert.deepStrictEqual` → `toStrictEqual`,
     `assert.throws(fn, /regex/)` → `toThrow(/regex/)`,
     manually spot-check at least 1 converted assertion per batch by:
     introducing a deliberate bug into the asserted value (e.g. add a
     stray field, change a number) and confirming the test now fails
     under Vitest with a meaningful diff. This proves the assertion
     is genuinely checking what the original asserted, not silently
     passing through a more permissive matcher. Record the spot-check
     in the dual-run log: `spot-check: <file>::<test-name> verified`.
8. Manual review of every file containing `process.exit`. Grep each batch
   pre-conversion for `process.exit` calls and triage individually:
   - `process.exit(0)` at the top after a skip-gate condition: convert
     per the table in deliverable 6.
   - `process.exit(1)` in a trailing summary block (counters
     `if (failed > 0) process.exit(1)`): delete entirely. Vitest reports
     failures itself; the handwritten summary is redundant.
   - `process.exit(0)` or `process.exit(1)` in any other position
     (mid-test, inside a callback, after an early-detection branch):
     STOP. The file may rely on early-termination semantics — no async
     side effects firing, no later test definitions registering — that
     `test.skipIf` does not preserve. Flag for manual review under
     R-M4's side-effect invariant. Either rewrite to confine the early
     exit to a single test body (where Vitest's `return` or
     `expect.fail` covers it), or quarantine under R-M1's contract.

**Success criteria.**

- All 52 `node:test` files pass under `test:unit:vitest` in single-fork mode.
- The diff for each batch is mechanical and reviewable; no logic changed.
- `process.exit(0)` and `process.exit(1)` are removed from every
  converted file (or the file is quarantined per deliverable 8).
- The dual-run consistency log shows `match:yes` for every file in
  every batch.

**Rollback.** Each batch is a separate commit; `git revert` of any batch
restores those files. The old runner remains the primary path until Phase 5.

### Phase 3: Migrate handwritten `test()` / `assert()` files

The roughly 215 files using the handwritten pattern. Conversion is more
varied than Phase 2 because the handwritten harness is duplicated per file
with minor variations (some files have `assertEqual<T>`, some have
`assertFailedWithRule`, some have `runTest` instead of `test`, etc.).

**Deliverables.**

1. Convert in batches of approximately 10. Run `test:unit:vitest` after
   each batch. Commit per batch.
2. Standard conversion shape (canonical example below).
3. Worked example. Pick `server/services/__tests__/runContextLoader.test.ts`
   as the representative file (cited in `docs/testing-conventions.md` as a
   canonical template).

   **Before** (current shape, abbreviated):
   ```ts
   import { processContextPool } from '../runContextLoaderPure.js';

   let passed = 0;
   let failed = 0;

   function test(name: string, fn: () => void) {
     try {
       fn();
       passed++;
       console.log(`  PASS  ${name}`);
     } catch (err) {
       failed++;
       console.log(`  FAIL  ${name}`);
       console.log(`        ${err instanceof Error ? err.message : err}`);
     }
   }

   function assert(cond: unknown, message: string) {
     if (!cond) throw new Error(message);
   }

   function assertEqual<T>(actual: T, expected: T, label: string) {
     if (JSON.stringify(actual) !== JSON.stringify(expected)) {
       throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
     }
   }

   test('processes an empty pool', () => {
     const result = processContextPool([], { maxTokens: 1000 });
     assertEqual(result.eager.length, 0, 'no eager sources');
   });

   // ... more tests

   console.log('');
   console.log(`${passed} passed, ${failed} failed`);
   if (failed > 0) process.exit(1);
   ```

   **After** (Vitest):
   ```ts
   import { test, expect } from 'vitest';
   import { processContextPool } from '../runContextLoaderPure.js';

   test('processes an empty pool', () => {
     const result = processContextPool([], { maxTokens: 1000 });
     expect(result.eager.length).toBe(0);
   });

   // ... more tests
   ```

   The conversion deletes:
   - The `let passed = 0; let failed = 0` counters.
   - The handwritten `function test(...)` definition.
   - The handwritten `function assert(...)` and `assertEqual(...)` definitions.
   - The trailing `console.log(\`...\`)` summary.
   - The trailing `if (failed > 0) process.exit(1)`.

   And adds:
   - `import { test, expect } from 'vitest'` at the top.
   - Per-call replacement of `assert(cond, msg)` with
     `expect(cond, msg).toBeTruthy()`.
   - Per-call replacement of `assertEqual(actual, expected, label)` with
     `expect(actual).toEqual(expected)` (use `toStrictEqual` if the
     handwritten helper used JSON-stringify deep equality on objects with
     undefined fields, since Vitest's `toEqual` treats undefined as absent).

4. The two outliers (`shared/lib/parseContextSwitchCommand.test.ts` and
   `server/services/scopeResolutionService.test.ts`) require special
   handling per R-M8: wrap each existing top-level assertion block in a
   `test('descriptive name', () => { ... })` call. Group related
   assertions into the same test block. Phase 6 moves the files into
   `__tests__/` directories.

5. Manual review list. During conversion, flag any file where the change
   is NOT mechanical and requires human judgment. Add each to a section
   `## Manual review` at the bottom of the next commit message. Examples
   the executing session should expect:
   - Files with custom assertion helpers like `assertFailedWithRule` or
     `assertThrows` (pure-helper conversion is not 1:1; these helpers
     wrap multi-step verification logic).
   - Files with custom test wrappers like `runTest` that take additional
     arguments (timeout, retries, etc.).
   - Files where the handwritten `test()` accepts an async function but
     the harness does not await it correctly (an actual bug; convert as a
     fix, not just a translation).
6. Dual-run consistency check per batch. Same procedure as Phase 2
   deliverable 7: pre-batch bash runner pass / fail per file, post-batch
   `npx vitest run` pass / fail per file, mismatch stops the batch.
   Append results to
   `tasks/builds/vitest-migration/dual-run-consistency.md` (the same
   file Phase 2 wrote to; this phase appends additional batches).
7. `process.exit` triage per Phase 2 deliverable 8 — same rules apply to
   the handwritten files. The handwritten harness frequently ends with
   `if (failed > 0) process.exit(1)` (visible in the Phase 3 worked
   example); these are deleted as part of the standard conversion.
8. Integration-file side-effect grep (R-M4 enforcement). For each
   `*.integration.test.ts` and `integration.test.ts` file converted in
   this phase, after rewriting the skip-gate, scan the file for
   free-standing top-level statements (anything outside `import` / `const`
   / `let` / `var` / `function` / `describe` / `test` / `beforeAll` /
   `afterAll` / `beforeEach` / `afterEach`). Two cases:
   - No flagged statements: pass.
   - Any flagged statement: review individually. Confirmed-benign cases
     (cosmetic top-level `console.log`) are still moved into a
     `beforeAll` or deleted; the goal is zero free-standing top-level
     statements in any integration test, so the side-effect invariant
     in § 6 is mechanically verifiable by a single grep.
9. Re-run the test-count-parity check (per Phase 1 deliverable 7) at the
   end of this phase. The 2 outliers now have `testCount > 0` (Phase 3
   wrapped them); update
   `tasks/builds/vitest-migration/test-count-parity.md` with the new
   values. The total registered-test count must still match (modulo
   whitelisted deltas).
10. **End-of-phase global dual-run.** Per-batch dual-run (deliverable 6)
    catches drift introduced within a batch but cannot catch drift
    that only manifests in cross-file interactions — a test in batch 5
    that became environmentally dependent on a fixture mutation
    introduced in batch 12, for example. After the final Phase 3 batch
    lands, run ONE full-suite dual-run:
    - `bash scripts/run-all-unit-tests.sh` against the full suite,
      capture per-file outcome.
    - `npx vitest run` against the full suite, capture per-file
      outcome.
    - Compare per-file outcomes (same procedure as the per-batch
      check, scoped to all 277 files at once).
    Any mismatch surfaces cross-file semantic drift accumulated
    across the phase. Investigate, fix, and append to
    `tasks/builds/vitest-migration/dual-run-consistency.md` under a
    `## Phase 3 final global comparison` heading. Phase 3 is not
    complete until this comparison shows full match. This is the
    last opportunity to catch bash-vs-Vitest divergence before the
    bash runner is deleted in Phase 5.

**Success criteria.**

- All approximately 215 handwritten files pass under `test:unit:vitest` in
  single-fork mode.
- Both outliers are wrapped in `test()` blocks and pass.
- The "manual review" list is empty or each entry has been resolved.
- The dual-run consistency log shows `match:yes` for every file in
  every batch.
- The integration-file side-effect grep returns zero flagged statements
  across all integration files.
- The updated test-count-parity check shows MATCH or fully WHITELISTED.

**Rollback.** Per-batch `git revert`. The old runner remains primary.

### Phase 4: Enable parallelism

Switch Vitest from `singleFork` to the default parallel pool and stress-test
the suite to surface flakiness.

**Deliverables.**

1. Update `vitest.config.ts`: remove `pool: 'forks'` and the
   `poolOptions.forks.singleFork: true` settings, falling back to Vitest's
   default `threads` pool. Keep the per-file pool override for
   `build-code-graph-watcher.test.ts` (it stays in single-fork mode
   permanently). Cap worker concurrency explicitly:
   ```ts
   poolOptions: {
     threads: {
       maxThreads: Math.max(1, (os.cpus()?.length ?? 2) - 1),
       minThreads: 1,
     },
   },
   ```
   Without an explicit cap, Vitest spawns one worker per CPU on the
   runner, which on hosted CI (often 4 to 8 vCPU) can saturate DB
   connections, file handles, and OS-assigned-port allocation. The
   `cores - 1` cap leaves headroom for the main process and the
   reporter, and is the lowest-friction heuristic that avoids
   environment-dependent runtime regressions (a 2-vCPU runner sees
   1 worker; an 8-vCPU runner sees 7). The exact value is tunable in
   Phase 5 if the runtime numbers warrant it.
2. Run `npm run test:unit:vitest` 10 consecutive times. At least 3 of
   the 10 runs MUST use `vitest run --sequence.shuffle` so order-
   coupling bugs surface. Vitest's default ordering is deterministic;
   without shuffle, an order-dependent bug can pass 10 times in a row
   and break on the first PR that adds or renames a file.
   `--sequence.shuffle` covers BOTH dimensions:
   - **File-level shuffle:** randomizes which order test files are
     picked up by workers (catches cross-file singleton leakage).
   - **Test-level shuffle (`shuffle.tests`, included by default in
     `--sequence.shuffle`):** randomizes which order `test()` blocks
     within a single file run (catches intra-file state leakage
     between sibling tests in the same file). This is the failure
     mode `describe()` blocks tend to mask: a setup in test 1 that
     test 3 silently relies on.
   The 3-run floor distributes the risk:
   - 7 runs with default ordering (the production CI behaviour).
   - 3 runs with `--sequence.shuffle` (both file and test shuffle).
   Record the result of each run (pass / fail / flaky-test list, plus
   which ordering it used) in
   `tasks/builds/vitest-migration/parallel-stress-results.md`.
3. For each test that fails or flakes, classify it. The failure taxonomy
   below is mandatory — repeated diagnosis without classification leads
   to the same root cause being re-investigated for each new flake. The
   results doc records the category per failure so the team builds a
   shared mental model of which categories are common in this codebase.
   Categories:
   - **shared-state**: module-level singleton, registry mutation,
     in-memory cache, ALS context state. R-M1.
   - **env**: module-load env validation surfaced under a fresh worker
     (R-M2), or env-absence assumption violated.
   - **import-resolution**: extension elision, `.ts` vs `.js` suffix,
     alias miss. R-M3.
   - **timing-async**: race, missing await, premature teardown,
     unhandled promise rejection.
   - **filesystem**: file-write race, port-bind collision. R-M6.
   - **order-dependent**: passes under default ordering, fails under
     shuffle (the new shuffle gate above). Almost always a shared-state
     bug surfaced by ordering.
   - **other**: explain in the results doc; if "other" is used more
     than once, add a new category.
   Then fix or quarantine. Quarantine = a `// @vitest-isolate` comment
   with the contract from R-M1 (reason / date / owner / follow-up —
   all four fields mandatory), plus a `tasks/todo.md` entry, plus a
   `poolMatchGlobs` entry in `vitest.config.ts` pinning the file to a
   single fork.

   **Resource-exhaustion-before-quarantine triage.** When multiple
   tests fail or flake at high concurrency in patterns that look like
   cross-file races (DB connection drops, ECONNREFUSED on localhost
   ports, EMFILE / "too many open files"), the cause is often
   environment-level resource exhaustion, NOT test-level parallel
   bugs. Before quarantining, reduce `maxThreads` (cores − 2, then
   cores / 2, then 2) and re-run. If the failures disappear at lower
   concurrency, the fix is the cap — not quarantines. Recording these
   resource-driven retries under the **filesystem** or **timing-async**
   categories with a "resource-exhaustion suspected" note prevents
   misdiagnosis: a test that was wrongly quarantined as parallel-
   unsafe will sit there forever, even after the underlying CI runner
   gets bigger.
4. Update the CI environment block with any newly-required env vars
   surfaced by R-M2. Both `vitest.config.ts`'s `env` block and the CI
   workflow's `env:` block must list the same variables.

**Success criteria.**

- 10 consecutive parallel runs pass without flakiness on the same Node 20
  CI environment, of which at least 3 used `--sequence.shuffle`.
- Every quarantine has the four-field contract (reason / date / owner /
  follow-up) and a corresponding `tasks/todo.md` entry.
- Every failure surfaced during the 10 runs is classified into the
  taxonomy above and recorded in
  `tasks/builds/vitest-migration/parallel-stress-results.md`.
- The set of env vars in `vitest.config.ts` and CI match exactly.

**Rollback.** If widespread flakiness cannot be resolved, revert the
parallelism change (re-add `pool: 'forks'` + `singleFork: true`) and
proceed to Phase 5 with sequential Vitest. The CI runtime stays slower
than the under-3-minute target, but Phase 5 cutover is still safe and
the runtime improvement comes later.

### Phase 5: Cut over `npm test` and re-tune CI

Replace the bash unit runner with Vitest as the primary path. Old runner
goes away.

**Deliverables.**

1. Update `package.json`:
   - Change `"test:unit": "bash scripts/run-all-unit-tests.sh"` to
     `"test:unit": "vitest run"`.
   - Delete `"test:unit:vitest": "vitest run"` (now redundant).
   - The chained `"test"` script is unchanged in shape:
     `"test": "npm run test:gates && npm run test:qa && npm run test:unit"`.
2. Delete `scripts/run-all-unit-tests.sh`.
3. Identify and delete the now-unused handwritten test helper module(s).
   Investigation found NO shared helper module; every handwritten file
   defined its own `test`, `assert`, `assertEqual` inline. The Phase 3
   conversion removed those per-file. Verify nothing was missed by
   grepping for `function test\(name: string` and
   `function assert\(cond: unknown` across the repo; expected count is 0.
4. Update `.github/workflows/ci.yml`:
   - Change `timeout-minutes: 45` to `timeout-minutes: 15`. The headroom
     accommodates parallel-run flake detection without masking hangs.
   - The CI env block already covers the floor variables. Add any extras
     surfaced in Phase 4.
5. Update `docs/ci-setup.md` with the new expected runtime ("under 3
   minutes for the unit layer; about 30 seconds for gates and QA").

**Success criteria.**

- `npm test` runs the new pipeline end-to-end (gates + QA + Vitest).
- A CI run on the migration branch passes.
- Total CI runtime for the unit layer hits the soft target and respects
  the hard cap:
  - **Soft target: under 3 minutes.** This is the goal — the original
    motivation for the migration. Achievable on the parallel-clean
    suite per the readiness report.
  - **Hard cap: under 5 minutes.** Anything above this fails the
    migration and Phase 4 must be revisited (likely more quarantines
    or a worker-count cap). Sitting at 3 to 5 minutes is acceptable
    and not subject to optimisation churn during this migration;
    revisit only if Phase 6 follow-ups make headroom worth chasing.
  - The CI workflow's `timeout-minutes: 15` setting is the failsafe
    above the hard cap, not the cap itself.

**Rollback.** Revert the `package.json` `test:unit` change and the
`scripts/run-all-unit-tests.sh` deletion. The bash runner is the fallback
path for the duration of one or two release cycles. CI returns to slower
runtime but stays green.

### Phase 6: Cleanup, conventions, and footgun removal

Final-state housekeeping. Each item is independent of the others; commit
per item.

**Convention codification.**

1. Update `docs/testing-conventions.md`:
   - Vitest is the single permitted runner.
   - Tests live under `**/__tests__/*.test.ts`.
   - The `*Pure.ts` + `*.test.ts` sibling pattern is preserved (the
     `verify-pure-helper-convention.sh` gate continues to enforce it
     unchanged).
   - The assertion API is `expect(...).matcher(...)` exclusively; the
     handwritten and `node:test` styles are forbidden in new tests.
   - Skip-gates use `test.skipIf(condition)` or `describe.skipIf(condition)`.
   - **No module-load side effects (I-7b).** Test files must not mutate
     shared state at import time — no top-level registry registration,
     no top-level singleton init, no top-level filesystem writes. State
     setup belongs in `beforeAll` / `beforeEach` or inside the test
     body. Integration tests are the strict subset enforced by grep
     (I-7a); the rule applies to all tests.
   - **Env-absence dependencies must be explicit (I-8).** A test that
     branches on `process.env.X === undefined` must include
     `expect(process.env.X).toBeUndefined()` so the dependency is
     visible. Implicit absence is forbidden.
   - **No-new-flake gate (I-9).** A new test that flakes under 3
     consecutive local or CI runs (I-9a) OR fails in ≥2 of 10
     consecutive CI runs (I-9b) does not merge. Either fix the
     flake or quarantine under the R-M1 contract (with 30-day
     expiry pressure per I-6).
   - **Per-file count-drift justification (I-10).** A PR that
     changes the registered test count of a file by more than ±30%
     must include one or two sentences in the PR description naming
     what changed and why. Routine refactoring is below threshold;
     structural weakening (1 test → 5 weak ones; 10 tests → 4)
     surfaces to review.
   - **Test-only utilities live under `__tests__/` or are explicitly
     excluded.** Test fixtures, mocks, and helper functions used only
     by tests must live under a `__tests__/` directory (typically
     `__tests__/fixtures/` or `__tests__/helpers/`) so the coverage
     `**/__tests__/**` exclude pattern catches them. A helper that
     accidentally lives in a production directory inflates coverage
     metrics and makes them meaningless. If a test-only utility must
     live outside `__tests__/` for import-graph reasons, it gets an
     explicit per-file entry in the coverage `exclude` array with a
     comment naming the reason. New tests should never need this
     escape hatch — it exists for legacy cases only.
   - **Env mutation must restore (I-8b).** Tests that set
     `process.env.X = ...` must restore using snapshot/restore in
     `beforeEach` / `afterEach` per the pattern in I-8b.
2. Update `docs/testing-structure-Apr26.md`:
   - The April 2026 snapshot now describes the Vitest-based runtime.
   - Frontend tests, API contract tests, and E2E remain explicitly out of
     scope per the same triggers (`per-feature stabilisation`).
3. Document quarantined tests. Each `// @vitest-isolate` file gets one
   line in `docs/testing-conventions.md` § "Quarantined tests" with the
   rationale, plus a `tasks/todo.md` entry to revisit.

**Outlier file resolution.**

4. Move
   `shared/lib/parseContextSwitchCommand.test.ts` to
   `shared/lib/__tests__/parseContextSwitchCommand.test.ts`. Adjust the
   import path inside (relative path changes from `'./parseContextSwitchCommand.js'`
   to `'../parseContextSwitchCommand.js'`).
5. Move
   `server/services/scopeResolutionService.test.ts` to
   `server/services/__tests__/scopeResolutionService.test.ts`. Adjust the
   import path. Also pair-extract the pure logic into
   `scopeResolutionServicePure.ts` if `verify-pure-helper-convention.sh`
   complains (the gate may flag the move because the test now lives in
   `__tests__/` and must import from a sibling module). If extraction is
   non-trivial, suppress the gate for this single file with the documented
   `// guard-ignore-file: pure-helper-convention reason="..."` comment
   and add a `tasks/todo.md` entry to extract the pure helper later.
6. Once both files live under `__tests__/`, simplify `vitest.config.ts`'s
   `include` array to drop the two explicit outlier entries; the
   `**/__tests__/**/*.test.ts` glob now catches them.

**Integration test TODO bodies.**

7. `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`'s
   `Implementer-supplied:` placeholder body becomes
   `test.todo('DLQ round-trip: poison job → __dlq → system_incidents row',
   () => { /* implement */ })` with a tracking comment referencing a
   `tasks/todo.md` entry. The test is now visible as a pending item in
   Vitest output rather than a silent no-op.

**Footgun removal.**

8. Rename the broken legacy migrate script entry in `package.json` from
   `"migrate:drizzle-legacy": "drizzle-kit migrate"` to
   `"migrate:drizzle-legacy-DO-NOT-USE": "drizzle-kit migrate"`. Per
   readiness report § 2, this script silently skips migrations 0041+ and
   the team has chosen the custom forward-only runner instead.
9. Audit the `playbooks:test` script
   (`tsx server/lib/workflow/__tests__/workflow.test.ts`). The file is
   covered by the Vitest glob (`**/__tests__/*.test.ts` matches it), so
   the script entry is redundant. Delete it. If for some reason the file
   does NOT run under Vitest, document the reason in
   `docs/testing-conventions.md` and keep the script.
10. Investigate `chatTriageClassifierPure.test.ts`'s `writeFileSync` call
    (R-M6). Determine the path, scope, and need. If the path is fixed
    (e.g. `/tmp/some-fixture.txt`), rewrite to use an in-memory buffer or
    `vi.fn()`-based assertion. Quarantine only as last resort.

**Repo-level Node version pinning.**

11. Add an `engines` field to root `package.json`:
    ```json
    "engines": {
      "node": ">=20.0.0 <21.0.0"
    }
    ```
12. Add a `.nvmrc` file at the repo root containing the single line `20`.
    For tooling compatibility (nvm, fnm, Volta).

**Coverage tooling.**

13. Configure Vitest's v8 coverage provider in `vitest.config.ts`:
    ```ts
    test: {
      // ... other settings
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'json'],
        include: ['server/**/*.ts', 'shared/**/*.ts', 'client/src/**/*.ts'],
        exclude: ['**/__tests__/**', '**/*.d.ts'],
      },
    },
    ```
    The exclude pattern uses directory-based exclusion (`**/__tests__/**`)
    rather than naming-based (`**/*Pure.test.ts`, `**/*.test.ts`). The
    convention enforced by `verify-pure-helper-convention.sh` already
    requires every `*.test.ts` file to live under `__tests__/`, so the
    directory pattern is sufficient AND robust against naming drift —
    a misnamed test file would either fail the gate (caught upstream)
    or live somewhere outside `__tests__/` (which we want flagged, not
    silently excluded from coverage).
    **Tradeoff to acknowledge.** This delegates coverage correctness
    to the gate layer: a test file that escapes both `**/__tests__/**`
    AND the gate (e.g. a hypothetical `*.test.ts` in a directory
    pattern the gate doesn't check) would be counted as production
    code in coverage and inflate metrics. The two outliers in this
    migration are the existence proof that gate gaps happen. The
    accepted tradeoff: `**/__tests__/**` is correct for 100% of
    today's files post-Phase 6 and any future violations are a gate
    bug (fix the gate) not a coverage bug (don't fix the coverage
    config).
14. Add a script entry: `"test:coverage": "vitest run --coverage"`.
15. Do NOT set thresholds (per § 2 non-goals). Coverage is a measurement
    only at this stage. CI does NOT run coverage on every PR.

**Success criteria.**

- Both outlier files moved under `__tests__/` and discoverable by glob.
- Vitest config simplified (no explicit outlier paths).
- All conventions documented in the two updated reference docs.
- Footguns removed or visibly renamed.
- `engines` field and `.nvmrc` present.
- Coverage tooling wired with no thresholds.

**Rollback.** Each item is independently revertable. None affects the
test runner or CI behaviour; only documentation, naming, and coverage
tooling are touched.

---

## 5. Concrete file changes

Itemised list across all phases.

**Created.**

- `vitest.config.ts` (Phase 1).
- `docs/test-fixtures-inventory.md` (Phase 1).
- `docs/pre-migration-test-snapshot.txt` (Phase 0).
- `docs/pre-migration-test-snapshot.json` (Phase 0; companion to the
  txt snapshot, anchors the test-count-parity invariant).
- `tasks/builds/vitest-migration/test-count-parity.md` (Phase 1; updated
  in Phase 3 once the outliers are wrapped).
- `tasks/builds/vitest-migration/vitest-discovery-baseline.json` (Phase 1;
  output of `vitest list --reporter=json`, the primary source of truth
  for I-3a).
- `tasks/builds/vitest-migration/dual-run-consistency.md` (Phases 2 to 3;
  per-batch comparison of bash-runner vs Vitest outcomes).
- `tasks/builds/vitest-migration/escalations.md` (Phases 2 to 3;
  per-batch whitelist or mismatch summaries surfaced to the user
  before the next batch — the migration-fatigue friction point).
- `tasks/builds/vitest-migration/parallel-stress-results.md` (Phase 4).
- `.nvmrc` (Phase 6).

**Modified.**

- `package.json`:
  - Phase 1: add `vitest` and `@vitest/coverage-v8` to `devDependencies`,
    add `"test:unit:vitest": "vitest run"` to `scripts`.
  - Phase 5: change `"test:unit"` from
    `"bash scripts/run-all-unit-tests.sh"` to `"vitest run"`. Delete the
    redundant `"test:unit:vitest"` entry.
  - Phase 6: add `"engines": { "node": ">=20.0.0 <21.0.0" }`, rename
    `"migrate:drizzle-legacy"` to `"migrate:drizzle-legacy-DO-NOT-USE"`,
    delete `"playbooks:test"` (verify Vitest covers it first), add
    `"test:coverage": "vitest run --coverage"`.
- `vitest.config.ts`:
  - Phase 4: drop single-fork mode, add per-file pool overrides for
    quarantined files.
  - Phase 6: drop the explicit outlier-path entries from `include` once
    the files have been moved, add the coverage block.
- `docs/testing-conventions.md` (Phase 6): full rewrite of the assertion
  pattern and skip-gate sections; preserve the `*Pure.ts` + `*.test.ts`
  convention exactly as today.
- `docs/testing-structure-Apr26.md` (Phase 6): update the snapshot to
  reflect the Vitest-based runtime; preserve the per-feature stabilisation
  trigger and the out-of-scope categories.
- `.github/workflows/ci.yml` (Phase 5): change `timeout-minutes` from
  45 to 15, add any extra env vars surfaced in Phase 4.
- `docs/ci-setup.md` (Phase 5): update expected runtimes.
- Every `*.test.ts` file under the unit layer (Phases 2, 3, 6):
  - Phase 2: about 52 files (the `node:test` set).
  - Phase 3: about 215 files (the handwritten set, plus the 2 outliers
    which require special wrapping).
  - Phase 6: 1 file (`dlqMonitorRoundTrip.integration.test.ts`'s body
    becomes `test.todo`).
- 2 outlier files moved (see "Moved" below) and their import paths
  adjusted in Phase 6.

**Deleted.**

- `scripts/run-all-unit-tests.sh` (Phase 5).
- The handwritten test helper duplicates inside each `*.test.ts` file
  (the inlined `function test`, `function assert`, etc.). Removed
  per-file during Phase 3, not as a separate deletion. Verification at
  end of Phase 5 that none survived.
- `package.json`'s `"playbooks:test"` script (Phase 6, contingent on
  audit confirming Vitest covers the file).

**Possibly deleted.**

- `package.json`'s `"migrate:drizzle-legacy-DO-NOT-USE"` entry. Phase 6
  renames it; full deletion is a follow-up if the team prefers (this
  spec keeps the rename so the broken state is visible in
  `package.json` rather than vanishing silently).

**Moved (Phase 6).**

- `shared/lib/parseContextSwitchCommand.test.ts` to
  `shared/lib/__tests__/parseContextSwitchCommand.test.ts`.
- `server/services/scopeResolutionService.test.ts` to
  `server/services/__tests__/scopeResolutionService.test.ts`.

**Untouched.**

- All 54 `scripts/verify-*.sh` files.
- `scripts/run-all-gates.sh`, `scripts/run-all-qa-tests.sh`.
- `scripts/migrate.ts`, `scripts/seed.ts`, `scripts/run-trajectory-tests.ts`.
- The worker package (`worker/`).
- Mission-control (`tools/mission-control/`).
- `migrations/`, `drizzle.config.ts`.
- Trajectory fixtures under `tests/trajectories/`.
- The `_pre-test-integration-harness-spec` carve-outs
  (`fakeWebhookReceiver.ts`, `fakeProviderAdapter.ts`, `loadFixtures.ts`)
  beyond the per-file conversion of any `*.test.ts` that imports them.

---

## 6. Validation and rollback

Per-phase exit gates and the rollback path if a phase needs to be
reversed.

### Phase 0

**Success criteria.**

- `docs/pre-migration-test-snapshot.txt` exists and is committed.
- The snapshot lists pass / fail / skip per file plus a summary.
- Any failing tests have been triaged (fixed, deleted, or annotated with
  a tracking comment that names the follow-up).
- `npm run test:gates` and `npm run test:qa` both exit zero on the same
  Node 20 environment CI uses.

**Rollback.** None required. Phase 0 outputs are advisory.

### Phase 1

**Success criteria.**

- `npm run test:unit:vitest` discovers all 277 files and produces a
  complete run report. Pass / fail status of individual tests is not yet
  required to match the bash runner; this phase only verifies discovery
  and infrastructure.
- The fixture inventory at `docs/test-fixtures-inventory.md` exists and
  enumerates every shared test utility identified during investigation.
- `npm test` continues to work via the old runner unchanged.

**Rollback.** `git revert` of the Phase 1 commits removes the new
`vitest.config.ts`, the dev dependencies, and the new script entry. No
existing test file or convention file is modified.

### Phase 2

**Success criteria.**

- All approximately 52 `node:test` files pass under `test:unit:vitest` in
  single-fork mode.
- The diff for each batch is mechanical (no logic changes).
- The dual-run consistency log
  (`tasks/builds/vitest-migration/dual-run-consistency.md`) shows
  `match:yes` for every file in every batch (invariant I-4).
- `process.exit(0)` and `process.exit(1)` no longer appear in any
  converted file (or the file is quarantined per § 4 Phase 2
  deliverable 8 with the four-field R-M1 contract).

**Rollback.** Each batch is its own commit; revert one batch without
affecting others. The bash runner remains primary throughout the phase.

### Phase 3

**Success criteria.**

- All approximately 215 handwritten files pass under `test:unit:vitest`
  in single-fork mode. Combined with Phase 2's 52 files, this equals the
  full unit-layer test count from the snapshot.
- The two outliers (`parseContextSwitchCommand.test.ts`,
  `scopeResolutionService.test.ts`) are wrapped in `test()` blocks and
  pass.
- The "manual review" list is empty or each entry has been resolved.
- Dual-run consistency log shows `match:yes` for every file (I-4).
- Integration-file side-effect grep returns zero flagged statements
  across all integration files (I-7).
- Test-count-parity check at
  `tasks/builds/vitest-migration/test-count-parity.md` shows MATCH or
  fully WHITELISTED, with the outliers' counts updated to their
  post-wrap values (I-3).

**Rollback.** Per-batch `git revert`. The bash runner remains primary.

### Phase 4

**Success criteria.**

- 10 consecutive parallel runs pass without flakiness on the CI Node 20
  environment, of which at least 3 used `--sequence.shuffle`.
- Every quarantined test has a `// @vitest-isolate` comment with the
  four-field contract (reason / date / owner / follow-up) per R-M1, a per-file
  pool override in `vitest.config.ts`, and a live `tasks/todo.md` entry.
- Every failure surfaced during the 10 runs is classified into the
  taxonomy in § 4 Phase 4 deliverable 3 and recorded in the parallel
  stress results doc.
- `vitest.config.ts`'s `env` block and the CI workflow `env:` block list
  exactly the same variables.
- `tasks/builds/vitest-migration/parallel-stress-results.md` is committed
  and lists each run's outcome.

**Rollback.** If parallelism produces widespread flake that cannot be
resolved within the phase budget, revert the parallelism switch (re-add
`pool: 'forks'` + `singleFork: true`). Vitest still works; CI runtime
stays slower than target. Phase 5 cutover can still happen on top of
sequential Vitest. The runtime improvement is then a deferred follow-up.

### Phase 5

**Success criteria.**

- `npm test` runs the new pipeline end-to-end (`test:gates` then
  `test:qa` then `vitest run`).
- A CI run on the migration branch passes.
- Total CI runtime for the unit layer hits the soft target (under 3
  minutes) and the hard cap (under 5 minutes). If Phase 4 was rolled
  back to single-fork, only the hard cap is enforced.
- `scripts/run-all-unit-tests.sh` is deleted from the repo.
- A grep for `function test\(name: string` and `function assert\(cond: unknown`
  across the repo returns 0 matches.

**Rollback.** Revert the `package.json` `test:unit` change and restore
`scripts/run-all-unit-tests.sh` from git history. The bash runner is
the fallback path. CI returns to the slower runtime but stays green.

### Phase 6

**Success criteria.**

- Both outlier files moved under `__tests__/` and discoverable by the
  `**/__tests__/**/*.test.ts` glob without explicit path entries in
  `vitest.config.ts`.
- All conventions documented in `docs/testing-conventions.md` and
  `docs/testing-structure-Apr26.md`.
- Footguns removed (legacy migrate script renamed; `playbooks:test`
  deleted if Vitest covers it).
- `engines` field and `.nvmrc` present and consistent (both point at
  Node 20).
- Vitest coverage tooling wired with no thresholds and a
  `test:coverage` script.
- `dlqMonitorRoundTrip.integration.test.ts` uses `test.todo()` for the
  unfinished body.

**Rollback.** Each item is independently revertable and none affects the
test runner or CI behaviour.

### Cross-phase invariants

These hold across every phase. Each invariant has a name that commit
messages, quarantine comments, and follow-up tasks reference precisely.

1. **I-1: Gate / QA layers never change.** `npm run test:gates` and
   `npm run test:qa` produce the same output on every commit from Phase 0
   through Phase 6.
2. **I-2: Main is always green.** Phase work happens on a migration branch;
   merges to `main` only land once the phase's success criteria are met.
3. **I-3: Test-count parity.** Split into a primary and a secondary
   signal because grep alone is a weak oracle (matches commented code,
   strings, dynamically-generated tests, helper wrappers).
   - **I-3a (primary, source of truth):** Vitest's
     `vitest list --reporter=json` discovery count per file is the
     authoritative post-migration baseline (captured at end of Phase 1
     to `vitest-discovery-baseline.json`). The Phase 5 Vitest count
     equals the Phase 1 Vitest count, modulo the 2 outliers gaining
     `> 0` tests in Phase 3.
   - **I-3b (secondary, sanity check):** the grep-derived `testCount`
     in `docs/pre-migration-test-snapshot.json` must not diverge from
     the Vitest count beyond whitelisted deltas with rationale in
     `tasks/builds/vitest-migration/test-count-parity.md`. Common
     benign deltas (nested `test()` in `describe()`, conditional
     registration, helper wrappers) must each be named.
   Both checks run at the end of Phases 1, 3, and 5 — the three points
   where the discovery surface materially changes. Any unwhitelisted
   divergence in either signal fails the invariant.
4. **I-4: Dual-run consistency (Phases 2 to 3 only).** During the
   coexistence window, two checks must hold for every file in every
   batch:
   - **I-4a (file-level outcome):** the bash runner's per-file pass/fail
     outcome equals Vitest's per-file pass/fail outcome.
   - **I-4b (assertion semantics):** for any batch converting deep-
     equality or `assert.throws` patterns, at least one converted
     assertion per batch is spot-checked by deliberately breaking the
     asserted value and confirming Vitest now fails meaningfully. This
     guards against `toEqual` / `toStrictEqual` semantic differences
     (undefined vs missing fields, prototypes, NaN handling) silently
     passing tests for the wrong reason.
   Recorded in `tasks/builds/vitest-migration/dual-run-consistency.md`.
   This is the only invariant scoped to a phase range rather than the
   whole migration; once Phase 5 deletes the bash runner, the oracle
   is gone and this invariant retires.
5. **I-5: No silent test deletions.** No `*.test.ts` file is deleted
   except via an explicit per-file decision recorded in the commit that
   deletes it (with rationale in the commit body).
6. **I-6: Quarantine contract with expiry pressure.** Every
   `// @vitest-isolate` comment carries the four required fields
   (reason, date, owner, follow-up) per R-M1's contract. Every
   quarantine has a corresponding live entry in `tasks/todo.md`.
   Quarantines also have **expiry pressure**: any quarantine older
   than 30 days from its `date:` field must be reviewed in the next
   quarterly audit (or sooner) and either resolved (parallel-unsafe
   behaviour fixed, quarantine removed) or explicitly re-justified by
   updating the `date:` field with rationale. Quarantines tagged
   `owner: unowned` are flagged for ownership assignment at every
   audit until they get a real owner or are resolved. Without
   ownership and expiry pressure, `// @vitest-isolate` becomes
   permanent technical-debt storage. Phase 6 audits this initially;
   subsequent quarterly cycles (tracked under "test infrastructure
   hygiene") carry it forward.
7. **I-7: Test file side-effect freedom.** Two scopes:
   - **I-7a (mechanically enforced, integration tests only):** no
     `*.integration.test.ts` or `integration.test.ts` file has
     free-standing top-level statements outside `import` / `const` /
     `let` / `var` / `function` / `describe` / `test` / `beforeAll` /
     `afterAll` / `beforeEach` / `afterEach`. Enforced by Phase 3's
     grep at the time of conversion; the codified convention in Phase 6
     forbids new violations.
   - **I-7b (advisory, all test files):** no test file may mutate
     shared state at module load time — including but not limited to
     registry registration (`registerProviderAdapter`), singleton
     initialisation, in-memory cache priming, file-system writes,
     network setup. The same risks that drive I-7a (parallel-unsafe
     state leaking across worker boundaries) apply to every parallel-
     run test, not just integration tests; R-M1 is the canonical
     failure mode. I-7b is advisory because mechanical enforcement is
     impractical (a function call at module top-level may or may not
     mutate state depending on the callee), but Phase 6's
     `docs/testing-conventions.md` update names the rule explicitly so
     PR review can flag violations.
8. **I-8: Env discipline.** Two parts:
   - **I-8a (absence):** No test depends on the absence of an env var
     without an explicit `expect(process.env.X).toBeUndefined()`
     assertion documenting the dependency. Phase 2 / Phase 3 conversion
     adds the assertions; Phase 6's conventions update forbids reliance
     on implicit absence in new tests. The `env` block in
     `vitest.config.ts` lists only floor variables and Phase 1 / 4
     surfaced essentials — no convenience defaults.
   - **I-8b (mutation):** Tests must not mutate `process.env` without
     restoring it. The pattern that breaks this invariant is one test
     setting `process.env.X = 'foo'` and never resetting; under
     parallelism the worker now has X defined for every subsequent
     test in the same worker, silently breaking tests that rely on
     absence (I-8a) or different values. Tests that need to mutate
     env must use the snapshot/restore pattern:
     ```ts
     let envSnapshot: typeof process.env;
     beforeEach(() => { envSnapshot = { ...process.env }; });
     afterEach(() => { process.env = envSnapshot; });
     ```
     Phase 6's conventions update codifies the pattern; Phase 4's
     parallel-stress-test classification will surface mutation-without-
     restore failures under the **env** category.
9. **I-9: No-new-flake (post-Phase 6, permanent).** After cutover,
   two complementary checks gate new tests, because consecutive-run
   sampling alone misses rare flakes (1-in-10 timing-sensitive
   failures that pass 3 in a row but fail on the 4th):
   - **I-9a (consecutive):** any newly-introduced test that flakes
     under 3 consecutive local or CI runs must not merge. Cheap to
     run during PR review; catches the obvious cases.
   - **I-9b (frequency):** any newly-introduced test that fails in
     ≥2 of 10 consecutive CI runs must not merge. This aligns with
     the Phase 4 stress model (10 runs, 3 with shuffle) and catches
     rare flakes that I-9a misses. Run on the migration branch
     before merge; subsequently, surfaced via the optional shuffled
     CI job (§ 8) or a manual stress run when a test smells flaky.
   Either fix the flake (preferred) or quarantine under R-M1's
   contract (with 30-day expiry pressure per I-6). Without I-9, the
   parallel-clean state achieved in Phase 4 erodes within weeks as
   new tests land without parallel-safety review. The convention is
   codified in Phase 6's `docs/testing-conventions.md` update; PR
   review enforces it.
10. **I-10: Per-file test-count drift guard (post-Phase 6, advisory).**
    I-3 protects total counts; I-10 protects against structural
    weakening hidden in healthy-looking deltas. A developer can
    delete one rigorous test and add two weak ones — total count goes
    up, coverage looks fine, behavioural guarantee is weaker. The
    rule: any per-file change in the Vitest registered-test count
    that exceeds ±30% from the file's prior count requires
    justification in the PR description (one or two sentences naming
    what changed and why). The 30% threshold is deliberately loose so
    routine refactoring (split one test into two) doesn't trigger
    review noise; the goal is to flag the cases where 1 → 5 or
    10 → 4 happens without anyone noticing. Advisory because it relies
    on PR review judgment, not mechanical enforcement; the
    justification requirement creates the friction point that
    surfaces the change to a reviewer.

---

## 7. Estimate and sequencing

Rough hour estimates per phase. These assume a single Claude Code session
per phase with the executing agent making case-by-case judgment calls
without architectural decisions. Estimates expand if Phase 0 surfaces a
broken baseline or Phase 4 surfaces widespread flake.

| Phase | Estimate | Depends on | Notes |
|-------|----------|------------|-------|
| 0     | 1 to 2 hours | CI bring-up complete and green | Snapshot capture is fast; triage time depends on whether anything fails. |
| 1     | 2 to 3 hours | Phase 0 | Vitest config, fixture inventory, pre-emptive quarantine of the watcher test. |
| 2     | 3 to 5 hours | Phase 1 | About 52 files, mostly mechanical. The mocking and skip-gate translations are the only judgment-heavy part. |
| 3     | 8 to 15 hours | Phase 2 | About 215 files. Largest phase. Variance comes from the long tail of files with custom helpers (R-M3 R-M8). |
| 4     | 3 to 8 hours | Phase 3 | Variable based on flake surfaced. If the codebase is parallel-clean, the lower bound holds. R-M1 R-M2 are the variance drivers. |
| 5     | 1 to 2 hours | Phase 4 | Cutover is mechanical: change one script entry, delete one bash file, update CI timeout. |
| 6     | 3 to 5 hours | Phase 5 | Many small items, none individually risky. |

**Total estimate:** 21 to 40 hours of focused Claude Code session time,
spread across multiple sessions. Phase 3 is the largest and most likely to
expand beyond its band.

**Critical path.** Phases run sequentially as listed. There is no
parallelisation across phases because each phase's success criteria
include "all tests pass under Vitest", which depends on the previous
phase's conversions landing.

**Within Phase 3 only**, batches can be reviewed and merged in parallel
provided each batch is independent (no overlapping file edits).

---

## 8. Decisions deferred and follow-ups

Items intentionally NOT decided in this spec. Each is documented as a
follow-up to revisit post-migration. Add each to `tasks/todo.md` during
Phase 6 so they survive the migration session.

**Coverage thresholds.** Vitest produces coverage reports starting in
Phase 6, but no failure threshold is set. Revisit in 2 to 3 months once
the team has visibility into actual coverage levels and can pick a
threshold that reflects the real state rather than an aspirational one.

**Bash gate audit.** The 54 `verify-*.sh` scripts may contain redundancy
or obsolete checks (e.g. gates that point at code paths that have since
been refactored away). Out of scope for this migration. Tracked as a
separate follow-up under "test infrastructure hygiene".

**QA script audit.** Same shape as the gate audit; separate follow-up.

**Trajectory tests.** `scripts/run-trajectory-tests.ts` remains a
separate command. Decision on whether to fold into `npm test` is
deferred. Trajectory tests have different latency and external-dependency
profiles (they exercise live LLM endpoints in some configurations) that
may warrant staying out of the PR-gating path.

**Frontend tests.** Per `docs/testing-structure-Apr26.md`'s per-feature
stabilisation trigger, frontend tests are added when individual UI
surfaces have been stable for 4+ weeks. Vitest now exists in the repo, so
when a frontend area is ready, the runner is already configured (the
React-specific tooling, RTL plus MSW, is the additional install).

**API contract tests.** Same trigger and same posture as frontend tests.

**`Implementer-supplied:` placeholder body.** The single
`test.todo()` block in
`server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`
either gets implemented or the test gets deleted. Either decision lives
in the follow-up, not this spec.

**Quarantined tests under `// @vitest-isolate`.** Each represents work
to make the test parallel-safe. Track per file. When a quarantine is
removed, the file moves back into the default pool and Phase 4's
10-consecutive-runs gate is re-applied to confirm.

**Optional non-blocking shuffled CI job.** After cutover, default CI
runs deterministic ordering (the production behaviour). Order-dependent
bugs introduced by future PRs only surface when shuffle is manually
run. A non-blocking nightly or weekly CI job that runs
`vitest run --sequence.shuffle` against `main` would surface latent
ordering bugs early, without gating PRs on shuffle (which would create
review noise from rare flakes). Not in scope here because CI workflow
authoring is outside the migration; suggested follow-up once the
post-migration cadence stabilises. The output ties back to I-9b: any
failure pattern surfaced by the shuffle job is a candidate for a
quarantine under the R-M1 contract.

**Bash gate parallelisation.** Each gate is sub-second; 54 sequential
runs at about 0.5 seconds each is roughly 27 seconds total. Not worth
optimising at current scale. Revisit if total CI time becomes dominated
by gates rather than the unit layer.

**Outlier-file pure-helper extraction.** Phase 6 may suppress the
`verify-pure-helper-convention.sh` gate for the moved
`scopeResolutionService.test.ts` file if extraction is non-trivial. The
follow-up is to extract the pure logic into
`scopeResolutionServicePure.ts` per the documented convention and remove
the suppression.

**Mission-control tests.** `tools/mission-control/server/__tests__/` has
3 test files (`github.test.ts`, `inFlight.test.ts`, `logParsers.test.ts`)
that are not part of the main suite per readiness report § 6. Out of
scope here. A future migration of the mission-control sub-app to Vitest
is a separate decision tracked elsewhere.

**Worker test coverage.** The worker package
(`worker/`) has zero `*.test.ts` files today. Whether this is a gap
worth filling is a product decision tied to the IEE worker's stability;
not relevant to this migration.

**Replacement of `loadFixtures()` style.** The current fixture loader
returns a fresh object per call. If integration tests benefit from a
shared per-suite seed, Vitest's `beforeAll` hook can replace the per-test
seed. Not in scope here.
