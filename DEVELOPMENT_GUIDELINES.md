# Development Guidelines

**Maintained by:** the operator, updated after major audits and architectural decisions.
**Last updated:** 2026-05-13 (§8.34-8.37 + §9 viewer discriminator — derived from ChatGPT PR/spec review log audit)
**Status:** Living document — update when a new invariant is locked or a pattern is retired.

These guidelines are the "how we build" companion to `architecture.md` ("what we're building") and `CLAUDE.md` ("how agents behave"). They encode lessons from the 2026-04-25 full-codebase audit and the remediation programme. Every new feature and every PR is expected to follow these rules.

---

## Contents

1. [Multi-tenancy and RLS (non-negotiable)](#1-multi-tenancy-and-rls-non-negotiable)
2. [Service / Route / Lib tier boundaries](#2-service--route--lib-tier-boundaries)
3. [Schema layer rules](#3-schema-layer-rules)
4. [LLM routing](#4-llm-routing)
5. [Gates are the source of truth](#5-gates-are-the-source-of-truth)
6. [Migration discipline](#6-migration-discipline)
7. [Testing posture (pre-production phase)](#7-testing-posture-pre-production-phase)
8. [Development discipline](#8-development-discipline)
9. [Multi-tenant safety checklist (every new feature)](#9-multi-tenant-safety-checklist-every-new-feature)
10. [When this document should be updated](#10-when-this-document-should-be-updated)

---

## 1. Multi-tenancy and RLS (non-negotiable)

> Templates, code examples, and the canonical RLS policy SQL live in [`architecture.md` § Row-Level Security](./architecture.md#row-level-security-rls--three-layer-fail-closed-data-isolation). The rules below are checklist items — see architecture.md before writing the migration.

- **`app.organisation_id` is the only valid org session variable.** `app.current_organisation_id` is a phantom — never used. Detection gate: `scripts/verify-rls-session-var-canon.sh`.
- **Every new tenant table ships full RLS in the same migration** (canonical policy template in architecture.md). Add the table to `server/config/rlsProtectedTables.ts` in the same PR.
- **Always filter by `organisationId` in application code, even with RLS.** Reads and writes by ID must include an explicit `eq(items.organisationId, organisationId)`. Detection gate: `scripts/verify-org-scoped-writes.sh`.
- **Routes with `:subaccountId` must call `resolveSubaccount(req.params.subaccountId, req.orgId!)` before consuming the ID.** Pass `subaccount.id` downstream, never the raw param. Detection gate: `scripts/verify-subaccount-resolution.sh`.
- **Corrective migrations follow the 0213 precedent.** Append-only — write a new migration that drops every historical policy name and creates the canonical one. Reference: `migrations/0213_fix_cached_context_rls.sql`.

---

## 2. Service / Route / Lib tier boundaries

> Detailed patterns and "when to create a service" criteria live in [`architecture.md` § Service Layer](./architecture.md#service-layer).

- **Routes and `server/lib/**` never import `db` directly** — call a service. Enforced by `scripts/verify-rls-contract-compliance.sh`.
- **A new service file requires multiple DB interactions or multiple callers.** Otherwise the call goes inline in the route wrapped in `withOrgTx`. Max one service per domain.
- **Use the right access pattern**: `withOrgTx` (org-scoped), `withAdminConnection` (system/admin), pure helper (no DB), admin+per-tenant `withOrgTx` (jobs writing tenant data — mirror `memoryDedupJob.ts`), log-and-swallow with `getOrgScopedDb()` inside the `try` block (never above it).
- **Maintenance jobs that advertise per-org partial-success use one admin transaction per organisation, or SAVEPOINT subtransactions inside an outer admin tx that holds the advisory lock — never a single shared admin tx across all orgs.**
- **A pg-boss worker that sets `resolveOrgContext: () => null` MUST re-open `withOrgTx` after loading the run's organisation.** The null opt-out is for the initial cross-tenant row lookup only — every subsequent DB call in the handler must run inside `withOrgTx({tx, organisationId: run.organisationId, ...}, async () => { ... })` and use `getOrgScopedDb()`. See `KNOWLEDGE.md` [2026-05-14] for the WF4 incident rationale. (Q4 — build: split-workflow-engine) **Exception:** `workflowEngine/queueLifecycle/tick.ts` and `watchdog.ts` currently violate this convention — remediation is explicitly deferred to the WF3/WF4 follow-up PR. Until that PR lands, these two files are tracked exceptions, not compliance examples.

---

## 3. Schema layer rules

- **Schema files are leaves.** `server/db/schema/**` may only import from `drizzle-orm`, `shared/types/**`, and other schema files — never from `services/`, `lib/`, `routes/`, or `middleware/`. One violation drove 175 circular cycles in the 2026-04-25 audit.
- **Types crossing the schema/service boundary live in `shared/types/`.** If a type is used by both a schema file (as a JSONB column) and a service (as a return type), put it in `shared/types/` and have services re-export for backward compat.
- **Partial unique indexes on soft-deletable tables must include `AND deleted_at IS NULL`.** Without it, re-inserting a soft-deleted row permanently fails with a unique constraint violation — the record is logically gone but still occupies the index.
- **Soft-delete enforcement is two-layered: SQL exclusion is the rule, runtime assertion is defence-in-depth.** Joins against soft-deletable tables (`agents`, `systemAgents`, etc.) carry `isNull(table.deletedAt)` in the join `ON` clause — never in `WHERE` for `leftJoin`s, since that converts outer to inner semantics. `assertNotSoftDeleted(record, label)` may be called on hot paths after fetch as a regression catcher; it is supplementary, not a replacement for the SQL filter.

---

## 4. LLM routing and canonical reads

- **All LLM calls go through `llmRouter`.** Never import provider adapters (`anthropicAdapter`, etc.) in production code, including `countTokens` (billable). Detection gate: `scripts/verify-no-direct-adapter-calls.sh`.
- **Reads from `canonical_*` tables go through `canonicalDataService`** — read-only, no writes, no side effects, no mutation-caching. Detection gate: `scripts/verify-canonical-read-interface.sh`.
- **Every `canonicalDataService` call passes a `PrincipalContext`.** Use `fromOrgId(orgId, subaccountId?)` for legacy call sites. Detection gate: `scripts/verify-principal-context-propagation.sh`.
- **`withPrincipalContext` only works inside an active `withOrgTx`.** Job handlers and other non-request contexts must construct a `PrincipalContext` via `fromOrgId` and pass it as the first parameter — never wrap with `withPrincipalContext`.

---

## 5. Gates are the source of truth

- **Blocking gates block merges — no exceptions.** No `--ignore` flags, no `# baseline-allow` on blocking gates, no deletion. **Continuous integration runs the full gate suite as a pre-merge gate** — do NOT run `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, the umbrella `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, or `scripts/run-all-*.sh` locally. See `CLAUDE.md` § *Test gates are CI-only — never run locally* for the full rule.
- **Historical baseline files need both conditions:** filename in the gate's `HISTORICAL_BASELINE_FILES` array AND a `-- @rls-baseline:` annotation in the file. One without the other still fails the gate.
- **Trust CI's gate result, not a local re-run.** Gate state drifts in pre-production. CI is the authoritative gate runner — read its output to reconcile live violations against the spec's planned scope. Never apply a stale fix list, and never invoke gate scripts locally to "preview" what CI will say.
- **Warning-level gates are observability signals, not blockers.** A point-specific `# baseline-allow` with an explanatory comment is the right way to acknowledge a reviewed pattern. Never use blanket suppression.

### Gate authoring rules

- **Self-test fixtures must not carry gate-recognised suppression annotations.** A fixture with `@null-safety-exempt` or `guard-ignore-next-line` proves only that the gate respects suppression — not that detection works. Remove all suppression annotations from deliberate-violation fixture files.
- **Scan-path override env vars must disable the matching path exclusions.** An override env var (e.g. `DERIVED_DATA_NULL_SAFETY_SCAN_DIR`) that points at a fixture directory is useless if the gate still applies `! -path "*/__tests__/*"`. Remove that exclusion when the override is set.
- **Grep-based gates must skip `import type` lines.** Type-only imports are erased at compile time and should not trigger import-presence gates. Pipe through `grep -v "import type"` before the pattern match, or document the limitation and require `guard-ignore-next-line` at affected call sites.
- **Advisory gate runners must use `|| true`.** Any script that captures advisory gate output via `OUTPUT="$(bash gate.sh 2>&1)"` under `set -euo pipefail` must append `|| true`: `OUTPUT="$(bash gate.sh 2>&1 || true)"`. Without it, promoting the gate from advisory to blocking will kill the runner before the count line is parsed.
- **Calibration constants must enumerate every exclusion.** When a gate subtracts a hard-coded constant from a raw count, each excluded occurrence must be listed as an inline comment with a unique grep pattern (one hit per exclusion). A bare magic number is unverifiable — the next author cannot tell whether it's still correct. `scripts/verify-skill-read-paths.sh` is the canonical example.
- **`actionType` regex must include dots.** The pattern `actionType: '[a-z_]+'` does not match dot-namespaced types (`crm.fire_automation`, `crm.query`, etc.). Use `[a-z_.]+` or document the exclusion explicitly.
- **Strip CRLF when parsing files on Windows.** Windows-authored files contain `\r\n`. Bash scripts that join or split lines must pipe through `tr -d '\r'`; JS parsers must `.replace(/\r/g, '')` before splitting on `\n`. The `guard-utils.sh` jq wrapper already does this — new scripts must replicate it.

### Gate baseline and test robustness

Baselines under `scripts/.gate-baselines/*.txt` are keyed by `<path>:<line>:<message>`. Many test fixtures, snapshots, and assertion strings are likewise positional. A refactor that moves, renames, splits, or shifts lines in any referenced file breaks the reference for every downstream PR — those PRs then fail gates they did not cause, and the failure appears in code unrelated to the actual diff.

- **PRs that move, rename, split, or shift lines in files referenced by a gate baseline, fixture, or positional test assertion update those references in the same commit.** Treat the baseline file or fixture as part of the unit of change. Source-file rename without baseline update is the same defect class as schema rename without migration update.
- **Authoring rule: prefer behaviour-anchored assertions over coordinate-anchored ones.** Assert that a specific function was called with specific args; assert on parsed structure rather than formatted output; sort lists before comparing; pin against stable IDs, not array index or render order. Coordinate-anchored tests (line numbers, full file paths in messages, snapshotted log strings, ordered-by-default lists) generate false negatives on unrelated refactors and erode trust in the suite.
- **Evolving rule: when a refactor exposes a brittle test or baseline entry, fix the brittleness, not just the coordinates.** Updating `line:693` to `line:697` is fine for documented-debt baselines. But if the same entry has drifted twice in a quarter, the underlying check is the wrong shape — replace the file:line key with a content-hash key, or replace the regex with an AST-aware analyser. Whichever change reduces future drift is the cheaper long-run fix.

Detection: if a CI run on a fresh branch off `main` fails a gate that the branch's diff does not touch, the cause is almost always baseline drift from a previous merge that did not follow this rule.

## 6. Migration discipline

1. **Migrations are append-only.** Never edit a historical migration file after it has run.
2. **Migration numbers are assigned at merge time.** Use `<NNNN>_<name>.sql` as a placeholder during PR development; rename the file to claim the next available number immediately before merge (after rebasing onto latest `main`).
3. **System-scoped tables** (no `organisation_id`) must document in the migration header why they are not added to `RLS_PROTECTED_TABLES`. Every migration that creates a table must either add it to the registry with a full policy **or** include a `-- system-scoped: <reason>` header comment. Neither = gate failure, not just a review comment.
4. **Drizzle schema changes** that accompany a migration land in the same PR. The schema file and the migration are a unit.
5. **Corrective migrations** follow §1's bullet on corrective migrations: enumerate all historical policy names, DROP them, then CREATE with the canonical policy shape.
6. **`policyMigration` in `rlsProtectedTables.ts` must point at the migration that physically runs `CREATE POLICY ... ON <table>`.** If a corrective migration's header NOTE explicitly excludes a table, the manifest entry for that table must still reference the original policy migration, not the corrective one. Use `grep -rl "CREATE POLICY.*ON <table>" migrations/` to confirm the authoritative file when in doubt.

---

## 7. Testing posture (pre-production phase)

The current posture is `static_gates_primary` per `docs/spec-context.md`. This means:

- **Gates pass = done.** A green gate run in CI is the definition of done for a phase. Local sessions do not run the gate suite — see §5 and `CLAUDE.md` § *Test gates are CI-only — never run locally*.
- **New runtime tests are added only for pure functions** — functions that accept data and return data with no DB, network, or filesystem side effects.
- **Do not add** jest/playwright/supertest/E2E tests until `docs/spec-context.md` flips `testing_posture` (triggered by first live agency client onboarding). Runtime unit tests use **Vitest** — see `docs/testing-conventions.md` for the canonical pattern.
- **`*Pure.test.ts` naming is enforced by `verify-pure-helper-convention.sh`.** Files matching that pattern must have zero transitive DB imports. If a test needs the DB, drop `Pure` from the filename — do not suppress the gate violation.
- **Run individual tests** with `npx vitest run <path-to-test-file>` — do not use `npx tsx` or `scripts/run-all-unit-tests.sh` for Vitest tests.
- **Spy on the logger object directly, not `process.env` or `console.*`.** `server/lib/logger.ts` resolves `LOG_LEVEL` to a `const` at import time, so patching env in `beforeEach` is a no-op — use `mock.method(logger, 'warn', () => {})` to intercept at the object level.

When `docs/spec-context.md` flips `testing_posture`, update §7 of this document to describe the new posture. For the inventory of suites that must exist before the flip, the trigger condition, and the sequencing plan, see [`docs/testing-transition-plan.md`](./docs/testing-transition-plan.md).

## 8. Development discipline

### 8.1 Fix root causes, not symptoms

A single import line (`server/db/schema/agentRunSnapshots.ts` importing from `server/services/middleware/types.ts`) drove 175 circular dependency cycles. The right fix was extracting the type — not suppressing 175 individual cycle warnings. Always ask: what is the minimum change that closes the entire class of violation?

### 8.2 No drive-by cleanup

Do not bundle "while I'm in this file, let me also fix X" into a phase PR. Each category has a dedicated section and a dedicated PR. Drive-by cleanup bloats review, expands blast radius, and makes phases unrevertible.

### 8.3 Smallest viable PR per category

A "category" is a single spec subsection. When a category is opened, every finding in it ships in the same PR. We do not ship half a category. But we also do not bundle two categories into one PR unless they are causally connected (as Phases 1A–1E are).

### 8.4 Prefer existing primitives over new abstractions

Every phase of the audit remediation reused existing primitives: `withOrgTx`, `withAdminConnection`, `withPrincipalContext`, `fromOrgId`, `llmRouter`, `canonicalDataService`, `resolveSubaccount`. A new primitive (e.g. `rateLimitStoreService`) requires a documented "why not reuse / why not extend" paragraph in the PR description. The bar is high.

### 8.5 Feature development is paused during structural remediation

From the moment Phase 1 of the 2026-04-25 remediation starts until the Phase 4 ship gate is green, no new product features merge to `main`. Feature branches may exist; they wait. This is a one-time structural reset — when `docs/spec-context.md` reflects all phases complete, remove this constraint.

### 8.6 Infrastructure migrations ship with an env-flag rollback shim

Significant infrastructure migrations ship with an env-flag rollback shim that has identical function signatures to the new path — no caller changes required to revert.

### 8.7 State/Lifecycle invariants are mandatory for specs that touch state machines

Any spec that introduces or modifies a state machine (step transitions, run aggregation, approval boundaries, resume paths, job status) must include a dedicated State/Lifecycle section pinning: (1) valid transitions, (2) execution-record requirement before terminal-state writes, (3) concurrency guard predicate on terminal-state writes (e.g. `UPDATE ... WHERE status = 'review_required'`), (4) whether the status set is closed.

Detection: if a spec mentions "state", "transition", "status", "approved", "completed", "failed", "resume", or "cancel" without this section, add one before review.

### 8.8 Cross-spec consistency sweep is mandatory for multi-chunk work

Multi-chunk / multi-phase / parallel-PR implementations require a cross-spec consistency pass before freeze, reading all specs simultaneously to check: (a) identifier naming across specs, (b) shared contracts identical across consumers, (c) no primitive introduced in two places, (d) no contradictory assumptions about cross-cutting decisions. Individual per-spec review cannot catch this drift.

### 8.9 One PR per feature branch; one PR per sprint

Multi-chunk work uses one integration branch and one PR to main. Per-chunk branches PR into the integration branch, never directly to main. One-PR-per-chunk topologies create redundant integration points and force a consolidation step that integration-branch discipline avoids.

### 8.10 Race-claim ordering

Operations with both a state write and an external side effect persist the state-claim first, verify the claim succeeded, and only then trigger the side effect.

### 8.11 Idempotency keys

Idempotency keys for actions are keyed on the canonical entity ID, never on the variant of the action.

### 8.12 External-call ordering

Run external calls that can fail (LLM classifiers, third-party APIs) before persisting the rows that depend on them — never insert rows then call out.

### 8.13 Discriminated-union validators

Adding a new kind to a discriminated union and updating the validator's allow-list happens in the same commit.

### 8.14 Resume-path gate bypass

Resume paths after gate clearance pass an explicit bypass flag through gate resolution — never re-resolve the gate on resume.

### 8.15 Cross-path lifecycle hooks

Cross-cutting lifecycle hooks (heartbeat, audit, cost tracking) fire from every execution path that completes the relevant unit, never from one path only.

### 8.16 Allow-list discipline

Every entry in a project allow-list (RLS exceptions, gate suppressions, baseline files) cites a linked invariant ID, spec section anchor, or migration filename — bare rationale text is not enough.

### 8.17 Multi-source UI merges sort by server time with a stable tiebreaker

UI surfaces that consume the same logical event from optimistic and websocket sources (or any two replay paths) merge by stable record ID and sort by server-stamped timestamp with an immutable secondary key — never primary-only.

### 8.18 Terminal state-machine writes flow through `assertValidTransition`

Every code path that writes a terminal status to a state-machine row (run, step, action) calls `shared/stateMachineGuards.ts` immediately before the UPDATE; sites that have not yet adopted it emit a `state_transition` log with `guarded: false` — silent unguarded writes are not allowed.

### 8.19 Error codes are extracted via the single shared helper

`shared/errorCode.ts` (`getErrorCode`) is the only place that branches on error shape (`string` / `{ code }` / `{ error: string }` / `{ error: { code } }`); `Error.message` is free text and is never promoted to the code channel.

### 8.20 Deferred enforcement requires an observability log at the same boundary

When a mechanical isolation or transition assertion is deferred, the matching boundary still ships a structured log NOW with table, operation, and scope-tuple booleans — write-side boundaries get the log even when the read-side spec slips.

### 8.21 Pure functions whose inputs may reorder are tested under input permutation

Any pure resolver / reducer / ranker whose source array can be reordered between renders ships with a determinism test that exercises ≥3 input orderings and asserts by-key identical output.

### 8.22 Allow-list annotations name the function they cover

Per-file allow-listing is insufficient; call-site annotations (e.g. `@rls-allowlist-bypass: <table> <function_name>`) name the immediately-following declaration so renames and moves invalidate the binding.

### 8.23 ACTION_REGISTRY entries must be registered in SKILL_HANDLERS

Any action registered in `ACTION_REGISTRY` must also have a matching entry in `SKILL_HANDLERS` in `skillExecutor.ts`; registration in one without the other leaves the action unreachable at runtime with no compile-time error.

### 8.24 Module-level in-process caches require a size cap

Module-level `Map` or `Set` used as a process-lifetime dedup or idempotency cache must be bounded by an explicit size cap with LRU eviction; unbounded maps grow indefinitely under production load.

### 8.25 `<button>` elements outside a submit context require `type="button"`

Every `<button>` that does not intentionally submit a form must declare `type="button"`; the HTML default is `type="submit"`, which silently submits any ancestor `<form>` on click.

### 8.26 Feature kill switches must gate all consumer paths

A system-disabled flag must short-circuit every route that touches the feature — mutation routes, read-through routes, picker/integration endpoints — not just the primary write path; partial gating leaves orphaned traffic and partial state when the flag is flipped.

### 8.27 Soft-delete filter goes through `isActive(table)`

Every join on a soft-deletable table uses `isActive(table)` from `server/lib/queryHelpers`. Raw `isNull(table.deletedAt)` is a lint-waivable finding that must be explicitly justified inline. For leftJoin, the filter MUST live in the join's ON clause, never the WHERE — placing it in WHERE converts outer to inner semantics.

### 8.28 Token `iat` invalidation comparisons align both sides to whole seconds

JWT `iat` is second-precision (`iat * 1000` is whole-second × 1000). Any state field used to invalidate tokens (`passwordChangedAt`, session-revocation-at, etc.) must floor to whole seconds at write time and compare with strict `>` against `iat` — never compare a millisecond-precision Date to a second-precision token claim, and never use `>=` (revokes valid tokens issued in the same wall-clock second as the state change).

### 8.29 Per-route body-size caps install BEFORE the global JSON parser

Routes that need a tighter body cap than the global `express.json({ limit: '10mb' })` (audit endpoints, abuse-prone reporting endpoints, anything where authenticated abuse can inflate downstream layers) install a path-scoped `express.json({ limit: '<smaller>' })` BEFORE the global parser. Once `req._body` is populated by the tight parser, the global parser short-circuits — oversized payloads return 413 from the path-scoped parser. Reverse order silently lets oversized bodies through.

### 8.30 SQL CASE enum mappers use `ELSE NULL`, never a fallback string

When a SQL `CASE` expression maps a DB enum column to a typed value for consumption by a TypeScript fail-closed mapper, write `ELSE NULL` — not `ELSE '<default>'`. Unknown enum values must propagate as `NULL` to the TypeScript layer, which throws `UnknownEnumValueError`; a string fallback silently coerces the unknown value and bypasses the safety guarantee.

### 8.31 Non-durable async operations must carry an explicit durability comment

Any fire-and-forget (`void promise.catch(...)`) that bypasses the pg-boss durable queue must carry a comment naming the residual risk (e.g. orphaned `agent_runs` rows on process restart) and a `tasks/builds/*/migration-gaps.md` PLAN_GAP entry. Silently non-durable is worse than explicitly deferred — a future developer cannot tell whether the omission was deliberate.

### 8.32 Cycle-prevention assertions must cover all files in the import chain

When adding a no-circular-import assertion (e.g. a test that reads file source and asserts no import of module X), extend the assertion to cover every file in the chain that could reintroduce the cycle — not only the root file. A gap at any downstream node leaves the cycle risk undetected by the test.

### 8.33 Suppression-is-success for single-writer event emitters

For emitters where a single writer owns the per-entity stream (Home dashboard live reactivity, terminal status-transition writers under last-write-wins ordering, cache populators, idempotent webhook receivers, notification dedup, `writeDiagnosis`, etc.), the contract is suppression-is-success: when the emitter loses a coordination race (another writer got there first, or a stamped-newer payload makes this write redundant), it returns SUCCESS, not failure. Required pattern:

- Return shape `{ success: true, suppressed: true, reason }` — `reason` is a short string naming the suppression cause (e.g. `'lost_race'`, `'newer_payload_already_written'`, `'already_emitted'`).
- `suppressed: false` (or absence of the field) means a write actually happened.
- Callers MUST treat `suppressed: true` as success; never retry, never log as warning, never increment a failure-rate metric.
- The emitter MUST NOT throw on suppression paths — throwing inverts the natural control flow for what is, by design, a healthy outcome.

Failure mode if violated: retry storms on intentional suppressions, false incident signals, broken success-rate metrics, and alert fatigue (the four regressions ADR-0013 was written to prevent).

Does NOT apply to genuine failures: DB connection lost, malformed payload, permission denied, downstream API 5xx — those return `{ success: false, error: ... }` as normal. The convention is specifically for the class where "another writer beat me" is a healthy outcome.

A `suppressedSuccess(reason)` helper at the call site is preferred over hand-rolling the shape every time.

Reference: ADR-0013 (canonical), `architecture.md § Home dashboard live reactivity`, and the 2026-05-13 KNOWLEDGE.md entry "Pattern — 'Suppression is success' for single-writer event emitters".

### 8.34 Paginated and list-returning queries ship a deterministic ORDER BY with a stable tiebreaker

Every list query exposed to a UI or paginated API uses `ORDER BY <primary>, <stable secondary>` where the secondary is an immutable key (`id`, or `created_at, id`); cursor encoding includes both keys. Primary-only sorts reorder under equal primary values and break pagination silently.

### 8.35 State-changing UPDATEs filter by org, status, and assert single-row effect

Every UPDATE that transitions a row to a new state filters by `organisationId` AND the expected current `status` (`WHERE organisation_id = ? AND status IN (...)`), asserts `rowCount === 1`, and returns 409 `invalid_state_transition` otherwise. Bare `eq(id, x)` on a state row is a blocking review finding.

### 8.36 Empty `.catch(() => {})` is banned

No silent catch. Every caught promise rejection routes through `logger.warn({scope, ids, error})`, `logger.error(...)`, or `logAndSwallow` — never an empty arrow. Silent catches strip every signal needed to debug production incidents.

### 8.37 React `useEffect` async loads carry a cancellation guard

Every `useEffect` that awaits a fetch and then calls `setState` carries a `cancelled` boolean or generation-counter ref, checked before the `setState`. Bare `setState` after `await` causes stale-state writes when inputs change mid-flight.

### 8.38 Tick workers MUST resolve a real org context before opening DB transactions

A pg-boss handler registered with `resolveOrgContext: () => null` MUST call `withOrgTx(row.organisationId, ...)` explicitly after loading the run row — `resolveOrgContext: () => null` is an opt-out for the first raw-db lookup only, not for the entire handler body. Handlers that run dozens of DB calls after a null opt-out have no `app.organisation_id` GUC set; every downstream `getOrgScopedDb()` call reads from the unscoped pool and Postgres's RLS returns empty sets silently. Detection gate: `scripts/verify-with-org-tx-or-scoped-db.sh`.

### 8.39 Routes never import from `server/db/schema/**`

Route files must not import Drizzle table objects directly. All DB access goes through the service layer. Importing schema objects in routes bypasses the service abstraction, prevents service-layer caching and instrumentation, and is an architectural invariant violation. Precedent: `server/routes/support/supportAgentRoutes.ts` fix (PR #318). Detection gate: `scripts/verify-no-db-in-routes.sh`.

### 8.40 Handoff dispatch paths must agree on durability posture

Handoff dispatch paths must agree on durability posture. Synchronous `Promise.all(executeRun)` is forbidden for spawn paths; route through `enqueueHandoff`.

---

## 9. Multi-tenant safety checklist (every new feature)

Before any PR that touches tenant data merges, answer YES to all nine:

- [ ] **Org-scoped at the table level.** New table has `organisation_id NOT NULL`, `RLS_PROTECTED_TABLES` entry, and canonical org-isolation policy in the same migration.
- [ ] **Org-scoped at the query level.** Every read/write by ID also filters by `organisationId` explicitly.
- [ ] **Service-layer mediated.** No route or lib file imports `db` directly.
- [ ] **Subaccount-resolved.** Every route with `:subaccountId` calls `resolveSubaccount(...)` before using the ID.
- [ ] **Gates green.** All RLS gates plus the architectural-contract gates pass on the feature branch before review.
- [ ] **Background jobs follow the admin/org tx pattern.** Any new maintenance job that writes tenant rows mirrors `memoryDedupJob.ts` (admin connection for iteration, `withOrgTx` per tenant write).
- [ ] **Log-and-swallow services keep `getOrgScopedDb` inside `try`.** No resolution above the catch boundary.
- [ ] **Cross-entity ID verified.** Server-side handlers that take a parent ID in the URL and a client-supplied child ID in the body verify the child belongs to the parent before any write.
- [ ] **Dual-GUC tables use `setOrgAndSubaccountGUC`.** Any new table whose RLS policy checks both `app.organisation_id` and `app.subaccount_id` (dual-GUC) calls `setOrgAndSubaccountGUC(tx, orgId, subaccountId)` — never bare `db.select()`/`db.update()` and never plain `setOrgGUC` — as the first statement inside every `db.transaction(...)` that touches it. See architecture.md "Dual-GUC pattern".
- [ ] **Owner-only reads pass a viewer discriminator.** Any table where RLS allows admin reads but the spec requires content redaction for non-owners ships a serialiser that accepts `viewer = { userId, role, organisationId }` and returns the redacted shape when `viewer.userId !== row.ownerUserId`. Sharing one serialiser across roles without a viewer argument is a blocking review finding.

---

## 10. When this document should be updated

- A new architectural primitive becomes canonical → add it to §4 or §8.4.
- `docs/spec-context.md` flips `testing_posture` → update §7.
- `docs/spec-context.md` flips `live_users: yes` → update §8.5 (feature freeze no longer applies; rollout model changes).
- A new gate is introduced → add its detection reference to the relevant section.
- A pattern from `KNOWLEDGE.md` reaches "stable, enforce everywhere" status → migrate it here.
- **After finishing a development branch** → the `finishing-a-development-branch` skill (Step 2) scans code review output and appends qualifying findings here.

### Format rules for all new additions

Every new bullet added to this document must meet **all** of the following:

- **One sentence preferred, two sentences maximum.** If you can't state the rule concisely, it is not ready for this document.
- **No code blocks.** Code examples belong in `architecture.md` or `KNOWLEDGE.md`.
- **No "why" explanations inline.** The rule stands alone. Rationale goes in the PR description or `KNOWLEDGE.md`.
- **Class-level rule only.** Must prevent a repeatable class of mistake, not describe a one-off fix.
- **Universally applicable.** Must apply across features, not be specific to one domain or PR.

If a finding does not meet every criterion, it goes to `KNOWLEDGE.md` instead — not here with a caveat.

---

*Derived from the 2026-04-25 full-codebase audit (47 findings + 16 ground-truth gate corrections) and the corresponding remediation spec (`docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`). The spec is the authoritative source for the remediation work; this document is the distilled, forward-looking summary.*
