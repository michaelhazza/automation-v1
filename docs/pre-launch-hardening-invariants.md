# Pre-Launch Hardening — Cross-Chunk Invariants

**Status:** authoritative
**Source-of-truth scope:** all 6 per-chunk specs in the pre-launch hardening sprint
**Authored:** 2026-04-26
**Linked from:** every per-chunk spec via front-matter (commit SHA pinned)

This document is the single source of truth for invariants that span the 6 pre-launch hardening specs. Every per-chunk spec links to this file with a pinned commit SHA. If you need to amend an invariant, update this file in a dedicated PR — never inline the change in a chunk spec. After amendment, re-run Task 6.6 (consistency sweep) and re-stamp Task 6.5 (spec freeze) per the post-freeze amendment protocol in `tasks/builds/pre-launch-hardening-specs/plan.md` § Task 6.5.

Every invariant below is **testable or enforceable** — checkable by a script, a code grep, an existing CI gate, a pure-function assertion, or a named convention. Philosophical statements do not belong here.

**Enforcement format.** Each invariant carries an `*Enforcement:*` block listing one or more of:

- **Gate:** named CI script that fails when the invariant is violated.
- **Test:** named pure unit / integration test asserting the invariant.
- **Static:** grep pattern, glob check, or other static-analysis rule.
- **Manual:** spec-reviewer / pr-reviewer / spec-conformance reviewer check (used only when no Gate / Test / Static is feasible).

**Every invariant has at least one mechanism.** "Manual" alone is permitted, but flagged in § Invariant Violation Protocol so the unenforced surface is explicit.

---

## Table of contents

1. RLS contract invariants
2. Naming and schema invariants
3. Execution contract invariants
4. Gate expectations
5. Spec-vs-implementation translation rules
6. State / Lifecycle invariants
7. Cross-flow operational invariants

Invariant Violation Protocol

Amendments

---

## 1. RLS contract invariants

**1.1 Three-layer fail-closed isolation.** Every tenant table (org-scoped or subaccount-scoped) is protected by all three layers from `architecture.md` § "Row-Level Security — Three-Layer Fail-Closed Data Isolation" (line 1332): Postgres RLS policies (Layer 1), service-layer org-scoped DB / scope assertions (Layer 2), tool call security events (Layer 3). RLS is the authority; service-layer filters are defence-in-depth.

  *Enforcement:*
  - **Gate:** `verify-rls-coverage.sh` (`architecture.md:1388`)
  - **Gate:** `verify-rls-contract-compliance.sh` (`architecture.md:1389`)

**1.2 Manifest registration is mandatory.** Every tenant-scoped table MUST appear in `server/config/rlsProtectedTables.ts`. The manifest is the canonical roster (`architecture.md:1354`).

  *Enforcement:*
  - **Gate:** `verify-rls-coverage.sh` — fails if the manifest references a table without a matching `CREATE POLICY` in any migration

**1.3 Canonical session variables only.** RLS policies may reference only the five vars listed in `architecture.md:1372-1383`: `app.organisation_id`, `app.current_subaccount_id`, `app.current_principal_type`, `app.current_principal_id`, `app.current_team_ids`. **Never `app.current_organisation_id`** — that variable is not set anywhere and a policy referencing it silently disables itself.

  *Enforcement:*
  - **Gate:** `verify-rls-session-var-canon.sh` (`architecture.md:1390`) — bans the phantom variable from migrations and server code

**1.4 No direct `db` import in routes.** Routes route through service-layer helpers that resolve principal context. Direct `import { db } from ...` in `server/routes/` is prohibited — it bypasses RLS middleware.

  *Enforcement:*
  - **Static:** grep `^import.*\bdb\b.*from.*['\"]@?\.\./db` in `server/routes/` → must return zero matches
  - **Gate:** Chunk 1 spec promotes this to a CI gate variant

**1.5 Maintenance jobs follow the admin/org tx contract.** Background jobs that read/write tenant tables follow the `server/jobs/memoryDedupJob.ts` shape: `withAdminConnection` to enumerate orgs, then `withOrgTx` per-org for the actual work. Direct `db` from a job is a Layer-1 fail-open.

  *Enforcement:*
  - **Test:** spec-named pure unit test per job (Chunk 4 covers `ruleAutoDeprecateJob`, `fastPathDecisionsPruneJob`, `fastPathRecalibrateJob`) asserting a real row is decayed/pruned/recalibrated under the contract
  - **Static:** grep for direct `db` imports in `server/jobs/` → must return zero except admin/maintenance jobs that explicitly use `withAdminConnection`

**1.6 Subaccount-isolation Option B-lite exception.** The cached-context tables (`reference_documents`, `document_bundles`, `document_bundle_attachments`, `bundle_resolution_snapshots`, `bundle_suggestion_dismissals`) deliberately enforce subaccount isolation at the service layer, not the DB layer (per migration 0213). New cached-context tables MUST follow the same posture or carry a documented opt-in to DB-layer subaccount RLS in their migration's header comment.

  *Enforcement:*
  - **Static:** Chunk 2 CACHED-CTX-DOC adds this posture to `docs/cached-context-infrastructure-spec.md` § RLS as a first-class architectural decision; future drift detected by grepping new cached-context migrations for matching header comments
  - **Manual** (owner: `spec-conformance` agent): review when any new cached-context table lands

**1.7 Reference-documents parent-EXISTS RLS.** `reference_documents` and `reference_document_versions` are protected via parent-EXISTS WITH CHECK (the GATES-2026-04-26-1 follow-up named in `tasks/todo.md:935`'s resolved B-1/B-2/B-3 entry), not direct org-id columns. The migration carrying this lives in Chunk 1.

  *Enforcement:*
  - **Static:** migration presence — Chunk 1 commits `migrations/<n>_reference_documents_force_rls_parent_exists.sql`
  - **Gate:** `verify-rls-coverage.sh` — both tables registered in the manifest with parent-EXISTS noted

**1.8 Cross-org operations declare admin-context entry point.** Any read or write that intentionally crosses org boundaries (system-admin tooling, retention jobs, archive moves, cross-tenant analytics) routes through `withAdminConnection({ source: '<named-source>' })` with explicit `SET LOCAL ROLE admin_role`. Org-scoped session vars are NEVER set during admin-context operations (otherwise the policies engage and admin-context becomes silently scoped).

  *Enforcement:*
  - **Gate:** `verify-rls-contract-compliance.sh` — checks the admin entry-point pattern is the only path that sets `admin_role`
  - **Static:** grep for `BYPASSRLS` / `admin_role` outside of `server/lib/adminDbConnection.ts` and named callers → must return zero
  - **Manual** (owner: `spec-conformance` agent): review any new feature that proposes a cross-org code path

---

## 2. Naming and schema invariants

**2.1 Renamed automations columns (W1-6).** `automations.workflow_engine_id` → `automation_engine_id`; `parent_process_id` → `parent_automation_id`; `system_process_id` → `system_automation_id`. Legacy names are dead post-Chunk-2.

  *Enforcement:*
  - **Static:** grep for legacy column identifiers (`workflowEngineId`, `parentProcessId`, `systemProcessId`, and SQL forms) in `server/`, `shared/`, `migrations/` → must return zero after Chunk 2 lands
  *Source:* `tasks/todo.md:646` (W1-6).

**2.2 File-extension convention (W1-29).** `*.workflow.ts` only; `*.playbook.ts` is dead. Directory `server/playbooks/` renames to `server/workflows/` per Chunk 2.

  *Enforcement:*
  - **Static:** glob `**/*.playbook.ts` → must return zero matches after Chunk 2 lands
  - **Static:** directory listing — `server/playbooks/` must not exist; `server/workflows/` must exist
  *Source:* `tasks/todo.md:647` (W1-29).

**2.3 `agent_runs.handoff_source_run_id` is the canonical handoff edge column.** Handoff-created `agent_runs` rows carry `handoffSourceRunId = context.runId` of the originating `reassign_task` call. Whether `parentRunId` is also set (backward-compat) or null for handoff runs is decided by the Chunk 2 architect resolution of WB-1; the consumer in `delegationGraphServicePure.ts:72` and run-chain consumers conform to that decision.

  *Enforcement:*
  - **Test:** spec-named pure test asserting `agent_runs` INSERT path populates `handoffSourceRunId` for every handoff-created row
  - **Static:** grep `delegationGraphServicePure.ts` and `agentActivityService.getRunChain` → confirms each reads from the column the architect resolution names as canonical
  *Source:* `tasks/todo.md:637` (WB-1).

**2.4 Skill error envelope contract (C4a-6-RETSHAPE).** One of two options is chosen by the Chunk 2 architect output and cited by Chunk 5: either grandfather the existing flat-string pattern (`error: <code-string>`) or migrate to the nested envelope (`error: { code, message, context }`). Whichever is chosen, 100% adherence is the done-criterion. Specs may not document one option while code returns the other.

  *Enforcement:*
  - **Static:** CI grep across all `SKILL_HANDLERS` return shapes after Chunk 5 lands → every handler matches the chosen envelope; mixed shapes fail the gate
  - **Test:** spec-named pure test in Chunk 5 asserting a representative handler returns the chosen shape end-to-end
  *Source:* `tasks/todo.md:337` (C4a-6).

**2.5 Delegation analytics canonical truth (DELEG-CANONICAL).** `delegation_outcomes` is canonical for "what was attempted and what was the outcome." `agent_runs` telemetry columns (`delegationScope`, `delegationDirection`, `hierarchyDepth`, `handoffSourceRunId`) are per-run snapshots for joins, not authoritative history. Any analytics surface (admin dashboard, cost-attribution report, audit export) reads from `delegation_outcomes` for the source-of-truth value.

  *Enforcement:*
  - **Static:** grep new analytics consumers — must read from `delegation_outcomes`; reads from `agent_runs` telemetry columns require an explicit comment naming the join purpose
  - **Manual** (owner: `spec-conformance` agent + analytics-feature spec author): review per new analytics surface as it ships
  *Source:* `tasks/todo.md:332`.

**2.6 Schema decisions land before any code touching their columns.** No code branch may modify `agent_runs`, the W1-6 columns, the W1-29 file extensions, the skill error envelope, or the new `subaccount_agents.portal_default_safety_mode` column (per F10 architect resolution) until the Chunk 2 spec is merged.

  *Enforcement:*
  - **Manual** (owner: main session at Task 6.5 freeze gate): implementation-order rule recorded in `tasks/builds/pre-launch-hardening-specs/progress.md § Implementation Order`
  - **Manual** (owner: main session at Task 6.6 consistency sweep + `pr-reviewer` for code branches): freeze gate in Task 6.5 + consistency sweep in Task 6.6 — both block code branches that violate the order

---

## 3. Execution contract invariants

**3.1 Re-check invalidation after I/O (C4b-INVAL-RACE).** Every dispatcher boundary that awaits external I/O re-reads its row and hard-discards on `status === 'invalidated'` before writing. This applies to `workflowEngineService.ts` tick switch internal helpers (`*Internal`) for `action_call`, `agent_call`, `prompt`, and `invoke_automation`, mirroring the public `completeStepRun` / `completeStepRunFromReview` invalidation behaviour.

  *Enforcement:*
  - **Test:** spec-named pure simulation test of read-after-await race per Chunk 5 — concurrent invalidate + dispatch result asserts the late writer hard-discards
  - **Static:** grep `*Internal` helpers in `workflowEngineService.ts` for the invalidation re-read call after every `await`; new helpers without the wrapper fail the gate
  *Source:* `tasks/todo.md:667` (C4b-INVAL-RACE).

**3.2 Pre-dispatch credential resolution (W1-44).** The dispatcher resolves each automation's `required_connections` for the subaccount context **before** firing the webhook. Unresolved required connections fail with `error_code: 'automation_missing_connection'` at dispatch, not at the provider edge.

  *Enforcement:*
  - **Test:** spec-named test exercising missing-mapping path — asserts dispatch fails with the named code, no provider call attempted
  *Source:* `tasks/todo.md:649` (W1-44).

**3.3 Defence-in-depth at dispatcher boundary (W1-43).** The step dispatcher rejects any `invoke_automation` resolution that would produce more than one outbound webhook (per spec §5.10a rule 4). A pure-function assertion inside `resolveDispatch` verifies the automation row conforms to the single-webhook contract.

  *Enforcement:*
  - **Test:** spec-named pure-function assertion test on `resolveDispatch` — multi-webhook input emits `automation_composition_invalid` with `status: 'automation_composition_invalid'`
  *Source:* `tasks/todo.md:648` (W1-43).

**3.4 §5.7 error vocabulary is closed.** New error codes require a spec amendment. The `automation_execution_error` value emitted at `invokeAutomationStepService.ts:95` is resolved per Chunk 5's W1-38 decision (introduce `automation_engine_unavailable`, re-use `automation_not_found`, OR re-use `automation_missing_connection`).

  *Enforcement:*
  - **Static:** CI grep across `server/services/` and `server/jobs/` for emitted `error_code` / `code:` string literals → must intersect the §5.7 vocabulary set; ad-hoc values fail the gate
  *Source:* `tasks/todo.md:651` (W1-38).

**3.5 `runResultStatus = 'partial'` is decoupled from summary presence (H3).** A semantically-successful run with no summary is `'success'`, not `'partial'`. The H3 architect resolution in Chunk 5 picks one of: separate `hasSummary` flag, side-channel `summaryMissing=true`, or monitor-and-revisit. Whichever is picked, summary failure must not demote a successful run.

  *Enforcement:*
  - **Test:** spec-named pure test on `computeRunResultStatus` in `agentExecutionServicePure.ts` — `(completed, !hasError, !hadUncertainty, !hasSummary)` returns `'success'` (not `'partial'`)
  *Source:* `tasks/todo.md:152` (H3).

**3.6 `errorMessage` threading on normal-path failed runs (HERMES-S1).** When a run terminates via the normal path (no thrown exception) with `derivedRunResultStatus === 'failed'`, the `errorMessage` from `preFinalizeMetadata` is threaded into `extractRunInsights` (`agentExecutionService.ts:1350-1368`). Memory extraction is not skipped because of a missing exception.

  *Enforcement:*
  - **Test:** spec-named pure test asserting `extractRunInsights` is invoked with the threaded `errorMessage` for failed-without-throw runs
  *Source:* `tasks/todo.md:92-105` (HERMES-S1).

---

## 4. Gate expectations

**4.1 RLS gate posture is explicit.** `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` posture (hard-blocking vs warn) is decided by Chunk 1 § Open Decisions and recorded in the spec body. The default during the testing round is documented; the alternative is documented; the user picks.

  *Enforcement:*
  - **Manual** (owner: Chunk 1 spec author + user at first review checkpoint): the chosen posture is recorded in the Chunk 1 spec PR body
  - **Static:** the gate script itself encodes the chosen posture (exit-code semantics) so CI behaviour matches the spec

**4.2 All Chunk 6 gates green.** `verify-action-call-allowlist.sh`, `verify-skill-read-paths.sh`, `verify-input-validation.sh`, `verify-permission-scope.sh`, `scripts/verify-integration-reference.mjs`, `verify-rls-session-var-canon.sh` all pass after Chunk 6 lands.

  *Enforcement:*
  - **Gate:** CI run on the Chunk 6 PR — every named gate must exit 0
  *Source:* mini-spec § Chunk 6 done criteria.

**4.3 Gate skips `import type` lines (RLS-CONTRACT-IMPORT / GATES-2).** The RLS-contract gate distinguishes runtime imports from `import type` at the lexer level — a type-only import does not trigger the direct-`db` violation.

  *Enforcement:*
  - **Static:** Chunk 6 updates the gate script (`scripts/gates/verify-rls-contract-compliance.sh` or equivalent) to filter `import type` lines
  - **Test:** named test case in Chunk 6 — fixture file with both runtime and type-only `db` imports asserts only the runtime import triggers the gate

**4.4 Pre-Phase-2 coverage baseline captured (SC-COVERAGE-BASELINE).** Before any testing-round commit, the warning-level counts from `verify-input-validation.sh` (44 today) and `verify-permission-scope.sh` (13 today) are recorded in `tasks/builds/pre-launch-hardening-specs/progress.md`. Subsequent diffs against this baseline determine whether Phase 2 introduced regressions per `REQ #35` (`tasks/todo.md:916`).

  *Enforcement:*
  - **Manual** (owner: main session before Chunk 6 PR opens): baseline numbers recorded in `progress.md` before Chunk 6 PR opens
  - **Static:** future PR descriptions cite the baseline + delta when they touch input-validation or permission-scope

**4.5 No new test categories introduced.** Per `docs/spec-context.md § convention_rejections`, no spec adds vitest / jest / playwright / supertest / frontend unit tests / API contract tests. Test plans default to `pure_function_only` (`docs/spec-context.md:28`).

  *Enforcement:*
  - **Manual** (owner: `spec-reviewer` agent): rejects findings that propose any of these via the `convention_rejections` mapping
  - **Static:** grep `package.json` and `*.test.ts` patterns for vitest/jest/playwright/supertest imports → must remain absent

---

## 5. Spec-vs-implementation translation rules

**5.1 Prefer existing primitives.** Per `docs/spec-context.md § accepted_primitives` (line 42), every spec defaults to existing primitives. Any new primitive requires a "why not reuse" paragraph per `docs/spec-authoring-checklist.md § Section 1`.

  *Enforcement:*
  - **Manual** (owner: `spec-reviewer` agent): raises `directional-new-primitive-without-justification` for any unjustified new primitive
  - **Static:** every per-chunk spec's `## Implementation Guardrails § MUST reuse:` lists the primitives it depends on; new primitives require a paragraph in the same section

**5.2 No feature flags.** Rollout model is `commit_and_revert` (`docs/spec-context.md:36`). No `feature_flags` introduced for any chunk. `feature_flags: only_for_behaviour_modes` (line 37) means flags are reserved for shadow-vs-active or dev-vs-prod modes — not pre-launch hardening.

  *Enforcement:*
  - **Manual** (owner: `spec-reviewer` agent): rejects per `convention_rejections` (`spec-context.md:73`)
  - **Static:** grep `growthbook` / `featureFlag` / `gb.isOn` introductions in any chunk PR diff → must return zero

**5.3 No new test categories.** See § 4.5 above.

**5.4 No introduce-then-defer patterns.** A spec MUST NOT propose a primitive and then defer it to a later phase. Either the spec ships the primitive in scope, or it doesn't propose it. Mid-spec deferrals are a documented anti-pattern per `docs/spec-authoring-checklist.md § Section 7`.

  *Enforcement:*
  - **Manual** (owner: `spec-reviewer` agent): raises a directional finding when a primitive is mentioned but not built in the same phase
  - **Static:** every spec's `## Deferred Items` is the single source of truth for deferred work; prose mentions of "deferred" / "later" / "Phase N+1" / "future" without a corresponding entry fail review

**5.5 Architect outputs are immutable post-pin.** Once a per-chunk spec pins the architect output's commit SHA in its front-matter, the architect output may not be edited without re-pinning every consuming spec. The conflict-resolution rule in `tasks/builds/pre-launch-hardening-specs/plan.md` § Architect-output conflict check permits **in-place updates** to the losing architect output to point at the winning decision; that update is the only sanctioned post-pin edit and counts as a re-pin event.

  *Enforcement:*
  - **Manual** (owner: main session at Task 6.5 freeze gate): post-freeze amendment protocol (Task 6.5) catches violations
  - **Static:** every spec front-matter declares `Architect input: <path> (commit SHA: <sha>)`; SHA mismatch with the actual file SHA at HEAD fails the consistency sweep (Task 6.6)

**5.6 Implementation order is binding.** Implementation order is `1 → {2, 4, 6} → 5 → 3` (`tasks/builds/pre-launch-hardening-specs/progress.md § Implementation Order`). PR merge order does not imply dependency order. No code branch starts until Tasks 6.5 (spec freeze) and 6.6 (consistency sweep) both stamp clear.

  *Enforcement:*
  - **Manual** (owner: main session at Task 6.5 freeze gate + Task 6.6 sweep): freeze stamp + consistency sweep stamp in `progress.md` are required prerequisites for any code branch
  - **Static:** any code-touching PR opened against `main` before both stamps appear in `progress.md` is out of protocol; `pr-reviewer` agent flags it on review (owner: `pr-reviewer` agent for code branches)

---

## 6. State / Lifecycle invariants

These invariants pin behaviour around state machines (workflow steps, agent runs, approvals, resume paths). Chunk 3 (dead-path completion) and Chunk 5 (execution correctness) are the primary consumers — subtle bugs in this category usually surface only under sustained testing, which is exactly when this sprint is trying to prevent them.

**6.1 Step transitions to terminal states require an execution record.** A `workflow_step_runs` row cannot transition from `pending` / `running` to `completed` / `completed_with_errors` / `failed` without a corresponding write to the execution record (`outputJson` populated for non-failed terminal states; `automation_execution_runs` row for `invoke_automation` steps; an `agent_run` linkage for `agent_call` steps). Empty terminal transitions are a Layer-2 fail-open of the C4a-REVIEWED-DISP class.

  *Enforcement:*
  - **Test:** spec-named pure test on `completeStepRun` / `completeStepRunFromReview` asserting the record-write occurs in the same transaction as the status update
  - **Static:** grep `setStatus.*'completed'` or equivalent across `workflowEngineService.ts` for matching record-write calls in the same block

**6.2 Approval-required steps pass through exactly one decision boundary.** A step in `review_required` status can only transition out via `decideApproval` (or its post-approval resume path per Chunk 3 C4a-REVIEWED-DISP). Direct status updates that skip the decision boundary are prohibited — they are the path that drops the dispatch (the bug C4a-REVIEWED-DISP exists to fix).

  *Enforcement:*
  - **Test:** spec-named pure test asserting only `decideApproval` (or the resume-path entry the architect names) writes the post-`review_required` status
  - **Static:** grep `WorkflowStepReviewService` and `decideApproval` callers for direct status updates — must route through the decision boundary

**6.3 Run cannot end `success` if any step is `error` (or `failed`) unless explicitly `partial`. Cancelled and skipped have their own terminal semantics.** `agent_runs.runResultStatus` follows the discriminated aggregation rule:

- **All steps `completed`** (none cancelled, skipped, errored, failed) → run is `success`.
- **Any step `error` / `failed`** → run is `failed` if the run terminated abnormally, OR `partial` if the run otherwise completed (mixed-success-and-error). Never `success`.
- **Steps `cancelled`** → counted as cancelled, NOT as success-by-default. A run with all-cancelled steps takes its own terminal state per the cancellation source (run-level cancel → `cancelled`; per-step cancel within an otherwise-successful run → `partial` to surface the partial-completion semantics, never `success`).
- **Steps `skipped`** → counted as skipped, NOT as success-by-default. A run where every dispatched step skipped (typically because their preconditions evaluated false) is `success` only if at least one step actually `completed`; an all-skipped run takes the run's own terminal state per `runStatus.ts` rather than masquerading as success.

The H3 invariant (3.5) is the orthogonal rule about summary presence; this is the rule about per-step outcome aggregation. Together they fix the H3-PARTIAL-COUPLING bug: `partial` should ONLY be reachable via per-step aggregation here, not via summary absence in 3.5.

  *Enforcement:*
  - **Test:** spec-named pure test on `computeRunResultStatus` covering each of the four cases above (all-completed → success; any-error → failed/partial; cancelled aggregation; skipped aggregation). Must coexist with H3's summary-decoupling rule from invariant 3.5 (i.e. summary absence does NOT trigger `partial`)
  - **Static:** grep set membership against `shared/runStatus.ts` (`TERMINAL_RUN_STATUSES` / `IN_FLIGHT_RUN_STATUSES` / `AWAITING_RUN_STATUSES`) — every status referenced in execution code must be in the canonical sets

**6.4 Resume paths re-enter through the same state machine boundary.** Any post-approval / post-pause resume path enters via `completeStepRun`, `completeStepRunFromReview`, or the named architect-resolved entry (Chunk 3 C4a-REVIEWED-DISP names which one). Resume paths MUST NOT bypass the invalidation re-check from invariant 3.1 — they get the same protection.

  *Enforcement:*
  - **Test:** spec-named pure test asserting the resume path performs the invalidation re-read before writing
  - **Static:** grep new resume entry points — must call the named boundary helper, not write status directly

**6.5 Status sets are closed.** The terminal, in-flight, and awaiting status sets defined in `shared/runStatus.ts` (per `docs/spec-context.md § accepted_primitives`) are the single source of truth. New statuses require a spec amendment AND a `shared/runStatus.ts` update in the same PR.

  *Enforcement:*
  - **Static:** CI grep for new string literals matching the status-shape pattern in `server/services/`, `server/jobs/`, `server/routes/` → must intersect the canonical sets in `shared/runStatus.ts`
  - **Manual** (owner: `spec-reviewer` agent): raises a directional finding when a new status appears without the corresponding `runStatus.ts` update

---

## 7. Cross-flow operational invariants

These invariants govern how flows behave under stress — retry, conflict, concurrency. They cross every chunk and every flow. Folded in 2026-04-26 from external review feedback.

**7.1 Idempotency posture is explicitly classified per externally-triggered write.** Every flow that accepts external input (HTTP route, websocket, webhook receiver, scheduled job) MUST classify its idempotency posture in its spec as exactly one of: **key-based** (deterministic dedup key against persisted state), **state-based** (the state machine guards retry — e.g. status-predicate UPDATE), or **non-idempotent (intentional)** (explicitly accepts retry duplicates with documented rationale).

  *Enforcement:*
  - **Manual** (owner: `pr-reviewer` agent + spec author): every per-flow contract section in any spec must declare the chosen posture.
  - **Static:** grep for "idempotency" / "Idempotency" in every Chunk 3 + Chunk 4 + Chunk 5 spec section that adds a write path → must surface a stated posture.

**7.2 Source-of-truth precedence is fixed.** When two artefacts disagree about the outcome of the same operation, the precedence is:

1. **Execution records** (`agent_runs`, `workflow_step_runs`, `automation_execution_runs`) — ground truth. The state-machine row IS the outcome.
2. **Step / run state machine** (`status` columns) — derived from #1; consistent because written in the same tx.
3. **Artefacts** (conversation_messages.artefacts JSONB) — UI-facing surface; reflects #1 + #2 but is a snapshot at write time.
4. **Logs** (`audit_events`, `agent_execution_events`) — informational; never authoritative for outcome.

  *Enforcement:*
  - **Manual** (owner: spec author + `pr-reviewer` agent): every flow that emits an artefact AND modifies an execution record MUST cite this hierarchy in its spec section. If the artefact's `executionStatus` field disagrees with the execution record's terminal state, the execution record wins.
  - **Static:** grep new code for direct reads of `executionStatus` from artefact JSONB without joining to the underlying execution record → flag as fragile in spec-conformance review.

**7.3 Correlation key is `executionId` (or `runId` when no execution exists).** Every observability event in any cross-flow chain MUST carry the same `executionId` (or `runId` for orchestration paths) so a trace can be reconstructed by filtering on a single key. The chain crosses HTTP route → service → step run → webhook → completion event → artefact.

  *Enforcement:*
  - **Static:** every `observabilityEvent` payload schema in spec § 4.5.7 / § 6.5.2 / § 6.5.3 must include `executionId` (or `runId`) at the top level.
  - **Manual** (owner: `pr-reviewer` agent): trace correlation is verified at first incident; missing key fails review.

**7.4 Every flow emits an explicit terminal-state status.** No flow returns silently. Every externally-triggered write path MUST emit a discriminated `status: 'success' | 'partial' | 'failed'` field in its terminal observability event AND in any user-facing response. Implicit success-by-absence is forbidden; an HTTP 200 without an explicit `status` field is a violation.

  *Enforcement:*
  - **Static:** grep every spec § 4.5.6 / § 6.5.1 / § 6.5.2 (no-silent-partial-success) for the three-value union → must be present in every flow.
  - **Test:** pure tests in Chunks 3, 4, 5 cover the success / partial / failed cases for each flow; no test asserts "succeeded if no error thrown" — every assertion checks the `status` field directly.
  - **Manual** (owner: spec author): every flow's response shape contract (e.g. § 4.5.8) must declare the `status` field.

---

## Invariant Violation Protocol

If any invariant in this document is violated during:

- **Spec drafting** (the author notices the proposed approach can't satisfy an invariant)
- **`spec-reviewer` iteration** (the reviewer flags an invariant conflict)
- **Cross-spec consistency sweep** (Task 6.6 finds a contradiction)
- **Code review** (pr-reviewer or spec-conformance during implementation)

…then exactly one of the following resolutions MUST be applied. Silent violations are not permitted.

### Resolution paths

1. **Resolve in-line.** Adjust the spec / architect output / code so the invariant is satisfied. Document the resolution in the spec's `## Open Decisions` (if it required adjudication) or `## Review Residuals` (if it required spec-reviewer iteration).
2. **Document and accept (directional tradeoff).** Add an entry to the spec's `## Review Residuals § Directional uncertainties` explaining why the violation is acceptable for this phase. The user reviews this at the next cadence checkpoint and either approves or sends it back for in-line resolution.
3. **Defer.** Add an entry to the spec's `## Deferred Items` with: the invariant violated, the reason for deferral, the trigger for re-opening. Does not satisfy the invariant; explicitly punts it to a later phase.
4. **Amend the invariants doc.** If the invariant itself is wrong (overlooked context, contradicted by a downstream architect resolution, etc.), open an amendment PR per the post-freeze amendment protocol in `tasks/builds/pre-launch-hardening-specs/plan.md` § Task 6.5: `## Amendments` entry, re-pin the SHA in every consuming spec, re-run Task 6.6 (consistency sweep), re-stamp Task 6.5 (freeze).

### What is not permitted

- Discovering a violation and proceeding without applying one of the four paths above.
- Marking a spec / PR / freeze stamp as clean while a known violation is unresolved.
- Updating an invariant in-place inside a per-chunk spec (the spec must update the invariants doc instead).
- Implementing code that violates an invariant on the basis that "the spec says so" — if the spec says so, both the spec and the invariants doc must agree first.

### Audit trail

Every violation resolution leaves a record:

- Path 1 (resolve in-line) → recorded in the spec's `## Open Decisions` or `## Review Residuals`
- Path 2 (document and accept) → recorded in `## Review Residuals § Directional uncertainties`
- Path 3 (defer) → recorded in `## Deferred Items` and routed to `tasks/todo.md`
- Path 4 (amend) → recorded in this doc's `## Amendments` section + every consuming spec's front-matter SHA bump

---

## Amendments

Every amendment to this document MUST update the pinned SHA in every consuming per-chunk spec's front-matter. An amendment that lands without re-pinning the consumers leaves the consumers asserting an old, superseded contract — the invariants doc says one thing while the specs claim alignment with a different version.

### Required steps for any amendment

1. **Open the amendment PR** against the integration branch, modifying only `docs/pre-launch-hardening-invariants.md`. The PR title prefix is `docs(pre-launch-hardening-invariants):`.
2. **Add an entry to the `## Amendments` section below** with: amendment date, prior pinned SHA, the change made, the user who approved, and the list of consuming specs.
3. **Identify every consuming spec** by grepping `docs/pre-launch-*-spec.md` for the prior SHA. Each match is a consumer that needs re-pinning.
4. **Open follow-up PRs (one per consuming spec, OR one bundled PR)** that update each consumer's front-matter `Invariants:` line to the new SHA. Do not leave a consumer at the old SHA.
5. **Re-run Task 6.6 (cross-spec consistency sweep)** with the amended invariants in force.
6. **Re-stamp Task 6.5 (spec freeze)** at the post-amendment HEAD per the protocol in `tasks/builds/pre-launch-hardening-specs/plan.md`.

### Audit trail format

```markdown
### YYYY-MM-DD — <one-line summary>

- **Prior SHA:** `<short-sha>` (`<full-sha>`)
- **New SHA:** `<short-sha>` (`<full-sha>`)
- **Change:** <what changed; cite invariant numbers>
- **Approved by:** <user>
- **Consuming specs re-pinned:** `pre-launch-rls-hardening-spec`, `pre-launch-schema-decisions-spec`, …
- **Re-stamp:** Task 6.5 freeze re-stamped at `<post-amendment-sha>`; Task 6.6 sweep clean.
```

### Entries

_(Empty at authoring. The post-freeze amendment protocol in `tasks/builds/pre-launch-hardening-specs/plan.md` § Task 6.5 is binding.)_
