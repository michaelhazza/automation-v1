# Pre-Production Tenancy Hardening — Dev Spec

**Status:** Draft 2026-04-29
**Branch:** `pre-prod-tenancy`
**Class:** Major (architect first; full review pipeline)
**Slug:** `pre-prod-tenancy`
**Source brief:** [`tasks/builds/pre-prod-tenancy/brief.md`](../../../tasks/builds/pre-prod-tenancy/brief.md)
**Migration range:** `0244–0255` (the brief reserved `0241–0252`, but `main` already has 0241/0242/0243; the next twelve numbers are reserved here for this branch only)
**Sister branches (do not edit their files):** `pre-prod-boundary-and-brief-api`, `pre-prod-workflow-and-delegation`

---

## Table of contents

- §0 — Framing & scope contract
- §1 — Verification log (what was already shipped on `main`)
- §2 — Files to change (single source of truth)
- §3 — Phase 1 — RLS protected-tables registry triage (`SC-2026-04-26-1`)
- §4 — Phase 2 — `intervention_outcomes` unique constraint + `ON CONFLICT` (`CHATGPT-PR203-R2`)
- §5 — Phase 3 — Maintenance-job per-org `withOrgTx` defense-in-depth (`B10`, optional)
- §6 — Migration sequence
- §7 — Test matrix
- §8 — Rollout ordering
- §9 — Deferred Items
- §10 — Execution-safety contracts (Section 10 of the spec-authoring checklist)
- §11 — Pre-review self-consistency checklist

---

## §0 — Framing & scope contract

### §0.1 Product framing (per `docs/spec-context.md`)

- `pre_production: yes` — no live agencies, no live users.
- `stage: rapid_evolution`, `feature_stability: low`, `breaking_changes_expected: yes`.
- `testing_posture: static_gates_primary`. `runtime_tests: pure_function_only`. No new vitest / jest / playwright / supertest.
- `rollout_model: commit_and_revert`. No feature flags. No staged rollout.
- `prefer_existing_primitives_over_new_ones: yes`.

### §0.2 What this spec does

Close every multi-tenant data-isolation gap that is **still open at branch tip on `main` as of 2026-04-29** in the pre-prod-tenancy stream, drawn from the source brief and verified against current code. Three phases:

1. **Phase 1 — RLS protected-tables registry triage** (`SC-2026-04-26-1`). Drive `scripts/verify-rls-protected-tables.sh` to a CI-passing state (exit 0). Register the 61 currently-unregistered tenant tables (per §3.2 / §3.4.1 — that section is the source of truth for the count) or allow-list them with rationale, remove the 4 stale entries (§3.4.2), and resolve the 2 caller-level violations on `systemMonitor` files (§3.4.3). Where a tenant table is registered without a matching `CREATE POLICY` block, ship the missing policy migration.
2. **Phase 2 — `intervention_outcomes` unique constraint + `ON CONFLICT DO NOTHING`** (`CHATGPT-PR203-R2`). Introduce the unique constraint that the brief specifies, replace the per-row `db.transaction` + advisory-lock pattern in `measureInterventionOutcomeJob.ts` with `INSERT ... ON CONFLICT (intervention_id) DO NOTHING`, and capture a load-test number.
3. **Phase 3 — Maintenance-job per-org `withOrgTx` defense-in-depth** (`B10`, optional). The three maintenance jobs (`ruleAutoDeprecateJob`, `fastPathDecisionsPruneJob`, `fastPathRecalibrateJob`) already run successfully under `withAdminConnection` + per-org savepoint and are no longer silent no-ops. The remaining gap is a defense-in-depth upgrade — drop into `withOrgTx({ organisationId })` per org so RLS is engaged for the per-org work rather than running everything under `admin_role`. Conditional: ship only if Phase 1+2 finish with budget.

### §0.3 What this spec does NOT do

The original brief listed these items but verification (§1) confirmed they are all closed on `main`:

- `P3-C1`, `P3-C2`, `P3-C3`, `P3-C4`, `P3-C5`, `GATES-2026-04-26-1` — DB-layer RLS hardening (closed by `migrations/0227`, `0228`, `0229`).
- `P3-C6`, `P3-C7`, `P3-C8`, `P3-C9` — Route → service refactors with `resolveSubaccount` (closed in-tree).
- `P3-C10`, `P3-C11` — Service org-filter additions (closed in-tree).
- `P3-H2`, `P3-H3` — `briefVisibility.ts` / `onboardingStateHelpers.ts` lib re-exports (closed in-tree).

These items are NOT re-asserted in any acceptance criteria here. Re-running verification on `main` to confirm they remain closed is part of §8 rollout ordering.

### §0.4 Scope-out (sister branches)

This branch must not touch:

- **`pre-prod-boundary-and-brief-api`** — `server/routes/sessionMessage.ts`, `server/routes/briefs.ts`, `server/services/scopeResolutionService.ts`, `server/services/briefCreationService.ts`, `server/index.ts`, `server/middleware/*`, auth routes, rate-limiting, webhook hardening.
- **`pre-prod-workflow-and-delegation`** — `server/services/workflowEngineService.ts`, `server/services/workflowRunService.ts`, `server/services/invokeAutomationStepService.ts`, `server/services/agentExecutionService.ts`, `server/services/agentScheduleService.ts`, `server/db/schema/agentRuns.ts`.

If a registry-triage classification (§3) lands a table whose owning migration belongs to one of the above areas, the table is registered/allow-listed *only*; no source files in those scoped-out paths are edited.

---

## §1 — Verification log (what was already shipped on `main`)

This is a Section-0 verification pass per the spec-authoring checklist. Every item the source brief named was checked against current code on `main` (commit `b150d759`-equivalent). The closed items below are NOT in scope — they are listed only to document why the spec dropped them.

| Brief item | Status | Closed by |
|---|---|---|
| `P3-C5` — replace phantom `app.current_organisation_id` in 0205–0208 | **closed** | DB state repaired at runtime by `migrations/0213_fix_cached_context_rls.sql`; idempotent audit-trail re-sweep in `migrations/0228_phantom_var_sweep.sql`. Historical 0205–0208 files deliberately not edited per the repo's append-only convention. |
| `P3-C1` — `memory_review_queue` ENABLE+FORCE+policy | **closed** | `migrations/0227_rls_hardening_corrective.sql:22-39` |
| `P3-C2` — `drop_zone_upload_audit` FORCE RLS | **closed** | `migrations/0227_rls_hardening_corrective.sql:41-59` |
| `P3-C3` — `onboarding_bundle_configs` FORCE RLS | **closed** | `migrations/0227_rls_hardening_corrective.sql:61-79` |
| `P3-C4` — `trust_calibration_state` FORCE RLS | **closed** | `migrations/0227_rls_hardening_corrective.sql:81-99` |
| `GATES-2026-04-26-1` — `reference_documents` + `reference_document_versions` FORCE RLS w/ parent-EXISTS | **closed** | `migrations/0229_reference_documents_force_rls_parent_exists.sql`; baseline allowlist at `scripts/verify-rls-coverage.sh:56-63` no longer lists 0202/0203. |
| `P3-C6` — `memoryReviewQueue` route → service | **closed** | `server/routes/memoryReviewQueue.ts` imports `memoryReviewQueueService` + `resolveSubaccount`; no `db` imports. |
| `P3-C7` — `systemAutomations` route → service | **closed** | `server/routes/systemAutomations.ts` imports only `systemAutomationService`; no `db` imports. |
| `P3-C8` — `subaccountAgents` route → service | **closed** | `server/routes/subaccountAgents.ts` uses `subaccountAgentService` / `agentBeliefService` / `agentScheduleService` / `agentExecutionService`; carries 9 `resolveSubaccount(req.params.subaccountId, req.orgId!)` call sites. |
| `P3-C9` — `clarifications` route + `resolveSubaccount` | **closed** | `server/routes/clarifications.ts` imports `clarificationService` + calls `resolveSubaccount`. |
| `P3-C10` — `documentBundleService:679,685` org filter | **closed** | `server/services/documentBundleService.ts` `verifySubjectExists` uses `getOrgScopedDb(...)` and applies `eq(table.organisationId, organisationId)` on every branch (agent / task / scheduled_task). |
| `P3-C11` — `skillStudioService:168,309` org filter | **closed** | `server/services/skillStudioService.ts:168, 309, 318` carry the org filter; both `getSkillStudioContext` and `saveSkillVersion` throw when `orgId` is missing for non-system scopes. (Originally resolved 2026-04-25; re-verified 2026-04-29.) |
| `P3-H2` — `briefVisibility.ts` → service | **closed** | `server/lib/briefVisibility.ts` is a thin re-export from `briefVisibilityService`. |
| `P3-H3` — `onboardingStateHelpers.ts` → service | **closed** | `server/lib/workflow/onboardingStateHelpers.ts` is a thin re-export from `onboardingStateService`. |
| `B10` — maintenance jobs `withAdminConnection` + per-org tx | **partial** | All three jobs use `withAdminConnection({ source })` + `SET LOCAL ROLE admin_role` + per-org savepoint via `tx.transaction(...)`. They run in production. Remaining gap: per-org work runs under `admin_role` (RLS bypassed) rather than dropping into a per-org `withOrgTx({ organisationId })`. Routed to **Phase 3** (this spec, optional). |
| `SC-2026-04-26-1` — RLS registry triage | **open** | `scripts/verify-rls-protected-tables.sh` exits 1 with **67 violations** (61 unregistered tenant tables + 4 stale registry entries + 2 caller-level `allowRlsBypass`-justification-comment violations on `server/services/systemMonitor/{baselines/refreshJob.ts:39, triage/loadCandidates.ts:45}`). Routed to **Phase 1**. |
| `CHATGPT-PR203-R2` — `intervention_outcomes` unique + ON CONFLICT | **open** | `server/db/schema/interventionOutcomes.ts:35` is `index(...)` not `uniqueIndex(...)`. `server/jobs/measureInterventionOutcomeJob.ts:254` still uses per-row `db.transaction` + advisory lock. Routed to **Phase 2**. |

### §1.1 Closure update applied to `tasks/todo.md`

Every closed item in the table above was marked `[x]` in `tasks/todo.md` with a closure note citing the closing migration / file evidence. Future readers should not re-litigate those items.

---

## §2 — Files to change (single source of truth)

This is the file inventory lock per the spec-authoring checklist §2. Every file listed below appears in exactly one phase. A new prose reference to a file or migration in §3–§5 cascades into this table in the same edit.

### §2.1 New migrations (range `0244–0255` reserved for this branch)

| Number | Path | Purpose | Phase |
|---|---|---|---|
| `0244` | `migrations/0244_intervention_outcomes_unique.sql` | `CREATE UNIQUE INDEX intervention_outcomes_intervention_unique ON intervention_outcomes(intervention_id)`. Replaces the existing non-unique `intervention_outcomes_intervention_idx`. Includes the `down` companion that recreates the non-unique index. | Phase 2 |
| `0244.down` | `migrations/0244_intervention_outcomes_unique.down.sql` | Reverse: drop the unique index, recreate the non-unique index on `intervention_id`. | Phase 2 |
| `0245+` | `migrations/0245_<batch>_rls.sql` ... | Policy migrations for tenant-scoped tables that the registry triage finds are **registered (or being newly registered) but missing a `CREATE POLICY` block**. Batching rule: one migration file per policy-shape batch — up to 4 canonical-org-isolation tables per file; tables that need parent-EXISTS or any other custom shape each get their own standalone file. The exact file count is bounded by classification output (§3.4). Maximum 11 new files (0245–0255) given the 12-number reservation. | Phase 1 |

**Migration shape for new policy files (canonical org-isolation):**

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

**Migration shape for parent-EXISTS variants (no `organisation_id` column on the child table — scoped via parent FK):**

Use the shape established by `migrations/0229_reference_documents_force_rls_parent_exists.sql` lines 49–67 (parent-EXISTS in both `USING` and `WITH CHECK`). The classification output (§3.4) names the parent table and FK column for each parent-EXISTS table.

### §2.2 Source files modified

| Path | Change | Phase |
|---|---|---|
| `server/config/rlsProtectedTables.ts` | Append entries for newly-registered tenant tables; remove the 4 stale entries (`document_bundle_members`, `reference_document_versions`, `task_activities`, `task_deliverables`). Each new entry follows the existing `{ tableName, schemaFile, policyMigration, rationale }` shape. | Phase 1 |
| `scripts/rls-not-applicable-allowlist.txt` | Append entries for tables classified as system-wide / cross-tenant / audit-only. Each entry obeys the 4-rule format already documented in the file header (one-sentence rationale, `[ref: ...]` citation, function-level `@rls-allowlist-bypass` annotation at every caller). | Phase 1 |
| `server/services/systemMonitor/baselines/refreshJob.ts` | Move the existing `// allowRlsBypass: cross-tenant aggregate reads against agent_runs / agents.` comment to within +/-1 line of the `allowRlsBypass: true` flag (currently line 39). See §3.4.3. | Phase 1 |
| `server/services/systemMonitor/triage/loadCandidates.ts` | Add an inline `// allowRlsBypass: <one-sentence justification naming the cross-org operation>` comment within +/-1 line of the `allowRlsBypass: true` flag at line 45. See §3.4.3. | Phase 1 |
| `server/db/schema/interventionOutcomes.ts` | Replace `interventionIdx: index('intervention_outcomes_intervention_idx').on(table.interventionId)` (line 35) with `interventionUnique: uniqueIndex('intervention_outcomes_intervention_unique').on(table.interventionId)`. Drizzle import already includes `uniqueIndex`. | Phase 2 |
| `server/services/interventionService.ts` | Change `recordOutcome` signature from `Promise<void>` to `Promise<boolean>` (returns `true` iff a new row was inserted, `false` on the `ON CONFLICT` no-op path). Replace the existing `db.insert(...).values(...)` call with `.onConflictDoNothing({ target: interventionOutcomes.interventionId })` and return `(result.rowCount ?? 0) > 0`. See §4.3 for the full new signature; §4.4 for the caller contract. | Phase 2 |
| `server/jobs/measureInterventionOutcomeJob.ts` | Replace the per-row `db.transaction(...)` + advisory-lock + claim-verify block (currently lines 254–267) with a single `INSERT ... ON CONFLICT (intervention_id) DO NOTHING` returning a boolean for "row inserted vs. skipped". Drop the per-org `pg_advisory_xact_lock` call. | Phase 2 |
| `server/jobs/ruleAutoDeprecateJob.ts` | (Phase 3) Replace the per-org savepoint `tx.transaction(async (subTx) => applyDecayForOrg(subTx, org.id))` with: enumerate orgs under `withAdminConnection`, then for each org open a fresh `withOrgTx({ organisationId: org.id, source: 'rule-auto-deprecate' })` and call the per-org function. Outer admin tx then becomes enumerator-only. | Phase 3 |
| `server/jobs/fastPathDecisionsPruneJob.ts` | (Phase 3) Same pattern. | Phase 3 |
| `server/jobs/fastPathRecalibrateJob.ts` | (Phase 3) Same pattern. | Phase 3 |

### §2.3 Source files added

| Path | Purpose | Phase |
|---|---|---|
| (none) | All work is migration-only or in-place edits. No new TS files required. | — |

### §2.4 Tests added (per `runtime_tests: pure_function_only`)

| Path | Phase | Notes |
|---|---|---|
| `server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts` (extend if already exists) | Phase 2 | Pure-only assertions: the decision-classifier returns the same `recordOutcome` args before and after the refactor; no DB. The DB-side ON CONFLICT semantics are verified by the schema gate plus the existing `rls.context-propagation.test.ts` integration harness, not a new test. |
| `scripts/__tests__/rls-protected-tables/run-fixture-self-test.sh` (new, optional) | Phase 1 | Mirror of `scripts/__tests__/derived-data-null-safety/run-fixture-self-test.sh` (the H1 pattern from the prior sprint). Drops a fixture migration with `organisation_id` into a temp dir, runs the gate against the fixture dir, asserts at least one violation lands. Only added if Phase 1 introduces a `--fixture-path` argument to the gate; otherwise deferred. |

### §2.5 Gate-harness wiring

| Path | Change | Phase |
|---|---|---|
| `scripts/run-all-gates.sh` | Add `run_gate "$SCRIPT_DIR/verify-rls-protected-tables.sh"` to the gate list. Currently the gate is callable but not registered in the harness, so its exit-0 condition is not enforced anywhere except CI manual invocation. Insertion goes after the existing `verify-rls-*` block (lines 74–76). | Phase 1 (last step) |

### §2.6 Build artefacts (committed in this branch but outside `server/` / `client/`)

| Path | Change | Phase |
|---|---|---|
| `tasks/builds/pre-prod-tenancy/progress.md` | Phase 1 implementer commits the filled §3.4.1 classification table here (one verdict per row) before any policy-migration commits. Phase 2 implementer appends the load-test result here (≥5× speedup vs. legacy or recorded blocker) per §4.7. | Phase 1 + Phase 2 |
| `tasks/todo.md` | Append entries under the existing `## Deferred from pre-prod-tenancy spec` heading for any Phase-3 deferral, sister-branch-deferred policy migrations, load-test absolute-figure deferral, and gate-self-test fixture deferral (see §9). | Phase 1 + Phase 2 + Phase 3 |

---

## §3 — Phase 1 — RLS protected-tables registry triage (`SC-2026-04-26-1`)

### §3.1 Goal

Drive `scripts/verify-rls-protected-tables.sh` to a CI-passing state (exit 0) on the post-merge `pre-prod-tenancy` head. Wire the gate into `scripts/run-all-gates.sh` so the CI harness fails on any future regression. Gates are CI-only per CLAUDE.md — no part of this phase asks an implementer to run them locally; the acceptance criteria below are CI invariants.

### §3.2 Inputs (current state at branch creation)

`scripts/verify-rls-protected-tables.sh` exits 1 with **67 violations**:

- **61 unregistered tenant tables** — the migration walker found `organisation_id` columns in `CREATE TABLE` bodies, but neither `server/config/rlsProtectedTables.ts` nor `scripts/rls-not-applicable-allowlist.txt` mentions the table.
- **4 stale registry entries** — listed in the manifest but the migration walker found no matching `CREATE TABLE ... organisation_id` (these are parent-FK-scoped and do not carry a direct `organisation_id` column): `document_bundle_members`, `reference_document_versions`, `task_activities`, `task_deliverables`.
- **2 caller-level violations** — `server/services/systemMonitor/baselines/refreshJob.ts:39` and `server/services/systemMonitor/triage/loadCandidates.ts:45` use `allowRlsBypass: true` without a justification comment within +/-1 line of the flag (the existing comment in `refreshJob.ts` is on line 37, two lines above the flag; the gate's heuristic enforces +/-1).

The brief's "60 unregistered + 4 stale = 64" figure has drifted to **61 unregistered + 4 stale + 2 caller-level = 67** because additional tenant tables and `allowRlsBypass` flags landed on `main` between the brief authoring and branch creation. The **classification tables in §3.4 are the source of truth** — not the brief's count.

### §3.3 Per-table classification rules

For each unregistered table, run this decision tree:

1. **Find the owning migration**: `grep -lE "CREATE TABLE[[:space:]]+\"?<table>\"?" migrations/*.sql`. There should be exactly one matching migration (the table-creation file) plus possibly later ALTER files. The owning migration is the table-creation one.
2. **Check whether the owning migration carries a `CREATE POLICY` block on the table**: `grep -nE "CREATE POLICY .* ON \"?<table>\"?" migrations/*.sql`.
3. Apply this classification rule:

   | Has `CREATE POLICY`? | Genuinely tenant-private? | Action |
   |---|---|---|
   | Yes | (assumed, since policy exists) | **Register** in `server/config/rlsProtectedTables.ts` with `policyMigration` set to the migration that carries the policy. No new policy migration. |
   | No | Yes | **Register + ship policy** — write a new policy migration in the `0245+` range (see §2.1 for migration shape), append a manifest entry pointing at the new migration. |
   | No | No (system-wide / audit-ledger / read replica / cross-tenant lookup) | **Allow-list** in `scripts/rls-not-applicable-allowlist.txt` with a one-sentence rationale citing an invariant ID, spec section, or migration filename per the format rules in the file header. Add the function-level `@rls-allowlist-bypass: <table> <fn-name> [ref: ...]` annotation at every caller of the table. |

4. **For the 4 stale entries** — confirm the table has no direct `organisation_id` column (`grep -nE "organisation_id" server/db/schema/<schema-file>.ts`). For each:
   - If the table is parent-FK-scoped (e.g. `document_bundle_members.bundle_id` → `document_bundles.organisation_id`) and the parent is RLS-policied with the canonical org-isolation shape, the child's effective scoping is correct. Drop the registry entry. (The current parent-EXISTS pattern from `migrations/0229` is the precedent — but `0229` only added `reference_document_versions`'s policy at the DB layer; the manifest already drops these as stale because the schema-walker can't see them.)
   - If parent FK does NOT propagate org scope (very unusual), promote the child to a parent-EXISTS RLS policy in the `0245+` range, then *update* the registry entry rather than dropping it.

### §3.4 Classification table (the 67 currently-failing tables)

The table below is the **deliverable** of Phase 1 — it must be present in the spec's progress log (`tasks/builds/pre-prod-tenancy/progress.md`) before any policy migrations are written. Each row carries the verdict from §3.3.

**At spec-authoring time the verdicts are not yet filled in.** The Phase 1 implementer fills the verdict column by walking the per-table classification rules in §3.3 against each row. The table below lists the 67 tables in the order the gate emitted them so the implementer can grep against the gate output.

#### §3.4.1 Unregistered tenant tables (61)

> **Authoring posture.** This subsection lists the 61 tables the gate emits at branch tip. Per §3.4 framing, the verdict column is INTENTIONALLY EMPTY at spec-authoring time — Phase 1's first deliverable is for the implementer to fill it in `tasks/builds/pre-prod-tenancy/progress.md` (a copy of this table with verdicts) per the §3.3 decision tree, before any policy migrations are written. The spec captures the *shape* of the deliverable, not the verdicts themselves; pre-classifying 61 tables here would do the implementation work in the spec.
>
> **Implementer's task per row:** fill `Owning migration`, `Has policy?`, `Verdict` (`register` / `register-with-new-policy` / `allowlist`), and `Notes` (parent table + FK if parent-EXISTS; rationale citation if allowlist).
>
> Some rows may already be policied via a later migration that the gate missed (the gate is a registry/allow-list diff, not a policy diff); the classification output must reconcile each one against the migration history.

| Table | Owning migration | Has policy? | Verdict | Notes |
|---|---|---|---|---|
| `account_overrides` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `action_events` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `action_resume_events` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `agent_conversations` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `agent_prompt_revisions` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `agent_triggers` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `agents` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `board_configs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `config_backups` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `config_history` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `connector_configs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `executions` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `feedback_votes` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `geo_audits` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `goals` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `hierarchy_templates` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `iee_artifacts` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `iee_runs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `iee_steps` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `intervention_outcomes` | _(implementer)_ | _(implementer)_ | _(implementer)_ | Phase 2 schema change adds a unique index on this table (§4.2); the registry/policy verdict here is independent of that. |
| `llm_inflight_history` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `mcp_server_configs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `mcp_tool_invocations` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `org_agent_configs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `org_budgets` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `org_margin_configs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `org_memories` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `org_memory_entries` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `org_user_roles` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `organisation_secrets` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `page_projects` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `permission_groups` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `permission_sets` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `playbook_runs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `playbook_templates` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `policy_rules` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `portal_briefs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `process_connection_mappings` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `processed_resources` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `projects` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `scheduled_tasks` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `skill_analyzer_jobs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `skill_idempotency_keys` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `skills` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `slack_conversations` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `subaccount_agents` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `subaccount_onboarding_state` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `subaccount_tags` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `subaccounts` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `system_incident_suppressions` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `system_incidents` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `task_attachments` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `task_categories` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `users` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `webhook_adapter_configs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `workflow_engines` | _(implementer)_ | _(implementer)_ | _(implementer)_ | Owning migration is in `server/db/schema/agentRuns.ts` territory — sister-branch scope-out (§0.4). Registry edit only; any new policy migration deferred to `pre-prod-workflow-and-delegation` (§9). |
| `workflow_runs` | _(implementer)_ | _(implementer)_ | _(implementer)_ | Same sister-branch scope-out as `workflow_engines`. |
| `workspace_entities` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `workspace_health_findings` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `workspace_items` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |
| `workspace_memory_entries` | _(implementer)_ | _(implementer)_ | _(implementer)_ | |

(61 rows total — 2 of them, `workflow_engines` and `workflow_runs`, are sister-branch-owned per §0.4 and so are registry-edit-only here. Names are taken in the order the gate emitted them.)

#### §3.4.2 Stale registry entries (4)

| Table | Schema file | Parent table | Parent FK column | Verdict |
|---|---|---|---|---|
| `document_bundle_members` | `documentBundleMembers.ts` | `document_bundles` | `bundle_id` | `drop-from-registry` (parent has canonical org-isolation policy via `0213` + `0228`) |
| `reference_document_versions` | `referenceDocumentVersions.ts` | `reference_documents` | `document_id` | `drop-from-registry` (parent + child both policied via `0229`; manifest entry persists historical reference but the schema walker cannot see it) |
| `task_activities` | `taskActivities.ts` | `tasks` | `task_id` | `drop-from-registry` (verify parent has canonical org-isolation; if missing, ship a parent-EXISTS migration in `0245+` instead and keep the entry) |
| `task_deliverables` | `taskDeliverables.ts` | `tasks` | `task_id` | `drop-from-registry` (same posture as `task_activities`) |

**Hard requirement:** before dropping `task_activities` / `task_deliverables`, grep `migrations/*.sql` for `CREATE POLICY .* ON "?tasks"?` and confirm a canonical org-isolation policy exists on `tasks`. If yes, drop. If no, escalate as a finding (the parent itself is leaky).

#### §3.4.3 Caller-level `allowRlsBypass` justification-comment violations (2)

| Caller | Current state | Verdict |
|---|---|---|
| `server/services/systemMonitor/baselines/refreshJob.ts:39` | `allowRlsBypass: true` flag at line 39, justification comment exists at line 37 (two lines above) — outside the gate's +/-1-line window. | **Move the comment** from line 37 onto line 38 (immediately above the flag) so the gate's heuristic sees it. Do not change the substantive justification — it is already specific ("cross-tenant aggregate reads against agent_runs / agents"). |
| `server/services/systemMonitor/triage/loadCandidates.ts:45` | Same pattern — `allowRlsBypass: true` without an inline justification comment within +/-1 line. | Same fix — add (or move) the justification comment to within +/-1 line of the flag. The substantive justification must name the cross-org operation per the gate's rejection of vague text ("needed", "admin work"). |

`server/services/systemMonitor/**` is not in either sister-branch scope-out list (§0.4); these edits land in this branch.

### §3.5 Implementation approach

1. **Inventory output.** Implementer fills the §3.4.1 table with verdicts per the §3.3 rules. Output is committed to `tasks/builds/pre-prod-tenancy/progress.md` before any code changes.
2. **Group by verdict.** Tables with `register` (policy already exists) → registry-only edit. Tables with `register-with-new-policy` → batch into `0245+` migrations (up to 4 per file when the canonical org-isolation shape applies; standalone files for parent-EXISTS or custom shapes). Tables with `allowlist` → append to `scripts/rls-not-applicable-allowlist.txt` with the prescribed rationale + `[ref: ...]` + per-caller annotations.
3. **Apply edits in this order** so each commit leaves the gate strictly less broken than the prior commit:
   1. Drop the 4 stale entries from `server/config/rlsProtectedTables.ts`.
   2. Append all `register` (policy-exists) entries to the manifest.
   3. Author + apply all `register-with-new-policy` migrations (`0245+`), one migration file per commit.
   4. Append `allowlist` entries to `scripts/rls-not-applicable-allowlist.txt`.
   5. Resolve the §3.4.3 caller-level violations on the two `systemMonitor` files (move/add the inline `// allowRlsBypass: ...` justification comment within +/-1 line of the flag).
   6. Add `run_gate "$SCRIPT_DIR/verify-rls-protected-tables.sh"` to `scripts/run-all-gates.sh`.
4. **No edits to historical migrations.** The repo is append-only on migrations; if a tenant table's owning migration omitted RLS, the fix is a NEW migration, not an edit to the historical file.
5. **No source edits in sister-branch areas.** If a table whose owning migration is `agentRuns.ts` (sister branch territory) needs a registration, the registry edit is permitted (the manifest is shared); the schema file and the table-creation migration are not touched. New policy migrations on those tables are deferred to the sister branch via a `## Deferred Items` entry — see §9.

### §3.6 Acceptance criteria

- CI gate `verify-rls-protected-tables.sh` exits 0 on the post-merge `pre-prod-tenancy` head (gates run by CI, not locally — per CLAUDE.md).
- `tasks/builds/pre-prod-tenancy/progress.md` contains the filled §3.4.1 classification table with one verdict per row.
- `server/config/rlsProtectedTables.ts` no longer contains `document_bundle_members`, `reference_document_versions`, `task_activities`, `task_deliverables` entries (verified by `grep`).
- Every new `register-with-new-policy` migration uses one of the two migration shapes in §2.1 (canonical org-isolation, or parent-EXISTS).
- `scripts/run-all-gates.sh` runs the gate (verified by `grep -n verify-rls-protected-tables scripts/run-all-gates.sh`).
- `npx tsc --noEmit -p server/tsconfig.json` clean.
- No source files in the sister-branch scope-out lists (§0.4) modified by this phase.

---

## §4 — Phase 2 — `intervention_outcomes` unique constraint + `ON CONFLICT` (`CHATGPT-PR203-R2`)

### §4.1 Goal

Replace the per-row `db.transaction(...)` + `pg_advisory_xact_lock` pattern in `server/jobs/measureInterventionOutcomeJob.ts` with a database-level unique constraint and `INSERT ... ON CONFLICT (intervention_id) DO NOTHING`. The current pattern serialises every row through an advisory lock and a transaction; the new pattern is constraint-enforced exactly-once with no per-row tx overhead.

### §4.2 Schema change

Migration `0244_intervention_outcomes_unique.sql` (forward):

```sql
-- Replace the non-unique index with a UNIQUE index on intervention_id.
-- The existing index is named `intervention_outcomes_intervention_idx`
-- (per server/db/schema/interventionOutcomes.ts:35) and was added by an
-- earlier migration; the unique replacement enforces exactly-once
-- write semantics for measureInterventionOutcomeJob.

DROP INDEX IF EXISTS intervention_outcomes_intervention_idx;
CREATE UNIQUE INDEX intervention_outcomes_intervention_unique
  ON intervention_outcomes (intervention_id);
```

Migration `0244_intervention_outcomes_unique.down.sql` (reverse):

```sql
DROP INDEX IF EXISTS intervention_outcomes_intervention_unique;
CREATE INDEX IF NOT EXISTS intervention_outcomes_intervention_idx
  ON intervention_outcomes (intervention_id);
```

Drizzle schema edit (`server/db/schema/interventionOutcomes.ts`):

```ts
// before (line 35):
interventionIdx: index('intervention_outcomes_intervention_idx').on(table.interventionId),

// after:
interventionUnique: uniqueIndex('intervention_outcomes_intervention_unique').on(table.interventionId),
```

If `uniqueIndex` is not already imported in the file, add it to the existing `import { ... } from 'drizzle-orm/pg-core'` line.

### §4.3 Job refactor

Current shape (`server/jobs/measureInterventionOutcomeJob.ts:254-267`):

```ts
const wrote = await db.transaction(async (tx) => {
  const lockKey = `${row.organisation_id}::measureInterventionOutcomes`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

  const [existing] = await tx
    .select({ id: interventionOutcomes.interventionId })
    .from(interventionOutcomes)
    .where(eq(interventionOutcomes.interventionId, row.id))
    .limit(1);
  if (existing) return false;

  await interventionService.recordOutcome(decision.recordArgs!);
  return true;
});
```

Replacement shape:

```ts
// recordOutcome internally INSERTs into intervention_outcomes with ON CONFLICT
// (intervention_id) DO NOTHING. Returns true iff a new row was inserted.
const wrote = await interventionService.recordOutcome(decision.recordArgs!);
```

`interventionService.recordOutcome` becomes the single owner of the insert. Its signature changes from `Promise<void>` to `Promise<boolean>` (the existing input shape is already a single inline object literal — see `server/services/interventionService.ts:53–70` — and is reused unchanged):

```ts
// before (server/services/interventionService.ts:53,70):
async recordOutcome(data: { ...existing fields... }): Promise<void>

// after:
async recordOutcome(data: { ...existing fields... }): Promise<boolean>
```

The body changes its underlying SQL to:

```ts
const result = await db
  .insert(interventionOutcomes)
  .values({ /* ... existing field-mapping unchanged ... */ })
  .onConflictDoNothing({ target: interventionOutcomes.interventionId });

return (result.rowCount ?? 0) > 0;
```

(`db` here is the existing module-level handle the service already uses. The org-scoping is already established by the calling middleware; this refactor does not change that.)

The advisory lock and the SELECT-then-INSERT pattern both go away. The lock was only needed because the index was non-unique — with the unique constraint, the kernel guarantees exactly-once.

### §4.4 Idempotency posture and contract (Section-10 §10.1, §10.2)

- **Idempotency posture:** `key-based`. The unique key is `intervention_outcomes(intervention_id)`. The unique index is `intervention_outcomes_intervention_unique` (named in `0244`).
- **Retry classification:** `safe`. `INSERT ... ON CONFLICT DO NOTHING` is unconditionally retryable — repeated calls return `wrote=false` after the first success.
- **Caller contract:** `recordOutcome` returns `true` when the row was newly inserted, `false` when a prior row already existed. Callers MUST NOT treat `false` as a failure — it is the success-but-already-written outcome. The job's accumulator (`summary.written`) is incremented only on `true`.

### §4.5 Concurrency guard for racing writes (Section-10 §10.3)

- **Mechanism:** DB-level unique constraint.
- **First-commit-wins:** the racing `INSERT` that arrives second receives `rowCount=0` and `wrote=false`. The losing caller sees the same successful outcome as the winning caller.
- **What replaces the advisory lock:** nothing. The advisory lock was a workaround for the missing unique constraint; it is no longer needed.
- **What DOES NOT change:** the upstream eligibility filter (`row` selection in `runMeasureInterventionOutcome`) is unchanged. The race window between SELECT and INSERT is closed by the unique key, not by re-coordinating callers.

### §4.6 HTTP / error mapping (Section-10 §10.6)

This is a job, not an HTTP route, so there is no HTTP status to map. But: the job MUST distinguish between the three outcomes the new path can produce:

- `wrote=true` → `summary.written += 1`.
- `wrote=false` (conflict) → no counter increment; this is the silent "already-written" path. (Optional: a `summary.alreadyWritten` counter for telemetry — strictly optional, not required to ship.)
- Underlying `INSERT` throws (e.g. FK violation, NOT NULL violation, anything other than `23505 unique_violation`) → bubble up to the per-row `try/catch` (lines 270–275) which already increments `summary.failed` and logs the error. **The new code path MUST NOT catch `23505`** — that path is handled by `onConflictDoNothing()`'s no-op semantics. Catching `23505` defensively would mask other kinds of conflicts.

### §4.7 Load-test acceptance

The brief asks for a load-test acceptance criterion (target rows/sec/org). Pre-production framing means we don't have prod traffic, but a synthetic load-test is reasonable:

- **Setup:** spin up the test DB (existing pattern in `tasks/...` integration test runs), seed N=10,000 `actions` rows ready for outcome measurement across 5 orgs (2,000 rows/org).
- **Run:** invoke `runMeasureInterventionOutcome()` with both implementations (legacy advisory-lock + new ON-CONFLICT) under a stopwatch.
- **Pass condition:** the new path is **at least 5× faster** than the legacy path on this setup. Record absolute rows/sec/org in `tasks/builds/pre-prod-tenancy/progress.md` so future regressions can be detected by re-running.
- **Pass condition (correctness):** `summary.written` matches the eligible-row count exactly across both runs (the new path must not drop or double-count rows).

If the load test cannot be set up locally because of seed-data dependencies, the spec defers the absolute number to a `tasks/todo.md` entry (see §9) but the **5× speedup vs. legacy** must still be demonstrated against a smaller fixture (e.g. 1,000 rows / 2 orgs).

### §4.8 Acceptance criteria

- `migrations/0244_intervention_outcomes_unique.sql` and its `.down.sql` companion exist; the forward migration applies cleanly to a fresh DB; the down migration reverses it cleanly.
- `server/db/schema/interventionOutcomes.ts:35` uses `uniqueIndex(...)`.
- `server/jobs/measureInterventionOutcomeJob.ts` no longer contains `pg_advisory_xact_lock` or `db.transaction(` for the per-row write path. The `try/catch` block remains for non-`23505` errors only.
- `interventionService.recordOutcome` (in `server/services/interventionService.ts` or wherever it lives) uses `.onConflictDoNothing({ target: interventionOutcomes.interventionId })`.
- Pure test (`server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts` — extend if it exists) asserts the decision-classifier shape is unchanged.
- Load-test result appears in `tasks/builds/pre-prod-tenancy/progress.md`. The 5× speedup vs. legacy must be demonstrated against either the full §4.7 fixture (10,000 rows / 5 orgs) or the smaller fallback fixture (1,000 rows / 2 orgs); only the absolute rows/sec/org figure may be deferred (with a blocker note explaining why the local seed couldn't be set up — routed to §9).
- `npx tsc --noEmit -p server/tsconfig.json` clean.
- The Phase 2 schema change introduces no new RLS-gate violations of its own. (`intervention_outcomes` is named in §3.4.1 as a Phase 1 deliverable — Phase 1 owns driving `verify-rls-protected-tables.sh` to exit 0. Phase 2 is required not to *worsen* the gate; it is not on the hook for the pre-existing violation. See §6 / §8.1 for ordering.)

---

## §5 — Phase 3 — Maintenance-job per-org `withOrgTx` defense-in-depth (`B10`, optional)

### §5.1 Goal

Upgrade the three maintenance jobs from "outer admin tx + per-org savepoint" to "outer admin tx for enumeration, then a fresh `withOrgTx` per org for the per-org work." The current pattern runs all per-org work under `admin_role` (RLS bypassed); the upgrade re-engages tenant-scoped policies for each org's writes, so any bug that mis-targets an org's data is caught by the row-level policy instead of silently writing to the wrong tenant.

### §5.2 Pattern

Current pattern (e.g. `server/jobs/ruleAutoDeprecateJob.ts:161-242`):

```ts
result = await withAdminConnection(
  { source, reason },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    // ... advisory lock ...
    const orgs = await tx.execute(sql`SELECT id FROM organisations LIMIT 500`) as ...;
    for (const org of orgs) {
      const result = await tx.transaction(async (subTx) => {
        return applyDecayForOrg(subTx, org.id);  // RLS bypassed, runs under admin_role
      });
    }
  },
);
```

Replacement pattern:

```ts
// Step 1: enumerate orgs under admin_role.
const orgs = await withAdminConnection(
  { source, reason: 'enumerate orgs' },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    // advisory lock here if cross-job mutual exclusion is required
    return (await tx.execute(sql`SELECT id FROM organisations LIMIT 500`)) as Array<{ id: string }>;
  },
);

// Step 2: for each org, do the per-org work in a fresh tenant-scoped tx.
for (const org of orgs) {
  try {
    const { decayed, autoDeprecated } = await withOrgTx(
      { organisationId: org.id, source: `${SOURCE}:per-org` },
      async (orgTx) => applyDecayForOrg(orgTx, org.id),
    );
    // accumulate ...
  } catch (err) {
    // existing per-org error handling preserved
  }
}
```

Key differences:

- The outer admin tx exits as soon as enumeration finishes. The advisory lock (if used for cross-job exclusion) is held only for enumeration, not for the entire sweep. **If the existing advisory lock was protecting the per-org work, the lock semantics change.** Implementer must confirm the advisory-lock intent for each job and either keep it scoped to enumeration only, or move it to a separate session-level lock if the per-org work needed it.
- Per-org work now runs under the tenant role with `app.organisation_id = org.id` set by `withOrgTx`. Any RLS-protected table the per-org function reads or writes must have an `organisation_id = current_setting('app.organisation_id', true)::uuid` filter in its policy, which it already does for canonical tables.
- `applyDecayForOrg` and the equivalent functions in the other two jobs accept the org-scoped tx instead of the admin tx. Their internal SQL must already match this contract — they should not contain `SET LOCAL ROLE admin_role` or admin-only operations. Verify before lifting.

### §5.3 Per-job changes

| Job | File | Per-org function | Notes |
|---|---|---|---|
| `runRuleAutoDeprecate` | `server/jobs/ruleAutoDeprecateJob.ts` | `applyDecayForOrg(tx, orgId)` | Existing advisory lock at line 169 — confirm whether it gates enumeration only or per-org work. If per-org, route to a session-level lock outside `withOrgTx`. |
| `runFastPathDecisionsPrune` | `server/jobs/fastPathDecisionsPruneJob.ts` | (the per-org block currently under `withAdminConnection` at lines 90–...) | Same audit. |
| `runFastPathRecalibrate` | `server/jobs/fastPathRecalibrateJob.ts` | (the per-org block currently under `withAdminConnection` at lines 108–...) | Same audit. |

### §5.4 Acceptance criteria

- All three jobs use `withOrgTx({ organisationId: org.id, source: ... })` for per-org work; no per-org `tx.transaction(...)` savepoint inside an outer admin tx.
- Outer admin tx is enumeration-only; advisory locks (if any) clearly scoped to enumeration vs. per-org work.
- `npx tsc --noEmit -p server/tsconfig.json` clean.
- Targeted pure tests for each job (extend existing pure tests if they exist) assert the org-enumeration order and the per-org function's contract are unchanged.
- CI gate `verify-rls-protected-tables.sh` still exits 0 (Phase 3 must not regress the Phase 1 deliverable; gates run by CI).

### §5.5 Decision rule for shipping Phase 3

Phase 3 ships **only if Phase 1 + Phase 2 finish under the branch's reasonable budget** (rough heuristic: ≤ 3 days end-to-end). If they take longer, Phase 3 is deferred to a follow-up branch (entry in §9). The reason: the three jobs are functional today (no silent no-ops), and the upgrade is defense-in-depth, not correctness. Shipping a partial Phase 1+2 with a clean review trail beats shipping all three phases with a rushed Phase 3.

### §5.6 Per-job concurrency contract (Section-10 §10.3)

Phase 3 splits a single outer admin transaction into one admin enumeration tx plus one `withOrgTx` per org. That changes the lifetime of any advisory lock the original tx held. Every job's commit MUST declare, before it ships, which of the two patterns applies:

- **Pattern A — enumeration-only lock.** The advisory lock was protecting enumeration only (mutual exclusion across concurrent runs of the same job). The lock stays inside the outer admin tx and is released when enumeration finishes; per-org work runs without the lock. Idempotency posture for per-org work: `state-based` (each per-org function already uses optimistic predicates / NOT-EXISTS guards). This is the expected pattern for all three jobs.

- **Pattern B — per-org lock required.** The advisory lock was protecting per-org work (e.g. preventing two concurrent jobs from racing on the same org's writes). The Phase 3 commit for that job MUST acquire a session-level (cross-tx) lock outside `withOrgTx` per org, then drop into `withOrgTx` for the work. If the audit cannot cleanly express the lock with a session-level mechanism, the job is deferred to a follow-up branch (§9).

**Pre-commit deliverable.** For each of the three jobs, the implementer commits a one-paragraph audit verdict to `tasks/builds/pre-prod-tenancy/progress.md` naming Pattern A or Pattern B and the line numbers consulted. If any job is Pattern B and the session-level mechanism isn't obviously equivalent, that job alone is deferred (the other two can still ship).

**Idempotency posture per job:** `state-based` — each per-org function runs against optimistic predicates already enforced in its existing SQL. No new key-based guards are introduced; no terminal-event semantics change. Concurrency safety derives from (a) per-job advisory lock at enumeration (Pattern A) or session-level lock per org (Pattern B), plus (b) RLS-engaged tenant-scoped writes inside `withOrgTx`.

**Retry classification:** `safe` — re-running any of the three jobs against the same per-org state produces the same result (the per-org SQL is already retry-safe; the new wrapper does not change that).

---

## §6 — Migration sequence

The branch reserves migration numbers `0244–0255`. The original brief reserved `0241–0252`, but `main` already shipped 0241/0242/0243; the next twelve numbers are reserved here.

| Order | Number | File | Phase | Dependency |
|---|---|---|---|---|
| 1 | `0244` | `0244_intervention_outcomes_unique.sql` (+ `.down.sql`) | Phase 2 | None as a schema migration — `0244` is independent of the Phase 1 policy migrations. Can ship first if Phase 2 is started before Phase 1 finishes. The Phase 1 registry edit for `intervention_outcomes` is sequenced separately (§3.5) — Phase 1 still owns `verify-rls-protected-tables.sh` exit 0, not Phase 2 (§4.8). Recommended order is Phase 1 → Phase 2 (see §8). |
| 2 | `0245+` | one or more `0245_<batch>_rls.sql` per the §3.5 batching rule | Phase 1 | Each policy migration depends on the table's CREATE TABLE migration already being applied (which it always is — those are historical migrations). |

**Hard rules:**

- One migration number = one file (plus optional `.down.sql` companion). No reordering after commit.
- No edits to historical migration files (`0204`–`0228` etc.). All fixes are new migrations.
- No migration in this branch lands in the `0241–0243` numbers — those are owned by main commits.
- If Phase 1 fills the `0245–0255` reservation and still has unregistered tables remaining, the spec is rescoped: **fewer tables per migration is not the answer** (the cap reflects review-attention budget, not file-system budget). Instead, defer the remainder to a follow-up branch with its own migration reservation.

---

## §7 — Test matrix

Per `runtime_tests: pure_function_only` framing, this section is sparse by design. Static gates carry most of the verification load.

### §7.1 Static gates (primary)

| Gate | What it verifies | Phase |
|---|---|---|
| `bash scripts/verify-rls-protected-tables.sh` | Schema-vs-registry diff (Phase 1 deliverable: exit 0). | Phase 1 |
| `bash scripts/verify-rls-coverage.sh` | Every manifest entry has a matching `CREATE POLICY` in some migration. New entries from Phase 1 must satisfy this gate. | Phase 1 |
| `bash scripts/verify-rls-contract-compliance.sh` | No direct DB access from `server/lib/` or `server/routes/` outside the allow-list. Should be no-op for this branch (Phase 1 doesn't touch lib/route files; Phase 2 only edits `server/jobs/`). | Phase 1 + Phase 2 |
| `bash scripts/verify-rls-session-var-canon.sh` | No new occurrence of the phantom `app.current_organisation_id` session var. New policy migrations from Phase 1 must use the canonical `app.organisation_id`. | Phase 1 |
| `npx tsc --noEmit -p server/tsconfig.json` | TypeScript compiles. Phase 2's Drizzle schema change adds a `uniqueIndex` import; verify it doesn't break call sites. | Phase 1 + Phase 2 + Phase 3 |
| `npm run build:server` | Server bundle builds. | Phase 1 + Phase 2 + Phase 3 (post-merge gate, not local) |

### §7.2 Pure unit tests (secondary)

| Test file | Phase | Assertion |
|---|---|---|
| `server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts` (extend) | Phase 2 | The decision-classifier branch (`tooEarly` / `noPostSnapshot` / `recordOutcome`) returns identical args before and after the refactor. No DB access. |
| `server/jobs/__tests__/<jobName>Pure.test.ts` (extend each, if pure tests exist) | Phase 3 | Org enumeration produces the same ordered list of org IDs before and after the refactor. Per-org function invocation count matches enumerated org count. |

### §7.3 What is NOT tested at runtime (per framing)

Per `docs/spec-context.md`:

- No new `vitest` / `jest` / `playwright` / `supertest` tests.
- No frontend tests (no frontend changes anyway).
- No API contract tests (no API changes anyway).
- No E2E against the app.
- No performance baselines beyond the Phase 2 §4.7 load-test number, which is recorded in `progress.md` (not as a test).
- No composition tests.

If a reviewer suggests any of the above, refer to §0.1 framing (or update `docs/spec-context.md` first if the framing has shifted — but the spec-reviewer's framing rules apply).

### §7.4 Integration test harness re-use

The existing `server/services/__tests__/rls.context-propagation.test.ts` integration test harness iterates `RLS_PROTECTED_TABLES` and asserts Layer-B fail-closed posture for every entry. New entries added to the manifest in Phase 1 are automatically covered when this harness runs in CI — no per-table integration test is added here.

### §7.5 Pre-merge gate cadence

Per CLAUDE.md, the full test suite is CI-only. Before merge, run:

- `npm run lint`
- `npx tsc --noEmit -p server/tsconfig.json`
- `bash scripts/verify-rls-protected-tables.sh` (Phase 1 hard gate)
- `bash scripts/verify-rls-coverage.sh`

CI will run the full battery (`npm run test:gates`) on PR open.

---

## §8 — Rollout ordering

### §8.1 Phase order

The recommended order is **Phase 1 → Phase 2 → Phase 3 (optional)**. Reasons:

- **Phase 1 is the largest piece** (registry triage across 67 tables). Front-loading it gets the gate to exit 0 fastest, which de-risks the rest of the branch — every subsequent commit is checked against an already-passing gate.
- **Phase 2 is independent** but depends on no new tables being created in Phase 1 that touch `intervention_outcomes` (the table is already in the manifest plan per §3.4.1).
- **Phase 3 is conditional** (§5.5); shipping it before Phase 1+2 finish is wasted leverage.

### §8.2 Per-phase commit cadence

- **Phase 1:** one commit per migration file (so the policy migrations are reviewable independently). Manifest edits land in their own commit before the policy migrations. Allow-list edits in their own commit.
- **Phase 2:** two commits — (a) the `0244` migration + Drizzle schema edit, (b) the job + service refactor. Splitting lets the schema and the code roll back independently.
- **Phase 3:** one commit per job, so each job's lock-semantics audit is reviewable on its own.

### §8.3 Pre-merge baseline reverification

Before opening the PR:

1. Re-run the §1 verification table against the post-merge `pre-prod-tenancy` head — confirm every "closed" item from §1 is still closed (i.e. no merge from `main` regressed the work).
2. Confirm the gate exits 0: `bash scripts/verify-rls-protected-tables.sh`.
3. Confirm `npx tsc --noEmit -p server/tsconfig.json` is clean.

The §1 reverification specifically guards against a sister-branch merging conflicting work into `main` while this branch was in flight.

### §8.4 Conflict resolution if a sister branch lands first

If `pre-prod-boundary-and-brief-api` or `pre-prod-workflow-and-delegation` merges into `main` before this branch:

- Merge `main` into `pre-prod-tenancy`.
- Re-run `bash scripts/verify-rls-protected-tables.sh` — the unregistered-tables count may shift (new tables introduced by the sister branch). Update the §3.4.1 classification output in `progress.md` to reflect the new state. Add classification verdicts for any newly-surfaced tables.
- Do NOT alter sister-branch source files in this branch — only update the registry / allow-list.
- If the sister branch added an `organisation_id` column to a table this branch already registered, no edit is needed.

---

## §9 — Deferred Items

- **Phase 3 (B10) maintenance-job per-org `withOrgTx` defense-in-depth.** Conditional on §5.5 — ships only if Phase 1+2 finish under budget. If deferred, capture in `tasks/todo.md § Deferred from pre-prod-tenancy spec` with a one-line trigger ("Phase 1+2 merged on <date>; remaining defense-in-depth upgrade routed to follow-up branch") and a back-link to §5 of this spec.

- **Tenant-scoped tables whose owning migration belongs to a sister-branch path.** If a table named in §3.4.1 has its CREATE TABLE in `agentRuns.ts` or another sister-branch-owned schema file and is missing both a policy AND any registry/allow-list entry, the registry edit lands here but the policy migration is deferred to the owning sister branch. Capture in `tasks/todo.md § Deferred from pre-prod-tenancy spec` with the exact table name + intended policy shape (canonical org-isolation vs. parent-EXISTS) so the sister branch can ship the migration without re-doing the classification work.

- **Load-test absolute rows/sec/org figure** (§4.7). If the Phase 2 load test cannot be set up locally, the absolute number is deferred. The 5×-speedup-vs-legacy assertion still ships in `progress.md` against a smaller fixture.

- **Gate-self-test fixture for `verify-rls-protected-tables.sh`** (§2.4 optional row). Mirror of the H1 derived-data fixture. Defer if the gate doesn't accept a `--fixture-path` argument — add it as a small enhancement in a follow-up branch.

- **GATES-2026-04-26-2** (verify-rls-contract-compliance.sh should skip `import type` lines). Out of scope here; remains in `tasks/todo.md` under the existing 2026-04-26 deferred-items section.

- **B10 verification of advisory-lock intent** for each job (§5.3) — if Phase 3 ships and the audit reveals an advisory lock that was protecting per-org work and cannot be cleanly scoped to enumeration only, the job's commit is rolled back and the job is deferred to a follow-up branch with a dedicated session-level lock design.

---

## §10 — Execution-safety contracts (Section 10 of the spec-authoring checklist)

Most of Section 10 of the checklist is concentrated in Phase 2 because Phase 1 is registry-edit work and Phase 3 is purely a tx-shape upgrade. Each subsection below points at the in-spec home for the contract.

| Section-10 item | Where it lives in this spec | Phase |
|---|---|---|
| §10.1 Idempotency posture | §4.4 (`key-based`, unique key `intervention_outcomes(intervention_id)`, index `intervention_outcomes_intervention_unique`); §5.6 (`state-based`, per-job optimistic predicates already in place). | Phase 2 + Phase 3 |
| §10.2 Retry classification | §4.4 (`safe`); §5.6 (`safe`). | Phase 2 + Phase 3 |
| §10.3 Concurrency guard for racing writes | §4.5 (DB unique constraint, first-commit-wins, losing caller sees `wrote=false`); §5.6 (per-job Pattern A vs. Pattern B advisory-lock audit, deliverable to `progress.md` before each Phase 3 job's commit). | Phase 2 + Phase 3 |
| §10.4 Terminal event guarantee | N/A — neither the Phase 2 job nor the Phase 3 jobs emit cross-flow events. The existing `measureInterventionOutcome.tick_complete` log is not a cross-flow terminal; it's a per-tick heartbeat. | — |
| §10.5 No-silent-partial-success | §4.6 — `summary.failed` increments on any non-`23505` error; `summary.written` increments only on a true insert; `wrote=false` is silent because the row is correctly already present (this is success, not partial). Phase 3 does not change any job's success/partial/failed semantics — the per-org function's existing accumulator is preserved. | Phase 2 + Phase 3 |
| §10.6 Unique-constraint-to-HTTP mapping | N/A — neither phase introduces an HTTP route. The Phase 2 job-internal mapping is in §4.6. | — |
| §10.7 State-machine closure | N/A — no state machine introduced or modified. | — |

Phase 1 (registry triage) introduces no externally-triggered writes, no new state machines, and no new concurrent-write contests — it is a mechanical refactor of the registry / allow-list manifest. Phase 3 changes the lifetime of an advisory lock for each maintenance job; the per-job lock-scope contract is pinned in §5.6.

---

## §11 — Pre-review self-consistency checklist

Run before invoking `spec-reviewer`. Every item must answer "yes."

- [x] **§0 verification pass.** Every cited deferred item from `tasks/todo.md` was verified open or annotated `verified closed by <migration>` (see §1).
- [x] **No new primitive without a "why not reuse" paragraph.** Phase 1 reuses the existing manifest + allow-list. Phase 2 reuses Drizzle `uniqueIndex` + `onConflictDoNothing`. Phase 3 reuses `withOrgTx`. No new primitives proposed.
- [x] **File inventory lock** (§2). Every file/migration named in §3–§5 also appears in §2.
- [x] **Contracts.** Phase 2 has §4.4 (idempotency posture), §4.5 (concurrency guard), §4.6 (HTTP/error mapping). Phase 1 has no cross-boundary data shape; Phase 3 has none.
- [x] **Source-of-truth precedence.** Phase 2's `recordOutcome` is the single owner of the insert; the unique constraint is the authoritative dedup mechanism. Stated in §4.3.
- [x] **RLS / Permissions.** Phase 1 IS the RLS work — every newly-registered tenant table either has or gets a canonical `CREATE POLICY` (§3.3); allow-listed tables carry the prescribed function-level annotations. Phase 2 adds no new tenant tables. Phase 3 strengthens RLS posture (engaging policies that were previously bypassed under `admin_role`).
- [x] **Execution model.** Phase 1: synchronous migrations + manifest edits. Phase 2: existing job (queued via the existing job harness — unchanged); the refactor is to the synchronous code path inside the job, not to its trigger model. Phase 3: same — no execution-model change.
- [x] **Phase dependency graph** (§8.1). No backward references — Phase 2 doesn't reference Phase 1's new tables; Phase 3 doesn't reference Phase 2's schema change. No orphaned deferrals — every deferral in §9 has its trigger condition stated.
- [x] **Deferred Items section** (§9) exists and is non-trivial.
- [x] **Goals ↔ Implementation match.** §0.2 states three goals; each maps to exactly one phase (§3 / §4 / §5). No load-bearing claim is unbacked.
- [x] **Testing posture matches `docs/spec-context.md`.** §7.3 explicitly enumerates what is NOT tested at runtime to avoid framing drift.
- [x] **Section-10 contracts** (§10). Idempotency, retry classification, concurrency guard, no-silent-partial-success all declared for Phase 2. N/A reasons given for §10.4, §10.6, §10.7.
- [x] **Unique-constraint-to-HTTP mapping** — N/A (job-internal). Documented in §10.
- [x] **State machine** — N/A. Documented in §10.
