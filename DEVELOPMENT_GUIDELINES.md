# Development Guidelines

**Maintained by:** the operator, updated after major audits and architectural decisions.
**Last updated:** 2026-04-27 (condensed §§1–4 to one-liners; SQL templates and code examples moved to architecture.md; §10 format rules and finishing-branch trigger added; §§8.10–8.16 + §2 maintenance-job rule + §9 cross-entity rule from pre-launch-hardening reviews)
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

---

## 3. Schema layer rules

- **Schema files are leaves.** `server/db/schema/**` may only import from `drizzle-orm`, `shared/types/**`, and other schema files — never from `services/`, `lib/`, `routes/`, or `middleware/`. One violation drove 175 circular cycles in the 2026-04-25 audit.
- **Types crossing the schema/service boundary live in `shared/types/`.** If a type is used by both a schema file (as a JSONB column) and a service (as a return type), put it in `shared/types/` and have services re-export for backward compat.

---

## 4. LLM routing and canonical reads

- **All LLM calls go through `llmRouter`.** Never import provider adapters (`anthropicAdapter`, etc.) in production code, including `countTokens` (billable). Detection gate: `scripts/verify-no-direct-adapter-calls.sh`.
- **Reads from `canonical_*` tables go through `canonicalDataService`** — read-only, no writes, no side effects, no mutation-caching. Detection gate: `scripts/verify-canonical-read-interface.sh`.
- **Every `canonicalDataService` call passes a `PrincipalContext`.** Use `fromOrgId(orgId, subaccountId?)` for legacy call sites. Detection gate: `scripts/verify-principal-context-propagation.sh`.
- **`withPrincipalContext` only works inside an active `withOrgTx`.** Job handlers and other non-request contexts must construct a `PrincipalContext` via `fromOrgId` and pass it as the first parameter — never wrap with `withPrincipalContext`.

---

## 5. Gates are the source of truth

- **Blocking gates block merges — no exceptions.** No `--ignore` flags, no `# baseline-allow` on blocking gates, no deletion. Run all gates with `npm run test:gates`.
- **Historical baseline files need both conditions:** filename in the gate's `HISTORICAL_BASELINE_FILES` array AND a `-- @rls-baseline:` annotation in the file. One without the other still fails the gate.
- **Re-run gates before each new phase.** Gate state drifts in pre-production — reconcile live violations against the spec's planned scope, never apply a stale fix list.
- **Warning-level gates are observability signals, not blockers.** A point-specific `# baseline-allow` with an explanatory comment is the right way to acknowledge a reviewed pattern. Never use blanket suppression.

### Gate authoring rules

- **Self-test fixtures must not carry gate-recognised suppression annotations.** A fixture with `@null-safety-exempt` or `guard-ignore-next-line` proves only that the gate respects suppression — not that detection works. Remove all suppression annotations from deliberate-violation fixture files.
- **Scan-path override env vars must disable the matching path exclusions.** An override env var (e.g. `DERIVED_DATA_NULL_SAFETY_SCAN_DIR`) that points at a fixture directory is useless if the gate still applies `! -path "*/__tests__/*"`. Remove that exclusion when the override is set.
- **Grep-based gates must skip `import type` lines.** Type-only imports are erased at compile time and should not trigger import-presence gates. Pipe through `grep -v "import type"` before the pattern match, or document the limitation and require `guard-ignore-next-line` at affected call sites.
- **Advisory gate runners must use `|| true`.** Any script that captures advisory gate output via `OUTPUT="$(bash gate.sh 2>&1)"` under `set -euo pipefail` must append `|| true`: `OUTPUT="$(bash gate.sh 2>&1 || true)"`. Without it, promoting the gate from advisory to blocking will kill the runner before the count line is parsed.
- **Calibration constants must enumerate every exclusion.** When a gate subtracts a hard-coded constant from a raw count, each excluded occurrence must be listed as an inline comment with a unique grep pattern (one hit per exclusion). A bare magic number is unverifiable — the next author cannot tell whether it's still correct. `scripts/verify-skill-read-paths.sh` is the canonical example.
- **`actionType` regex must include dots.** The pattern `actionType: '[a-z_]+'` does not match dot-namespaced types (`crm.fire_automation`, `crm.query`, etc.). Use `[a-z_.]+` or document the exclusion explicitly.
- **Strip CRLF when parsing files on Windows.** Windows-authored files contain `\r\n`. Bash scripts that join or split lines must pipe through `tr -d '\r'`; JS parsers must `.replace(/\r/g, '')` before splitting on `\n`. The `guard-utils.sh` jq wrapper already does this — new scripts must replicate it.

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

- **Gates pass = done.** A green gate run is the definition of done for a phase.
- **New runtime tests are added only for pure functions** — functions that accept data and return data with no DB, network, or filesystem side effects.
- **Do not add** vitest/jest/playwright/supertest/E2E tests until `docs/spec-context.md` flips `testing_posture` (triggered by first live agency client onboarding).
- **`*Pure.test.ts` naming is enforced by `verify-pure-helper-convention.sh`.** Files matching that pattern must have zero transitive DB imports. If a test needs the DB, drop `Pure` from the filename — do not suppress the gate violation.
- **Run individual tests** with `npx tsx <path-to-test-file>` — `scripts/run-all-unit-tests.sh` ignores `--` filter args.
- **Spy on the logger object directly, not `process.env` or `console.*`.** `server/lib/logger.ts` resolves `LOG_LEVEL` to a `const` at import time, so patching env in `beforeEach` is a no-op — use `mock.method(logger, 'warn', () => {})` to intercept at the object level.

When `docs/spec-context.md` flips `testing_posture`, update §7 of this document to describe the new posture.

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

### 8.6 Rate limiter rollback

The DB-backed rate limiter ships with an env-flag rollback shim:
- `USE_DB_RATE_LIMITER=false` → reverts to in-memory behaviour without a code revert
- The shim has identical function signatures — no caller changes needed
- Flip the flag, restart workers, observe

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

---

## 9. Multi-tenant safety checklist (every new feature)

Before any PR that touches tenant data merges, answer YES to all five:

- [ ] **Org-scoped at the table level.** New table has `organisation_id NOT NULL`, `RLS_PROTECTED_TABLES` entry, and canonical org-isolation policy in the same migration.
- [ ] **Org-scoped at the query level.** Every read/write by ID also filters by `organisationId` explicitly.
- [ ] **Service-layer mediated.** No route or lib file imports `db` directly.
- [ ] **Subaccount-resolved.** Every route with `:subaccountId` calls `resolveSubaccount(...)` before using the ID.
- [ ] **Gates green.** All RLS gates plus the architectural-contract gates pass on the feature branch before review.
- [ ] **Background jobs follow the admin/org tx pattern.** Any new maintenance job that writes tenant rows mirrors `memoryDedupJob.ts` (admin connection for iteration, `withOrgTx` per tenant write).
- [ ] **Log-and-swallow services keep `getOrgScopedDb` inside `try`.** No resolution above the catch boundary.
- [ ] **Cross-entity ID verified.** Server-side handlers that take a parent ID in the URL and a client-supplied child ID in the body verify the child belongs to the parent before any write.

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
