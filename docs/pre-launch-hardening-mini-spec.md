# Pre-Launch Hardening — Mini-Spec

**Status:** planning — flesh into per-chunk specs on a dedicated branch
**Source:** audit of `tasks/todo.md` on 2026-04-26 (78 deferred items reviewed)
**Audience:** spec author starting the next planning sprint

## Why now

- Pre-production. No live data, no users, no SLAs.
- A major testing round is imminent.
- Architectural and schema changes are dramatically cheaper without data — every item below is harder to land later.
- Multi-tenant correctness must be true before testing or the test data poisons every assumption built on top of it.

## Contents

- Chunk 1 — RLS Hardening Sweep
- Chunk 2 — Schema Decisions + Renames
- Chunk 3 — Dead-Path Completion
- Chunk 4 — Maintenance Job RLS Contract
- Chunk 5 — Execution-Path Correctness
- Chunk 6 — Gate Hygiene Cleanup
- Sequencing
- Explicitly out of scope (defer post-launch)
- Build-during-testing watchlist
- Spec authoring notes

---

## Chunk 1 — RLS Hardening Sweep

**Goal:** every multi-tenant write/read path goes through RLS-enforced session context. No direct `db` imports in routes, no FORCE-RLS gaps, no phantom session vars.

**Items (from `tasks/todo.md`):**
- `P3-C1` `P3-C2` `P3-C3` `P3-C4` — 4 tables missing FORCE RLS: `memory_review_queue` (also missing CREATE POLICY), `drop_zone_upload_audit`, `onboarding_bundle_configs`, `trust_calibration_state`.
- `P3-C5` — phantom RLS session var across migrations 0205/0206/0207/0208.
- `P3-C6..C9` — 4 routes import `db` directly and bypass RLS middleware: `routes/memoryReviewQueue.ts`, `routes/systemAutomations.ts`, `routes/subaccountAgents.ts`, `routes/clarifications.ts`.
- `P3-C10` — `documentBundleService` queries agents/tasks without orgId at lines 679, 685.
- `P3-C11` — `skillStudioService` queries skills without orgId at lines 168, 309.
- `P3-H2` — `briefVisibility.ts` direct `db` import.
- `P3-H3` — `onboardingStateHelpers.ts` direct `db` import.
- `SC-1` (SC-2026-04-26-1) — 60-table delta between RLS-protected-tables registry and migrations.
- `GATES-2026-04-26-1` — `reference_documents` / `_versions` FORCE RLS via parent-EXISTS WITH CHECK.

**Key decisions:**
- For `SC-1`: which of the 60 tables are tenant-scoped vs system tables? Per-table classification is the spec author's first pass.
- Should the RLS gate become hard-blocking (vs warn) once the registry is reconciled?

**Files affected:** ~20 migrations, ~10 route files, ~5 service files, the RLS gate config.

**Effort:** medium. Mostly mechanical once the SC-1 triage is done.

**Done criteria:**
- Zero `import { db } from` in `server/routes/`.
- Every tenant table has FORCE RLS + valid policies; gate enforces hard.
- SC-1 registry == migrations == code expectations (3-set drift = 0).

---

## Chunk 2 — Schema Decisions + Renames

**Goal:** lock in column shapes and table names that block riley Part 3 migration and 59 call sites today. All decisions; minimal new code.

**Items:**
- `F6` — `safety_mode` vs existing `run_mode` collision. Pick one column or define their relationship.
- `F10` — portal run-mode field is unnamed; migration 0205 cannot land without a name.
- `F11` — `side_effects` storage decision (column shape + read path).
- `F15` — validator + format decision for `processes.input_schema`.
- `F21` `F22` — "Check now" trigger removal/keep + definition of "meaningful" output.
- `WB-1` — `agent_runs.handoff_source_run_id` write-path + `parentRunId` reuse decision.
- `DELEG-CANONICAL` — canonical source of truth between `agent_runs` telemetry and `delegation_outcomes` event stream.
- `W1-6` — rename `automations` table columns; 59 call sites use legacy names.
- `W1-29` — rename `*.playbook.ts → *.workflow.ts`.
- `BUNDLE-DISMISS-RLS` — `bundle_suggestion_dismissals` unique-key vs RLS mismatch (one migration).
- `CACHED-CTX-DOC` — document Option B-lite RLS posture in spec.

**Key decisions (the meat of the spec):**
- F6 / F10 / F11: 3 architect calls; resolves migration 0205 blockers.
- WB-1: do we reuse `parentRunId` or split into a dedicated handoff edge?
- DELEG-CANONICAL: pick one truth or document the contract that keeps them aligned.

**Files affected:** schema files, 59 call sites for W1-6, all `*.playbook.ts` files for W1-29, riley spec doc.

**Effort:** medium-large (decisions are small; rename mechanics are wide).

**Done criteria:**
- All ambiguous columns have names + types.
- Migration 0205 unblocked.
- Drizzle schema, SQL migrations, and code all use the new names.
- W1-6 grep-clean.

---

## Chunk 3 — Dead-Path Completion

**Goal:** every write-path the product surfaces actually executes. Today the product is silently demo-only on its highest-impact paths.

**Items:**
- `DR3` — `BriefApprovalCard` approve/reject buttons are silent no-ops. Add server route + handlers + execution linkage.
- `DR2` — Conversation follow-ups don't re-invoke fast-path/Orchestrator. Architectural decision needed: how does a follow-up become an agent run?
- `DR1` — `POST /api/rules/draft-candidates` route missing.
- `C4a-REVIEWED-DISP` — review-gated `invoke_automation` never dispatches after approval. Either post-approval resume path or step-type-aware approval.

**Key decisions:**
- DR2: what's the trigger semantics for conversational follow-ups? Auto-invoke every message, threshold-based, explicit user action?
- C4a-REVIEWED-DISP: resume the original step or branch a new one?

**Files affected:** `briefApprovalService` (new), `briefConversationService`, `agentExecutionService`, `invokeAutomationStepService`, related route files.

**Effort:** medium-large.

**Done criteria:**
- Approve/reject buttons end-to-end functional with tests.
- Follow-up message in any chat surface results in a new agent run (or documented decision why not).
- Approved external automations dispatch and surface their result.
- `POST /api/rules/draft-candidates` returns 200 with valid payload.

---

## Chunk 4 — Maintenance Job RLS Contract

**Goal:** background decay/pruning jobs that silently no-op today actually run, so test memory state isn't garbage.

**Items:**
- `B10-MAINT-RLS` — `ruleAutoDeprecateJob.ts`, `fastPathDecisionsPruneJob.ts`, `fastPathRecalibrateJob.ts` need to mirror the admin/org tx contract from `memoryDedupJob.ts`.

**Key decisions:** none — contract already exists in `memoryDedupJob`.

**Files affected:** the three job files + their tests.

**Effort:** small.

**Done criteria:** all three jobs execute their intended writes under the same RLS contract as `memoryDedupJob`; test added per job that verifies a real row is decayed/pruned/recalibrated.

---

## Chunk 5 — Execution-Path Correctness

**Goal:** dispatcher and execution loops resist the race conditions and contract gaps that surface only under sustained testing.

**Items:**
- `C4b-INVAL-RACE` — re-check invalidation after I/O in `workflowEngineService.ts` tick switch.
- `W1-43` — dispatcher §5.10a rule 4 defence-in-depth in `invokeAutomationStepService.ts:165-166`.
- `W1-44` — pre-dispatch `required_connections` resolution; fail at dispatch, not provider edge.
- `W1-38` — add `automation_execution_error` to §5.7 error vocabulary (spec + code align).
- `HERMES-S1` — thread `errorMessage` from `preFinalizeMetadata` into `agentExecutionService.ts:1350-1368` so failed runs without thrown exceptions still extract memory.
- `H3-PARTIAL-COUPLING` — decouple `runResultStatus='partial'` from summary presence; summary failure must not demote a successful run.
- `C4a-6-RETSHAPE` — skill handler error envelope: spec mandates `{code, message, context}`; ~40 skills return flat string. Architect call: grandfather the string pattern or migrate all.

**Key decisions:**
- C4a-6-RETSHAPE: grandfather or migrate. Either way, spec must reflect reality.
- C4b: scope of the invalidation re-check wrapper (one helper or per-call-site).

**Files affected:** `workflowEngineService.ts`, `invokeAutomationStepService.ts`, `agentExecutionService.ts`, ~40 skill handlers (only if migrating).

**Effort:** medium.

**Done criteria:**
- Race-condition test for C4b passes (concurrent invalidate + dispatch result).
- W1-43/44 enforced at dispatcher boundary with tests.
- HERMES-S1 verified by failed-run-without-throw test extracting memory.
- Skill error envelope contract is one of two documented options and 100% adherent.

---

## Chunk 6 — Gate Hygiene Cleanup

**Goal:** keep CI honest during the testing round. Every item small, all bundled.

**Items:**
- `P3-H4` — create `actionCallAllowlist.ts`.
- `P3-H5` — `measureInterventionOutcomeJob` queries canonicalAccounts inside a service.
- `P3-H6` — `referenceDocumentService.ts` stops importing `anthropicAdapter` directly.
- `P3-H7` / `S-2` — propagate `PrincipalContext` through `canonicalDataService` callers (5 files).
- `P3-M10..M16` — skill visibility drift, missing YAML frontmatter on 5 workflow skills, `verify-integration-reference.mjs` yaml dep, missing canonical dictionary entries, `docs/capabilities.md` editorial rule violation.
- `P3-L1` — explicit package.json deps.
- `S2-SKILL-MD` — `.md` definitions for `ask_clarifying_questions` and `challenge_assumptions`.
- `S3-CONFLICT-TESTS` — strengthen rule-conflict parser tests.
- `S5-PURE-TEST` — `saveSkillVersion` pure unit test.
- `SC-COVERAGE-BASELINE` — capture pre-Phase-2 baseline counts before testing changes them.
- `RLS-CONTRACT-IMPORT` (GATES-2) — gate skips `import type` lines.

**Key decisions:** none. Pure cleanup.

**Files affected:** ~25 small touches across services, scripts, docs, tests.

**Effort:** small. One PR.

**Done criteria:** all gates green; all warning baselines captured.

---

## Sequencing

1. **Chunk 1 first** (RLS) — non-negotiable. Other chunks can land alongside but no testing should run until Chunk 1 is in.
2. **Chunk 2 in parallel** (schema decisions) — needs an architect pass before code work starts. Do the architect call first; code lands after Chunk 1.
3. **Chunk 4** (maintenance jobs) — tiny; can ride alongside any other chunk.
4. **Chunk 6** (gate hygiene) — tiny; ride alongside.
5. **Chunk 5** (execution correctness) — after Chunk 2 lands, since it touches some of the same files.
6. **Chunk 3** (dead paths) — last; needs Chunks 1, 2, 5 to be stable so the new write paths land on a clean foundation.

## Explicitly out of scope (defer post-launch)

- `CHATGPT-PR203-R2` (per-row tx+lock throughput) and `CHATGPT-PR203-BONUS` (cross-job `JobResult` union) — own specs, own PRs.
- `AGENT-RUNS-SPLIT` — reviewer said don't preempt; revisit on trigger.
- `LAEL-RELATED-EXT` — needs spec first.
- All `RILEY-*` / `HD-*` feature extensions.
- All UX polish (`BLUEPRINT-MODAL`, ClientPulse N1–N8, RILEY-CRM/AGENTS cards, Workflows/Automations Mock 08/09 simplification).
- Long-term observability (`LAEL-P2`, `LAEL-P3`, `METRICS-PANEL/BADGES`, `TELEMETRY-SINK`, `INC-SLA`, `HD-VIOL-SAMPLING`).

## Build-during-testing watchlist (not part of this spec, but spec authors should know)

These earn their value when traffic exists. Plan them, but they ride with the testing round itself, not the pre-testing hardening:

- `LAEL-P1-1` `LAEL-P1-2` — emission for `llm.requested/completed`, `memory.retrieved`, `rule.evaluated`, `skill.invoked/completed`, `handoff.decided`.
- `TEST-HARNESS` — capability-contract execution harness (riley §5.4a/§5.10a).
- `HYBRID-IDSCOPED` — ID-scoped live fetch in `hybridExecutor.applyLiveFilter`.
- `INC-IDEMPOT` `INC-THROTTLE` — incident ingestion guards.
- `P3-M1` — DB/Redis-backed rate limiter.
- `S8-WS-COMMIT` — defer websocket emit to tx commit.
- `CGF6-IDEMPOTENCY` — `saveRule` idempotency key.
- `N7-PAGINATE` — paginate `/api/briefs/:briefId/artefacts`.
- `C3-CANONICAL-META` `C3-DRIFT-TEST` — canonical-table metadata drift test.

## Spec authoring notes

- Each chunk above is one spec document. Naming convention: `docs/pre-launch-<chunk-name>-spec.md`.
- Architect agent should be invoked for Chunks 2 and 3 first (architectural decisions baked in).
- Chunks 1, 4, 5, 6 can be planned inline by the lead session — they have no architectural ambiguity left.
- Reference back to source IDs in `tasks/todo.md` from every spec section so reviewers can trace requirement provenance.
- Each spec must define: scope, items closed, items explicitly NOT closed, key decisions and their resolutions, files touched, test plan, done criteria, rollback notes (where applicable).
- Update `tasks/todo.md`: mark each item with the spec slug that owns it as soon as the spec is drafted, so duplicates can't sneak in.
