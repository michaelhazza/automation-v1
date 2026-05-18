# Tier Categorisation Framework — wave-6-rls-residue-and-gate-fix

**Chunk:** 0 (design/audit — no code changes)
**Spec reference:** §8
**Purpose:** Defines the schema and rules for `tier-categorisation.md`, produced in Chunk 1'. Every residue callsite from the honest (Linux CI) gate output must have exactly one row using the fields and rules below.

## Sections

- [1. Mandatory Fields](#1-mandatory-fields)
- [2. Tier Partition Rules](#2-tier-partition-rules)
- [3. Dual-GUC Sub-Decision](#3-dual-guc-sub-decision)
- [4. File Structure](#4-tier-categorizationmd-file-structure)
- [5. Domain Grouping Rules](#5-domain-grouping-rules)
- [6. Expected Distribution](#6-expected-distribution)

---

## 1. Mandatory Fields (per §8)

Every row in `tier-categorisation.md` must use these exact column names:

| Column | Description | Example |
|--------|-------------|---------|
| `file:line` | Absolute position in the repo | `server/services/agentExecutionService.ts:42` |
| `Call expression` | The exact call from source | `db.select().from(tasks)` |
| `Target table` | Drizzle table being accessed | `tasks` |
| `In RLS_PROTECTED_TABLES?` | Presence in `server/config/rlsProtectedTables.ts` | `yes` / `no` / `deferred` |
| `Tenant key` | Column for tenant isolation | `organisationId` |
| `Tier verdict` | One of the five tiers in §2 | `Tier 1` |
| `Upstream entrypoint (Tier 1 only)` | HTTP route or pg-boss worker at top of call chain | `POST /api/agents/:id/run` |
| `Bypass rationale + ADR (Tier 2 only)` | Why cross-tenant/admin access is needed | `System cron job — no orgId available; ADR-0041` |
| `Required new entrypoint (Tier 1-blocked only)` | Entrypoint needed to resolve the block | `pg-boss worker for queue agent-cleanup` |

Columns that do not apply to a given tier must be populated with `n/a`. Do not leave them blank.

---

## 2. Tier Partition Rules

### Tier 0 — Pure helper (no migration needed)

The function containing the `db.*` call is in a `*Pure.ts` or `*pure.ts` file. These are convention-pure helpers; the analyser flags them because it cannot statically prove they are unreachable, but they are not executed directly by any route or job.

**Action:** No migration needed. Annotate with:
```ts
// Tier 0: pure helper — db call is unreachable in production via route/job
```

### Tier 1 — Reachable from HTTP route or pg-boss worker (migrate)

The callsite is reachable from either an HTTP route calling `authenticate()` or a pg-boss worker registered via `createWorker()`. The caller chain can be traced within 5 hops.

**Action:** Convert `db.*` to `getOrgScopedDb('serviceName.functionName')` per spec §7.1. Predicate retention is mandatory.

**Upstream entrypoint column:** the HTTP route path or the pg-boss queue name.

### Tier 1-blocked — Entrypoint cannot be named within 5 hops

Should be Tier 1 but the upstream entrypoint cannot be traced within 5 hops due to deep call chains, event emitters, `setImmediate`, or dynamic dispatch.

**Action:** Route to the `## Blocked verdicts requiring operator review` appendix. Chunk 13 resolves.

**Required new entrypoint column:** Describe what entrypoint would need to exist (e.g., "expose via pg-boss worker for queue X").

### Tier 2 — Legitimately needs cross-tenant or admin access (guard or annotate)

Callsite legitimately needs access beyond a single-org scoped DB connection (system cron jobs, admin reporting, maintenance jobs, migration backfills).

**Action — two valid forms:**

1. Convert to `withAdminConnection({ source: 'serviceName.functionName', reason: '<one-line>' }, async tx => { ... })` per spec §7.2, OR
2. Retain `db.*` with one of the three Wave-5 guard-ignore forms plus a WHY comment and ADR reference:
   - `// guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>`
   - `// guard-ignore: with-org-tx-or-scoped-db reason="<rationale up to 120 chars>"`
   - `// guard-ignore-next-line: with-org-tx-or-scoped-db reason="<rationale>"`

**Bypass rationale + ADR column:** Required. Must include ADR reference or clear operational reason.

### Tier 3 — Migration, seed, or CI helper (no migration needed)

The callsite is inside a migration file, seed script, or CI/gate helper. These paths are intentionally privileged.

**Action:** No migration needed. Annotate with:
```ts
// Tier 3: migration/seed/CI path — direct db access is intentional
```

---

## 3. Dual-GUC Sub-Decision (per §7.1.1)

When migrating a Tier 1 callsite, check whether the callsite is reachable from a route that also sets `app.subaccount_id`. If yes, use `getOrgScopedDb()` with `{ includeSubaccount: true }`. If only `app.organisation_id` is set (org-only routes and all job workers), the standard single-GUC form suffices. The tier verdict stays `Tier 1` in either case. Record in the upstream entrypoint column as a parenthetical: `POST /api/subaccounts/:id/contacts (dual-GUC)`.

---

## 4. `tier-categorisation.md` File Structure

```
# Tier Categorisation — wave-6-rls-residue-and-gate-fix

**Total residue callsites:** <N from honest gate output>
**Chunk 1' date:** <YYYY-MM-DD>

## agent-execution residue (N rows: N1 Tier 1, N2 Tier 2, N3 Tier 3, N4 Tier 0, N5 blocked)

| file:line | Call expression | Target table | In RLS_PROTECTED_TABLES? | Tenant key | Tier verdict | Upstream entrypoint (Tier 1 only) | Bypass rationale + ADR (Tier 2 only) | Required new entrypoint (Tier 1-blocked only) |
|-----------|----------------|-------------|--------------------------|-----------|-------------|-----------------------------------|--------------------------------------|-----------------------------------------------|

## skill-execution residue (N rows: ...)
## workflow residue (N rows: ...)
## billing residue (N rows: ...)
## personal-assistant residue (N rows: ...)
## sandbox residue (N rows: ...)
## integration-services residue (N rows: ...)
## jobs residue (N rows: ...)
## lib residue (N rows: ...)
## adapters residue (N rows: ...)

---

## Blocked verdicts requiring operator review

One entry per Tier 1-blocked callsite:

### <file:line>

- **Call expression:** `db.select().from(X)`
- **Target table:** X
- **Block reason:** <why the entrypoint cannot be named within 5 hops>
- **Attempted trace:** <function names in the partial trace>
- **Required new entrypoint:** <what would need to be created>
- **Suggested Chunk 13 action:** <refactor recommendation>

---

## Grand Total

| Tier | Count |
|------|-------|
| Tier 0 (pure helper) | N |
| Tier 1 (migrate to getOrgScopedDb) | N |
| Tier 1-blocked (operator review) | N |
| Tier 2 (admin/cross-tenant) | N |
| Tier 3 (migration/seed/CI) | N |
| **Total** | **N** |
```

---

## 5. Domain Grouping Rules

Assign each callsite to a domain section based on file path:

| Domain section | File path prefix(es) |
|----------------|---------------------|
| `agent-execution residue` | `server/services/agentExecution*`, `server/services/agentRun*`, `server/services/agentSchedule*`, `server/services/agentDelegation*` |
| `skill-execution residue` | `server/services/skillExecution*`, `server/services/skillAnalyzer*`, `server/services/skillRegistry*` |
| `workflow residue` | `server/services/workflow*`, `server/services/playbook*`, `server/jobs/workflow*` |
| `billing residue` | `server/services/billing*`, `server/services/subscription*`, `server/services/usage*` |
| `personal-assistant residue` | `server/services/personalAssistant*`, `server/services/thread*` |
| `sandbox residue` | `server/services/sandbox*`, `server/services/iee*`, `server/adapters/sandbox*` |
| `integration-services residue` | `server/services/connector*`, `server/services/integration*`, `server/services/crm*` |
| `jobs residue` | `server/jobs/**` (excluding workflow jobs) |
| `lib residue` | `server/lib/**` |
| `adapters residue` | `server/adapters/**` (excluding sandbox adapters) |

If a file does not match any prefix, assign to the closest domain by directory. Do not create new sections without operator approval.

---

## 6. Expected Distribution (from spec §4)

| Tier | Expected count |
|------|---------------|
| Tier 1 | 700-900 |
| Tier 2 | 100-200 |
| Tier 3 | 50-150 |
| Tier 0 | 10-50 |
| Tier 1-blocked | 10-50 |
| **Total** | **approx. honest gate count from Chunk 1** |

The exact gate count from Chunk 1 (post-fix) is the ground truth. These ranges are from spec §4 based on Wave 5 codebase state. If the actual distribution differs materially (e.g., Tier 2 exceeds 250), surface it to the operator before proceeding to migration chunks.
