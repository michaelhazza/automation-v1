# Pre-Launch Hardening — Cross-Chunk Invariants

**Status:** authoritative
**Source-of-truth scope:** all 6 per-chunk specs in the pre-launch hardening sprint
**Authored:** 2026-04-26
**Linked from:** every per-chunk spec via front-matter (commit SHA pinned)

This document is the single source of truth for invariants that span the 6 pre-launch hardening specs. Every per-chunk spec links to this file with a pinned commit SHA. If you need to amend an invariant, update this file in a dedicated PR — never inline the change in a chunk spec. After amendment, re-run Task 6.6 (consistency sweep) and re-stamp Task 6.5 (spec freeze) per the post-freeze amendment protocol in `tasks/builds/pre-launch-hardening-specs/plan.md` § Task 6.5.

Every invariant below is **testable or enforceable** — checkable by a script, a code grep, an existing CI gate, a pure-function assertion, or a named convention. Philosophical statements do not belong here.

---

## Table of contents

1. RLS contract invariants
2. Naming and schema invariants
3. Execution contract invariants
4. Gate expectations
5. Spec-vs-implementation translation rules

Amendments

---

## 1. RLS contract invariants

**1.1 Three-layer fail-closed isolation.** Every tenant table (org-scoped or subaccount-scoped) is protected by all three layers from `architecture.md` § "Row-Level Security — Three-Layer Fail-Closed Data Isolation" (line 1332): Postgres RLS policies (Layer 1), service-layer org-scoped DB / scope assertions (Layer 2), tool call security events (Layer 3). RLS is the authority; service-layer filters are defence-in-depth.

  *Enforcement:* `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh` (`architecture.md:1388-1389`).

**1.2 Manifest registration is mandatory.** Every tenant-scoped table MUST appear in `server/config/rlsProtectedTables.ts`. The manifest is the canonical roster (`architecture.md:1354`).

  *Enforcement:* `verify-rls-coverage.sh` fails if the manifest references a table without a matching `CREATE POLICY` in any migration.

**1.3 Canonical session variables only.** RLS policies may reference only the five vars listed in `architecture.md:1372-1383`: `app.organisation_id`, `app.current_subaccount_id`, `app.current_principal_type`, `app.current_principal_id`, `app.current_team_ids`. **Never `app.current_organisation_id`** — that variable is not set anywhere and a policy referencing it silently disables itself.

  *Enforcement:* `verify-rls-session-var-canon.sh` (`architecture.md:1390`).

**1.4 No direct `db` import in routes.** Routes route through service-layer helpers that resolve principal context. Direct `import { db } from ...` in `server/routes/` is prohibited — it bypasses RLS middleware.

  *Enforcement:* grep `^import.*\bdb\b.*from.*[\"']@?\.\./db` in `server/routes/`; CI gate variant per Chunk 1 spec.

**1.5 Maintenance jobs follow the admin/org tx contract.** Background jobs that read/write tenant tables follow the `server/jobs/memoryDedupJob.ts` shape: `withAdminConnection` to enumerate orgs, then `withOrgTx` per-org for the actual work. Direct `db` from a job is a Layer-1 fail-open.

  *Enforcement:* spec-named pure unit test per job + grep for direct `db` imports in `server/jobs/`.

**1.6 Subaccount-isolation Option B-lite exception.** The cached-context tables (`reference_documents`, `document_bundles`, `document_bundle_attachments`, `bundle_resolution_snapshots`, `bundle_suggestion_dismissals`) deliberately enforce subaccount isolation at the service layer, not the DB layer (per migration 0213). New cached-context tables MUST follow the same posture or carry a documented opt-in to DB-layer subaccount RLS in their migration's header comment.

  *Enforcement:* documented in `docs/cached-context-infrastructure-spec.md` (Chunk 2 CACHED-CTX-DOC closes the gap); future drift caught by spec-conformance review.

**1.7 Reference-documents parent-EXISTS RLS.** `reference_documents` and `reference_document_versions` are protected via parent-EXISTS WITH CHECK (the GATES-2026-04-26-1 follow-up named in `tasks/todo.md:935`'s resolved B-1/B-2/B-3 entry), not direct org-id columns. The migration carrying this lives in Chunk 1.

  *Enforcement:* migration presence + `verify-rls-coverage.sh`.

---

## 2. Naming and schema invariants

**2.1 Renamed automations columns (W1-6).** `automations.workflow_engine_id` → `automation_engine_id`; `parent_process_id` → `parent_automation_id`; `system_process_id` → `system_automation_id`. Legacy names are dead post-Chunk-2.

  *Enforcement:* grep for legacy names returns zero results in `server/` and migrations after Chunk 2 lands.
  *Source:* `tasks/todo.md:646` (W1-6).

**2.2 File-extension convention (W1-29).** `*.workflow.ts` only; `*.playbook.ts` is dead. Directory `server/playbooks/` renames to `server/workflows/` per Chunk 2.

  *Enforcement:* grep for `*.playbook.ts` returns zero; directory listing audit.
  *Source:* `tasks/todo.md:647` (W1-29).

**2.3 `agent_runs.handoff_source_run_id` is the canonical handoff edge column.** Handoff-created `agent_runs` rows carry `handoffSourceRunId = context.runId` of the originating `reassign_task` call. The `parentRunId` reuse for handoff chains is being phased out per the Chunk 2 architect resolution of WB-1.

  *Enforcement:* spec-named pure test asserting INSERT path populates `handoffSourceRunId`; consumer in `delegationGraphServicePure.ts:72` reads only this column for handoff edges.
  *Source:* `tasks/todo.md:637` (WB-1).

**2.4 Skill error envelope contract (C4a-6-RETSHAPE).** One of two options is chosen by the Chunk 2 architect output and cited by Chunk 5: either grandfather the existing flat-string pattern (`error: <code-string>`) or migrate to the nested envelope (`error: { code, message, context }`). Whichever is chosen, 100% adherence is the done-criterion. Specs may not document one option while code returns the other.

  *Enforcement:* CI grep across all `SKILL_HANDLERS` return shapes after Chunk 5 lands.
  *Source:* `tasks/todo.md:337` (C4a-6).

**2.5 Delegation analytics canonical truth (DELEG-CANONICAL).** `delegation_outcomes` is canonical for "what was attempted and what was the outcome." `agent_runs` telemetry columns (`delegationScope`, `delegationDirection`, `hierarchyDepth`, `handoffSourceRunId`) are per-run snapshots for joins, not authoritative history. Any analytics surface (admin dashboard, cost-attribution report, audit export) reads from `delegation_outcomes` for the source-of-truth value.

  *Enforcement:* spec-named convention; audited per analytics surface as it ships.
  *Source:* `tasks/todo.md:332`.

**2.6 Schema decisions land before any code touching their columns.** No code branch may modify `agent_runs`, the W1-6 columns, the W1-29 file extensions, the skill error envelope, or the new `subaccount_agents.portal_default_safety_mode` column (per F10 architect resolution) until the Chunk 2 spec is merged.

  *Enforcement:* implementation-order rule in `tasks/builds/pre-launch-hardening-specs/progress.md`; freeze gate in Task 6.5.

---

## 3. Execution contract invariants

**3.1 Re-check invalidation after I/O (C4b-INVAL-RACE).** Every dispatcher boundary that awaits external I/O re-reads its row and hard-discards on `status === 'invalidated'` before writing. This applies to `workflowEngineService.ts` tick switch internal helpers (`*Internal`) for `action_call`, `agent_call`, `prompt`, and `invoke_automation`, mirroring the public `completeStepRun` / `completeStepRunFromReview` invalidation behaviour.

  *Enforcement:* spec-named pure simulation test of read-after-await race per Chunk 5; named in `tasks/todo.md:667`.

**3.2 Pre-dispatch credential resolution (W1-44).** The dispatcher resolves each automation's `required_connections` for the subaccount context **before** firing the webhook. Unresolved required connections fail with `error_code: 'automation_missing_connection'` at dispatch, not at the provider edge.

  *Enforcement:* spec-named test exercising missing-mapping path; named in `tasks/todo.md:649`.

**3.3 Defence-in-depth at dispatcher boundary (W1-43).** The step dispatcher rejects any `invoke_automation` resolution that would produce more than one outbound webhook (per spec §5.10a rule 4). A pure-function assertion inside `resolveDispatch` verifies the automation row conforms to the single-webhook contract.

  *Enforcement:* spec-named assertion + test; named in `tasks/todo.md:648`.

**3.4 §5.7 error vocabulary is closed.** New error codes require a spec amendment (the `automation_execution_error` value emitted at `invokeAutomationStepService.ts:95` is resolved per Chunk 5's W1-38 decision: introduce `automation_engine_unavailable`, OR re-use `automation_not_found`, OR re-use `automation_missing_connection`).

  *Enforcement:* spec-name the chosen value; CI grep for ad-hoc strings outside the vocabulary.
  *Source:* `tasks/todo.md:651`.

**3.5 `runResultStatus = 'partial'` is decoupled from summary presence (H3).** A semantically-successful run with no summary is `'success'`, not `'partial'`. The H3 architect resolution in Chunk 5 picks one of: separate `hasSummary` flag, side-channel `summaryMissing=true`, or monitor-and-revisit. Whichever is picked, summary failure must not demote a successful run.

  *Enforcement:* spec-named pure test on `computeRunResultStatus` per Chunk 5; named in `tasks/todo.md:152`.

**3.6 `errorMessage` threading on normal-path failed runs (HERMES-S1).** When a run terminates via the normal path (no thrown exception) with `derivedRunResultStatus === 'failed'`, the `errorMessage` from `preFinalizeMetadata` is threaded into `extractRunInsights` (`agentExecutionService.ts:1350-1368`). Memory extraction is not skipped because of a missing exception.

  *Enforcement:* spec-named pure test asserting failed-without-throw runs extract memory; named in `tasks/todo.md:92-105`.

---

## 4. Gate expectations

**4.1 RLS gate posture is explicit.** `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` posture (hard-blocking vs warn) is decided by Chunk 1 § Open Decisions and recorded in the spec body. The default during the testing round is documented; the alternative is documented; the user picks.

  *Enforcement:* gate posture is recorded in the spec PR body and in the gate script itself.

**4.2 All Chunk 6 gates green.** `verify-action-call-allowlist.sh`, `verify-skill-read-paths.sh`, `verify-input-validation.sh`, `verify-permission-scope.sh`, `scripts/verify-integration-reference.mjs`, `verify-rls-session-var-canon.sh` all pass after Chunk 6 lands.

  *Enforcement:* CI run on the Chunk 6 PR.
  *Source:* mini-spec § Chunk 6 done criteria.

**4.3 Gate skips `import type` lines (RLS-CONTRACT-IMPORT / GATES-2).** The relevant RLS-contract gate distinguishes runtime imports from `import type` at the lexer level — a type-only import does not trigger the direct-`db` violation. The Chunk 6 spec is the source-of-truth for this rule (it does not exist as a labeled todo entry yet).

  *Enforcement:* gate script update + named test case in Chunk 6.

**4.4 Pre-Phase-2 coverage baseline captured (SC-COVERAGE-BASELINE).** Before any testing-round commit, the warning-level counts from `verify-input-validation.sh` (44 today) and `verify-permission-scope.sh` (13 today) are recorded in `tasks/builds/pre-launch-hardening-specs/progress.md`. Subsequent diffs against this baseline determine whether Phase 2 introduced regressions per `REQ #35` (`tasks/todo.md:916`).

  *Enforcement:* baseline numbers recorded; future PRs diff against them.

**4.5 No new test categories introduced.** Per `docs/spec-context.md § convention_rejections`, no spec adds vitest / jest / playwright / supertest / frontend unit tests / API contract tests. Test plans default to `pure_function_only` (`docs/spec-context.md:28`).

  *Enforcement:* spec-reviewer rejects findings that propose any of these.

---

## 5. Spec-vs-implementation translation rules

**5.1 Prefer existing primitives.** Per `docs/spec-context.md § accepted_primitives` (line 42), every spec defaults to existing primitives. Any new primitive requires a "why not reuse" paragraph per `docs/spec-authoring-checklist.md § Section 1`.

  *Enforcement:* `spec-reviewer` directional finding `directional-new-primitive-without-justification`.

**5.2 No feature flags.** Rollout model is `commit_and_revert` (`docs/spec-context.md:36`). No `feature_flags` introduced for any chunk. `feature_flags: only_for_behaviour_modes` (line 37) means flags are reserved for shadow-vs-active or dev-vs-prod modes — not pre-launch hardening.

  *Enforcement:* `convention_rejections` in `spec-context.md:73`.

**5.3 No new test categories.** See § 4.5 above.

**5.4 No introduce-then-defer patterns.** A spec MUST NOT propose a primitive and then defer it to a later phase. Either the spec ships the primitive in scope, or it doesn't propose it. Mid-spec deferrals are a documented anti-pattern per `docs/spec-authoring-checklist.md § Section 7`.

  *Enforcement:* spec-reviewer + the `## Deferred Items` mandatory section keeps the audit trail explicit.

**5.5 Architect outputs are immutable post-pin.** Once a per-chunk spec pins the architect output's commit SHA in its front-matter, the architect output may not be edited without re-pinning every consuming spec. The conflict-resolution rule in `tasks/builds/pre-launch-hardening-specs/plan.md` § Architect-output conflict check permits **in-place updates** to the losing architect output to point at the winning decision; that update is the only sanctioned post-pin edit and counts as a re-pin event.

  *Enforcement:* documented in plan.md; freeze-gate amendment protocol catches violations.

**5.6 Implementation order is binding.** Implementation order is `1 → {2, 4, 6} → 5 → 3` (`tasks/builds/pre-launch-hardening-specs/progress.md § Implementation Order`). PR merge order does not imply dependency order. No code branch starts until Tasks 6.5 (spec freeze) and 6.6 (consistency sweep) both stamp clear.

  *Enforcement:* freeze stamp + consistency sweep stamp in `progress.md`.

---

## Amendments

_(Empty at authoring. Each amendment entry records: amendment date, prior freeze SHA, the change made, the user who approved, and the consuming specs that need their pinned SHAs refreshed. The post-freeze amendment protocol in `tasks/builds/pre-launch-hardening-specs/plan.md` § Task 6.5 is binding.)_
