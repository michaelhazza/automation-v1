# Pre-Production Tenancy Hardening — Dev Spec

**Status:** Draft 2026-04-29
**Spec version:** Round 6 (2026-04-29) — see "Spec history" below
**Branch:** `pre-prod-tenancy`
**Class:** Major (architect first; full review pipeline)
**Slug:** `pre-prod-tenancy`
**Source brief:** [`tasks/builds/pre-prod-tenancy/brief.md`](../../../tasks/builds/pre-prod-tenancy/brief.md)
**Migration range:** `0244–0255` (the brief reserved `0241–0252`, but `main` already has 0241/0242/0243; the next twelve numbers are reserved here for this branch only)
**Sister branches (do not edit their files):** `pre-prod-boundary-and-brief-api`, `pre-prod-workflow-and-delegation`

**Spec history (review rounds applied — every `progress.md` entry MUST cite the round / commit SHA it was authored against):**

- Draft (commit `bb0b2766`) — initial author
- Round 1 — Codex spec-reviewer iteration 1, 10 mechanical fixes (commit `a9135930`)
- Round 2 — ChatGPT spec review, ctid/dedup safety, gate-wiring-first sequencing, three-place audit enforcement (uncommitted at round-2 close, committed alongside Round 5)
- Round 3 — enforcement tightening (mechanical paste / cross-checks): §3.5.1 PR-description gate-status block, §7.5 NEW-call-sites list, §4.2.0 pre-check timing constraint, §2.1 parent-EXISTS NOT NULL invariant, §6 migration-overflow rescope block, §5.2.1 reviewer cross-check
- Round 4 — reviewer-binding + visibility: gate list from harness output, reviewer-diff cross-check, write-quiescent state requirement, pre-flight count visibility, grep-hit write-confirmation, Phase 3 reviewer rotation, progress.md contract status, sister-branch merge re-verification
- Round 5 — drift-resistance + future-proofing: spec version stamp, global progress.md ordering rule, §3.4.1 table-set freeze invariant, allow-list negative assertion, Phase 2 future schema-evolution clause, progress.md spec-SHA citation requirement
- Round 6 — CI-only gate alignment: removed five local-gate-invocation instructions (Rounds 1–5 had drift against CLAUDE.md "gates are CI-only — never run locally"). §3.5.1 paste block sourced from CI output; §7.1 reframed as CI invariants; §7.6 pre-merge cadence split into local-allowed vs. CI-waited-for; §8.3 / §8.4 read gate status from CI rather than running the harness locally. §11 Round-4 entry carries an in-place corrigendum.
- Round 7 — final-pass closure: ChatGPT round-7 reviewer confirmed Round 6 closed the dual-truth flaw cleanly (no architectural gaps, no remaining contracts to add, ready to lock). One non-blocking polish applied: §7.1 "Authority rule (load-bearing)" paragraph states explicitly that local execution of gate logic is non-authoritative and MUST NEVER be used for pass/fail decisions, with the rationale (environment drift / "works on my machine" regressions) captured in the rule itself. Forbidden patterns from round-7 reviewer (no fallback local execution, no "optional local verification", no CI+local hybrid) are recorded in §11 Round-7 entry. **The spec is locked at Round 7** — further changes require a new round entry here AND a `progress.md` re-validation per the citation rule below.

When a `progress.md` entry references "the spec," it MUST cite the round it was authored against (e.g. `[spec round 7 — commit <sha>]`). If the spec rounds forward between authoring and merge, the implementer MUST re-validate the entry against the new round before the PR lands. This makes the spec-vs-evidence pairing auditable and prevents stale-spec confusion when multiple rounds land during implementation.

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
| `0245+` | `migrations/0245_<batch>_rls.sql` ... | Policy migrations for tenant-scoped tables that the registry triage finds are **registered (or being newly registered) but missing a `CREATE POLICY` block**. Batching rule (see §2.1.1 below for full constraints): **one migration file = one policy shape**, up to 4 tables per file when the canonical org-isolation shape applies. No mixing of canonical and parent-EXISTS shapes inside the same file. The exact file count is bounded by classification output (§3.4). Maximum 11 new files (0245–0255) given the 12-number reservation. | Phase 1 |

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

**Hard invariant — single deterministic FK path:** parent-EXISTS policies MUST reference exactly ONE parent table via exactly ONE FK column, and that FK MUST be `NOT NULL` on the child schema. Specifically:

- **No OR'd `EXISTS` clauses across multiple parents.** A policy of the shape `USING (EXISTS (SELECT 1 FROM parent_a ...) OR EXISTS (SELECT 1 FROM parent_b ...))` widens access by design — any tenant who owns a row in *either* parent passes the check. If a child table joins to two or more parent tables that each carry `organisation_id`, escalate to the user; do NOT pick one parent to use as the policy basis and do NOT OR them.
- **No nullable FK paths.** If the child's FK to the parent is nullable, rows with `NULL` in the FK column have no parent to scope against — the policy must explicitly handle this (e.g. by requiring the FK to be set, or by a separate DENY policy for `NULL` cases). If the FK is nullable AND there is no separate scoping mechanism, the table is not a clean parent-EXISTS candidate; escalate.
- **NOT NULL verification is mandatory, not assumed.** The implementer MUST verify the FK column's nullability against authoritative sources before authoring a parent-EXISTS migration. Specifically: (a) `grep -nE "<fk_column>[^,]*NOT NULL" migrations/*.sql` against the child's CREATE TABLE migration AND any subsequent ALTER COLUMN migrations that may have changed the constraint; (b) read the Drizzle schema file (`server/db/schema/<child>.ts`) and confirm the field declaration includes `.notNull()`; (c) the two MUST agree. If they disagree, the schema or the migration history has drifted and the implementer escalates to the user before proceeding — do NOT assume the schema file is authoritative (it can be edited without a corresponding migration; the migration history is the source of truth for what is actually in the DB). A parent-EXISTS migration that ships against a nullable FK silently lets `NULL`-FK rows slip past the policy.
- **No 1-to-many semantics where the join is non-deterministic.** If a child row could be joined to multiple parent rows via the same FK (e.g. via a junction table where the child's logical owner is one of N possible parents), the policy is ambiguous — escalate. The 1:1 / N:1 path from child to parent must be deterministic.

If a child table cannot satisfy the single-deterministic-FK-path invariant, it is NOT a parent-EXISTS candidate. The implementer's choices are: (a) add an `organisation_id` column to the child via a separate migration and use the canonical org-isolation shape (preferred for tables with substantial write traffic); (b) escalate to the user for an architectural decision; (c) defer to a follow-up branch with an entry in §9.

#### §2.1.1 Migration batching constraints (canonical vs. parent-EXISTS)

The batching rule above is intentionally narrow. Concretely:

- **One file = one policy shape.** A single migration file applies the canonical-org-isolation shape to up to 4 tables, OR applies a parent-EXISTS shape to a single table. It does NOT mix shapes. Mixing makes review harder (the reviewer has to mentally switch between two policy templates within one file) and rollback messier (a `.down.sql` that has to undo two shapes in one file is more error-prone).
- **Order within a file** does not matter for canonical-shape batches (the four `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` blocks are independent), but each table's block MUST be self-contained — no shared `DROP POLICY IF EXISTS` line factored across tables.
- **Parent-EXISTS migrations are always solo.** Each parent-EXISTS table gets its own migration file. The parent table + FK column reference makes them less symmetric and harder to factor; one file per table keeps each policy independently reviewable and revertable.
- **Cap of 4 tables per canonical file** is a review-attention budget, not a file-system constraint. If Phase 1 produces 30+ canonical-shape tables (unlikely given §3.2's 61-table envelope and the `register-with-new-policy` subset), the cap stands — the spec is rescoped before the cap is raised. Adding a 5th table to a file is not a way to save a migration number; deferring instead is.

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
| `scripts/run-all-gates.sh` | Add `run_gate "$SCRIPT_DIR/verify-rls-protected-tables.sh"` to the gate list. Currently the gate is callable but not registered in the harness, so its exit-0 condition is not enforced anywhere except CI manual invocation. Insertion goes after the existing `verify-rls-*` block (lines 74–76). | Phase 1 (FIRST step — see §3.5 step 1) |

### §2.6 Build artefacts (committed in this branch but outside `server/` / `client/`)

| Path | Change | Phase |
|---|---|---|
| `tasks/builds/pre-prod-tenancy/progress.md` | Phase 1 implementer commits the filled §3.4.1 classification table here (one verdict per row) before any policy-migration commits. Phase 2 implementer appends the §4.2.0 pre-check result and the load-test result (≥ 5× speedup vs. legacy + ≥ 200 rows/sec/org absolute floor, per §4.7). Phase 3 implementer appends the per-job advisory-lock audit (Pattern A or B) per §5.2.1. | Phase 1 + Phase 2 + Phase 3 |
| `tasks/todo.md` | Append entries under the existing `## Deferred from pre-prod-tenancy spec` heading for any Phase-3 deferral, sister-branch-deferred policy migrations, load-test fixture-upgrade deferral, gate-self-test fixture deferral, and the CI-pipeline-config verification deferral (see §9). | Phase 1 + Phase 2 + Phase 3 |
| `.github/pull_request_template.md` | Append the allow-list bypass grep-output prompt to the PR template (per §7.5 continuous-enforcement contract). One-time edit; lands with the §3.4.3 caller-fix commit or in the manifest commit, whichever lands first. | Phase 1 |

**`progress.md` entries are part of the contract — missing or inconsistent entries are blocking.** The artefacts above (especially `tasks/builds/pre-prod-tenancy/progress.md`) carry deliverables that this spec relies on at multiple checkpoints: §3.4.1 classification verdicts, §4.2.0 pre-check result + quiescence verification, §4.7 load-test triple (legacy / new / multiplier), §5.2.1 per-job advisory-lock audit. These are NOT informal notes — they are reviewer-checkable evidence. A PR that lands the corresponding source change without the matching `progress.md` entry is rejected at review time, regardless of whether the source change itself looks correct: the implementer is asserting a property (e.g. "the pre-check showed zero duplicates") that the reviewer cannot verify without the recorded evidence. Inconsistency between `progress.md` and another source (commit message, PR-description block) is also a reject — the §5.2.1 three-place enforcement rule generalises here. Treat `progress.md` as a deliverable, not a scratchpad.

**Global ordering rule — `progress.md` entries are committed alongside or before the code change they justify.** For any step that requires a `progress.md` entry, the entry MUST be committed in the SAME commit as the code change it justifies, OR in a commit IMMEDIATELY PRECEDING that change on the same branch. Post-hoc entries (committed after the code change has landed) are NOT permitted — they retrofit evidence after the fact, which defeats the contract: the entry is supposed to be the implementer's pre-commit assertion, not a back-filled record. If an implementer commits a code change first and then realises they owe a `progress.md` entry, the resolution is to amend the commit (locally, before push) or push a follow-up commit that adds the entry AND a back-reference annotation explaining the ordering breach (`progress.md note added post-hoc — see commit <sha>; this is a one-off cleanup, not a precedent`). The reviewer treats post-hoc-without-annotation as an automatic reject.

**Spec-version citation rule — every `progress.md` section header includes the spec round/SHA it was authored against.** Every section appended to `tasks/builds/pre-prod-tenancy/progress.md` MUST carry a one-line citation immediately under its `##` heading of the form `[spec round 5 — commit <sha>]` (substitute the round number and the spec's commit SHA at the time the entry was authored — `git log -1 --format=%h docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`). If the spec rounds forward between when the entry was authored and when the PR merges, the implementer MUST re-validate the entry against the new round before merge — either by confirming the entry still satisfies the new round (and updating the citation) or by re-authoring the entry. This pairs with the round-history block at the top of the spec: future readers can audit which version of the spec each `progress.md` claim was made against, instead of guessing whether the claim survived a tightening round it post-dates.

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

   | Has `CREATE POLICY`? | Genuinely tenant-private? (per §3.3.1 rubric) | Action |
   |---|---|---|
   | Yes | (assumed, since policy exists) | **Register** in `server/config/rlsProtectedTables.ts` with `policyMigration` set to the migration that carries the policy. No new policy migration. |
   | No | Yes | **Register + ship policy** — write a new policy migration in the `0245+` range (see §2.1 for migration shape), append a manifest entry pointing at the new migration. |
   | No | No (system-wide / audit-ledger / read replica / cross-tenant lookup) | **Allow-list** in `scripts/rls-not-applicable-allowlist.txt` with a one-sentence rationale citing an invariant ID, spec section, or migration filename per the format rules in the file header. Add the function-level `@rls-allowlist-bypass: <table> <fn-name> [ref: ...]` annotation at every caller of the table. |

#### §3.3.1 Tenant-private vs. allow-list — hard rubric

The "genuinely tenant-private?" column above is the spec's load-bearing invariant for Phase 1. With 61 tables to classify, drift between implementers (or between classification sessions) would silently weaken the multi-tenant boundary. The rubric below is an MCDA (must-pass, must-not-pass) test — implementers MUST apply it row-by-row before recording a verdict in `progress.md`.

**A table MUST be classified as `tenant-private` (verdict = `register` or `register-with-new-policy`) if ANY of the following hold:**

1. The table contains an `organisation_id` column (any spelling — `organisation_id`, `organization_id`, `org_id`) that is non-nullable on at least one production-relevant code path. The migration walker has already pre-filtered for this column existing — the only judgement call is "is it actually populated for tenant rows?".
2. The table joins (via FK or implicit foreign key) to a tenant-private parent table AND tenant-scoped operations write to it. (E.g. `task_attachments.task_id → tasks.id`, where `tasks` is tenant-private.) These are the parent-EXISTS cases — they ship a parent-EXISTS RLS policy per §2.1.
3. A row in the table can plausibly be derived from, or expose, another tenant's confidential workspace (workflow definitions, agent prompts, custom skills, briefs, conversation history, scheduled task payloads). Even if the table also holds rows shared across tenants, mixed-mode tables MUST be tenant-private — never allow-list a table that could leak any tenant data.

**A table MAY be classified as `allow-list` (verdict = `allowlist`) ONLY if ALL of the following hold:**

1. Either the table has no `organisation_id` column (false-positive from the schema walker — rare but possible if the column was dropped in a later migration), OR the column is intentionally cross-tenant by design (system-wide reference data, cross-tenant audit ledger, system-incident telemetry — i.e. the population semantics are "every tenant writes here for system observation," not "this row belongs to one tenant").
2. The table is read-only OR all writes happen under a system-admin code path that does NOT process untrusted input (e.g. a maintenance job triggered by an internal scheduler, not an HTTP route). If any HTTP-route or webhook handler writes to the table, it is NOT allow-list-eligible — it is tenant-private (or the route is mis-designed).
3. No write to the table is conditioned on the writer's `organisation_id` such that a wrong `organisation_id` would silently corrupt another tenant's data. (Gut check: if a bug set `app.organisation_id` to the wrong tenant before this insert, would the insert end up in the wrong tenant's view? If yes, the table is tenant-private.)
4. There exists a citable invariant ID (`docs/pre-launch-hardening-invariants.md`) or spec-section anchor that documents *why* RLS doesn't apply. If the implementer cannot find such a citation, the table is tenant-private by default — defer the verdict and escalate.

**Tie-breaker for ambiguous cases.** When in doubt, classify as tenant-private and ship a policy. The cost of an unnecessary RLS policy is negligible (one extra DB roundtrip per query). The cost of a wrong allow-list is a multi-tenant data leak. Bias all judgement calls toward `tenant-private`.

**Hard invariant — mutual exclusion between manifest and allow-list.** A given table name MUST appear in `server/config/rlsProtectedTables.ts` OR `scripts/rls-not-applicable-allowlist.txt`, but NEVER both. The two files are mutually exclusive disposition lanes for the same decision; a table appearing in both is a split-brain — the gate's behaviour and the runtime guard's behaviour become disposition-dependent and the spec's "every tenant table is either policied or explicitly bypassed" invariant is violated. Concretely:

- The Phase 1 implementer MUST run `comm -12 <(awk '{print $1}' scripts/rls-not-applicable-allowlist.txt | sort -u) <(grep -oE "tableName: '\\K[^']+" server/config/rlsProtectedTables.ts | sort -u)` (or an equivalent diff) before pushing the final Phase 1 commit. Empty output is the pass condition. Non-empty output names the offending tables and MUST be reconciled before merge.
- The §3.5 step ordering already lands the manifest commit(s) before the allow-list commit, which makes accidental double-listing easy to spot in review (a later allow-list addition for a table already in the manifest is a clear scope error). The mutual-exclusion check above is the belt-and-braces verification.
- If a future change moves a table from one disposition to the other (e.g. a previously allow-listed system table grows tenant-scoped writes and needs RLS), the move MUST be a single commit that removes the entry from one file and adds it to the other — never a two-commit add-then-remove that would briefly violate the invariant.

**Hard escalation triggers** (implementer MUST stop and escalate to the user, not pick a verdict):

- The table mixes tenant-scoped writes with cross-tenant reads (e.g. an audit-style table that some tenants read from but only the system writes to). Architectural decision required — usually resolved by splitting the table.
- The owning migration is in a sister-branch path (§0.4) AND the table is borderline. Sister-branch authors own those tables; surface the verdict question in the deferred-items entry, do not pick a verdict here.
- The classification result conflicts with an existing entry in either manifest (`server/config/rlsProtectedTables.ts`) or allowlist (`scripts/rls-not-applicable-allowlist.txt`) for a closely-related table — implies prior drift; resolve by aligning both, not by adding inconsistent verdicts.

The rubric above MUST be cited (by §3.3.1 anchor) in the per-table notes column of `tasks/builds/pre-prod-tenancy/progress.md` for every table whose verdict is `allowlist`. Verdicts of `register` / `register-with-new-policy` need no citation — those are the default.

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
>
> **Progress-table lock (post-first-policy-migration).** Once the first `register-with-new-policy` migration is committed (i.e. the first `0245+` file lands), the verdicts in `tasks/builds/pre-prod-tenancy/progress.md` (the §3.4.1 mirror) become **locked** — no row may be reclassified after this point in the branch. Reclassification mid-flight is dangerous: a verdict change from `register-with-new-policy` to `allowlist` would orphan a policy migration that has already been committed; a change in the opposite direction would silently skip the migration the verdict now requires. If a reclassification is genuinely needed (e.g. the implementer discovers mid-Phase-1 that a table thought to be tenant-private is actually system-wide), the implementer MUST: (a) revert the affected policy migration commit (and any subsequent commits that depend on it); (b) update the verdict in `progress.md`; (c) re-author the work along the new verdict. The "no silent reclassification" invariant is what makes the progress table a reliable single source of truth for the §3.4.1 deliverable.
>
> **Table-set freeze invariant (per classification cycle).** The progress-table lock above covers VERDICT changes within a fixed table set; this invariant covers changes to the table SET itself. The §3.4.1 table set is **frozen per classification cycle** — it is the snapshot of `verify-rls-protected-tables.sh` output at the moment Phase 1 classification was authored. Any change to the gate-emitted table set (a sister-branch merge that adds new tenant tables, a `main` merge that drops a table the gate previously surfaced, a renamed table that disappears under the old name and reappears under a new one, a new tenant column added to an existing table that pushes it from "not gate-detected" to "gate-detected") **invalidates the current classification cycle** and requires a new `## Post-merge classification delta` entry per §8.4 BEFORE further work proceeds. Verdicts authored against a since-superseded table set are NOT trustworthy for the new cycle — the implementer cannot wave at "the verdicts are still valid for these tables, the new tables just need new verdicts" without explicitly re-running the §3.3.1 rubric on every entry, because a table that was previously gate-detected may have changed its policy state under main and now warrants a different verdict. Mental model: classification is always tied to a snapshot, and a snapshot is invalidated by any change to its inputs.

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

**Hard requirement:** before dropping `task_activities` / `task_deliverables`, grep `migrations/*.sql` for `CREATE POLICY .* ON "?tasks"?` AND confirm the policy on `tasks` includes BOTH a `USING` clause (controls which rows are visible to SELECT/UPDATE/DELETE) AND a `WITH CHECK` clause (controls which rows can be inserted or updated to). A `USING`-only policy is not sufficient: it would permit a tenant to mutate a row's `organisation_id` to another tenant's id. Specifically:

- Run `grep -nE "CREATE POLICY .* ON \"?tasks\"?" migrations/*.sql` and read the matching policy block.
- Confirm the block contains both `USING (...)` and `WITH CHECK (...)` clauses, each gated on `organisation_id = current_setting('app.organisation_id', true)::uuid` (plus the standard non-null guards from §2.1's canonical shape).
- If `USING` is present but `WITH CHECK` is missing, the parent is partially-policied — escalate as a finding and do NOT drop the child registry entries. The fix is to ship a parent-EXISTS policy on the child OR to backfill `WITH CHECK` on the parent (separate spec — out of scope here).
- If both clauses are present, drop the registry entry per the verdict above.

The same `USING` + `WITH CHECK` requirement applies to any parent-EXISTS policy authored as a `register-with-new-policy` migration in the `0245+` range (the `0229` reference shape per §2.1 already includes both — implementers cannot omit `WITH CHECK` and copy from `0229`).

#### §3.4.3 Caller-level `allowRlsBypass` justification-comment violations (2)

| Caller | Current state | Verdict |
|---|---|---|
| `server/services/systemMonitor/baselines/refreshJob.ts:39` | `allowRlsBypass: true` flag at line 39, justification comment exists at line 37 (two lines above) — outside the gate's +/-1-line window. | **Move the comment** from line 37 onto line 38 (immediately above the flag) so the gate's heuristic sees it. Do not change the substantive justification — it is already specific ("cross-tenant aggregate reads against agent_runs / agents"). |
| `server/services/systemMonitor/triage/loadCandidates.ts:45` | Same pattern — `allowRlsBypass: true` without an inline justification comment within +/-1 line. | Same fix — add (or move) the justification comment to within +/-1 line of the flag. The substantive justification must name the cross-org operation per the gate's rejection of vague text ("needed", "admin work"). |

`server/services/systemMonitor/**` is not in either sister-branch scope-out list (§0.4); these edits land in this branch.

### §3.5 Implementation approach

1. **Inventory output.** Implementer fills the §3.4.1 table with verdicts per the §3.3 rules. Output is committed to `tasks/builds/pre-prod-tenancy/progress.md` before any code changes.
2. **Group by verdict.** Tables with `register` (policy already exists) → registry-only edit. Tables with `register-with-new-policy` → batch into `0245+` migrations (up to 4 per file when the canonical org-isolation shape applies; standalone files for parent-EXISTS or custom shapes). Tables with `allowlist` → append to `scripts/rls-not-applicable-allowlist.txt` with the prescribed rationale + `[ref: ...]` + per-caller annotations.
3. **Apply edits in this order** so each commit leaves the gate strictly less broken than the prior commit. The gate is wired into `run-all-gates.sh` FIRST (sub-step 3.1) so that every subsequent commit on the branch is evaluated against it — temporary CI failure during sub-steps 3.2–3.6 is expected and accepted (per `commit_and_revert` rollout per §0.1: there is no production exposure to a temporarily-failing gate, only the local branch). Wiring the gate last would mean every regression introduced during sub-steps 3.2–3.6 is silent until the very last commit; wiring it first surfaces regressions at the commit that introduces them, which is the whole point of having a gate. The known-red CI window this creates is documented in §3.5.1 below — read it before pushing the gate-wiring commit.

   1. **Wire the gate** — add `run_gate "$SCRIPT_DIR/verify-rls-protected-tables.sh"` to `scripts/run-all-gates.sh`. From this commit onwards every branch commit is CI-evaluated against the gate (CI is the only place gates run — per CLAUDE.md). Expected state: **gate fails in CI** until the rest of Phase 1 lands; reviewers evaluate PR head only per §3.5.1.
   2. Drop the 4 stale entries from `server/config/rlsProtectedTables.ts`.
   3. Append all `register` (policy-exists) entries to the manifest.
   4. Author + apply all `register-with-new-policy` migrations (`0245+`), one migration file per commit.
   5. Append `allowlist` entries to `scripts/rls-not-applicable-allowlist.txt`.
   6. Resolve the §3.4.3 caller-level violations on the two `systemMonitor` files (move/add the inline `// allowRlsBypass: ...` justification comment within +/-1 line of the flag).
   7. **Confirm the gate exits 0** in CI on the head of `pre-prod-tenancy`. This is the Phase 1 acceptance criterion (§3.6).
4. **No edits to historical migrations.** The repo is append-only on migrations; if a tenant table's owning migration omitted RLS, the fix is a NEW migration, not an edit to the historical file.
5. **No source edits in sister-branch areas.** If a table whose owning migration is `agentRuns.ts` (sister branch territory) needs a registration, the registry edit is permitted (the manifest is shared); the schema file and the table-creation migration are not touched. New policy migrations on those tables are deferred to the sister branch via a `## Deferred Items` entry — see §9.

#### §3.5.1 Expected red-CI window (Phase 1)

Wiring the gate first (§3.5 step 3 sub-step 1) creates a known consequence: **CI on `pre-prod-tenancy` will fail from sub-step 3.1 through sub-step 3.6 of §3.5.** This is by design, but it has to be made explicit so reviewers and the implementer don't lose signal during the window.

- **Where the red lives.** `verify-rls-protected-tables.sh` will exit non-zero in CI for every commit between sub-step 3.1 (gate wiring) and sub-step 3.7 (acceptance reverification). All other gates in `scripts/run-all-gates.sh` are expected to remain green; the implementer MUST verify on every Phase 1 commit that **only** `verify-rls-protected-tables.sh` is the failing gate. If any other gate goes red during this window, that is a real regression and stops Phase 1 immediately (do not push another commit until it is green again).
- **Mechanical check (paste CI gate summary into PR description).** "Verify only one gate is red" is unenforceable as a thought; it is enforceable as a paste. The Phase 1 PR description MUST contain a block of the exact form:

  ```
  ## CI gate state — Phase 1 known-red window
  As of commit <sha>:
  - verify-rls-protected-tables.sh : RED (expected — see §3.5.1)
  - verify-rls-coverage.sh         : <GREEN | RED>
  - verify-rls-contract-compliance.sh : <GREEN | RED>
  - verify-rls-session-var-canon.sh : <GREEN | RED>
  - <every other gate run-all-gates.sh executes> : <GREEN | RED>
  ```

  Every gate in `run-all-gates.sh` is listed by name, with its current status. The implementer pastes the block at the time of opening (or updating) the PR; the reviewer's first action is to confirm that ONLY `verify-rls-protected-tables.sh` reads `RED`. Any other RED entry is an automatic reject — the implementer must fix the unrelated regression before review can proceed. This converts the "only this gate is red" intent into a one-glance verification.

  **The gate list MUST be sourced from the most recent CI run's output, not maintained manually and not produced by running the harness locally.** Per CLAUDE.md, `run-all-gates.sh` is forbidden as a local invocation — it is a CI-only harness. A manually-curated list silently omits any new gate CI picks up after this spec was written; that's the failure mode this rule closes. The implementer's procedure:

  1. Push the commit to the branch.
  2. Wait for the CI run associated with that commit to complete (or the most recent CI run if updating an existing PR).
  3. Read the gate names + statuses from the CI run's `[GATE] <name>: violations=<n>` lines (or the equivalent harness output format CI produces).
  4. Paste the resulting list into the block above, annotating GREEN / RED based on each gate's CI-reported exit code.

  If the implementer has no CI output to read (e.g. CI hasn't run yet for the latest commit, or CI is offline), the gate-status block is marked `pending CI` and the PR is held until CI produces output — the spec does NOT permit "I'll run the harness locally to fill this in." If the most recent CI run produces a gate the reviewer doesn't recognise, that is a feature: the contract surfaces the new gate's existence and forces an explicit colour annotation. Any "I dropped this gate from the list because it wasn't relevant to Phase 1" claim is a reject — the list IS the CI run's output for the branch tip, not a curated subset.
- **Reviewer expectation.** Reviewers (`pr-reviewer` and any human reviewer) MUST evaluate the **PR head**, not intermediate commits. Intermediate-commit CI red is expected and not a finding. The PR description for the Phase 1 PR MUST state: "CI fails on intermediate commits by design — see spec §3.5.1; evaluate head only." Without that note, a reviewer reading the per-commit CI history will (correctly) flag the broken builds.
- **Branch trust posture.** No commit on `pre-prod-tenancy` is treated as merge-eligible until sub-step 3.7 confirms the gate exits 0 on the head. If anyone (including the implementer) is tempted to ship an intermediate commit to a sister branch or deploy from it, STOP — the branch is in a known-red state and the assertion of correctness only applies at the final head.
- **No new flag, no skip mechanism.** `PROTECTED_TABLES_PHASE_COMPLETE` env-flag-style bypasses are explicitly NOT introduced here — that would be a new primitive and violates §0.1's `prefer_existing_primitives_over_new_ones`. The known-red window is documented and time-bounded; that is the contract.
- **Squash-on-merge is the disposition.** When the Phase 1 PR is merged, the merge commit on `main` MUST be squashed (or rebased to a single commit) so the noisy intermediate-red history does not pollute `main`'s commit history. The per-commit cadence inside the branch (manifest commits, migration commits, allowlist commit, caller-fix commit per §8.2) is for in-branch reviewability — it is NOT the shape of the change as it lands on `main`.

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

The migration is split into a **mandatory pre-check** (run by the implementer before authoring the SQL) and the **forward migration** (which assumes the pre-check passed). The pre-check is what removes the lossy implicit-default behaviour the earlier draft relied on.

#### §4.2.0 Mandatory pre-check (implementer responsibility)

Before authoring or applying `0244`, the implementer MUST run this query against every database the migration will be applied to (the dev DB at minimum; any other database where row history matters):

```sql
SELECT intervention_id, COUNT(*) AS dupes
FROM intervention_outcomes
GROUP BY intervention_id
HAVING COUNT(*) > 1;
```

Three possible outcomes:

- **Empty result (zero duplicates).** Default expectation — the per-row advisory-lock + claim-verify pattern in the legacy job should have made duplicates impossible. Proceed to §4.2.1's forward migration. The migration carries no `DELETE` because there is nothing to dedup; if a future write somehow lands a duplicate between the pre-check and the migration, the `LOCK TABLE` in the forward migration plus the unique-index creation will surface it as a transactional failure (rolled back), not silently keep the wrong row.
- **Non-empty result, but a deterministic "correct row" rule applies.** E.g. "for any duplicate set on `intervention_id`, the row with the most recent `created_at` carries the canonical outcome." If and only if such a rule can be stated and defended in writing, the implementer commits the rule to `tasks/builds/pre-prod-tenancy/progress.md` (one paragraph: which column distinguishes the correct row, why that semantic is correct, citation to the schema field's role) AND modifies the forward migration to dedup by that rule (NOT by `ctid`). The rule MUST refer to a real, semantically meaningful column — `ctid` is not such a column (it is physical-row-position, not write-order, and is not a stable identity).
- **Non-empty result, no deterministic rule.** STOP. Do not apply the migration. Surface the duplicate set to the user with the count and a sample (5–10 rows for the most-duplicated `intervention_id`); the resolution is a one-off data-cleanup decision, not a migration-time default. Acceptable resolutions include: (a) manually selecting the canonical row per dup-set after inspection; (b) deciding the dup-set is corrupt and dropping all of it; (c) adjusting the schema to disambiguate. None of these can be safely defaulted inside the migration.

The implementer records the pre-check result (count of dup `intervention_id` values, sample if non-zero, chosen resolution path) in `tasks/builds/pre-prod-tenancy/progress.md` BEFORE committing `0244`. A `0244` commit without the pre-check note is rejected at review time.

**Pre-check timing — read consistency contract.** The pre-check is informational only if it ran "some time" before the migration applies — a writer landing a duplicate between the pre-check and `0244`'s `LOCK TABLE` would silently invalidate the result. To close this window, the pre-check MUST be run under one of:

1. A `REPEATABLE READ` (or stricter) transaction that holds across both the pre-check query and the migration apply, OR
2. **Immediately before** `0244` is applied (same maintenance window, no writer activity in between — pre-prod framing per §0.1 makes this realistic; there is no live agency / live user to interleave writes).

If the implementer takes path 2 (immediate-before-apply rather than `REPEATABLE READ`), the DB MUST be in a known **write-quiescent state** when the pre-check runs and remain quiescent until the migration's `LOCK TABLE` engages. Specifically: no pg-boss workers consuming jobs that touch `intervention_outcomes`, no `measureInterventionOutcomeJob` schedule actively firing, no manual scripts mid-run, no other developer's local server connected to the same database. The pre-prod framing makes this *plausible*, not *guaranteed* — quiescence is a property the implementer must verify (e.g. `SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%'` should return 1 for the implementer's own session) and document in `progress.md` alongside the pre-check result. Without an explicit quiescence check, path 2 is indistinguishable from a `REPEATABLE READ`-violating "ran the query yesterday" scenario; the reviewer treats unverified quiescence as if path 1 were not honoured either.

The migration itself acquires `ACCESS EXCLUSIVE` (§4.2.1), which closes the window once it begins; the pre-check timing constraint exists to ensure the implementer's *decision* (zero duplicates → no dedup; non-zero → STOP-or-rule) is based on a state that the migration will actually encounter. If the pre-check ran a day before the migration applies, that constraint is violated; re-run the pre-check immediately before applying.

#### §4.2.1 Forward migration (assumes pre-check passed)

Migration `0244_intervention_outcomes_unique.sql`:

```sql
-- Replace the non-unique index with a UNIQUE index on intervention_id.
-- The existing index is named `intervention_outcomes_intervention_idx`
-- (per server/db/schema/interventionOutcomes.ts:35) and was added by an
-- earlier migration; the unique replacement enforces exactly-once
-- write semantics for measureInterventionOutcomeJob.
--
-- §4.2.0 pre-check: implementer has confirmed either zero pre-existing
-- duplicates OR has applied a deterministic, reviewer-vetted dedup rule
-- (recorded in tasks/builds/pre-prod-tenancy/progress.md). The migration
-- below assumes that pre-check has happened; it does NOT default to a
-- ctid-based dedup. If duplicates exist at apply time without a vetted
-- rule, the LOCK + CREATE UNIQUE INDEX path below will fail loudly and
-- roll back — the correct outcome.

-- Acquire ACCESS EXCLUSIVE on the table for the migration's duration.
-- This closes the race window between any pending pre-existing duplicate
-- and the unique-index creation: no concurrent writer can land a new row
-- between the dedup (if any) and the index. ACCESS EXCLUSIVE is heavier
-- than the migration strictly needs, but pre-prod framing (§0.1) means
-- there is no live agency / live user impact from briefly blocking writes.
LOCK TABLE intervention_outcomes IN ACCESS EXCLUSIVE MODE;

-- (Optional) Conditional dedup block — only present if §4.2.0 produced
-- a deterministic rule. Example for the "most-recent created_at wins"
-- case (DO NOT include this block unless the rule was actually applied
-- per §4.2.0):
--
-- DELETE FROM intervention_outcomes a
-- USING intervention_outcomes b
-- WHERE a.intervention_id = b.intervention_id
--   AND a.created_at < b.created_at;
--
-- The default form of `0244` carries NO dedup block — the pre-check
-- confirmed zero duplicates and the LOCK above prevents new ones.

DROP INDEX IF EXISTS intervention_outcomes_intervention_idx;
CREATE UNIQUE INDEX intervention_outcomes_intervention_unique
  ON intervention_outcomes (intervention_id);
```

The `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` is held for the migration's transaction lifetime (transactional DDL guarantees this); concurrent writers block until the migration commits or rolls back. Combined with the `0244.down.sql` companion (§2.1) and the §4.2.2 rollback posture, this gives a deterministic migration outcome regardless of writer activity.

#### §4.2.2 Rollback posture for the unique-index migration

If `0244` causes unexpected conflicts on a prod-like fixture during pre-merge (e.g. the §4.2.0 pre-check missed a duplicate, or the chosen dedup rule kept the wrong row):

- The `.down.sql` companion drops the unique index and recreates the non-unique index. It does NOT restore any rows the optional dedup `DELETE` removed — once that `DELETE` is committed, those rows are gone. Implementers MUST take a `pg_dump` of `intervention_outcomes` before applying `0244` against any database whose row history matters (the dev DB rarely qualifies; pre-prod framing means there is no other database where it would).
- If the `CREATE UNIQUE INDEX` itself fails inside the migration's transaction (transactional DDL), the entire migration rolls back — including the `LOCK TABLE` and any optional dedup `DELETE`. PostgreSQL's transactional DDL is the safety net here; the dump is for the case where rollback succeeds but the implementer realises post-hoc that the wrong row was kept by a dedup rule.
- The job's caller contract change (`recordOutcome` returning `boolean`) is independent of the migration — it can be reverted by reverting the source-only commit (§8.2 splits the schema commit from the code commit specifically to enable this).

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

`interventionService.recordOutcome` becomes the single owner of the insert. Its signature changes from `Promise<void>` to `Promise<boolean>` (the existing input shape is already a single inline object literal — see `server/services/interventionService.ts:53–70` — and is reused unchanged).

**Invariant — single-writer (grep-able):** `interventionService.recordOutcome` is the ONLY writer to the `intervention_outcomes` table after this refactor. No other call site may `INSERT` / `UPDATE` / `UPSERT` into `intervention_outcomes`. The invariant is enforced by reviewer grep, similar to the allow-list contract (§7.5):

```bash
# Should return exactly ONE write site — interventionService.recordOutcome's
# body. Any other hit is a violation of the single-writer invariant.
grep -rnE "(interventionOutcomes|'intervention_outcomes')" server/ \
  | grep -E "(\.insert\(|\.update\(|onConflict|sql\`(INSERT|UPDATE))"
```

Reviewers (`pr-reviewer` and any future PR reviewer) MUST run the grep above on any PR that touches files containing `interventionOutcomes` references and confirm the single-writer invariant holds. Adding a second writer is permissible only by explicit spec amendment — never silently. The Phase 2 PR's PR description MUST include the grep output for the post-refactor state, with one expected hit (the new `recordOutcome` body) and zero unexpected hits. If the grep returns more than one hit at PR open time, the implementer reconciles before review proceeds.

**Reviewer must manually confirm each grep hit is a write operation.** The regex above (`(\.insert\(|\.update\(|onConflict|sql\`(INSERT|UPDATE))`) matches substrings — those substrings can also appear in: (a) comments and JSDoc, (b) log strings (`logger.info('intervention insert blocked')`), (c) variable names (`const insertCandidate = ...`), (d) type-import shims that re-export Drizzle helpers, (e) test fixtures setting up legacy state. Each hit's source-line context MUST be opened and inspected; a hit is only counted against the single-writer invariant if the source line is **executing** an `INSERT`, `UPDATE`, `UPSERT`, or `onConflict*` operation against `intervention_outcomes` at runtime. Non-write hits (read queries, comments, log strings, unused-import lines, test-fixture setup) are NOT violations and MUST NOT be counted — over-rejection on substring noise is itself a reviewer error. Spurious-hit confirmation is a reviewer responsibility (not the implementer's): the implementer's PR description states "1 hit" plus a one-line per-hit annotation (`<file>:<line> — write | read | comment | log | import`); the reviewer verifies the annotation against the source, not against the grep alone.

**Future schema evolution clause.** The single-writer invariant covers application-code writers caught by the grep above — but the grep cannot see Postgres-side writers. Future schema changes, triggers, jobs, or migrations that write to `intervention_outcomes` MUST EITHER:

  (a) **route through `interventionService.recordOutcome`** (typically by enqueuing a job that calls the service rather than writing direct SQL), preserving the single-writer invariant unchanged; OR
  (b) **explicitly amend this spec's single-writer invariant**, adding the new writer as a named exception with a justification and a contract for how it preserves the `intervention_outcomes(intervention_id)` uniqueness guarantee. A spec amendment of this kind requires the same review trail as any other Major spec change: re-author the §4.3 invariant block, run `spec-reviewer`, get pr-review approval before the new writer's code merges.

Specifically forbidden without (a) or (b):

- A Postgres `BEFORE INSERT` / `AFTER INSERT` / `BEFORE UPDATE` trigger on `intervention_outcomes` that performs additional writes to the same table (e.g. an audit-row insert into the same table). The unique constraint catches duplicates; a trigger that inserts secondary rows bypasses the constraint and the single-writer invariant simultaneously.
- A `BACKFILL: insert one outcome row per intervention` migration. If historical data needs to be backfilled, the migration MUST drive the backfill through `recordOutcome` (e.g. by reading rows from a staging table and calling the service in a loop, with `ON CONFLICT DO NOTHING` doing its job) OR amend the invariant per (b).
- A new background job that writes to `intervention_outcomes` directly (e.g. a "reconcile orphaned outcomes" sweep). The reconciliation logic MUST live in the service and be invoked from the job; the job itself does not write SQL.

The clause exists because the invariant is what makes `recordOutcome`'s ON CONFLICT semantics safe under racing writes (§4.5): if a second writer exists, `wrote=false` no longer means "row was already inserted by an earlier `recordOutcome` call" — it might mean "a trigger fired between the SELECT and the INSERT." That ambiguity is what the unique constraint was meant to remove; a non-conforming writer puts it back.



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
- **Pass condition (relative — required):** the new path is **at least 5× faster** than the legacy path on the same fixture. Record both legacy rows/sec/org and new rows/sec/org in `tasks/builds/pre-prod-tenancy/progress.md` so the speedup is reproducible.
- **Pass condition (absolute — required):** the new path achieves **≥ 200 rows/sec/org sustained throughput** on the §4.7 fixture (or the smaller §4.7 fallback fixture below). The relative-only "5× faster" assertion is gameable on a tiny dataset where both paths complete in milliseconds and noise dominates — the absolute floor closes that loophole. 200 rows/sec/org is a conservative baseline derived from a single PostgreSQL `INSERT ... ON CONFLICT` taking 1–5ms in a non-saturated test DB; a path that cannot beat 5ms/row per org is not delivering the schema change's performance benefit. If the implementer measures a clear local-environment ceiling (e.g. the test DB is on a slow disk and even the new path can't beat 80 rows/sec/org), capture the measured ceiling in `progress.md` and route the absolute floor to `tasks/todo.md` (§9) for re-measurement on a representative environment.
- **Pass condition (correctness — required):** `summary.written` matches the eligible-row count exactly across both runs (the new path must not drop or double-count rows).

If the load test cannot be set up locally because of seed-data dependencies, the spec defers the absolute rows/sec/org figure to a `tasks/todo.md` entry (see §9) but the **5× speedup vs. legacy AND the ≥ 200 rows/sec/org absolute floor** must still be demonstrated against a smaller fixture (e.g. 1,000 rows / 2 orgs). Both numbers must be captured; only the *upgrade* to the full 10,000-row fixture is deferrable.

### §4.8 Acceptance criteria

- `migrations/0244_intervention_outcomes_unique.sql` and its `.down.sql` companion exist; the forward migration applies cleanly to a fresh DB; the down migration reverses it cleanly.
- `server/db/schema/interventionOutcomes.ts:35` uses `uniqueIndex(...)`.
- `server/jobs/measureInterventionOutcomeJob.ts` no longer contains `pg_advisory_xact_lock` or `db.transaction(` for the per-row write path. The `try/catch` block remains for non-`23505` errors only.
- `interventionService.recordOutcome` (in `server/services/interventionService.ts` or wherever it lives) uses `.onConflictDoNothing({ target: interventionOutcomes.interventionId })`.
- Pure test (`server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts` — extend if it exists) asserts the decision-classifier shape is unchanged.
- Load-test result appears in `tasks/builds/pre-prod-tenancy/progress.md` with all THREE numbers: legacy rows/sec/org, new rows/sec/org, and the multiplier. Both the relative pass condition (≥ 5× speedup vs. legacy) and the absolute pass condition (≥ 200 rows/sec/org) must be demonstrated against either the full §4.7 fixture (10,000 rows / 5 orgs) or the smaller fallback fixture (1,000 rows / 2 orgs). Only the *upgrade* from the fallback fixture to the full fixture is deferrable to §9 — both pass conditions ship.
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

- The outer admin tx exits as soon as enumeration finishes. The advisory lock (if used for cross-job exclusion) is held only for enumeration, not for the entire sweep. **If the existing advisory lock was protecting the per-org work, the lock semantics change** — this is not hypothetical, it is the most likely regression vector for Phase 3.
- Per-org work now runs under the tenant role with `app.organisation_id = org.id` set by `withOrgTx`. Any RLS-protected table the per-org function reads or writes must have an `organisation_id = current_setting('app.organisation_id', true)::uuid` filter in its policy, which it already does for canonical tables.
- `applyDecayForOrg` and the equivalent functions in the other two jobs accept the org-scoped tx instead of the admin tx. Their internal SQL must already match this contract — they should not contain `SET LOCAL ROLE admin_role` or admin-only operations. Verify before lifting.

#### §5.2.1 Advisory-lock audit — MANDATORY pre-change (Pattern A vs. Pattern B)

Before any Phase 3 commit lands for a given job, the implementer MUST complete the audit below and commit the verdict to `tasks/builds/pre-prod-tenancy/progress.md` (one paragraph per job — naming Pattern A or Pattern B and the line numbers consulted). This audit is NOT advisory — Phase 3 commits without an audit verdict are rejected at review time.

**Audit procedure (per job):**

1. **Find the lock.** Identify every `pg_advisory_xact_lock` / `pg_try_advisory_lock` / equivalent call inside the existing `withAdminConnection({ source }, async (tx) => ...)` block. The current shape acquires the lock once at the top of the admin tx (e.g. `ruleAutoDeprecateJob.ts:169`).
2. **Identify all writes within the lock's scope.** Inside the admin tx, list every `INSERT`, `UPDATE`, `DELETE` statement (including those inside helper functions called from the per-org block — recursively trace `applyDecayForOrg` and any callees). Use `grep -nE "(\.insert\(|\.update\(|\.delete\(|sql\`(INSERT|UPDATE|DELETE))"` against the job file and any helpers it calls.
3. **Classify each write:**
   - **Enumeration-scope** writes: e.g. updating a `last_run_at` row in a system-level table; counting orgs; logging the run start. These do NOT depend on per-org mutual exclusion.
   - **Per-org-scope** writes: e.g. the per-org decay update, the per-org pruning delete, the per-org recalibration insert. These DO depend on per-org mutual exclusion if any concurrent runner could race them on the same org.
4. **Decide the pattern:**
   - If ALL writes are enumeration-scope → **Pattern A** (lock is enumeration-only). Default and expected for all three jobs.
   - If ANY write is per-org-scope AND that write is not idempotent on its own (i.e. running it twice on the same org would produce a wrong result) → **Pattern B** (lock must guard per-org work). The Phase 3 commit MUST acquire a session-level advisory lock outside `withOrgTx` per org.
   - If unable to determine confidently → **default to Pattern B**. Implementing Pattern B for a Pattern-A-eligible job is over-engineered but correct; implementing Pattern A for a Pattern-B-actual job is a race-condition introduction. Bias toward correctness.
5. **If the audit reveals a per-org write that cannot cleanly be expressed under a session-level lock** (e.g. the lock is implicitly tied to the in-tx state via `SELECT ... FOR UPDATE` rather than a named advisory key), defer that job to a follow-up branch and capture in §9. The other two jobs still ship.

The audit is not optional. The line "implementer MUST grep for writes inside the per-org function and confirm whether they rely on mutual exclusion" is the procedural restatement of step 2 above, applied to every job individually.

**Audit-deliverable enforcement (commit message + PR description + reviewer checklist):**

The §5.2 / §5.6 / §5.2.1-step-3 audit verdict is easy to skip if the only requirement is "commit a paragraph to `progress.md`". Phase 3 commits MUST therefore carry the audit verdict in three places, every one of which is checkable at review time:

1. **Commit message — required first line.** Every Phase 3 commit MUST include in its commit body a line of the exact form:

   ```
   advisory-lock-audit: pattern-A | line N1, N2 (writes); line N3 (lock acquisition)
   ```

   or

   ```
   advisory-lock-audit: pattern-B | line N1, N2 (writes); line N3 (lock); session-lock impl line N4
   ```

   `<line N>` references must point at real source lines in the job file at the time of the commit. A commit without this line is rejected.

2. **PR description — required block.** The Phase 3 PR description MUST contain a block of the exact form:

   ```
   ## Phase 3 advisory-lock audits
   - ruleAutoDeprecateJob.ts        : Pattern A | writes lines 161, 198 | lock line 169
   - fastPathDecisionsPruneJob.ts   : Pattern A | writes lines 90, 127 | lock line 102
   - fastPathRecalibrateJob.ts      : Pattern A | writes lines 108, 154 | lock line 116
   ```

   (lines are illustrative — implementer fills the actual values). One row per job; `Pattern A` or `Pattern B`; the per-job paragraph in `progress.md` (§5.6) is the long form, this PR-description block is the at-a-glance form for the reviewer.

3. **Reviewer checklist item — explicit reject criterion.** `pr-reviewer` and any human reviewer MUST treat "advisory-lock audit not explicit (commit message line + PR description block)" as an automatic reject, not a soft suggestion. This is documented in `tasks/review-logs/README.md` review contract and surfaces in `pr-reviewer`'s checklist for any commit that touches `server/jobs/{ruleAutoDeprecateJob,fastPathDecisionsPruneJob,fastPathRecalibrateJob}.ts`.

If the audit verdict in any of the three places (commit message, PR description, `progress.md` paragraph) disagrees with the others — same job classified as Pattern A in one and Pattern B in another, or different line numbers — the commit is rejected and the implementer reconciles before re-pushing. Soft-enforcement of this audit was the failure mode the previous draft was at risk of; the three-place requirement closes it.

**Reviewer cross-check (mandatory before approval).** Three sources only enforce the audit if a reviewer actually cross-checks them. The reviewer (`pr-reviewer` and any human reviewer) MUST:

- Pick at least ONE of the three jobs at random.
- Open all three sources (commit message body for that job's commit, the PR-description block, the `progress.md` paragraph for that job).
- Verify the Pattern (A or B), the line numbers, and the lock-acquisition reference are byte-identical across all three.
- If they match, the cross-check passes for that job AND establishes confidence that the implementer's process produced consistent triplets — the other two jobs are spot-checked for plausibility (Pattern declared, line numbers in range) but not byte-checked.
- If they do not match for the chosen job, the PR is rejected and ALL three jobs are re-cross-checked after reconciliation.
- **Reviewer SHOULD vary which job is byte-checked across reviews when Phase 3 lands as multiple PRs (e.g. one PR per job per §8.2).** Always picking the same job (e.g. `ruleAutoDeprecateJob` because it's listed first) defeats the random-spot-check intent — over multiple PRs the implementer would learn that one job gets bytewise scrutiny and the others don't. If the reviewer kept a per-PR record of which job was chosen (e.g. in the `pr-reviewer` log), they SHOULD pick a job not chosen in the prior Phase 3 PR. This is a SHOULD, not a MUST — the random selection within a single PR is the load-bearing rule; cross-PR rotation is a polish that prevents predictable selection bias.

Reviewers MUST note in the `pr-reviewer` log which job was chosen for the byte-check, so the reader of the review log can re-derive the audit chain. A `pr-reviewer` log that approves a Phase 3 PR without a recorded cross-check job is itself rejected at the next-level review.

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
- **Migration-number-ceiling overflow rule (hard).** If Phase 1 fills the `0245–0255` reservation (eleven slots — `0244` is reserved for Phase 2) and still has unregistered tables remaining, the implementer MUST **STOP Phase 1 immediately**. Specifically:
  - Do NOT reuse a migration number that has already been committed on this branch (renumbering breaks downstream consumers; the migrations table is append-only).
  - Do NOT expand the migration range mid-branch (taking `0256+` would conflict with whatever sister branch or follow-up branch reserves the next range; reservation is a coordination contract, not a suggestion).
  - Do NOT pack additional tables into already-committed migration files (those files are reviewed and approved as a batch; widening them post-review hides scope from reviewers).
  - DO defer the remaining unregistered tables to a follow-up branch with its own migration reservation. Capture the remainder list in `tasks/todo.md § Deferred from pre-prod-tenancy spec` with the table names + intended verdict (`register-with-new-policy` per §3.3) so the follow-up can pick up cleanly without redoing the §3.3.1 rubric.
  - DO surface the overflow to the user before pushing further commits — this is an architectural condition that justifies the rescope, not an implementer-side decision.
  - **DO call out the overflow in the PR description as an explicit block** (not buried in a commit message or progress.md note). Without an explicit PR-description callout, the partial Phase 1 looks like incomplete work to a reviewer, not a deliberate rescope. Required block (placed near the top of the PR description, after `## Summary`):

    ```
    ## Phase 1 migration-number overflow — deliberate rescope
    Available migration slots in this branch (0245–0255): 11
    register-with-new-policy verdicts produced: <N> tables → <M> migration files needed (per §2.1.1 batching)
    Overflow: M > 11 → STOP rule triggered (§6 hard rules)
    Tables landing in this branch: <list of tables that fit in the 11 slots>
    Tables deferred to follow-up branch: <list>
    Deferred-items entry: tasks/todo.md § Deferred from pre-prod-tenancy spec — see "Phase 1 migration-number-ceiling overflow"
    ```

    Reviewers treat this block as a deliberate-rescope marker; without it, the partial Phase 1 is a rejected-as-incomplete PR.
  - The `register` (policy-already-exists) and `allowlist` verdicts do NOT consume a migration number — they only consume manifest / allowlist entries — so the overflow trigger is specifically the count of `register-with-new-policy` verdicts exceeding the available migration slots after batching per §2.1.1. Implementers MUST run a pre-flight count of `register-with-new-policy` rows before authoring the first `0245+` migration; if the count exceeds (4 × number of canonical-shape files possible) + (1 × number of parent-EXISTS tables) and the total migration files would exceed 11, the rescope is triggered before any migration is written.
  - **The pre-flight count itself MUST be recorded in the PR description BEFORE the first `0245+` migration commit lands** — visibility is what makes the STOP-rule reviewer-enforceable. Required block in the Phase 1 PR description (placed after `## Summary`, even when no overflow occurs):

    ```
    ## Phase 1 migration-number pre-flight count
    register-with-new-policy verdicts: <N> tables
    Canonical-shape tables (batched up to 4 per file): <C> tables → ceil(C/4) files
    Parent-EXISTS tables (1 file each):                <P> tables → P files
    Total 0245+ migration files needed:                ceil(C/4) + P = <T>
    Available migration slots (0245–0255):             11
    Outcome: <T <= 11 → no overflow, proceed | T > 11 → STOP rule triggered (§6 hard rules)>
    ```

    If the pre-flight count is missing from the PR description, the reviewer rejects the PR even when the actual count would have been within limits — the missing number means the rescope decision (or the no-rescope decision) was not made *deliberately* before the migration commits, and the reviewer cannot verify the STOP rule was honoured. When overflow does occur, the larger `## Phase 1 migration-number overflow — deliberate rescope` block above supersedes this one (the deferred-table list and overflow callout are the more informative version); without overflow, this short block alone is sufficient.

---

## §7 — Test matrix

Per `runtime_tests: pure_function_only` framing, this section is sparse by design. Static gates carry most of the verification load.

### §7.1 Static gates (CI invariants — primary)

These are CI-only invariants the post-merge branch head MUST satisfy. Per CLAUDE.md, none of them are runnable locally — gate names appear here as identifiers, not as commands. The implementer reads each gate's status from the latest CI run; the reviewer reads the same.

**Authority rule (load-bearing).** Local execution of gate logic is non-authoritative and MUST NEVER be used for pass/fail decisions, even when local execution would be technically possible. CI is the single source of truth for every gate listed in this section; a passing local invocation is not evidence of a passing gate, and a failing local invocation is not evidence of a failing gate. The asymmetry is by design — local environments drift (out-of-sync schema, stale node_modules, missing env vars, different Postgres version), and the cost of "works on my machine" passing while CI fails on `main` is a regression that ships. This rule binds every future contributor and every future agent: if a gate appears in the table below, its disposition is determined by CI output and only by CI output.

| Gate (CI-only identifier) | What CI verifies | Phase |
|---|---|---|
| `verify-rls-protected-tables.sh` | Schema-vs-registry diff (Phase 1 deliverable: exit 0). | Phase 1 |
| `verify-rls-coverage.sh` | Every manifest entry has a matching `CREATE POLICY` in some migration. New entries from Phase 1 must satisfy this gate. | Phase 1 |
| `verify-rls-contract-compliance.sh` | No direct DB access from `server/lib/` or `server/routes/` outside the allow-list. Should be no-op for this branch (Phase 1 doesn't touch lib/route files; Phase 2 only edits `server/jobs/`). | Phase 1 + Phase 2 |
| `verify-rls-session-var-canon.sh` | No new occurrence of the phantom `app.current_organisation_id` session var. New policy migrations from Phase 1 must use the canonical `app.organisation_id`. | Phase 1 |

**Local commands the implementer DOES run** (per CLAUDE.md "Allowed locally"):

| Command | What it verifies | Phase |
|---|---|---|
| `npm run lint` | Lint clean. | Phase 1 + Phase 2 + Phase 3 |
| `npx tsc --noEmit -p server/tsconfig.json` | TypeScript compiles. Phase 2's Drizzle schema change adds a `uniqueIndex` import; verify it doesn't break call sites. | Phase 1 + Phase 2 + Phase 3 |
| `npm run build:server` | Server bundle builds (only when the change touches the build surface — Phase 2's schema change qualifies). | Phase 2 |
| `npx tsx server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts` | Targeted pure-test execution for THIS change (per CLAUDE.md "Targeted execution of unit tests authored for THIS change"). | Phase 2 |

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

### §7.5 Allow-list annotation enforcement (grep-based, not gated, Phase 1)

`scripts/rls-not-applicable-allowlist.txt` lines 31–56 require every caller of an allow-listed table to carry a function-level `// @rls-allowlist-bypass: <table> <fn-name> [ref: ...]` annotation. **This rule is enforced by reviewer grep, not by an automated gate.** Per `DEVELOPMENT_GUIDELINES.md § 8.4` ("prefer existing primitives over new ones"), the allowlist file's own header explicitly declines to add a new CI gate at current call volumes — the grep `grep -nE "@rls-allowlist-bypass" server/` is sufficient.

**Negative assertion (load-bearing).** Any query against an allow-listed table that does NOT carry a corresponding `@rls-allowlist-bypass` annotation within the function declaration immediately above it is an **automatic reject at review time, regardless of intent**. The annotation is the load-bearing artefact: it tells the next reviewer (and the next auditor, and the next agent traversing the code) "this bypass is intentional, here is its justification, here is the spec section that authorises it." A query without the annotation is — from the reviewer's perspective — indistinguishable from a leaky cross-tenant read that someone forgot to annotate, and the resolution in both cases is the same: stop, add the annotation (or refactor the query to go through an org-scoped path that doesn't need one), then re-submit. The reviewer does NOT attempt to assess intent ("but this looks like it was probably meant to be cross-tenant") — intent without annotation is unreviewable. This negative form pairs with the positive form ("annotated callers must include `@rls-allowlist-bypass:` per the format rules"); reviewers act on the negative form because that is what the diff makes visible (an un-annotated query is grep-able; intent is not).

Phase 1 implementer's responsibility:

- For every `allowlist`-verdict table, run `grep -nE "<table_name>" server/` to enumerate callers, then for each caller add (or verify already present) the function-level annotation per the format in the allowlist file header.
- The PR description for the Phase 1 commit that adds allow-list entries MUST list each newly-annotated function (`<file>:<line> <function_name>`) so the reviewer can grep-check the annotations match the new allowlist entries.
- The reviewer (`pr-reviewer`) is expected to spot-check via `grep -nE "@rls-allowlist-bypass" server/` and confirm: (a) every new allowlist table has at least one matching annotation; (b) the annotation's `<function_name>` token matches the immediately-following function declaration verbatim (rule 4 in the allowlist header).

**Continuous (post-Phase-1) enforcement — PR-description grep diff.** Grep enforcement only works if it is re-run when new callers of an allow-listed table appear. To make that continuous without adding a new gate, the spec adopts an additional invariant:

- **Any PR (this branch or any future branch) that touches a file containing a query against an allow-listed table MUST include in its PR description (a) the full grep output AND (b) an explicit list of NEW call sites added in this PR.** Format:

  ```
  ## Allow-list table query touches
  Touched files:
  - <path/to/file1.ts>
  - <path/to/file2.ts>

  Full grep output (`grep -nE "@rls-allowlist-bypass" <each file above>`):
  <paste output>

  NEW call sites added by this PR (the diff added a query against an allow-listed table at):
  - <path/to/file1.ts:NN> — function `<fnName>` — annotation present: <yes | no — STOP if no>
  - (or "n/a — no new call sites; only existing call sites modified")
  ```

  Listing only the full grep output is NOT sufficient: an existing annotation can mask a new un-annotated caller in the same file. The NEW-call-sites list is the diff-aware reading; the reviewer's job is to confirm every new call site has an annotation in the grep output and that the function name matches the immediately-following declaration verbatim (allowlist file header rule 4).

  **Reviewer-diff cross-check (mandatory).** The implementer's NEW-call-sites list is a self-report — the reviewer cannot trust it on its own. The reviewer MUST run `git diff <base>..<head>` over the PR and grep the diff for any addition (`^+`) of an allow-listed table name in a query context (e.g. `.select(`, `.insert(`, `.update(`, `.delete(`, `.from(<allowlistedTable>`, or a `sql\`...<table>...\`` template that contains DDL/DML keywords). Every diff-detected new call site MUST appear in the PR's NEW-call-sites list with an annotation entry in the grep output. **If the reviewer's diff surfaces a query against an allow-listed table that the implementer did NOT list, the PR is rejected** — this binds reviewer behaviour to the diff itself (ground truth), not to the description (the implementer's claim). The PR description is what the implementer says they did; the diff is what they actually did. Both must agree.
- The Phase 1 PR for this spec is the first to honour this contract. The PR description MUST include the grep output for `server/services/systemMonitor/baselines/refreshJob.ts` and `server/services/systemMonitor/triage/loadCandidates.ts` (the §3.4.3 caller-fix files), plus every file that contains a query against any newly-added allow-list-table from the Phase 1 manifest commits.
- The pull-request template (`.github/pull_request_template.md`) is updated as part of this branch — see §2.6 — with a one-line prompt: `If this PR touches a query against an RLS-not-applicable allowlist table, paste 'grep -nE "@rls-allowlist-bypass" <file>' output here:`. The prompt is a reminder, not enforcement; reviewer-grep is still the actual enforcement step.

If the call-volume of allow-list bypasses ever grows beyond ~30 annotations across the codebase, re-evaluate adding a gate as a follow-up branch (entry in `tasks/todo.md` once the threshold is approached). For Phase 1, grep + PR-description discipline is the contract.

### §7.6 Pre-merge cadence

Per CLAUDE.md, the full gate suite is CI-only — `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `bash scripts/run-all-gates.sh`, and any individual `scripts/verify-*.sh` invocation are forbidden as local commands. The CI server runs them as the pre-merge gate.

**What the implementer runs locally before pushing:**

- `npm run lint`
- `npx tsc --noEmit -p server/tsconfig.json`
- (where applicable) `npm run build:server` if the change touches the build surface
- (where applicable) `npx tsx <path-to-pure-test>` for the single pure-test file authored for THIS change

**What the implementer waits for CI to confirm before merging:**

- `verify-rls-protected-tables.sh` reports GREEN (Phase 1 hard gate — see §3.5.1 for the gate-status paste-block contract)
- `verify-rls-coverage.sh` reports GREEN
- All other gates in `run-all-gates.sh` report GREEN (only the Phase 1 hard gate is allowed to be RED during the §3.5.1 known-red CI window; everything else GREEN at all times)
- `npm run test:gates` (CI's umbrella battery) passes

If CI is unavailable or has not run for the latest commit, the merge waits — the spec does not permit substituting a local run for a missing CI signal.

---

## §8 — Rollout ordering

### §8.1 Phase order

The recommended order is **Phase 1 → Phase 2 → Phase 3 (optional)**. Reasons:

- **Phase 1 is the largest piece** (registry triage across 67 tables). Front-loading it gets the gate to exit 0 fastest, which de-risks the rest of the branch — every subsequent commit is checked against an already-passing gate.
- **Phase 2 is independent** but depends on no new tables being created in Phase 1 that touch `intervention_outcomes` (the table is already in the manifest plan per §3.4.1).
- **Phase 3 is conditional** (§5.5); shipping it before Phase 1+2 finish is wasted leverage.

### §8.2 Per-phase commit cadence

- **Phase 1:**
  - One commit per migration file (so the policy migrations are reviewable independently).
  - Manifest edits land in their own commit(s) before the policy migrations. **Cap: max 15 manifest entries per commit** — beyond that, the diff becomes harder to review row-by-row and a wrong verdict is more likely to slip through. With ≤ 61 tables to triage and (per the §3.3.1 tie-breaker) most defaulting to `register` / `register-with-new-policy`, the manifest will land in 2–4 commits, not one.
  - **Allow-list edits land in a SINGLE commit, reviewed as a holistic set.** The reviewer (`pr-reviewer` and any human reviewer) MUST evaluate the entire allow-list addition as one decision — not row-by-row. This counter-balances §3.3.1's per-row rubric: each row was vetted individually against the rubric, but the SET must also be coherent (no two rows that should have been the same kind of decision but drifted; no row whose verdict only makes sense if a sibling table was also classified the same way). To make this practical, the commit MUST present allow-list entries sorted alphabetically by table name and the PR description MUST list the full set of newly-allow-listed tables in one block (not scattered across commit messages). If the allow-list addition exceeds **20 entries**, the implementer MUST split by domain (e.g. all system-monitor tables in one commit; all reference-data tables in another) — the split is by *coherent group*, never arbitrary, and each group still ships as a single batch reviewed holistically. Splitting alphabetically across commits to reduce diff size is forbidden — it defeats the holistic-review intent.
  - The §3.4.3 caller-comment fixes on the two `systemMonitor` files land in a single commit (two file edits, one logical change).
- **Phase 2:** two commits — (a) the `0244` migration + Drizzle schema edit, (b) the job + service refactor. Splitting lets the schema and the code roll back independently.
- **Phase 3:** one commit per job, so each job's lock-semantics audit (per §5.2.1) is reviewable on its own.

### §8.3 Pre-merge baseline reverification

Before opening the PR:

1. Re-run the §1 verification table against the post-merge `pre-prod-tenancy` head — confirm every "closed" item from §1 is still closed (i.e. no merge from `main` regressed the work). This is a code-reading task, not a gate run; for each row in §1, the implementer reads the cited file/migration and confirms the closure evidence still holds.
2. Confirm `npx tsc --noEmit -p server/tsconfig.json` is clean (local — per CLAUDE.md "Allowed locally").
3. Confirm CI reports `verify-rls-protected-tables.sh` GREEN on the latest commit. CI is the only place that gate runs; the implementer reads the result from the CI output, not by invoking the harness locally.

The §1 reverification specifically guards against a sister-branch merging conflicting work into `main` while this branch was in flight.

### §8.4 Conflict resolution if a sister branch lands first

If `pre-prod-boundary-and-brief-api` or `pre-prod-workflow-and-delegation` merges into `main` before this branch:

- Merge `main` into `pre-prod-tenancy`.
- Push the merge commit and wait for CI to produce a fresh `verify-rls-protected-tables.sh` output for the new branch tip — the unregistered-tables count may shift (new tables introduced by the sister branch). The §3.4.1 classification output in `progress.md` is invalidated whenever the gate's table-set changes; verdicts that referenced a since-superseded baseline are no longer trustworthy. CI is the source of the new gate output; the implementer reads the violation list from the CI run, not by invoking the harness locally.
- **Hard requirement: any merge-from-main during Phase 1 implementation requires a fresh `progress.md` classification entry covering the delta BEFORE the implementer pushes any further commits to the branch.** Specifically: append a new dated section to `tasks/builds/pre-prod-tenancy/progress.md` titled `## Post-merge classification delta (<date> — main merge <merge-sha>)` with: (a) the full new gate output, (b) the diff against the prior gate output (newly-failing tables / newly-resolved tables / unchanged tables), (c) verdicts for every newly-surfaced table per §3.3.1. Without this entry, Phase 1 cannot be reviewed-as-complete — the existing verdicts cite a stale baseline that the post-merge gate no longer matches, and the reviewer has no way to audit which tables were classified before vs. after the merge.
- Do NOT alter sister-branch source files in this branch — only update the registry / allow-list.
- If the sister branch added an `organisation_id` column to a table this branch already registered, no edit is needed (but the post-merge `progress.md` entry must still acknowledge the delta — even a no-op delta).

---

## §9 — Deferred Items

- **Phase 3 (B10) maintenance-job per-org `withOrgTx` defense-in-depth.** Conditional on §5.5 — ships only if Phase 1+2 finish under budget. If deferred, capture in `tasks/todo.md § Deferred from pre-prod-tenancy spec` with a one-line trigger ("Phase 1+2 merged on <date>; remaining defense-in-depth upgrade routed to follow-up branch") and a back-link to §5 of this spec.

- **Tenant-scoped tables whose owning migration belongs to a sister-branch path.** If a table named in §3.4.1 has its CREATE TABLE in `agentRuns.ts` or another sister-branch-owned schema file and is missing both a policy AND any registry/allow-list entry, the registry edit lands here but the policy migration is deferred to the owning sister branch. Capture in `tasks/todo.md § Deferred from pre-prod-tenancy spec` with the exact table name + intended policy shape (canonical org-isolation vs. parent-EXISTS) so the sister branch can ship the migration without re-doing the classification work.

- **Load-test absolute rows/sec/org figure** (§4.7). If the Phase 2 load test cannot be set up locally, the absolute number is deferred. The 5×-speedup-vs-legacy assertion still ships in `progress.md` against a smaller fixture.

- **Gate-self-test fixture for `verify-rls-protected-tables.sh`** (§2.4 optional row). Mirror of the H1 derived-data fixture. Defer if the gate doesn't accept a `--fixture-path` argument — add it as a small enhancement in a follow-up branch.

- **GATES-2026-04-26-2** (verify-rls-contract-compliance.sh should skip `import type` lines). Out of scope here; remains in `tasks/todo.md` under the existing 2026-04-26 deferred-items section.

- **B10 verification of advisory-lock intent** for each job (§5.3) — if Phase 3 ships and the audit reveals an advisory lock that was protecting per-org work and cannot be cleanly scoped to enumeration only, the job's commit is rolled back and the job is deferred to a follow-up branch with a dedicated session-level lock design.

- **CI pipeline-config verification — `run-all-gates.sh` is actually invoked.** This spec wires `verify-rls-protected-tables.sh` into `scripts/run-all-gates.sh` (§2.5, §3.5 step 1). The gate in `run-all-gates.sh` is only effective if CI invokes that script — but the repository at `pre-prod-tenancy` branch tip has no `.github/workflows/` (or equivalent) checked in. Whether CI invokes `run-all-gates.sh` is therefore outside this spec's scope to verify. Capture in `tasks/todo.md § Deferred from pre-prod-tenancy spec` with the trigger condition: "before Phase 1 lands on `main`, confirm the CI pipeline (wherever it lives — Replit, external service, or to-be-added GitHub Actions) actually invokes `bash scripts/run-all-gates.sh` on PR open. If it does not, the gate-wiring in this spec is theatre — surface to the user as an architectural finding, not an implementation fix."

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
- [x] **No new primitive without a "why not reuse" paragraph.** Phase 1 reuses the existing manifest + allow-list. Phase 2 reuses Drizzle `uniqueIndex` + `onConflictDoNothing`. Phase 3 reuses `withOrgTx`. No new primitives proposed. Allow-list annotation enforcement explicitly stays grep-based (§7.5) per `DEVELOPMENT_GUIDELINES § 8.4`. No new env-flag bypass for the red-CI window (§3.5.1) — documented expectation, not a new primitive.
- [x] **File inventory lock** (§2). Every file/migration named in §3–§5 also appears in §2. Migration batching constraints pinned in §2.1.1; parent-EXISTS single-FK invariant pinned in §2.1.
- [x] **Contracts.** Phase 2 has §4.4 (idempotency posture), §4.5 (concurrency guard), §4.6 (HTTP/error mapping), §4.2.0 (mandatory pre-check), §4.2.1 (forward-migration shape with `LOCK TABLE`), §4.2.2 (rollback posture). Phase 1 has no cross-boundary data shape; Phase 3 has §5.2.1 (mandatory advisory-lock audit + three-place enforcement: commit message + PR description + reviewer-checklist reject criterion) plus §5.6 (concurrency contract).
- [x] **Source-of-truth precedence.** Phase 2's `recordOutcome` is the single owner of the insert; the unique constraint is the authoritative dedup mechanism. Stated in §4.3. The §3.4.1 classification table is the single source of truth for tenant-table verdicts (not the brief). Manifest and allow-list are mutually exclusive lanes (§3.3.1 hard invariant).
- [x] **RLS / Permissions.** Phase 1 IS the RLS work — every newly-registered tenant table either has or gets a canonical `CREATE POLICY` (§3.3 + §3.3.1 hard rubric); allow-listed tables carry the prescribed function-level annotations (§7.5) plus continuous PR-description grep-output enforcement (§7.5). Parent policies for child-FK-scoped tables MUST include both `USING` and `WITH CHECK` (§3.4.2). Parent-EXISTS policies MUST use a single deterministic FK path (§2.1). Phase 2 adds no new tenant tables. Phase 3 strengthens RLS posture (engaging policies that were previously bypassed under `admin_role`).
- [x] **Execution model.** Phase 1: synchronous migrations + manifest edits, gate wired FIRST (§3.5 step 1) with documented red-CI window (§3.5.1) and squash-on-merge disposition. Phase 2: existing job (queued via the existing job harness — unchanged); the refactor is to the synchronous code path inside the job, not to its trigger model; pre-check (§4.2.0) + LOCK TABLE (§4.2.1) + rollback (§4.2.2). Phase 3: same — no execution-model change; advisory-lock audit (§5.2.1) is mandatory pre-commit and enforced in three places.
- [x] **Phase dependency graph** (§8.1). No backward references — Phase 2 doesn't reference Phase 1's new tables; Phase 3 doesn't reference Phase 2's schema change. No orphaned deferrals — every deferral in §9 has its trigger condition stated. New deferral: CI pipeline-config verification (§9 last item).
- [x] **Deferred Items section** (§9) exists and is non-trivial.
- [x] **Goals ↔ Implementation match.** §0.2 states three goals; each maps to exactly one phase (§3 / §4 / §5). No load-bearing claim is unbacked.
- [x] **Testing posture matches `docs/spec-context.md`.** §7.3 explicitly enumerates what is NOT tested at runtime to avoid framing drift. §7.5 documents allow-list grep enforcement (function-level annotations + continuous PR-description grep diff).
- [x] **Section-10 contracts** (§10). Idempotency, retry classification, concurrency guard, no-silent-partial-success all declared for Phase 2. N/A reasons given for §10.4, §10.6, §10.7.
- [x] **Load-test pass conditions are non-gameable** (§4.7). Both relative (≥ 5× speedup vs. legacy) AND absolute (≥ 200 rows/sec/org) ship; only the upgrade from fallback to full fixture is deferrable.
- [x] **Unique-index migration handles existing duplicates safely** (§4.2.0 mandatory pre-check + §4.2.1 LOCK TABLE forward migration + §4.2.2 rollback posture). No implicit ctid-default; deterministic dedup rule required for any non-zero pre-check or STOP.
- [x] **Allow-list batch review is holistic** (§8.2). Single commit (or domain-coherent splits ≥ 20 entries), sorted alphabetically, full-set listed in PR description, reviewer signs off on the SET.
- [x] **Migration-number ceiling has a STOP rule** (§6 hard rules). No reuse, no expansion, no packing — defer the remainder to a follow-up branch with its own reservation; pre-flight count required before authoring the first `0245+` migration.
- [x] **Manifest / allow-list mutual exclusion** (§3.3.1 invariant + Phase 1 implementer pre-merge `comm -12` check).
- [x] **Round-3 enforcement tightening (mechanical paste / cross-checks).** §3.5.1 — Phase 1 PR description includes a CI-gate-status block listing every gate by name and current status. §7.5 — allow-list PR description requires both full grep output AND an explicit NEW-call-sites list (existing annotations cannot mask new violations). §4.2.0 — pre-check timing constraint (REPEATABLE READ tx OR run-immediately-before-apply). §2.1 — parent-EXISTS NOT NULL verification is mandatory (migration history + Drizzle schema, must agree). §6 — migration-overflow rescope requires an explicit PR-description block. §5.2.1 — reviewer cross-check picks ≥ 1 job at random and byte-checks the audit triple (commit / PR block / progress.md).
- [x] **Progress-table lock after first policy migration** (§3.4.1 — verdicts are locked once the first `0245+` lands; reclassification requires reverting the affected migration first).
- [x] **Phase 2 single-writer invariant** (§4.3 — `recordOutcome` is the only writer to `intervention_outcomes`; reviewer-grep verified at every future PR that touches files referencing `interventionOutcomes`).
- [x] **Round-4 enforcement tightening (reviewer-binding + visibility).** §3.5.1 — gate-status paste block MUST be sourced from CI output, not maintained manually (Round 4's original wording said "derived from `bash scripts/run-all-gates.sh` execution output," which contradicted CLAUDE.md "gates are CI-only — never run locally" and was corrected in Round 6 to "sourced from the most recent CI run's output"). §7.5 — reviewer MUST run `git diff <base>..<head>` and confirm every diff-detected new query against an allow-listed table appears in the PR's NEW-call-sites list (binds reviewer behaviour to ground truth). §4.2.0 — immediate-before-apply path MUST verify and document write-quiescent state (no background jobs / schedulers / other servers; quiescence verification recorded in `progress.md`). §6 — pre-flight migration-count MUST be recorded in PR description before the first `0245+` migration commit, even when no overflow occurs (visibility for the no-rescope case). §4.3 — reviewer MUST manually confirm each grep hit is a write operation (the regex matches substrings; non-write hits are not invariant violations). §5.2.1 — reviewer SHOULD vary which job is byte-checked across multiple Phase 3 PRs (prevents predictable selection bias). §2.6 — `progress.md` entries are part of the contract, not a scratchpad; missing or inconsistent entries are blocking. §8.4 — any merge-from-main during Phase 1 implementation MUST commit a fresh `progress.md` classification delta entry before further branch commits (closes the stale-baseline failure mode).
- [x] **Round-5 drift-resistance + future-proofing.** Spec-version anchor added at top of file with full review-round history (Draft → R1 Codex → R2 ChatGPT → R3 enforcement → R4 reviewer-binding → R5 drift-resistance), so every `progress.md` citation has an unambiguous version to point at. §2.6 — global ordering rule for `progress.md` entries: same-commit OR immediately-preceding-commit only; post-hoc entries without a back-reference annotation are an automatic reject (closes the retrofit-evidence failure mode). §2.6 — every `progress.md` section header MUST cite the spec round + commit SHA it was authored against (`[spec round 5 — commit <sha>]`); spec-rounds-forward-mid-implementation requires re-validation before merge. §3.4.1 — explicit table-set freeze invariant: classification cycle is tied to a snapshot, any change to the gate-emitted table set invalidates the cycle (paired with §8.4's recovery rule). §7.5 — explicit negative assertion: any query against an allow-listed table without a corresponding `@rls-allowlist-bypass` annotation is an automatic reject regardless of intent (intent without annotation is unreviewable). §4.3 — Phase 2 single-writer invariant extended to cover future schema evolution: triggers / jobs / migrations writing to `intervention_outcomes` MUST route through `recordOutcome` OR explicitly amend the invariant (closes the trigger / backfill / future-job bypass class).
- [x] **Round-6 CI-only gate alignment (CLAUDE.md "gates are CI-only — never run locally" enforcement).** Five locations across rounds 1–5 still instructed the implementer to invoke gates locally (`bash scripts/verify-*.sh`, `bash scripts/run-all-gates.sh`); each was a contradiction with CLAUDE.md and has been corrected. §3.5.1 — gate-status paste block is sourced from the most recent CI run's output, not derived by running the harness locally; if CI hasn't produced output yet, the block is marked `pending CI` and the PR is held. §7.1 — "Static gates (primary)" table reframed as "Static gates (CI invariants — primary)"; gate names appear as identifiers, no `bash` prefix; a separate "Local commands the implementer DOES run" sub-table covers `npm run lint` / `npx tsc --noEmit` / `npm run build:server` / targeted `npx tsx <pure-test>` per CLAUDE.md "Allowed locally". §7.6 — pre-merge cadence split into "what the implementer runs locally" (lint, typecheck, targeted pure tests) vs. "what the implementer waits for CI to confirm" (every gate, `npm run test:gates`); CI is the only place the gate suite runs. §8.3 — pre-merge baseline reverification reads gate status from CI output, not from a local invocation. §8.4 — sister-branch merge waits for CI to produce a fresh gate output for the merge commit, rather than re-running the gate locally. The Round-4 entry above also carries an in-place corrigendum noting the original wording was wrong.
- [x] **Round-7 final-pass closure (CI-authority philosophy stated explicitly + spec lock).** ChatGPT round-7 review confirmed Round 6 closed the dual-truth (local grep vs. CI) flaw cleanly; no architectural gaps, no hidden inconsistencies, no remaining safety contracts to add. One non-blocking polish was applied: §7.1 "Authority rule (load-bearing)" paragraph states explicitly that local execution of gate logic is non-authoritative and MUST NEVER be used for pass/fail decisions — even when local execution is technically possible. The asymmetry rationale (local environments drift; "works on my machine" passing while CI fails on `main` is a regression that ships) is captured in the rule itself so future contributors don't re-derive it. Forbidden patterns (per round-7 reviewer): no fallback local-gate execution, no "optional local verification" language, no CI + local hybrid logic. The spec is now locked at this round; further changes require an explicit new round entry at the top of the file (§ Round history).
- [x] **Unique-constraint-to-HTTP mapping** — N/A (job-internal). Documented in §10.
- [x] **State machine** — N/A. Documented in §10.
