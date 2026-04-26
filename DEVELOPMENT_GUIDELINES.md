# Development Guidelines

**Maintained by:** the operator, updated after major audits and architectural decisions.
**Last updated:** 2026-04-27 (gate authoring rules, manifest-migration consistency, logger test pattern)
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

### 1.1 The canonical org session variable

**`app.organisation_id` is the ONLY valid Postgres session variable for org scoping.** It is set by:
- `server/middleware/auth.ts` (HTTP request path)
- `server/lib/createWorker.ts` (background worker path)

`app.current_organisation_id` is a phantom — it is **never set anywhere** in the codebase. Any policy, query, or code that references it fails open (because `current_setting('app.current_organisation_id', true)` returns NULL, and `NULL = anything` is NULL, not false — Postgres RLS treats NULL as "exclude row" but application-level null comparisons silently pass). Never use this variable.

Detection gate: `scripts/verify-rls-session-var-canon.sh`

### 1.2 Every new tenant table ships with full RLS in the same migration

A migration that creates a table with tenant data must, **in the same migration file**, include:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS <table>_org_isolation ON <table>;

CREATE POLICY <table>_org_isolation ON <table>
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

Also add the table to `server/config/rlsProtectedTables.ts` in the same migration PR.

**Why both USING and WITH CHECK?** `USING` controls reads. `WITH CHECK` controls writes. Without `WITH CHECK`, an INSERT or UPDATE with no valid session var will succeed silently.

**Why FORCE ROW LEVEL SECURITY?** Without `FORCE`, table owners (the DB user running migrations) bypass RLS entirely. On a connection without an org session var, the table owner would see all rows across all tenants.

**Why IS NOT NULL + non-empty guards?** `current_setting('app.organisation_id', true)` returns NULL when unset (the `true` flag is "missing-OK"). Casting NULL::uuid returns NULL, and `organisation_id = NULL` evaluates to NULL (not false). The explicit guards avoid relying on NULL-comparison semantics — both reads and writes are unambiguously blocked when the session var is unset.

### 1.3 Defence-in-depth: always filter by organisationId in application code

**Never rely on RLS alone.** Every read and write that takes a row by ID must also filter by `organisationId` explicitly:

```ts
// Bad — relies on RLS alone
const row = await tx.select().from(items).where(eq(items.id, id));

// Good — defence-in-depth
const row = await tx.select().from(items)
  .where(and(eq(items.id, id), eq(items.organisationId, organisationId)));
```

This is not redundant. If RLS is ever silently disabled by a migration regression, the application-level filter still protects the caller.

Detection gate: `scripts/verify-org-scoped-writes.sh`

### 1.4 Subaccount resolution is mandatory before using a subaccount ID

Any route with a `:subaccountId` URL parameter must call `resolveSubaccount(req.params.subaccountId, req.orgId!)` before using the ID downstream. The function verifies that the subaccount belongs to the requesting org. Skipping it allows horizontal privilege escalation even with RLS in place — a request scoped to org A can reference subaccount IDs belonging to org B.

```ts
// Required at the top of every handler that consumes req.params.subaccountId
const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
// Pass subaccount.id downstream — never pass req.params.subaccountId directly
```

Detection gate: `scripts/verify-subaccount-resolution.sh`

### 1.5 Corrective migrations follow the 0213 precedent

When a table has broken or missing RLS and must be repaired:
1. **Never edit the historical migration.** Migrations are append-only.
2. Write a new migration with the next available number.
3. Use `DROP POLICY IF EXISTS <old_policy_name> ON <table>` for **every** historical policy name (the old policy may have been named `*_tenant_isolation`, `*_org_isolation`, `*_subaccount_isolation`, etc. — enumerate them all).
4. Follow with `CREATE POLICY <table>_org_isolation ON <table>` using the canonical shape above.
5. Reference: `migrations/0213_fix_cached_context_rls.sql` (the precedent), `migrations/0200_fix_universal_brief_rls.sql` (canonical policy shape source).

---

## 2. Service / Route / Lib tier boundaries

### 2.1 Routes never own DB access

`server/routes/**` calls `server/services/**`. Routes do not import `db` directly. This is enforced by `scripts/verify-rls-contract-compliance.sh`.

The only acceptable patterns are:
- Route handler calls `serviceMethod(req.orgId!, req.params.id, …)` — org-scoped service
- Route handler is a thin adapter with no DB logic

### 2.2 Lib files do not own DB access either

`server/lib/**` files are for pure helpers and small utilities. When a lib file starts importing `db`, it has outgrown the tier. Move the DB-touching code to a peer service in `server/services/**`; the pure helpers stay in lib.

### 2.3 New service files have a high bar

A new service file is justified only when:
- The route has **more than one DB interaction**, OR
- The logic is **reused by more than one caller**

If neither condition holds, the single DB call goes inline in the route (wrapped in `withOrgTx`) and no new service file is created. **Max one service per domain.** Two service files covering the same business domain in the same PR is a signal the split is wrong — merge them.

### 2.4 Three patterns for service-tier DB access

1. **Org-scoped service** — use `withOrgTx(organisationId, async (tx) => { … })` from `server/instrumentation.ts`. Every query inside runs with `app.organisation_id` set.
2. **Admin/system service** — use `withAdminConnection()` from `server/lib/adminDbConnection.ts`. Bypasses RLS by design. For routes with `requireSystemAdmin` middleware or system-scoped tables.
3. **Pure helper in lib** — no DB access at all. Accepts data, returns data. Testable without a DB mock.
4. **Background / maintenance jobs that write tenant data** — acquire an admin connection for top-level iteration, then call `withOrgTx(orgId)` per tenant inside the loop. Mirror `memoryDedupJob.ts`. A job that skips this pattern silently no-ops on every write because RLS sees no session var.
5. **Log-and-swallow services** (bookkeeping, audit inserts, best-effort mirrors — anything whose contract says "must not block execution") — `getOrgScopedDb()` must be the **first line inside** the `try` block, never above it. Placing it above the catch turns a missing-org-context throw into a hard failure that escapes the error boundary. When reviewing a diff that adds `getOrgScopedDb`, confirm every hit is inside a `try {`.

---

## 3. Schema layer rules

### 3.1 Schema files are leaves — no upward imports

`server/db/schema/**` files may only import from:
- `drizzle-orm` and `drizzle-orm/pg-core`
- `shared/types/**`
- Other `server/db/schema/**` files

They must never import from `server/services/**`, `server/lib/**`, `server/routes/**`, or `server/middleware/**`. A single schema file importing from services creates circular dependency cascades (one violation drove 175 cycles in the 2026-04-25 audit).

**The fix pattern:** extract the type to `shared/types/` → schema file imports from `shared/types/` → service re-exports from the new location for backward compatibility.

### 3.2 New types that cross the schema/service boundary go in `shared/types/`

If a type is used by both a schema file (as a JSONB column type) and a service (as a return type), it belongs in `shared/types/`, not in `server/services/`. Examples: `AgentRunCheckpoint`, `SerialisableMiddlewareContext`.

---

## 4. LLM routing

### 4.1 All LLM calls go through `llmRouter`

Never import symbols from `server/services/providers/anthropicAdapter.ts` (or any other adapter) in production code outside `llmRouter`. This includes `countTokens` — it is a billable API call, not a local utility.

Detection gate: `scripts/verify-no-direct-adapter-calls.sh`

### 4.2 Canonical-table reads go through `canonicalDataService`

Any SELECT against a `canonical_*` table must go through `canonicalDataService`, not a direct Drizzle query. The service handles cross-tenant isolation and principal-aware row scoping.

`canonicalDataService` is a **read-only abstraction layer** — it never writes, never triggers background work, never caches with mutation. Methods added to it must be read-only queries with no side effects.

Detection gate: `scripts/verify-canonical-read-interface.sh`

### 4.3 Principal context propagation

Every call to `canonicalDataService` must pass a `PrincipalContext`. Use `fromOrgId(organisationId, subaccountId?)` to synthesise one from a legacy org-scoped call signature during the migration window.

Detection gate: `scripts/verify-principal-context-propagation.sh`

---

## 5. Gates are the source of truth

### 5.1 Gates block merges — no exceptions

A failing blocking gate means the PR does not merge. Do not add `--ignore` flags, `# baseline-allow` suppressions on blocking gates, or delete the gate. If a blocking gate cannot pass for a legitimate reason, the spec documents the reason and updates the gate's baseline mechanism — not the gate's hard rule.

Run all gates:
```bash
npm run test:gates
```

### 5.2 Historical baseline files require two conditions

When a gate produces noise from historical migration files that were repaired by a later migration:
1. Add the filename to the gate's `HISTORICAL_BASELINE_FILES` array (hard-coded allowlist).
2. Add `-- @rls-baseline: phantom-var policy replaced at runtime by migration 0213_fix_cached_context_rls.sql` to the relevant line in the historical migration file.

Both conditions must be met. A file in the allowlist without the annotation, or an annotated file not in the allowlist, still emits a gate violation.

### 5.3 Re-run gates before starting each phase

Gate state drifts in pre-production codebases. Before starting a new phase of work, re-run the relevant gates and reconcile the live violation set against the spec's planned scope. Do not blindly apply a fix list that no longer reflects reality.

### 5.4 Warning-level gates are signals, not blockers

Gates that emit `WARNING` (not `BLOCKING FAIL`) are observability signals. A `# baseline-allow` directive at a specific match point with an explanatory comment is the correct way to acknowledge a reviewed, intentionally-permitted pattern. Never use blanket suppression.

### 5.5 Gate authoring rules

- **Self-test fixtures must not carry gate-recognised suppression annotations.** A fixture with `@null-safety-exempt` or `guard-ignore-next-line` proves only that the gate respects suppression — not that detection works. Remove all suppression annotations from deliberate-violation fixture files.
- **Scan-path override env vars must disable the matching path exclusions.** An override env var (e.g. `DERIVED_DATA_NULL_SAFETY_SCAN_DIR`) that points at a fixture directory is useless if the gate still applies `! -path "*/__tests__/*"`. Remove that exclusion when the override is set.
- **Grep-based gates must skip `import type` lines.** Type-only imports are erased at compile time and should not trigger import-presence gates. Pipe through `grep -v "import type"` before the pattern match, or document the limitation and require `guard-ignore-next-line` at affected call sites.
- **Advisory gate runners must use `|| true`.** Any script that captures advisory gate output via `OUTPUT="$(bash gate.sh 2>&1)"` under `set -euo pipefail` must append `|| true`: `OUTPUT="$(bash gate.sh 2>&1 || true)"`. Without it, promoting the gate from advisory to blocking will kill the runner before the count line is parsed.

## 6. Migration discipline

1. **Migrations are append-only.** Never edit a historical migration file after it has run.
2. **Migration numbers are assigned at merge time.** Use `<NNNN>_<name>.sql` as a placeholder during PR development; rename the file to claim the next available number immediately before merge (after rebasing onto latest `main`).
3. **System-scoped tables** (no `organisation_id`) must document in the migration header why they are not added to `RLS_PROTECTED_TABLES`. Every migration that creates a table must either add it to the registry with a full policy **or** include a `-- system-scoped: <reason>` header comment. Neither = gate failure, not just a review comment.
4. **Drizzle schema changes** that accompany a migration land in the same PR. The schema file and the migration are a unit.
5. **Corrective migrations** follow the §1.5 precedent: enumerate all historical policy names, DROP them, then CREATE with the canonical policy shape.
6. **`policyMigration` in `rlsProtectedTables.ts` must point at the migration that physically runs `CREATE POLICY ... ON <table>`.** If a corrective migration's header NOTE explicitly excludes a table, the manifest entry for that table must still reference the original policy migration, not the corrective one. Use `grep -rl "CREATE POLICY.*ON <table>" migrations/` to confirm the authoritative file when in doubt.

---

## 7. Testing posture (pre-production phase)

The current posture is `static_gates_primary` per `docs/spec-context.md`. This means:

- **Gates pass = done.** A green gate run is the definition of done for a phase.
- **New runtime tests are added only for pure functions** — functions that accept data and return data with no DB, network, or filesystem side effects.
- **Do not add** vitest/jest/playwright/supertest/E2E tests until `docs/spec-context.md` flips `testing_posture` (triggered by first live agency client onboarding).
- **Run individual tests** with `npx tsx <path-to-test-file>` — `scripts/run-all-unit-tests.sh` ignores `--` filter args.
- **Spy on the logger object directly, not on `process.env` or `console.*`.** `server/lib/logger.ts` captures `LOG_LEVEL` into a `const` at import time. Patching `process.env.LOG_LEVEL` in `beforeEach` is a no-op — the constant is already resolved. Use `mock.method(logger, 'warn', () => {})` / `mock.method(logger, 'debug', () => {})` to intercept at the object level. Without this, DEBUG-path tests silently false-PASS because the level filter drops the call before any spy can see it.

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

Any spec that introduces or modifies a state machine (step transitions, run aggregation, approval boundaries, resume paths, job status) MUST include a dedicated State/Lifecycle section that pins:

1. **Valid transitions** — which transitions are legal, which are forbidden.
2. **Execution record requirement** — what DB record must exist before a terminal state is written.
3. **Concurrency guard on terminal-state writes** — the predicate that prevents two callers from simultaneously writing the same terminal state (e.g. `UPDATE ... WHERE status = 'review_required'`).
4. **Status set closure** — whether adding a new status value requires a spec amendment. Closed status sets prevent silent drift between spec and implementation.

This section is not optional even when "the state machine is simple." Simple state machines grow. A spec that doesn't pin the invariants before code ships produces correctness bugs that are invisible until concurrent load hits the seam.

Detection: if a spec contains words like "state", "transition", "status", "approved", "completed", "failed", "resume", or "cancel" without a dedicated State/Lifecycle section, add one before sending to review.

### 8.8 Cross-spec consistency sweep is mandatory before freeze for multi-chunk work

Any implementation that ships as multiple chunks, phases, or parallel PRs requires a cross-spec consistency pass before the freeze gate. Individual per-spec review cannot catch cross-chunk drift — the consistency sweep must read all specs simultaneously and check:

- (a) Identifier naming is consistent across all specs (SQL snake_case ↔ TS camelCase is a convention, not drift; everything else must match exactly).
- (b) Shared contracts are identical across every consumer — if two specs both reference the same primitive, they must describe it the same way.
- (c) No primitive is introduced in two places — single-owner rule for each new helper, service, or method.
- (d) No assumption in one spec contradicts an assumption in another — especially around ownership of cross-cutting decisions.

For the pre-launch hardening sprint, the consistency sweep caught C4a-6-RETSHAPE unowned-decision drift that five individual per-spec reviews had missed. The sweep catches what individual review cannot.

### 8.9 One PR per feature branch; one PR per sprint

For multi-chunk or multi-phase work, the correct PR topology is:

- One integration branch for all chunks/phases.
- One PR from the integration branch to main.
- Per-chunk branches are valid as authoring vehicles but PR into the integration branch, not directly to main.
- Or (preferred for spec-only work): author everything on the integration branch directly and open one PR.

Six-PR / one-PR-per-chunk approaches introduce unnecessary integration points, produce redundant closed-PR artefacts as "historical record", and force a consolidation step that pure integration-branch discipline avoids entirely.

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

---

## 10. When this document should be updated

- A new architectural primitive becomes canonical → add it to §4 or §8.4.
- `docs/spec-context.md` flips `testing_posture` → update §7.
- `docs/spec-context.md` flips `live_users: yes` → update §8.5 (feature freeze no longer applies; rollout model changes).
- A new gate is introduced → add its detection reference to the relevant section.
- A pattern from `KNOWLEDGE.md` reaches "stable, enforce everywhere" status → migrate it here.

---

*Derived from the 2026-04-25 full-codebase audit (47 findings + 16 ground-truth gate corrections) and the corresponding remediation spec (`docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`). The spec is the authoritative source for the remediation work; this document is the distilled, forward-looking summary.*
