# Pre-Launch Hardening — Spec-Branch Implementation Plan

**Branch:** `claude/pre-launch-hardening-spec-fs3Wy`
**Source brief:** `docs/pre-launch-hardening-mini-spec.md`
**Output mode:** SPEC-ONLY (no application code lands on this branch)
**Date:** 2026-04-26
**Owner of this plan:** the user (review + approve before any spec writing begins)

---

## Table of contents

- §1 Scope, branch policy, framing
- §2 ID resolution table (mini-spec ID → `tasks/todo.md` location)
- §3 Per-chunk spec outlines
  - §3.1 Chunk 1 — RLS Hardening Sweep
  - §3.2 Chunk 2 — Schema Decisions + Renames
  - §3.3 Chunk 3 — Dead-Path Completion
  - §3.4 Chunk 4 — Maintenance Job RLS Contract
  - §3.5 Chunk 5 — Execution-Path Correctness
  - §3.6 Chunk 6 — Gate Hygiene Cleanup
- §4 Architect invocation briefs (Chunks 2 & 3)
- §5 spec-reviewer + `tasks/todo.md` annotation + PR plan
- §6 Write order, sequencing, risks

---

## §1 Scope, branch policy, framing

### 1.1 Branch policy

- **Spec-only branch.** No application code (no migrations, no `.ts`, no schema, no tests against runtime behaviour) lands on `claude/pre-launch-hardening-spec-fs3Wy`.
- **Per-spec PR.** Each of the 6 chunk specs lands as its own PR for the user to review and merge. The user lands implementation against each merged spec on a separate branch later.
- **Documentation deltas only.** Permitted writes on this branch:
  - New files: `docs/pre-launch-<chunk-slug>-spec.md` (×6)
  - Edits to: `tasks/todo.md` (annotate items with owning spec slug — never delete)
  - This plan + the build slug folder: `tasks/builds/pre-launch-hardening/`
  - `tasks/current-focus.md` (optional pointer update on completion of all 6 specs)
- **No CLAUDE.md / architecture.md / spec-context.md edits** unless a spec-reviewer iteration explicitly forces a framing-statement update — and even then, only with the user's go-ahead.

### 1.2 Framing inherited from `docs/spec-context.md` (2026-04-16)

Every spec in this branch must respect:

- `pre_production: yes` / `live_users: no` / `testing_phase_started: no`
- `stage: rapid_evolution` / `breaking_changes_expected: yes`
- `testing_posture: static_gates_primary` — runtime tests **pure-function only**, no vitest/jest/playwright/supertest, no frontend tests, no API-contract tests, no E2E, no performance baselines.
- `rollout_model: commit_and_revert` — no feature flags for rollout (only for behaviour modes), no staged rollout, no migration-safety dry-runs.
- `prefer_existing_primitives_over_new_ones: yes` — every new primitive needs a "why-not-reuse" paragraph.

Each spec's test plan section will explicitly state "static gates + pure-function tests only — no runtime/E2E/contract tests per `docs/spec-context.md`" so the spec-reviewer doesn't escalate it as a directional finding.

### 1.3 What "implementation plan" means in this branch

This plan is the **plan to author 6 specs**, not a plan to implement them. The deliverables here are six finalized spec documents, each implementable independently on a follow-up branch. Implementation sequencing (which chunk lands first, what blocks what) is documented inside each spec's `## Depends on` and `## Blocks` lines so the human implementer has it after this branch is merged.

### 1.4 Hard rules carried into every chunk spec

- Every new tenant-scoped table needs all four of: RLS policy in the same migration, `RLS_PROTECTED_TABLES` manifest entry, route/middleware guard if HTTP-accessible, `PrincipalContext`-scoped reads if accessed from agent execution. (`spec-authoring-checklist.md §4`.)
- Every data shape crossing a service boundary or consumed by a parser gets a Contracts subsection with a worked example. (`spec-authoring-checklist.md §3`.)
- Every "deferred" / "later" / "future" reference in prose must appear in the spec's `## Deferred Items` section. (`spec-authoring-checklist.md §7`.)
- Every "Files to change" prose reference must cascade into the file inventory in the same edit. (`spec-authoring-checklist.md §2`.)
- Architectural calls in Chunks 2 and 3 are **not pre-decided in this plan**. The plan records the question and the candidates; the architect agent resolves them before the spec is written.

---

## §2 ID resolution table

Every ID cited in `docs/pre-launch-hardening-mini-spec.md` was located in `tasks/todo.md`. Where the mini-spec coined a short label for an item that has no native ID in `tasks/todo.md`, the canonical location is given below so the spec author and reviewers can trace requirement provenance.

### 2.1 Chunk 1 — RLS Hardening

| Mini-spec ID | Canonical in `tasks/todo.md` | Source line | Status |
|---|---|---|---|
| `P3-C1` | `P3-C1 — Missing FORCE RLS + CREATE POLICY on memory_review_queue` | L841 | open |
| `P3-C2` | `P3-C2 — drop_zone_upload_audit FORCE RLS` | L842 | open |
| `P3-C3` | `P3-C3 — onboarding_bundle_configs FORCE RLS` | L843 | open |
| `P3-C4` | `P3-C4 — trust_calibration_state FORCE RLS` | L844 | open |
| `P3-C5` | `P3-C5 — Phantom RLS session var` | L840 | open |
| `P3-C6` | `P3-C6 — direct db import in routes/memoryReviewQueue.ts` | L845 | open |
| `P3-C7` | `P3-C7 — direct db import in routes/systemAutomations.ts` | L846 | open |
| `P3-C8` | `P3-C8 — direct db import in routes/subaccountAgents.ts` | L847 | open |
| `P3-C9` | `P3-C9 — missing resolveSubaccount in routes/clarifications.ts` | L848 | open |
| `P3-C10` | `P3-C10 — missing orgId filter in documentBundleService.ts:679,685` | L849 | open |
| `P3-C11` | `P3-C11 — missing orgId filter in skillStudioService.ts:168,309` | L850 | open |
| `P3-H2` | `P3-H2 — direct db import in lib/briefVisibility.ts` | L851 | open |
| `P3-H3` | `P3-H3 — direct db import in lib/workflow/onboardingStateHelpers.ts` | L852 | open |
| `SC-1` (mini-spec alias) | `SC-2026-04-26-1` — A2 schema-vs-registry gate, 64 violations | L983 | open |
| `GATES-2026-04-26-1` | reference_documents (0202) + reference_document_versions (0203) FORCE RLS | L1001 | open |

### 2.2 Chunk 2 — Schema Decisions + Renames

| Mini-spec ID | Canonical in `tasks/todo.md` | Source line | Status |
|---|---|---|---|
| `F6` | `F6 / §6.3 / §12.25 — safety_mode vs run_mode collision` | L503 | open |
| `F10` | `F10 / §6.8 / §12.13 — portal run-mode field unnamed` | L504 | open |
| `F11` | `F11 / §6.4 / §12.22 — side_effects storage decision` | L505 | open |
| `F15` | `F15 / §5.4–§5.5 / §12.23 — input_schema/output_schema validator + format` | L506 | open |
| `F21` | `F21 / §7.4 / §12.16 — Rule 3 "Check now" trigger or removal` | L507 | open |
| `F22` | `F22 / §7.6 / §12.17 — definition of "meaningful" output` | L508 | open |
| `WB-1` | `REQ #WB-1 — agent_runs.handoff_source_run_id never written` | L637 | open |
| `DELEG-CANONICAL` (mini-spec coined) | `[auto] Designate a canonical source of truth for delegation analytics` | L332 | open |
| `W1-6` | `REQ W1-6 — automations table column renames not applied` | L646 | open |
| `W1-29` | `REQ W1-29 — *.playbook.ts → *.workflow.ts not renamed` | L647 | open |
| `BUNDLE-DISMISS-RLS` (mini-spec coined) | `bundle_suggestion_dismissals unique-key vs RLS mismatch` | L480 | open |
| `CACHED-CTX-DOC` (mini-spec coined) | `Subaccount isolation decision — document Option B-lite posture` | L491 | open |

### 2.3 Chunk 3 — Dead-Path Completion

| Mini-spec ID | Canonical in `tasks/todo.md` | Source line | Status |
|---|---|---|---|
| `DR1` | `DR1 — POST /api/rules/draft-candidates route missing` | L369 | open |
| `DR2` | `DR2 — re-invoke fast-path + Orchestrator on follow-up messages` | L370 | open |
| `DR3` | `DR3 — wire approve/reject actions on BriefApprovalCard` | L371 | open |
| `C4a-REVIEWED-DISP` (mini-spec coined) | `Review-gated invoke_automation steps never dispatch after approval` | L665 | open |

### 2.4 Chunk 4 — Maintenance Job RLS Contract

| Mini-spec ID | Canonical in `tasks/todo.md` | Source line | Status |
|---|---|---|---|
| `B10-MAINT-RLS` (mini-spec coined) | `B10 — maintenance jobs bypass admin/org tx contract` | L349 | open |

### 2.5 Chunk 5 — Execution-Path Correctness

| Mini-spec ID | Canonical in `tasks/todo.md` | Source line | Status |
|---|---|---|---|
| `C4b-INVAL-RACE` (mini-spec coined) | `Inline-dispatch step handlers do not re-check invalidation after I/O` | L667 | open |
| `W1-43` | `REQ W1-43 — dispatcher §5.10a rule 4 defence-in-depth` | L648 | open |
| `W1-44` | `REQ W1-44 — pre-dispatch connection resolution` | L649 | open |
| `W1-38` | `REQ W1-38 — automation_execution_error not in §5.7 vocab` | L651 | open |
| `HERMES-S1` (mini-spec coined) | `§6.8 errorMessage gap on normal-path failed runs` | L97–105 | open |
| `H3-PARTIAL-COUPLING` (mini-spec coined) | `H3 — runResultStatus='partial' coupling to summary presence` | L152 | open |
| `C4a-6-RETSHAPE` (mini-spec coined) | `REQ #C4a-6 — return-shape contract for delegation errors` | L337, L587 | open |

### 2.6 Chunk 6 — Gate Hygiene Cleanup

| Mini-spec ID | Canonical in `tasks/todo.md` | Source line | Status |
|---|---|---|---|
| `P3-H4` | `P3-H4 — actionCallAllowlist.ts file does not exist` | L858 | open |
| `P3-H5` | `P3-H5 — measureInterventionOutcomeJob queries canonicalAccounts outside service` | L859 | open |
| `P3-H6` | `P3-H6 — referenceDocumentService imports anthropicAdapter directly` | L860 | open |
| `P3-H7` | `P3-H7 — 5 files import canonicalDataService without PrincipalContext` | L861 | open |
| `S-2` | `S-2 — Principal-context propagation is import-only across 4 of 5 files` | L940 | open |
| `P3-M10` | `P3-M10 — skill visibility drift` | L879 | open |
| `P3-M11` | `P3-M11 — 5 workflow skills missing YAML frontmatter` | L880 | open |
| `P3-M12` | `P3-M12 — verify-integration-reference.mjs crashes (yaml dep)` | L881 | open |
| `P3-M15` | `P3-M15 — canonical_flow_definitions + canonical_row_subaccount_scopes missing from registry` | L863 | open |
| `P3-M16` | `P3-M16 — docs/capabilities.md editorial rule violation` | L883 | open |
| `P3-L1` | `P3-L1 — missing explicit package.json deps` | L882 | open |
| `S2-SKILL-MD` (mini-spec coined) | `S2 — add skill .md files for ask_clarifying_questions / challenge_assumptions` | L350 | open |
| `S3-CONFLICT-TESTS` (mini-spec coined) | `S3 — strengthen rule-conflict parser tests` | L351 | open |
| `S5-PURE-TEST` (mini-spec coined) | `S-5 — pure unit test for saveSkillVersion orgId-required throw contract` | L947 | open |
| `SC-COVERAGE-BASELINE` (mini-spec coined) | `REQ #35 — verify-input-validation.sh (44) + verify-permission-scope.sh (13) baseline` | L916 | open |
| `RLS-CONTRACT-IMPORT` / `GATES-2` | `GATES-2026-04-26-2 — verify-rls-contract-compliance.sh should skip import type lines` | L1008 | open |

### 2.7 IDs not found

None. Every mini-spec citation resolved. Where the mini-spec coined a short label (BUNDLE-DISMISS-RLS, CACHED-CTX-DOC, C4a-REVIEWED-DISP, C4b-INVAL-RACE, HERMES-S1, H3-PARTIAL-COUPLING, B10-MAINT-RLS, S2-SKILL-MD, S3-CONFLICT-TESTS, S5-PURE-TEST, SC-COVERAGE-BASELINE, DELEG-CANONICAL), the spec will quote the coined label AND the canonical location so the cross-reference is unambiguous.

---

## §3 Per-chunk spec outlines

For each chunk: target spec slug, goal, items closed, items NOT closed, key decisions (resolved or escalated), files touched, test plan posture, done criteria, rollback notes, depends on.

### §3.1 Chunk 1 — RLS Hardening Sweep

- **Spec slug:** `pre-launch-rls-hardening-spec`
- **Path:** `docs/pre-launch-rls-hardening-spec.md`
- **Architect needed?** No — inline planning. Mostly mechanical once SC-1 is triaged.
- **Depends on:** none. This is the foundational spec — every other chunk's RLS posture references it.
- **Blocks:** all other chunks (no testing should start until Chunk 1 implementation lands).

**Goal (one paragraph for the spec):**
Every multi-tenant write/read path goes through RLS-enforced session context. No direct `db` imports in `server/routes/`, no `FORCE RLS` gaps on tenant tables, no phantom session vars, no drift between the `RLS_PROTECTED_TABLES` manifest and the migrations on disk. The RLS gate becomes hard-blocking after the registry is reconciled.

**Non-goals:**
- No new RLS *features* (no per-row policies, no subaccount layer for tables that don't already have it).
- No backfill of historical data — this is pre-production.
- No retroactive `@rls-baseline` annotation cleanup beyond the two `reference_documents` files this spec ships.
- Cached-context tables already opted into "Option B-lite" (per migration 0213) — this spec does not relitigate that decision; CACHED-CTX-DOC routes the *documentation* of it to Chunk 2.

**Items closed (with source IDs):**
- `P3-C1` (memory_review_queue: FORCE RLS + CREATE POLICY) — L841
- `P3-C2` (drop_zone_upload_audit: FORCE RLS) — L842
- `P3-C3` (onboarding_bundle_configs: FORCE RLS) — L843
- `P3-C4` (trust_calibration_state: FORCE RLS) — L844
- `P3-C5` (phantom RLS session var across migrations 0205–0208) — L840
- `P3-C6..C9` (4 routes importing `db` directly: `memoryReviewQueue.ts`, `systemAutomations.ts`, `subaccountAgents.ts`, `clarifications.ts`) — L845–L848
- `P3-C10` (documentBundleService.ts:679,685 missing orgId filter) — L849
- `P3-C11` (skillStudioService.ts:168,309 missing orgId filter) — L850
- `P3-H2` (briefVisibility.ts direct db import) — L851
- `P3-H3` (onboardingStateHelpers.ts direct db import) — L852
- `SC-2026-04-26-1` (60-table delta between `RLS_PROTECTED_TABLES` registry and migrations + 4 stale registry entries) — L983
- `GATES-2026-04-26-1` (`reference_documents` / `_versions` FORCE RLS via parent-EXISTS WITH CHECK) — L1001

**Items explicitly NOT closed (and why):**
- All `RLS-*` features outside the listed item IDs.
- `BUNDLE-DISMISS-RLS` — moved to Chunk 2 (it's a unique-key vs RLS *schema decision*, not a coverage gap).
- `CACHED-CTX-DOC` — moved to Chunk 2 (it's a *documentation* deliverable, not an enforcement change).
- Any RLS work on tables that the SC-1 triage classifies as system-scoped (no `organisation_id`) — those are documented in the spec but not given policies.

**Key decisions (resolved inline — no architect needed):**
1. **SC-1 triage methodology.** Per-table classification (tenant-scoped vs system-scoped) is the spec author's first pass. The spec will include a table-by-table classification grid covering all 60 unregistered tables + 4 stale registry entries. Resolution rule: if the table has `organisation_id` (or `subaccount_id` with parent-org reachability) → tenant-scoped → policy + manifest entry; else → system-scoped → manifest exclusion + one-line comment.
2. **Hard-blocking gate.** Resolution: the `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` gates flip to **hard-blocking (exit 1)** after the registry is reconciled. Pre-flip: warning-only. Post-flip: any new tenant table without manifest + policy + guard is a CI failure. Spec includes the precise commit-order: (a) corrective migration ships, (b) manifest update ships in same PR, (c) gate flips in a follow-up commit/PR.
3. **Phantom session var fix.** Resolution: per `migration 0213` pattern — replace all `app.current_organisation_id` references with `current_setting('app.organisation_id', true)`. New corrective migration in numerical order after the latest (will be assigned at implementation time). This is the spec-named approach in `tasks/todo.md` L840.
4. **Direct-db-import remediation pattern.** Resolution: each route gets a service-layer extraction (move queries to `<routeName>Service.ts`); the route imports the service; `withOrgTx` / `getOrgScopedDb` from `server/middleware/orgScoping.ts` is the entry point. `lib/briefVisibility.ts` and `lib/workflow/onboardingStateHelpers.ts` either delegate to an existing service or get a `withOrgTx` wrapper at the call edge.
5. **`reference_document_versions` parent-EXISTS WITH CHECK.** Resolution: spec restates the existing `tasks/todo.md` L1005 approach — the versions table has no `organisation_id` column, so the policy uses `EXISTS (SELECT 1 FROM reference_documents WHERE id = reference_document_versions.document_id AND organisation_id = current_setting('app.organisation_id', true)::uuid)`.

**Files touched (concrete):**
- New migrations: 4 patch migrations (one each for P3-C1..C4) + 1 phantom-var migration + 1 reference-documents-FORCE-RLS migration (numbered at implementation time).
- Service layer: `server/services/memoryReviewQueueService.ts` (created/extended), `server/services/systemAutomationsService.ts` (created/extended), `server/services/subaccountAgentsService.ts` (created/extended); `clarifications.ts` route updates only — no new service.
- Route updates: `server/routes/memoryReviewQueue.ts`, `server/routes/systemAutomations.ts`, `server/routes/subaccountAgents.ts`, `server/routes/clarifications.ts`.
- Service updates: `server/services/documentBundleService.ts`, `server/services/skillStudioService.ts`, `server/lib/briefVisibility.ts`, `server/lib/workflow/onboardingStateHelpers.ts`.
- Manifest: `server/config/rlsProtectedTables.ts`.
- Gate config: `scripts/gates/verify-rls-coverage.sh`, `scripts/gates/verify-rls-contract-compliance.sh` (warn → hard-block flip).
- Documentation: `architecture.md` § "Row-Level Security" if the SC-1 reconciliation surfaces a manifest-shape change worth recording.

**Test plan:**
- Static gates only — `verify-rls-coverage.sh` (must exit 0 after fixes), `verify-rls-contract-compliance.sh` (must exit 0). No new runtime tests; the existing `rls.context-propagation.test.ts` integration harness already covers default-deny posture.
- One pure-function test added per service-extraction (memoryReviewQueueService etc.) verifying the org-scoped query shape compiles against the Drizzle schema.

**Done criteria:**
- Zero `import { db } from` matches in `server/routes/`.
- Every tenant table has FORCE RLS + valid policies; manifest 1:1 with migrations.
- 3-set drift (manifest ↔ migrations ↔ code expectations) is zero.
- Both gates exit 0 in hard-block mode.

**Rollback notes:**
- Each FORCE RLS migration includes a `_down.sql` that drops the FORCE clause (keeps RLS enabled).
- Phantom-var migration's down reverts `current_setting(...)` references to the old form (recorded for completeness — pre-prod, no expectation we use the down path).
- Hard-block gate flip is a commit revert if it fires unexpectedly in CI.

### §3.2 Chunk 2 — Schema Decisions + Renames

- **Spec slug:** `pre-launch-schema-decisions-spec`
- **Path:** `docs/pre-launch-schema-decisions-spec.md`
- **Architect needed?** **Yes.** Three schema-shape calls (F6/F10/F11), one cross-cutting analytics call (DELEG-CANONICAL), one delegation-graph call (WB-1) all benefit from a single architect pass that sees the trade-offs together.
- **Depends on:** Chunk 1 (RLS posture is the foundation any schema change must satisfy).
- **Blocks:** Chunk 5 (some F-items live in the same files Chunk 5 touches; schema decisions should land first to avoid double-touching).

**Goal (one paragraph for the spec):**
Lock in the column shapes, table/column renames, and analytics-source-of-truth contracts that block riley Part 3 migration and 59 call sites today. All decisions; minimal new code beyond the rename mechanics. Resolve every "Architect must pick" item from `tasks/todo.md` so implementation can start without further design loops.

**Non-goals:**
- No new schema *features* outside the named items. No table splits (`AGENT-RUNS-SPLIT` is explicitly deferred per mini-spec).
- No data migration or backfill — pre-prod, no live data.
- No riley Part 3 implementation in this spec — the spec resolves the *blockers* so Part 3 can land in a follow-up.

**Items closed (with source IDs):**
- `F6` (safety_mode vs run_mode collision) — L503
- `F10` (portal run-mode field name) — L504
- `F11` (side_effects storage shape) — L505
- `F15` (input_schema/output_schema validator + format) — L506
- `F21` (Rule 3 "Check now" trigger or removal) — L507
- `F22` (definition of "meaningful" output) — L508
- `WB-1` (agent_runs.handoff_source_run_id write-path + parentRunId reuse decision) — L637
- `DELEG-CANONICAL` (canonical truth between agent_runs telemetry and delegation_outcomes) — L332
- `W1-6` (automations table column renames; 59 call sites) — L646
- `W1-29` (`*.playbook.ts → *.workflow.ts` file extension + directory rename) — L647
- `BUNDLE-DISMISS-RLS` (bundle_suggestion_dismissals unique-key vs RLS) — L480
- `CACHED-CTX-DOC` (Option B-lite RLS posture documentation) — L491

**Items explicitly NOT closed (and why):**
- riley Part 3 migration itself — out of scope; this spec only unblocks it.
- `AGENT-RUNS-SPLIT` — explicitly deferred in the mini-spec; revisit on trigger (TS-inference wall, ~40 column threshold, or new column-group subsystem).
- All `RILEY-*` and `HD-*` feature extensions — explicitly deferred per mini-spec.
- The W1-43/W1-44/W1-38 dispatcher items (despite living in similar files) — those are Chunk 5 (execution correctness), not schema.

**Key decisions — escalated to architect (NOT pre-decided here):**
1. **F6** — `safety_mode` vs existing `run_mode`: keep split, migrate one, or `runConfig` JSONB. Architect picks. (Default per `tasks/todo.md` L503: keep split.)
2. **F10** — portal default safety-mode column on `subaccount_agents`: identify existing column or add new. Architect picks. (Recommendation per L504: new column `portal_default_safety_mode text NOT NULL DEFAULT 'explore'`.)
3. **F11** — `side_effects` storage: top-level boolean column, JSONB sub-field, or seed-only frontmatter. Architect picks. (Recommendation per L505: top-level column.)
4. **WB-1** — `parentRunId` for handoff runs: keep alongside `handoffSourceRunId` (backward-compat) or null it and migrate downstream chain logic. Architect picks. Affects `agentExecutionService.ts:1226-1232` and `agentActivityService.getRunChain` consumers.
5. **DELEG-CANONICAL** — pick one canonical source between `agent_runs` telemetry and `delegation_outcomes` event stream OR document the alignment contract that prevents drift. (Recommendation per L332: `delegation_outcomes` is canonical for "what was attempted and outcome"; `agent_runs` columns are per-run snapshot for joins.)

**Key decisions — resolved inline (no architect needed):**
6. **F15** — validator picks: spec defaults to `zod` (already in project deps) with JSON-Schema-light shape, `additionalProperties: false` opt-in per process. The architect can override but `tasks/todo.md` L506 notes this is a v1 best-effort choice; spec carries the default unless architect changes it.
7. **F21** — Rule 3 "Check now": spec adopts agent recommendation (drop Rule 3 from v1; ship the gate with 3 rules). Architect can revisit if F21 surfaces in the broader F-item architect pass.
8. **F22** — "meaningful" output definition: spec adopts agent recommendation (`status='completed'` AND (≥1 action proposed OR ≥1 memory block written)). Same caveat — architect can adjust.
9. **W1-6** — column renames: spec ships an ALTER TABLE migration with matching `_down` reversal + Drizzle schema update + grep+replace across all 59 call sites. No design call; mechanical.
10. **W1-29** — file/directory rename: spec ships the rename + import-path updates across consumers (seeder, build scripts). No design call; mechanical.
11. **BUNDLE-DISMISS-RLS** — spec adopts option (a) per L487: extend unique index to `(organisation_id, user_id, doc_set_hash)` + matching conflict target in `dismissBundleSuggestion`. (b) was the alternative — drop org-scoping; rejected because the table is already org-scoped in RLS so consistency wins.
12. **CACHED-CTX-DOC** — spec adds a §RLS subsection to `docs/cached-context-infrastructure-spec.md` (per L491 "keep scope narrow: a short subsection in the spec, not a new doc"). Documentation only.

**Files touched (concrete):**
- Drizzle schema: `server/db/schema/automations.ts`, `server/db/schema/agentRuns.ts`, `server/db/schema/subaccountAgents.ts`, `server/db/schema/processes.ts` (or its renamed equivalent), `server/db/schema/systemSkills.ts`, `server/db/schema/bundleSuggestionDismissals.ts`.
- Migrations: ALTER TABLE rename migration for W1-6, schema migrations for F6/F10/F11 (architect-shaped), unique-index migration for BUNDLE-DISMISS-RLS, validator-format migration for F15 (if column-typed).
- Service layer (W1-6 call sites): `server/services/automationService.ts`, `server/services/invokeAutomationStepService.ts`, `server/services/workflowEngineService.ts`, `server/services/workspaceHealthDetectors.ts` (and the 11 other files cited at L646).
- Routes: any route referencing renamed columns.
- File-extension rename (W1-29): `server/playbooks/*.playbook.ts` → `server/workflows/*.workflow.ts`; `server/scripts/seedWorkflows.ts` and any consumer.
- Spec doc edits: `docs/riley-observations-dev-spec.md` (resolves the F-item architect pending notes); `docs/cached-context-infrastructure-spec.md` (CACHED-CTX-DOC subsection); `docs/hierarchical-delegation-dev-spec.md` (records the WB-1 + DELEG-CANONICAL resolution).

**Test plan:**
- Static gates only — `npm run typecheck` (must pass after renames), `verify-rls-coverage.sh` (BUNDLE-DISMISS-RLS migration must keep 0 violations).
- Pure-function tests where data shapes change: F11 (`side_effects` reader/writer if column-typed), F15 (zod validator on a representative `processes.input_schema`), DELEG-CANONICAL (if the resolution introduces a reader helper).

**Done criteria:**
- All ambiguous columns have names + types named in spec.
- riley Part 3 migration unblocked (every F-item resolved).
- Drizzle schema, SQL migrations, and code all use the new names; W1-6 grep-clean (no legacy identifiers).
- `*.workflow.ts` extension across the board; no `*.playbook.ts` files remain.
- `agent_runs.handoff_source_run_id` write-path defined in spec; no ambiguity for INV-1.2/INV-1.3/INV-1.4 invariants.
- `delegation_outcomes` vs `agent_runs` canonical ownership documented in spec.

**Rollback notes:**
- Renames have `_down` migrations (rename back). Pre-prod, expectation we don't use them.
- F6/F10/F11 column adds have `_down` (drop column). If F11 ships as a JSONB sub-field, the down is a no-op (sub-fields don't have schema).

### §3.3 Chunk 3 — Dead-Path Completion

- **Spec slug:** `pre-launch-dead-path-completion-spec`
- **Path:** `docs/pre-launch-dead-path-completion-spec.md`
- **Architect needed?** **Yes.** DR2 and C4a-REVIEWED-DISP each carry an architectural call that needs an architect pass before the spec is written.
- **Depends on:** Chunk 1 (RLS), Chunk 2 (schema), Chunk 5 (execution-path correctness — DR3's approval dispatch and C4a-REVIEWED-DISP are adjacent in the dispatcher).
- **Blocks:** none — last in line.

**Goal (one paragraph for the spec):**
Every write-path the product surfaces actually executes. Today the highest-impact paths (BriefApprovalCard approve/reject, conversation follow-ups, post-approval automation dispatch, draft-candidates suggestion route) are silently demo-only. After this spec lands, every documented click in the product produces a real server-side effect with a traceable execution trail.

**Non-goals:**
- No new approval *types* — the spec wires the existing approval primitives end-to-end.
- No new orchestrator features — DR2's follow-up trigger reuses `classifyChatIntent` and `orchestratorFromTaskJob`.
- No UX redesign — the buttons that exist today stay where they are; only their handlers change.

**Items closed (with source IDs):**
- `DR1` (POST /api/rules/draft-candidates route + handler) — L369
- `DR2` (re-invoke fast-path + Orchestrator on follow-up conversation messages) — L370
- `DR3` (BriefApprovalCard approve/reject end-to-end) — L371
- `C4a-REVIEWED-DISP` (review-gated invoke_automation never dispatches after approval) — L665

**Items explicitly NOT closed (and why):**
- `CGF6-IDEMPOTENCY` (`saveRule` idempotency key) — explicitly deferred per mini-spec; ChatGPT round-4 follow-up.
- Approvals on step types other than `invoke_automation` (`agent_call`, `prompt`, `action_call`) — same architectural shape as C4a-REVIEWED-DISP per L665, but not in this chunk's items.
- `LAEL-RELATED-EXT` — explicitly deferred (needs spec first).

**Key decisions — escalated to architect (NOT pre-decided here):**
1. **DR2 — follow-up trigger semantics.** Does every follow-up message run `classifyChatIntent`? Or threshold-based ("only if ≥ N tokens" / "only if intent != 'thanks'")? Or explicit user action ("re-run agent")? Architect picks. Cross-cuts non-Brief scopes (`task`, `agent_run`) that don't currently enqueue orchestration, idempotency for passive acks, and whether `simple_reply`/`cheap_answer` produce new inline artefacts on follow-ups (per L370).
2. **C4a-REVIEWED-DISP — post-approval dispatch shape.** Two candidates per L665: (a) dedicated post-approval resume path that re-enters `invokeAutomationStep()` and performs the webhook dispatch; (b) step-type-aware approval handling in `decideApproval` that dispatches the approved step rather than completing it. Architect picks. Cross-cuts `decideApproval`, the step-run state machine, and the tick loop.

**Key decisions — resolved inline (no architect needed):**
3. **DR3 — approve/reject server route.** Spec adopts L371 approach: new server route(s) accept the decision and dispatch via `actionRegistry` / enqueue an orchestrator run; execution record linkage updates `executionId` + `executionStatus` on the artefact; client handlers call the new route and refresh state. Route shape: `POST /api/briefs/:briefId/approvals/:artefactId` with `{ decision: 'approve' | 'reject', note?: string }`. Mechanical given the existing primitives.
4. **DR1 — draft-candidates route.** Spec adopts L369 approach: new `POST /api/rules/draft-candidates` route that scans `conversation_messages.artefacts` JSONB for the `artefactId`, verifies `kind === 'approval'`, loads the parent brief for `briefContext`, looks up existing related rules, then calls `draftCandidates(...)`. Route guarded by `authenticate` + `requirePermission('rule.draft')` (or equivalent existing permission key).

**Files touched (concrete):**
- New service: `server/services/briefApprovalService.ts` (DR3) — accepts decision, dispatches via `actionRegistry`, updates artefact execution linkage.
- New route: `server/routes/briefApprovals.ts` (DR3 — `POST /api/briefs/:briefId/approvals/:artefactId`); also extend or add `server/routes/rules.ts` for DR1's `POST /api/rules/draft-candidates`.
- Service updates: `server/services/briefConversationService.ts` (DR2 follow-up trigger), `server/services/agentExecutionService.ts` (DR2 wiring point if architect picks the auto-invoke path), `server/services/invokeAutomationStepService.ts` + `server/services/workflowEngineService.ts` (C4a-REVIEWED-DISP, depending on architect's resume-vs-branch pick).
- Client: `client/src/components/BriefApprovalCard.tsx` + `client/src/pages/BriefDetailPage.tsx` (wire `onApprove`/`onReject`); `client/src/components/ApprovalSuggestionPanel.tsx` (DR1 client already posts; verify error-state + dismissal behaviour).
- Schema: none expected; if DR3 introduces an artefact-execution-linkage column, called out in Chunk 2 (not here) — but a status column on `conversation_messages.artefacts` JSONB is permitted in this chunk if it stays inside the existing JSONB shape.

**Test plan:**
- Static gates only — `npm run typecheck`, `npm run lint`, `verify-rls-coverage.sh` if any new tenant-scoped reads.
- Pure-function tests:
  - DR3: `briefApprovalServicePure.test.ts` covering approve dispatch + reject path + artefact linkage update.
  - DR1: `ruleCandidateDrafterPure.test.ts` covering the artefact-id lookup + brief-context resolution shape.
  - DR2: `chatFollowUpClassifierPure.test.ts` covering the trigger predicate (architect-resolved shape).
  - C4a-REVIEWED-DISP: `invokeAutomationResumePure.test.ts` covering the post-approval dispatch path.
- No runtime / API-contract / E2E tests per `docs/spec-context.md` framing.

**Done criteria:**
- Approve/reject buttons end-to-end functional with pure-function tests passing.
- Follow-up message in any chat surface results in a new agent run (or documented "won't enqueue" decision per architect).
- Approved external automations dispatch and surface their result via the existing execution-status pipeline.
- `POST /api/rules/draft-candidates` returns 200 with the documented payload shape; ApprovalSuggestionPanel no longer 404s.

**Rollback notes:**
- New routes can be commented out / unmounted if they misbehave (no schema dependency).
- DR2's follow-up trigger is gated by a code path predicate; rollback is a one-line revert.
- C4a-REVIEWED-DISP fix may modify the step-run state machine; the architect output must include a "rollback shape" sentence so we can revert without leaving zombie step rows.
