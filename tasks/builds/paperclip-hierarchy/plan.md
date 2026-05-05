# Paperclip Hierarchy — Implementation Plan

**Source spec:** `docs/hierarchical-delegation-dev-spec.md`
**Branch:** `claude/paperclip-agent-hierarchy-9VJyt`
**Classification:** Major — cross-cutting, architectural change, four-phase rollout.
**Testing posture:** `static_gates_primary` + `runtime_tests: pure_function_only` (per `docs/spec-context.md`).
**Rollout model:** `commit_and_revert`. No feature flags.
**Plan authored:** 2026-04-23.

## Out of scope (hard — do not include in any chunk)

- Spec §3.2 out-of-scope list (seeded-company multi-tier reorg, mesh / dynamic-team patterns, role enum, per-subaccount-agent `delegation_authority` override, RLS-layer delegation enforcement, cost rollups, broader upward-reassign beyond §6.4 step-2 special case, heartbeat-scheduling changes for managers, capability-aware routing redesign).
- NCA routing for cross-subtree reassignment (`tasks/todo.md` line 314).
- Violation sampling / alerting tier above §17.3 rejection-rate metric (`tasks/todo.md` line 315).
- Full `ORCHESTRATOR_AGENT_SLUG` deletion (retained for org-scope fallback per §6.6 case 2 + §13).
- Deactivation audit columns (`deactivatedAt` / `deactivatedReason` / `deactivatedByUserId`) — spec §6.8 verdict is use `isActive` only.

If a builder encounters a real architectural gap, route it to `tasks/todo.md § PR Review deferred items / ### paperclip-hierarchy` — do not edit the spec.

---

## Table of contents

1. System Invariants
2. Architecture notes
3. Phase overview
4. Phase 1 — Observability foundations (Chunks 1a / 1b / 1c)
5. Phase 2 — Root contract + scope-aware routing + template picker (Chunks 2.0 / 2a / 2b / 2c)
6. Phase 3 — Hierarchy context + visibility layer (Chunks 3a / 3b)
7. Phase 4 — Execution enforcement + derived skill resolution + trace graph (Chunks 4a / 4b / 4c / 4d)
8. File inventory cross-reference (spec §14.1–§14.4)
9. Phase dependency check (forward-only)
10. Risks
11. Architecture docs update (Phase 4 exit)

---

## 1. System Invariants

Four named invariants. Every chunk that touches the hierarchy graph, a delegation skill, a telemetry write, or run-trace reconstruction MUST reference the relevant invariant(s) by name in its acceptance criteria. These are paraphrased from the spec — not mere links — so a builder implementing a single chunk has the full invariant in view without re-reading the spec.

### INV-1 — runId continuity (spec §10.6)

Every delegation-spawned `agent_runs` row has a parent pointer equal to the `SkillExecutionContext.runId` of the dispatching skill call.

- **Spawn chain.** Sub-agent runs (`isSubAgent = true`) have `parentRunId = context.runId` of the `spawn_sub_agents` call. Set once at run creation; never null for a spawn row; never rewritten.
- **Handoff chain.** Handoff runs (created by `reassign_task` dispatch) have `handoffSourceRunId = context.runId` of the `reassign_task` call. Set once at run creation; never null for a handoff row; never rewritten.
- **Both pointers when both caused it.** A run that was spawned AND later reassigned has both pointers set, each immutable.
- **Telemetry alignment.** The corresponding `delegation_outcomes` row carries `runId = SkillExecutionContext.runId` — the SAME value as the parent pointer on the child run and the `context.runId` field on any `agent_execution_events` error row emitted by the same call. One correlated id threads the child run, the outcome row, and the error log.
- **Never regenerate; never read from elsewhere.** Every write site sources `runId` from `SkillExecutionContext.runId` directly. No reconciliation job, no back-fill path, no alternative source.
- **Enforced at call-site, not via reconciliation.** Type system + pure-core unit tests must cover the call-site.

Consumers that depend on INV-1: the DAG traversal in `delegationGraphService` (Chunk 4d), the metric queries in spec §17, the lossless-log backstop in `agent_execution_events`.

### INV-2 — Uniform error contract (spec §4.3)

Structured errors `delegation_out_of_scope`, `cross_subtree_not_permitted`, and `hierarchy_context_missing` returned by the delegation skills carry a stable `{ code, message, context }` shape.

- **`code`** is one of the three string literals. Enum is closed for v1 — adding a new code requires a spec update.
- **`message`** is human-readable, intended for the agent's prompt. May include runtime identifiers; MUST NOT include spec-version numbers or other values that drift between revisions.
- **`context`** is an object with a mandatory minimum:
  - **Required for every code:** `runId` (from `SkillExecutionContext.runId`) and `callerAgentId` (from `SkillExecutionContext.agentId`).
  - **Per-code required identifiers when resolvable:** `targetAgentId` + `delegationScope` + `callerChildIds` for `delegation_out_of_scope`; `callerParentId` + `suggestedScope` for `cross_subtree_not_permitted`; `skillSlug` for `hierarchy_context_missing`.
  - **Additive-only evolution.** Extra diagnostic fields MAY be added without a spec update; never rename or remove a field that has shipped.
  - **Size bound.** Serialised `context` ≤ 4 KiB.
  - **Array truncation.** Any array-valued diagnostic field (e.g. `callerChildIds`) truncates to the first 50 elements with a sibling `truncated: true` flag when the full list would breach the cap.
- Every error emitted by these skills is ALSO written to `agent_execution_events` with the same `{ code, context }` payload — lossless backstop for when `delegation_outcomes` writes are dropped (INV-3).

Consumers that depend on INV-2: the agent's prompt (re-plans on next turn), the Live Execution Log viewer, rejection-rate metrics (spec §17.3).

### INV-3 — Best-effort dual-writes (spec §10.3, §15.6, §15.8)

Telemetry writes for delegation decisions — one row to `delegation_outcomes`, one event to `agent_execution_events` — use distinct detached try/catch entry points and NEVER propagate failure to the skill caller.

- **`insertOutcomeSafe`** — single entry point on `delegationOutcomeService` for skill handlers. Single INSERT, no transaction. Runs AFTER the parent skill's core mutation has committed. On failure: logs WARN under tag `delegation_outcome_write_failed` and swallows. Does not re-throw.
- **`insertExecutionEventSafe`** — single entry point on the existing `agentExecutionEventService` for the delegation-error dual-write. Same detached-try/catch mechanism. On failure: logs WARN under tag `delegation_event_write_failed` and swallows. **Distinct tag from the outcome-write failure tag** so dashboards can distinguish shared-infra outage from single-path bugs.
- **Never inside the skill's critical-path transaction.** Both writes are explicitly sequenced AFTER the core mutation commits.
- **Strict variant exists for tests / backfills only.** `recordOutcomeStrict` throws on failure. Skill handlers MUST NEVER call the strict variant.
- **Degenerate-case contract.** If both writes drop, the error is STILL returned to the caller (agent prompt) with the full `{ code, message, context }`. Telemetry surfaces are telemetry, not enforcement.

Consumers that depend on INV-3: Chunks 1b, 4b, 4c (every telemetry write site); dashboards reading the failure tags; the lossless-log contract in INV-2.

### INV-4 — Immutable hierarchy snapshot (spec §4.1, §15.3)

`SkillExecutionContext.hierarchy` is a per-run read-only snapshot, built once at run start by `hierarchyContextBuilderService.buildForRun()`.

- **Type is `Readonly<HierarchyContext>`.** TypeScript-level immutability.
- **Runtime frozen.** The impure wrapper returns `Object.freeze(pureResult)`; mutation attempts throw in strict mode.
- **Skill handlers MUST NOT:** mutate any field, re-query the roster mid-run, reinterpret the snapshot, or store a parallel copy.
- **Graph changes apply at next run.** If roster changes mid-run, the run completes with stale context; the next run of the agent reads fresh state.
- **Fail fast on stale-context errors.** A delegation targeted at a since-deleted child fails via the existing target-not-found error class. Bounded by existing run-cost breakers + timeouts.
- **Never lazy-initialised.** Built exactly once per run in `agentExecutionService` BEFORE the skill resolver runs. The resolver consumes the already-built snapshot; it does not re-invoke the builder.
- **Write skills fail closed on missing `context.hierarchy`.** `spawn_sub_agents` and `reassign_task` emit `hierarchy_context_missing` (INV-2). Read skills (three list skills) fall through to `subaccount`-wide results with a WARN log.

Consumers that depend on INV-4: Chunks 3a (builder), 3b (list skills), 4b (write skills), 4c (resolver union).

---

## 2. Architecture notes

### 2.1 Key decisions (problem → pattern → rejected alternative)

**Pure + impure service split for every new service.** Spec §12 pins `runtime_tests: pure_function_only`, so pure cores get unit-tested; impure wrappers handle DB/IO and are not tested directly. Applies to all four new services: `hierarchyContextBuilderService`, `hierarchyRouteResolverService`, `delegationOutcomeService`, `delegationGraphService`.
- *Problem:* keeps correctness logic testable without DB fixtures; mirrors the rest of the repo (see spec-context `accepted_primitives`).
- *Pattern:* composition — pure function composed under an impure wrapper.
- *Rejected:* single-file service with IO mocked via interface injection — drifts from repo convention and bloats tests.

**Telemetry writes outside the critical-path transaction.** Both `insertOutcomeSafe` (new, on `delegationOutcomeService`) and `insertExecutionEventSafe` (new, added to the existing `agentExecutionEventService`) run as detached try/catch AFTER the parent skill's mutation commits. Distinct WARN tags (`delegation_outcome_write_failed` vs `delegation_event_write_failed`) so dashboards distinguish failure modes.
- *Problem:* a telemetry DB hiccup must not fail user-facing delegation work (INV-3).
- *Pattern:* adapter — the "safe" entry point adapts a strict insert to a fire-and-forget contract.
- *Rejected:* pg-boss job for outcome writes (over-engineered for row volume per spec §10.3); generic post-commit hook abstraction (plain detached call is enough).

**pg-boss job payload carries scope, not a new `tasks` column.** `briefCreationService.enqueueOrchestratorRoutingIfEligible(task, { scope })` widens the enqueue signature; `orchestratorFromTaskJob` reads `job.data.scope ?? 'subaccount'`. No `tasks.triggerContext` column (spec §6.7 rationale).
- *Problem:* scope is transient dispatch metadata, not durable task state. Schema migration would add row cost for no read-path benefit.
- *Pattern:* message-carried context — the queue payload is the natural carrier.
- *Rejected:* new `tasks.triggerContext` column (spec explicitly rejects it).

**Resolver replaces hardcoded slug ONLY for `scope === 'subaccount'`.** `ORCHESTRATOR_AGENT_SLUG` constant stays in `orchestratorFromTaskJob.ts` for the org-scope fallback path (§6.6 case 2). Full slug removal waits for a second org-level root candidate (deferred per §13).
- *Problem:* one clean slice; no half-implemented org-scope resolver.
- *Rejected:* delete the slug in Phase 2 (would force org-scope resolver work that's explicitly deferred).

**Graph-not-tree for `/api/agent-runs/:id/delegation-graph`.** A run can have both `parentRunId` (spawn parent) and `handoffSourceRunId` (handoff parent). Returning a tree would force picking one parent as canonical and discarding information; returning `{ nodes, edges }` is lossless (spec §7.2).
- *Problem:* trace explainability for the post-Phase-4 adjustment period.
- *Pattern:* discriminated-edge response (`DelegationEdgeKind = 'spawn' | 'handoff'`).
- *Rejected:* tree with handoff-as-annotation — loses information at the response layer.

**Narrow special case for upward reassign (§6.4 step 2, option b).** Any agent may `reassign_task` to `context.hierarchy.parentId`; marked `delegationDirection: 'up'`. Special-case check runs BEFORE generic scope validation.
- *Problem:* brief commits to "upward escalation allowed, logged" without introducing a role system.
- *Rejected:* `delegationScope: 'parent'` (vocabulary for a single-target case); separate `escalate_upward` skill (platform surface bloat); drop it (contradicts brief).

### 2.2 Patterns NOT applied

Spec §3.4 names primitives that could have been invented and weren't. This plan adds exactly:

- Four new services (all pure+impure pairs).
- One new table (`delegation_outcomes`).
- Two new routes (both list/read endpoints).
- One new permission key (`org.observability.view`).
- Three new health detectors (two Phase 1, one Phase 4).
- One new client component (`StartingTeamPicker`), one new view (`DelegationGraphView`), one optional admin page (`AdminDelegationOutcomesPage`).

No new retry/backoff primitive, no new RLS layer, no new queue, no new skill system, no role enum. `DelegationScope` is defined once in `shared/types/delegation.ts` and reused everywhere.

---

## 3. Phase overview

Four phases per spec §11, plus a Phase 2 pre-flight (Chunk 2.0) that is non-code — it resolves the seed-manifest dual-root before migration 0214 can apply.

| Phase | Chunks | Ships | User-visible? |
|---|---|---|---|
| 1 — Observability foundations | 1a, 1b, 1c | Migrations 0216 + 0217; `delegationOutcomeService`; list route; two detectors; optional admin page | No (no behaviour change) |
| 2 — Root contract + routing + picker | 2.0, 2a, 2b, 2c | Manifest re-seed → migration 0214; resolver service; job + brief + template rotation; picker UI | Yes (per-subaccount CEO routing) |
| 3 — Hierarchy context + visibility | 3a, 3b | Builder service; `SkillExecutionContext.hierarchy`; scope param on three list skills | Partial (adaptive defaults on list skills) |
| 4 — Execution enforcement + derived skills + trace graph | 4a, 4b, 4c, 4d | Migration 0215; `spawn_sub_agents` / `reassign_task` validation; derived delegation skills; third detector; graph route + trace tab | Yes (enforcement + trace UI) |

Forward-only dependency: Phase N never references primitives first introduced in Phase N+k. Three intentional early-introductions are called out in §9 Phase dependency check.

---

## 4. Phase 1 — Observability foundations

**Goal (from spec §11 Phase 1).** Ship the telemetry storage layer and two root-invariant health detectors. No behaviour change — `delegation_outcomes` is empty, `agent_runs` new columns are null on new rows, no delegation path writes to either yet. The admin list endpoint and optional dashboard exist so Phase 4 can light them up without further route work.

**Entry state.** Main branch at spec-merge; migrations up to `0201_universal_brief_permissions.sql`. No `shared/types/delegation.ts` yet. No `delegation_outcomes` table. No `hierarchy` field on `SkillExecutionContext`.

**Exit state.** Two migrations applied (0216, 0217). One new shared types file. One new thin service (`delegationOutcomeService` + pure). One new admin-only route (`GET /api/org/delegation-outcomes`) behind a new permission (`org.observability.view`). Two detectors registered. Optional admin page. `verify-rls-coverage.sh` and typecheck + lint green.

### Chunk 1a — Shared types + schema migrations + `delegationOutcomeService`

**What this chunk ships.** Migrations 0216 and 0217. Drizzle reflections. The single new shared-types file. The thin pure+impure service that future Phase 4 writers and the Phase 1 route both consume.

**Files — New:**
- `shared/types/delegation.ts` — defines `DelegationScope`, `DELEGATION_SCOPE_VALUES`, `DelegationScopeSchema` (Zod), `HierarchyContext`, `DelegationOutcome` interface, error-code string constants (`DELEGATION_OUT_OF_SCOPE`, `CROSS_SUBTREE_NOT_PERMITTED`, `HIERARCHY_CONTEXT_MISSING`), and `DelegationDirectionSchema`. Per spec §4 — TypeScript-first; Drizzle schemas import from here.
- `migrations/0216_agent_runs_delegation_telemetry.sql` — exact DDL per spec §5.3 (add four nullable columns to `agent_runs`; two CHECK constraints; two partial indexes on `hierarchy_depth` and `handoff_source_run_id`).
- `migrations/0217_delegation_outcomes.sql` — exact DDL per spec §5.4 (CREATE TABLE with six FKs and four CHECK constraints; three indexes; ENABLE RLS; CREATE POLICY `delegation_outcomes_org_isolation` with USING + WITH CHECK).
- `server/db/schema/delegationOutcomes.ts` — Drizzle table matching the migration; export type inference.
- `server/services/delegationOutcomeService.ts` — impure wrapper exporting `insertOutcomeSafe(input)` (detached try/catch; swallows on failure; logs WARN tag `delegation_outcome_write_failed` per spec §10.3 and INV-3), `recordOutcomeStrict(input)` (test/backfill-only; throws on failure — JSDoc warns skill handlers never call it), and `list(orgId, filters)` (read path used by §7.1 route — honours `callerAgentId`, `targetAgentId`, `outcome`, `delegationDirection`, `since` (default now - 7d), `limit` (default 100, cap 500); ORDER BY `created_at DESC`). Uses `orgScopedDb`; never raw `db`.
- `server/services/delegationOutcomeServicePure.ts` — `assertDelegationOutcomeShape(input)` pure validator replicating the four DB CHECK constraints (scope enum, outcome enum, reason-iff-rejected, direction enum) so callers surface a Zod/assertion error instead of a Postgres error; `buildListQueryFilters(rawQuery)` that coerces + clamps `limit` and `since`.
- `server/services/__tests__/delegationOutcomeServicePure.test.ts` — per spec §12.2. Covers: accepted-without-reason, rejected-with-reason, rejected-without-reason throws, accepted-with-reason throws, invalid scope throws, invalid direction throws, `buildListQueryFilters` clamps `limit` to 500 and defaults `since` to seven days ago.

**Files — Modified:**
- `server/db/schema/agentRuns.ts` — add `delegationScope: text('delegation_scope')`, `hierarchyDepth: smallint('hierarchy_depth')`, `delegationDirection: text('delegation_direction')`, `handoffSourceRunId: uuid('handoff_source_run_id').references(() => agentRuns.id)`.
- `server/db/schema/index.ts` — export `delegationOutcomes`.
- `server/config/rlsProtectedTables.ts` — add `delegation_outcomes` to the manifest. Same commit as migration 0217 so `verify-rls-coverage.sh` stays green.

**Implementation notes.**
- `insertOutcomeSafe` runs the service-layer integrity check from spec §4.4 — read both actor `subaccount_agents` rows via the same `orgScopedDb` call, assert `subaccount_id` on each equals the outcome's `subaccountId`, refuse + WARN on mismatch. Mismatch is a construction-bug safety net, not a data-corruption probe; cheap to leave in.
- Error tag `delegation_outcome_write_failed` is a STRING LITERAL, co-located with the WARN call. Dashboards filter on the literal; do not parameterise it. Spec §15.6 / INV-3 depend on the exact tag.
- The `list()` service method is used by the Phase 1 route (§1b) and future dashboards. It returns `DelegationOutcome[]` typed per `shared/types/delegation.ts`.
- Migration 0216 is intentionally separate from 0217 — one alters an existing table (`agent_runs`), the other creates a new table + RLS policy. Keeping them separate makes `rlsProtectedTables` manifest drift obvious and keeps blast radius small.

**Invariants touched.**
- **INV-2.** The error-code string constants are defined here so every downstream write site (Phase 4) imports the same literal. Renames require a spec update.
- **INV-3.** `insertOutcomeSafe` is the SINGLE entry point from skill handlers; `recordOutcomeStrict` is JSDoc-tagged for tests/backfills only.

**Static gates (run before marking chunk done).**
- `npm run typecheck` — new types flow through `agentRuns.ts` and `delegationOutcomes.ts` without errors.
- `npm run lint`.
- `npm run db:generate` — verify generated migration SQL matches the hand-written 0216 / 0217 files (Drizzle reflects; if drift, adjust the schema file, not the SQL).
- `verify-rls-coverage.sh` — green (manifest + migration in same commit).
- `npm test -- delegationOutcomeServicePure` — pure unit test passes.

**Acceptance criteria.**
- Migrations apply cleanly on a fresh DB.
- `delegation_outcomes` table exists, is empty, and rejects inserts missing `organisation_id` (FK).
- `agent_runs` has four new nullable columns; existing rows have null; new rows inserted by `agentExecutionService` continue to pass today with null in all four (no write-path yet).
- `orgScopedDb.insert(delegationOutcomes).values(validRow)` succeeds; `db.insert(delegationOutcomes)` (non-org-scoped) is rejected by RLS.
- `insertOutcomeSafe` with a malformed row logs WARN `delegation_outcome_write_failed` and returns without throwing (contract check — exercised in the pure test by injecting a failing inner call).

### Chunk 1b — Permission + admin list route (+ optional page)

**What this chunk ships.** One new permission key. One new admin-gated route returning rows from `delegation_outcomes`. Optional thin client page behind the permission.

**Files — New:**
- `server/routes/delegationOutcomes.ts` — Express router exporting `GET /api/org/delegation-outcomes`. Middleware: `authenticate`, `requireOrgPermission('org.observability.view')`, `asyncHandler(async (req, res) => { res.json(await delegationOutcomeService.list(req.orgId!, req.query)); })`. Filters list per spec §7.1: `callerAgentId`, `targetAgentId`, `outcome`, `delegationDirection`, `since`, `limit`. Input coercion + clamping delegates to `delegationOutcomeServicePure.buildListQueryFilters`.
- **Optional v1 (ship if time permits, else §13 defers):** `client/src/pages/AdminDelegationOutcomesPage.tsx` — simple table with filters over `GET /api/org/delegation-outcomes`; columns per spec §8.3 (timestamp, run, caller, target, scope, outcome, direction, reason).

**Files — Modified:**
- `server/lib/permissions.ts` — add `ORG_OBSERVABILITY_VIEW = 'org.observability.view'` to `ALL_PERMISSIONS`; add the key to the `org_admin` entry in `DEFAULT_PERMISSION_SET_TEMPLATES`. (`permissionSeedService.ts` loops over `DEFAULT_PERMISSION_SET_TEMPLATES` — no explicit change needed there.)
- `server/index.ts` — `app.use(delegationOutcomesRouter)` alongside the existing admin routes.
- **If the optional page ships:** `client/src/App.tsx` — register `/admin/delegation-outcomes`; `client/src/components/Layout.tsx` — add sidebar entry gated by `org.observability.view`.

**Implementation notes.**
- The route handler is intentionally thin — logic lives in `delegationOutcomeService.list`. No business logic in the route file.
- Query-parameter parsing uses the pure helper from Chunk 1a; the route itself just passes `req.query` through.
- `requireOrgPermission` is an existing helper in `server/middleware/`; no new middleware.
- The optional admin page is a second-class deliverable — ship it only if the chunk has slack, otherwise move to §13 Phase 5. Do not block the chunk on UI polish.

**Invariants touched.** None directly — this is a read path. INV-2 / INV-3 are relevant only once Phase 4 write paths start populating the table.

**Static gates.**
- `npm run typecheck` — new permission key is recognised by the `requireOrgPermission` type.
- `npm run lint`.
- `npm test -- permissions` — existing permission tests still pass after adding the new key (defensive; there is no pure test for the route itself per framing).
- Manual: `curl` the endpoint with and without the permission; confirm 403 without, 200 with, and org isolation holds (two orgs, each sees only its own rows — seeded with fixture data or SQL `INSERT` during a manual smoke).

**Acceptance criteria.**
- `GET /api/org/delegation-outcomes` returns `[]` on a fresh DB; returns seeded rows when any are inserted directly via SQL.
- Permission gate blocks a user without `org.observability.view`.
- RLS prevents a user from org A from seeing org B's rows even if `orgId` is spoofed (regression guard; exercised by the middleware, not the route).
- If the optional page ships: sidebar entry appears only for users with the permission; table renders and filters work.

### Chunk 1c — Workspace Health detectors (two of three)

**What this chunk ships.** Two Phase-1 detectors registered in the existing Workspace Health framework. The third detector (`explicitDelegationSkillsWithoutChildren`) ships in Phase 4 per spec §6.9 — do NOT register it here.

**Files — New:**
- `server/services/workspaceHealth/detectors/subaccountMultipleRoots.ts` — exports `{ name: 'subaccountMultipleRoots', severity: 'critical', detect(orgId, db) }`. Query: group by `subaccount_id` over rows where `parent_subaccount_agent_id IS NULL AND is_active = true`; emit a finding per subaccount with `COUNT(*) > 1`. Dedup key `(orgId, 'subaccountMultipleRoots', 'subaccount', subaccountId)`. Message per spec §6.9.
- `server/services/workspaceHealth/detectors/subaccountMultipleRootsPure.ts` — pure helper `findSubaccountsWithMultipleRoots(rows)` so the detector's DB call is separable from the counting logic.
- `server/services/workspaceHealth/detectors/subaccountNoRoot.ts` — exports `{ name: 'subaccountNoRoot', severity: 'info', detect(orgId, db) }`. Query: subaccounts in the org where zero active rows satisfy `parent_subaccount_agent_id IS NULL AND is_active = true`. Severity is **`info`** per spec §16.3 — zero-root is a valid operator-opt-in state; the message nudges toward per-subaccount-root configuration but does NOT flag as a failure.
- `server/services/workspaceHealth/detectors/subaccountNoRootPure.ts` — pure helper mirroring the sibling.
- `server/services/workspaceHealth/detectors/__tests__/subaccountMultipleRoots.test.ts` — per spec §12.2. Covers: zero subaccounts, one subaccount with one root, one subaccount with two roots (finding emitted), multiple subaccounts mixed.
- `server/services/workspaceHealth/detectors/__tests__/subaccountNoRoot.test.ts` — per spec §12.2. Covers: subaccount with roots emits no finding; subaccount with no active root emits one; inactive roots don't count as roots.

**Files — Modified:**
- `server/services/workspaceHealth/detectors/index.ts` — register the two new detectors alongside the existing six. `explicitDelegationSkillsWithoutChildren` is NOT added here (Phase 4).

**Implementation notes.**
- Use `db` passed in to `detect()` — do not grab a fresh connection. The framework's existing detectors (see `agentNoRecentRuns.ts`, `processBrokenConnectionMapping.ts`) demonstrate the contract.
- Message text is per spec §6.9 verbatim — copy it exactly; dashboards match on prefix.
- `subaccountNoRoot` severity is `info`, NOT `warning`. Spec §16.3 + §6.9 commit to this — operator-opt-in, not drift.

**Invariants touched.** None directly. Detectors surface invariant violations for manual operator review; they do not enforce.

**Static gates.**
- `npm run typecheck`.
- `npm run lint`.
- `npm test -- workspaceHealth` — pure detector tests + any existing detector tests pass.

**Acceptance criteria.**
- Both detectors register in the index; `AdminHealthFindingsPage` groups them under their respective severities on the next audit sweep.
- On the current repo seed (two `reportsTo: null` agents pre-Phase-2 cleanup), `subaccountMultipleRoots` fires for any subaccount that hosts both.
- On a fresh subaccount with no root, `subaccountNoRoot` emits ONE informational finding (not critical).
- Detectors are idempotent: re-running an audit over the same state produces the same finding set (dedup key stable).

**Phase 1 exit criteria (cross-chunk roll-up).**
- Migrations 0216 + 0217 applied; `rlsProtectedTables` manifest covers `delegation_outcomes`; `verify-rls-coverage.sh` green.
- `shared/types/delegation.ts` exports the full contract surface (scope enum, outcome interface, error-code constants, `HierarchyContext`).
- `delegationOutcomeService` is importable and callable (writes still no-op from skill handlers — the call sites wire in Phase 4).
- `GET /api/org/delegation-outcomes` is mountable and returns `[]`.
- `subaccountMultipleRoots` + `subaccountNoRoot` are registered; `explicitDelegationSkillsWithoutChildren` is NOT.
- No behaviour change for end users. No Brief routing change. No delegation-skill validation change.

---

## 5. Phase 2 — Root contract + scope-aware routing + template picker

**Goal (from spec §11 Phase 2).** Per-subaccount CEOs. Briefs filed against a subaccount dispatch to that subaccount's configured root agent; the hardcoded `'orchestrator'` slug is no longer the subaccount-scope entry point. Starting-team picker ships in the subaccount creation form.

**Entry state.** Phase 1 complete. Seed manifest at `companies/automation-os/automation-os-manifest.json` still has two `reportsTo: null` agents (Orchestrator + portfolio-health-agent) — migration 0214 would fail.

**Exit state.** Seed manifest re-parented (one root only on the Automation OS sentinel subaccount); migration 0214 applied; `hierarchyRouteResolverService` live; `orchestratorFromTaskJob` reads scope from job payload; `briefCreationService` passes scope through; template apply does same-transaction root rotation; subaccount creation form has a "Starting team" dropdown. Partial slug removal is subaccount-scope-only — `ORCHESTRATOR_AGENT_SLUG` constant retained for org-scope fallback per §6.6 case 2.

### Chunk 2.0 — Seed manifest dual-root cleanup (NON-CODE pre-flight)

**What this chunk ships.** A re-parented seed manifest that lands in-tree + a re-seed on the dev DB. No TypeScript, no SQL. Gated BEFORE migration 0214 applies — if this chunk doesn't land first, migration 0214 fails with `23505` on the sentinel subaccount.

**Files — Modified:**
- `companies/automation-os/automation-os-manifest.json` — change `portfolio-health-agent` (currently line ~168 with `reportsTo: null` and `executionScope: 'org'`) to one of:
  - **Option A (recommended):** `"reportsTo": "orchestrator"` — single root on the sentinel subaccount is the Orchestrator. Portfolio-health becomes a direct report. Minimal data churn; keeps both agents in the same seeded company.
  - **Option B:** Move `portfolio-health-agent` to a separate seeded subaccount. More invasive — requires a second-subaccount seed block. Not needed for Phase 2.
  - **Option C:** Mark `portfolio-health-agent` inactive. Rejected — the agent is in active use; deactivating it is a product regression, not a data cleanup.

**Decision rule.** Default to Option A unless the seed-reorg track has a standing reason to keep portfolio-health root-level. The architect plan defaults to Option A.

**Execution steps.**
1. Run `scripts/audit-subaccount-roots.ts` (ships in Chunk 2a — if it isn't built yet, do the equivalent manual SQL: `SELECT subaccount_id, COUNT(*) FROM subaccount_agents WHERE parent_subaccount_agent_id IS NULL AND is_active = true GROUP BY subaccount_id HAVING COUNT(*) > 1;`). Confirm the sentinel subaccount shows the expected dual-root state.
2. Edit the manifest per Option A.
3. Run `npm run seed` (or the equivalent `scripts/seed.ts` entry point). The seed script already resolves `reportsTo` strings into FK IDs; it handles arbitrary-depth trees. Re-seeding replaces the dual-root with one.
4. Re-run the audit. Expected: zero subaccounts with `COUNT(*) > 1`.
5. Commit the manifest change WITHOUT migration 0214 — that's Chunk 2a. Keeping the commits separate means a revert on migration 0214 doesn't revert the manifest cleanup.

**Acceptance criteria.**
- `audit-subaccount-roots.ts` (or its SQL equivalent) reports zero dual-root violations on the dev DB.
- The manifest file has exactly one `reportsTo: null` agent.
- `npm run seed` re-seeds cleanly with no errors; the Orchestrator is the sole root on the sentinel subaccount.
- The commit is manifest-only (no `.sql`, no `.ts`).

**Risk register:**
- If a teammate seeds a different DB instance mid-chunk, the cleanup must repeat on that instance before 2a runs against it. Call out in the PR description.
- No rollback concern — seed is idempotent over the manifest.

### Chunk 2a — Migration 0214 + audit script + same-tx root rotation

**What this chunk ships.** The partial unique index + its pre-migration audit tool + `hierarchyTemplateService` root rotation that preserves the invariant across re-applies.

**Files — New:**
- `migrations/0214_subaccount_agents_root_unique.sql` — per spec §5.1. `CREATE UNIQUE INDEX subaccount_agents_one_root_per_subaccount ON subaccount_agents (subaccount_id) WHERE parent_subaccount_agent_id IS NULL AND is_active = true;`.
- `scripts/audit-subaccount-roots.ts` — standalone Node script. Reads `subaccount_agents` via admin connection (not RLS-scoped — it's an operator tool across orgs); groups by `subaccount_id` over active rows with `parent_subaccount_agent_id IS NULL`; prints a report: `subaccount_id | org_id | count | agent_slugs`. Exits with code 0 if all counts ≤ 1, non-zero otherwise. Pure core in `scripts/auditSubaccountRootsPure.ts` takes the raw rows and produces the report structure.
- `scripts/__tests__/auditSubaccountRootsPure.test.ts` — per spec §12.2. Covers: clean roster (no violations), single-violation roster, multi-org mixed.

**Files — Modified:**
- `server/db/schema/subaccountAgents.ts` — add table-level `uniqueIndex('subaccount_agents_one_root_per_subaccount').on(t.subaccountId).where(sql\`parent_subaccount_agent_id IS NULL AND is_active = true\`)`.
- `server/services/hierarchyTemplateService.ts` — in `apply()` and `importToSubaccount()`, within the existing transaction and BEFORE inserting the new root row(s), deactivate the current active root on the target subaccount:
  ```ts
  await tx.update(subaccountAgents)
    .set({ isActive: false })
    .where(and(
      eq(subaccountAgents.subaccountId, params.subaccountId),
      isNull(subaccountAgents.parentSubaccountAgentId),
      eq(subaccountAgents.isActive, true),
    ));
  ```
  Per spec §6.8: no `deactivatedAt` / `deactivatedReason` columns in v1 (verdict: use `isActive` only; full audit columns deferred §13).

**Execution order (critical).**
1. Run `scripts/audit-subaccount-roots.ts`. Exit code 0 means safe to proceed. If non-zero, halt and resolve (Chunk 2.0 should have handled this, but an independent audit guards against drift between chunks).
2. Apply migration 0214.
3. Re-run the audit. Must still exit 0.
4. Re-run the existing `hierarchyTemplateService` tests. No new tests for the service itself (impure DB call) per framing; existing regression tests catch mistakes.

**Implementation notes.**
- The migration file's only statement is the `CREATE UNIQUE INDEX`. No backfill. The audit is OUTSIDE the migration — do not embed a check in the `.sql` file; operator judgement belongs in script form.
- Same-tx rotation is the quiet fix — without it, a second `apply()` against a subaccount that already has a root would fail `23505`. With it, re-applies rotate seamlessly. The deactivation runs BEFORE the insert because the partial unique index only considers `is_active = true`.
- `hierarchyTemplateService.apply()` and `importToSubaccount()` both wrap their mutations in `withTransaction` today; the deactivation step must be INSIDE that existing transaction. Do not open a nested transaction.

**Invariants touched.**
- **Root invariant (§5.1).** The index enforces at-most-one; the same-tx rotation keeps the invariant under re-apply.

**Static gates.**
- `npm run typecheck`.
- `npm run lint`.
- `npm run db:generate` — verify the Drizzle `uniqueIndex` reflection matches the hand-written 0214 migration.
- `npm test -- auditSubaccountRoots` — pure test passes.
- Manual: run `scripts/audit-subaccount-roots.ts` before and after 0214 — both exit 0.

**Acceptance criteria.**
- Migration 0214 applies cleanly on the post-2.0 dev DB; `psql` confirms the partial unique index exists.
- Attempting to insert a second active root on any subaccount returns `23505`.
- `hierarchyTemplateService.apply()` successfully re-applies a template to a subaccount with an existing root without a uniqueness error.
- The Phase 1 detector `subaccountMultipleRoots` reports zero findings post-migration on the dev DB.

### Chunk 2b — Resolver service + `orchestratorFromTaskJob` + `briefCreationService`

**What this chunk ships.** The new `hierarchyRouteResolverService`. `orchestratorFromTaskJob` reads scope from its pg-boss payload and calls the resolver for `subaccount` scope. `briefCreationService` passes `fastPathDecision.scope` through on enqueue. `ORCHESTRATOR_AGENT_SLUG` survives for the org-scope fallback only.

**Files — New:**
- `server/services/hierarchyRouteResolverService.ts` — impure wrapper exporting `resolveRootForScope({ organisationId, subaccountId, scope }): Promise<ResolveRootResult | null>`. Queries `subaccount_agents` for subaccount-scope; falls back to the existing org-level Orchestrator link resolution for org-scope (same pattern currently in `orchestratorFromTaskJob`); returns `null` for `system` scope.
- `server/services/hierarchyRouteResolverServicePure.ts` — `resolveRootForScopePure({ scope, subaccountRoots, orgLevelOrchestratorLink })` returning `{ subaccountAgentId, agentId, fallback }` or `null`. Pure decision tree per spec §6.6: `scope === 'subaccount'` + `subaccountId === null` → `fallback: 'org_root'`; `scope === 'subaccount'` + exactly one row → `fallback: 'none'`; zero rows → `fallback: 'org_root'` (with flag); multiple rows (impossible post-migration but defensive) → pick oldest by `createdAt`, `fallback: 'none'` flagged; `scope === 'org'` → org-level path; `scope === 'system'` → `null`.
- `server/services/__tests__/hierarchyRouteResolverServicePure.test.ts` — per spec §12.2. Covers all five branches of the decision tree.

**Files — Modified:**
- `server/jobs/orchestratorFromTaskJob.ts` — read `scope` from `job.data.scope ?? 'subaccount'`. Call `hierarchyRouteResolverService.resolveRootForScope({ organisationId: task.organisationId, subaccountId: task.subaccountId, scope })`. On null result (system scope), call `briefConversationWriter.appendSystemErrorArtefact(...)` per spec §6.7 and return. On non-null, dispatch to `result.subaccountAgentId`. Leave the `ORCHESTRATOR_AGENT_SLUG` constant in place — it is used by the resolver's org-scope branch (via whatever existing lookup it calls into; the resolver encapsulates the choice). Remove the inline slug lookup + manual link resolution that currently runs for every dispatch. Log `result.fallback` as structured telemetry so Phase 2 exit-criteria dashboards can measure fallback rate.
- `server/services/briefCreationService.ts` — the existing call at line ~75 becomes `enqueueOrchestratorRoutingIfEligible({ ... }, { scope: fastPathDecision.scope })`. Widen `enqueueOrchestratorRoutingIfEligible`'s signature in `orchestratorFromTaskJob.ts` to `(task, opts?: { scope?: 'subaccount' | 'org' | 'system' })`; the pg-boss payload carries `scope` in `job.data`.
- `server/services/taskService.ts` (line ~197) — non-Brief enqueue path, keep the existing one-arg call. The job default (`'subaccount'`) handles this path per spec §6.7; no scope to pass.

**Implementation notes.**
- The resolver is the canonical root-finder post-Phase-2. `orchestratorFromTaskJob` is the only runtime caller in v1; do NOT open additional callers in this chunk.
- `briefCreationService` does NOT call the resolver directly — it passes scope via pg-boss payload so the resolution happens inside the job handler (where the task is loaded + dispatched anyway). This is the "message-carried context" pattern from §2.1.
- `result.fallback !== 'none'` is logged as a WARN-level structured event with a stable tag — Phase 2's success criterion is a downward trend on fallback rate.
- Keep `ORCHESTRATOR_AGENT_SLUG = 'orchestrator'` in `orchestratorFromTaskJob.ts`. The constant is no longer used for subaccount-scope dispatch, but the org-scope branch of the resolver still resolves the system agent via that slug. Full deletion is deferred §13 until a second org-level root candidate lands.
- No `tasks.trigger_context` column. The pg-boss payload is the carrier. Do NOT add a schema migration in this chunk.

**Invariants touched.**
- **INV-1.** `runId` continuity is unaffected — this chunk changes root resolution, not run creation. Dispatched run still inherits the parent-pointer discipline when Phase 4 wires it.

**Static gates.**
- `npm run typecheck` — the widened `enqueueOrchestratorRoutingIfEligible` signature flows through both call sites.
- `npm run lint`.
- `npm test -- hierarchyRouteResolverServicePure`.
- Manual smoke: file a Brief against a subaccount with a configured root. Confirm via `agent_runs` inspection that the dispatched run belongs to that subaccount's root agent, not the hardcoded `'orchestrator'` system agent.

**Acceptance criteria.**
- A Brief filed against a subaccount with a configured root dispatches to that root (observable in `agent_runs.subaccountAgentId` on the first non-Brief-seed run).
- A Brief filed against a subaccount with NO subaccount-level root falls back to the org-level Orchestrator (observable in logs as `fallback: 'degraded'`, with a paired `subaccountNoRoot` workspace-health finding).
- `scope === 'system'` Briefs surface a conversation-level error artefact ("system-scope Briefs are not yet routable"); no dispatch happens.
- Non-Brief task-created triggers continue to work — they default to `'subaccount'` in the job handler.
- `subaccountMultipleRoots` detector remains at zero findings.

### Chunk 2c — Starting Team picker UI

**What this chunk ships.** A "Starting team" dropdown on the full subaccount creation form at `AdminSubaccountsPage.tsx`. Calls `POST /api/hierarchy-templates/:id/apply` immediately after subaccount creation when a template is selected. Layout quick-create stays unchanged (§13 defers the quick-create picker).

**Files — New:**
- `client/src/components/subaccount/StartingTeamPicker.tsx` — controlled `<select>`/combobox component. Props: `value: string | null`, `onChange(next: string | null)`, `templates: Array<{ id; name; description? }>`, `disabled?`. Fetches templates via react-query hook calling `GET /api/hierarchy-templates` (existing endpoint). Renders "None / configure later" as the default option; shows description on hover/focus.

**Files — Modified:**
- `client/src/pages/AdminSubaccountsPage.tsx` — add the picker between the name field and the submit button in the create form. State holds `selectedTemplateId: string | null`. On submit:
  1. `POST /api/subaccounts` (existing call). Get `createdId`.
  2. If `selectedTemplateId` is non-null, `POST /api/hierarchy-templates/${selectedTemplateId}/apply` with body `{ subaccountId: createdId, mode: 'replace' }`.
  3. On 2xx: toast `"Team installed: ${templateName}"`, navigate to the subaccount's agent list.
  4. On 4xx/5xx for the apply call: the subaccount exists but team install failed. Show an inline warning on the subaccount page with a retry button. Do NOT roll back the subaccount.
  5. If `selectedTemplateId` is null: behave as today.

**Implementation notes.**
- Per spec §8.1 clarification: `SubaccountCreatePage.tsx` does NOT exist in the repo. The actual create surface is `AdminSubaccountsPage.tsx`. Do not create a new page.
- Layout quick-create (`Layout.tsx`) is intentionally OUT OF SCOPE for Phase 2. §13 Deferred.
- No new endpoint. The apply verb (`POST /api/hierarchy-templates/:id/apply`) already exists.
- No component tests per framing (`frontend_tests: none_for_now`). The backend verb is already tested; the picker is glue.

**Static gates.**
- `npm run typecheck`.
- `npm run lint`.
- `npm run build` — client build succeeds.
- Manual: (1) create a subaccount with `None`, confirm existing behaviour preserved; (2) create a subaccount with a template, confirm team installed and navigation works; (3) create with a template but break the apply call (e.g. disable the endpoint locally), confirm subaccount still created + inline warning + retry works.

**Acceptance criteria.**
- Picker lists all active hierarchy templates; empty state renders helper link when no templates exist.
- Template applied on create matches what `POST /apply` would install via the existing admin path.
- Apply failure does not roll back the subaccount.
- Layout quick-create path unchanged (regression: existing quick-create flows still work identically).

**Phase 2 exit criteria (cross-chunk roll-up).**
- Manifest has exactly one `reportsTo: null` agent on the sentinel subaccount (2.0).
- Migration 0214 applied; partial unique index enforces at-most-one active root per subaccount (2a).
- `hierarchyRouteResolverService.resolveRootForScope` is the canonical root-finder for `scope === 'subaccount'` (2b). `ORCHESTRATOR_AGENT_SLUG` retained for org-scope fallback only.
- Briefs dispatch to the subaccount root when configured; fall back to the org Orchestrator otherwise; `fallback !== 'none'` rate is logged (Phase 2 success criterion: <1% after week 1).
- Subaccount creation form offers a starting-team picker that installs a template on success (2c).
- `subaccountMultipleRoots` detector remains at zero findings; `subaccountNoRoot` findings reflect operator choices (steady state, not a failure).
- No change to delegation skill execution (Phase 3/4 territory).

---

## 6. Phase 3 — Hierarchy context + visibility layer

**Goal (from spec §11 Phase 3).** `SkillExecutionContext.hierarchy` is built once per run. The three existing list skills accept a `scope` parameter with an adaptive default. No execution enforcement — agents can still delegate anywhere — but they now *see* scoped results by default when they call `config_list_agents`.

**Entry state.** Phase 2 complete. No `hierarchy` field on `SkillExecutionContext`. `config_list_agents` / `_subaccounts` / `_links` are org/subaccount-wide. `agent_runs.hierarchy_depth` column exists (Phase 1) but is null on every row.

**Exit state.** `hierarchyContextBuilderService` builds an immutable snapshot per run. `agentExecutionService` populates `ctx.hierarchy` before handing to the skill executor. Three list skills respect adaptive-default `scope`. `agent_runs.hierarchy_depth` is populated from `context.hierarchy.depth` on new rows.

### Chunk 3a — `hierarchyContextBuilderService` + wiring into `SkillExecutionContext`

**What this chunk ships.** The pure + impure builder service. `SkillExecutionContext` extended with optional `hierarchy`. `agentExecutionService` calls `buildForRun` before the skill resolver runs. `agent_runs.hierarchy_depth` starts getting populated.

**Files — New:**
- `server/services/hierarchyContextBuilderService.ts` — impure wrapper exporting `buildForRun({ agentId, subaccountId, organisationId }): Promise<Readonly<HierarchyContext>>`. Single `orgScopedDb` query over `subaccount_agents WHERE subaccount_id = $subaccountId AND is_active = true` selecting `id` + `parent_subaccount_agent_id`. Feeds result into `buildHierarchyContextPure`; wraps output in `Object.freeze`. Declares and exports `HierarchyContextBuildError` (codes: `agent_not_in_subaccount`, `depth_exceeded`, `cycle_detected`) per spec §6.1.
- `server/services/hierarchyContextBuilderServicePure.ts` — `buildHierarchyContextPure({ agentId, agents }): HierarchyContext`. Algorithm per spec §6.1: (1) find caller in roster → `parentId` (null iff caller's `parent_subaccount_agent_id` is null); (2) filter roster where `parent_subaccount_agent_id === agentId` → `childIds` sorted by id asc for determinism; (3) walk upward from caller, counting depth; track visited ids for cycle detection; cap at `MAX_DEPTH + 1 = 11` iterations; (4) the terminal ancestor (the row with `parent_subaccount_agent_id IS NULL`) is `rootId`. Throw `HierarchyContextBuildError('agent_not_in_subaccount')` if caller not in roster, `'depth_exceeded'` if walk hits the cap, `'cycle_detected'` if a visited id reappears.
- `server/services/__tests__/hierarchyContextBuilderServicePure.test.ts` — per spec §12.2. Covers: root agent (parentId null, depth 0, rootId === agentId); middle manager (parentId set, childIds populated, depth 1); leaf worker (childIds empty); deterministic childIds ordering (two invocations over the same roster produce identical output); cycle detection throws; depth > MAX_DEPTH throws; agent-not-in-roster throws; root's own childIds include all agents with `parent_subaccount_agent_id === rootId`.

**Files — Modified:**
- `server/services/skillExecutor.ts` (around line 119 where `SkillExecutionContext` is defined) — add optional field `hierarchy?: Readonly<HierarchyContext>`. Import the type from `shared/types/delegation.ts`. Type-only change; no runtime behaviour until `agentExecutionService` starts populating it.
- `server/services/agentExecutionService.ts` — in the run-construction path, after `agentId` + `subaccountId` + `organisationId` are known and BEFORE the skill resolver runs, call:
  ```ts
  const hierarchy = await hierarchyContextBuilderService.buildForRun({ agentId, subaccountId, organisationId });
  const ctx: SkillExecutionContext = { ...existingFields, hierarchy };
  ```
  Per spec §6.1 "built once per run". On `HierarchyContextBuildError`, log WARN (`hierarchy_not_built_for_run`) and leave `ctx.hierarchy` undefined — non-aborting. Read skills fall through (Chunk 3b); write skills fail closed (Chunk 4a). Do not abort the run. Also write `agent_runs.hierarchy_depth = hierarchy.depth` on the new row. The other Phase-1 columns (`delegation_scope`, `delegation_direction`, `handoff_source_run_id`) stay null until Phase 4.

**Implementation notes.**
- Construction ordering matters — `agentExecutionService` must build hierarchy BEFORE invoking `skillService.resolveSkillsForAgent` (§6.5). Phase 4's derived-skill resolver reads `context.hierarchy.childIds`; if hierarchy is built lazily AFTER the resolver, derived skills go missing.
- `Object.freeze` on the return. Type is `Readonly<HierarchyContext>`. Both layers of immutability are required by INV-4 — the type prevents accidental assignment in TypeScript, the freeze prevents runtime mutation even through type erasure.
- The roster query is ONE indexed query against `subaccount_agents` per run. Expected size <100 rows. No pagination, no caching.
- `HierarchyContextBuildError` is co-located with the impure wrapper. It is a server-side construction error, NOT part of the skill error contract (INV-2) — it does not cross into `shared/types/delegation.ts`.
- Diagnostic and system runs that legitimately bypass the builder (if any exist) leave `ctx.hierarchy` undefined. The three read skills (Chunk 3b) handle this with a WARN-level fallthrough; write skills (Phase 4) fail closed. Identify any legitimate bypass cases during this chunk and document them inline (WARN tag: `hierarchy_not_built_for_run`). If there are none, the WARN never fires in practice — that's fine.

**Invariants touched.**
- **INV-4 (immutable hierarchy snapshot).** Built-once-per-run is enforced here: `agentExecutionService` is the sole caller of `buildForRun`. The resolver (Phase 4 Chunk 4b) consumes the already-built snapshot; do not re-invoke the builder there.

**Static gates.**
- `npm run typecheck` — `SkillExecutionContext` extension flows through every import site.
- `npm run lint`.
- `npm test -- hierarchyContextBuilderServicePure`.

**Acceptance criteria.**
- Every new `agent_runs` row has `hierarchy_depth` populated matching the caller's depth in the active subaccount roster.
- `ctx.hierarchy` is a frozen object — `ctx.hierarchy.childIds.push(...)` throws in strict mode.
- A run for an agent with no roster row surfaces `HierarchyContextBuildError('agent_not_in_subaccount')` as a WARN-tagged non-aborting fallthrough — `ctx.hierarchy` is undefined, the run continues.
- Deterministic `childIds`: two runs for the same agent over the same roster produce identical `childIds` order.
- No regression in existing `agentExecutionService` tests.

### Chunk 3b — Scope param on three list skills

**What this chunk ships.** `config_list_agents`, `config_list_subaccounts`, `config_list_links` accept an optional `scope: DelegationScope`. Adaptive default (children if caller has children, subaccount otherwise). Missing-context falls through to subaccount with a WARN.

**Files — New:**
- `server/tools/config/__tests__/configSkillHandlersPure.test.ts` — new (or extends existing) per spec §12.2. Covers: adaptive default with children → `children`; adaptive default without children → `subaccount`; explicit scope overrides adaptive; missing-hierarchy fallthrough to `subaccount` with WARN log assertion; `descendants` walks the caller's subtree via the pure hierarchy builder (no recursive CTE). The downward-walk logic lives in a pure helper `computeDescendantIds({ callerId, roster })` exported from the config module or from `hierarchyContextBuilderServicePure.ts` — reuse the latter if it already exposes a walk; otherwise add a tiny pure helper to the config pure module.

**Files — Modified:**
- `server/tools/config/configSkillHandlers.ts` — `executeConfigListAgents`, `executeConfigListSubaccounts`, `executeConfigListLinks` each accept an optional `scope` via the input schema (Zod). Inside each handler:
  ```ts
  const effectiveScope: DelegationScope = input.scope ?? (
    (context.hierarchy?.childIds.length ?? 0) > 0 ? 'children' : 'subaccount'
  );
  if (!context.hierarchy) {
    logger.warn({ skill, runId: context.runId }, 'hierarchy_missing_read_skill_fallthrough');
    // fallthrough to 'subaccount' behaviour regardless of effectiveScope
  }
  ```
  Scope → filter per spec §6.2:
  - `config_list_agents`: `children` → filter roster to `parentSubaccountAgentId === context.agentId`; `descendants` → filter to ids returned by the pure downward walk; `subaccount` → existing behaviour.
  - `config_list_subaccounts` / `config_list_links`: `scope` is accepted for signature consistency but has NO filter effect in v1. Document in the skill markdown file.
- `server/skills/config_list_agents.md` — Parameters section adds `scope` with values `children | descendants | subaccount`, noting the adaptive default and the filter behaviour.
- `server/skills/config_list_subaccounts.md` — Parameters section adds `scope` with a clear note "accepted for signature consistency across list skills; has no filter effect in v1" so callers don't rely on narrowing.
- `server/skills/config_list_links.md` — same.

**Implementation notes.**
- Back-compat: existing callers pass no `scope`. Agents with zero children (all current agents except the Orchestrator on the flat seed) resolve to `subaccount` — identical to today. Behaviour change only bites the Orchestrator (and post-reorg, department heads).
- The WARN tag `hierarchy_missing_read_skill_fallthrough` is distinct from the error-code `hierarchy_context_missing` that write skills emit (Phase 4). Different severities, different surfaces — don't reuse the string.
- `config_list_subaccounts` / `config_list_links` accept the parameter because the three tools share a shape in the agent prompt. Dropping it from two of three creates per-skill surface divergence and forces the agent to memorise which skill is scope-aware — spec §6.2 "Rationale".
- Zod schema per skill: `scope: z.enum(DELEGATION_SCOPE_VALUES).optional()`. The shared enum comes from `shared/types/delegation.ts` (Phase 1 Chunk 1a).
- JSON-schema for LLM-visible tool definitions lives in the `.md` skill files per spec §14.3 — update those, not `actionRegistry.ts`.

**Invariants touched.**
- **INV-2.** Read skills do NOT emit `hierarchy_context_missing`; they fall through. That error is reserved for write skills (§4.1, §6.2).

**Static gates.**
- `npm run typecheck`.
- `npm run lint`.
- `npm test -- configSkillHandlersPure`.

**Acceptance criteria.**
- Orchestrator on the seeded company calling `config_list_agents` with no `scope` returns its 15 direct reports (children default), not the whole subaccount.
- Any leaf agent (e.g. a specialist) calling `config_list_agents` with no `scope` returns the full subaccount roster — adaptive fallthrough because `childIds.length === 0`.
- Explicit `scope: 'subaccount'` on the Orchestrator returns the full roster (override works).
- `scope: 'descendants'` on an agent with grandchildren (post seed-reorg) returns the full subtree including grandchildren — validated via the pure test against a synthetic roster.
- A run with `context.hierarchy` undefined triggers ONE WARN log and returns subaccount-wide results; no exception propagates to the caller.

**Phase 3 exit criteria (cross-chunk roll-up).**
- `SkillExecutionContext.hierarchy` populated on every run that goes through `agentExecutionService` (normal Brief dispatch path).
- `agent_runs.hierarchy_depth` populated on new rows; old rows remain null (no backfill per spec §5.3 / §16.5).
- Three list skills honour adaptive-default scope.
- No delegation rejection-rate spike (write paths unchanged — still flat, no enforcement).
- `subaccountMultipleRoots` still zero.

---

## 7. Phase 4 — Execution enforcement + derived skill resolution + trace graph

**Goal (from spec §11 Phase 4).** Hierarchy becomes binding. `spawn_sub_agents` and `reassign_task` validate scope and write `delegation_outcomes` + `agent_execution_events` dual-writes + new `agent_runs` columns. Skill resolver derives delegation skills from `context.hierarchy.childIds`. Trace graph route + UI makes multi-agent fan-out legible.

**Entry state.** Phase 3 complete. `context.hierarchy` is populated per run. List skills are adaptive. `spawn_sub_agents` and `reassign_task` still flat — no scope param, no validation. `ORCHESTRATOR_AGENT_SLUG` retained for org-scope fallback only.

**Exit state.** Migration 0215 applied. Two write-side skills validate scope and write telemetry. Third detector live (`explicitDelegationSkillsWithoutChildren`). New route `GET /api/agent-runs/:id/delegation-graph` + service + UI tab. `architecture.md` updated with a new "Hierarchical Agent Delegation" section.

### Chunk 4a — Migration 0215 + `spawn_sub_agents` + `reassign_task` validation + telemetry dual-writes

**What this chunk ships.** The two write-side skill handlers become scope-aware with full telemetry. The `tasks.delegation_direction` column lands. `agent_execution_events` gets a new best-effort entry point. The nesting-block at line ~3415 in `skillExecutor.ts` is removed. `MAX_HANDOFF_DEPTH` enforced uniformly across handoff + spawn chains.

**Files — New:**
- `migrations/0215_tasks_delegation_direction.sql` — per spec §5.2. `ALTER TABLE tasks ADD COLUMN delegation_direction text;` + CHECK constraint `tasks_delegation_direction_chk`.
- `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts` — per spec §12.2 / INV-2. Covers: all-children-accepted → all rows written with `direction='down'`; one-out-of-scope → whole call rejected, rejection rows for out-of-scope targets only; `effectiveScope === 'subaccount'` → `cross_subtree_not_permitted` regardless of caller role (roots included); `context.handoffDepth >= MAX_HANDOFF_DEPTH` → `max_handoff_depth_exceeded`; `context.hierarchy` undefined → `hierarchy_context_missing`; adaptive default (no children → `subaccount` → reject).
- `server/services/__tests__/skillExecutor.reassignTask.test.ts` — per spec §12.2. Covers direction computation (`down` / `up` / `lateral`); upward-escalation special case (§6.4 step 2) — target === `parentId`, skips scope validation, direction `'up'`; `effectiveScope === 'subaccount'` and caller is configured subaccount root → accepted; same scope and caller is NOT root → `cross_subtree_not_permitted`; `context.hierarchy` undefined → `hierarchy_context_missing`; special-case ordering — a non-root caller reassigning to its parent with explicit `scope: 'children'` still succeeds (the special case runs BEFORE generic validation).

**Files — Modified:**
- `server/db/schema/tasks.ts` — add `delegationDirection: text('delegation_direction')`.
- `server/services/skillExecutor.ts` — two major changes:
  - **`spawn_sub_agents` handler (around line 3410)** — accept optional `delegationScope`. Require `context.hierarchy` — emit `hierarchy_context_missing` if undefined (INV-2). Compute `effectiveScope` (adaptive default from §4.2). Validation per spec §6.3:
    1. If `effectiveScope === 'subaccount'` → reject entire call with `cross_subtree_not_permitted`. Write one rejection row per proposed target via `insertOutcomeSafe` (direction inferable from target vs. caller — use `'down'` for sub-targets in caller's subtree, `'lateral'` for outside-subtree targets; this matches the §4.4 direction contract); emit matching `insertExecutionEventSafe` row per target.
    2. Else classify each target: `children` → `parentSubaccountAgentId === context.agentId`; `descendants` → pure downward walk over `context.hierarchy`-derived roster (reuse Chunk 3b's walk helper).
    3. Any target out-of-scope → reject entire call with `delegation_out_of_scope`. Write rejection rows for the out-of-scope targets only (in-scope-but-unexecuted siblings get no row — spec §6.3 step 4). Same dual-write.
    4. All targets in-scope → enforce `context.handoffDepth < MAX_HANDOFF_DEPTH` (5). If not, reject with existing `max_handoff_depth_exceeded`. New sub-agent run's `handoffDepth = context.handoffDepth + 1`. Spawn the set. For each new run, set `agent_runs.delegation_scope = effectiveScope`, `agent_runs.delegation_direction = 'down'`, `agent_runs.parentRunId = context.runId` (INV-1). Write accepted rows via `insertOutcomeSafe`.
    5. **Delete the existing "sub-agents cannot spawn sub-agents" hard-block** at line ~3415. Multi-level fan-out is now legitimate up to `MAX_HANDOFF_DEPTH`.
  - **`reassign_task` handler (around line 3330)** — accept optional `delegationScope`. Require `context.hierarchy` — emit `hierarchy_context_missing` if undefined. Compute `effectiveScope`. Validation per spec §6.4:
    1. If target's agent id === `context.hierarchy.parentId` → upward-escalation special case. Skip scope validation. Set `delegationDirection = 'up'`. Jump to step 5. **Ordering invariant: this step runs BEFORE step 2 so explicit `scope: 'children'` on a parent-target still succeeds** — exercised by the direction-test above.
    2. If `effectiveScope === 'subaccount'` → assert `context.hierarchy.rootId === context.agentId && context.hierarchy.rootId !== null`. If not, reject with `cross_subtree_not_permitted`.
    3. Apply target-in-scope rule (`children` / `descendants` as spawn).
    4. Compute `delegationDirection`: target in caller's subtree → `'down'`; target is ancestor (only reachable post special-case via root's `subaccount` scope hitting its own ancestor path — empty for roots) → `'up'`; otherwise (only possible when `effectiveScope === 'subaccount'` and caller is root) → `'lateral'`.
    5. Write `tasks.delegation_direction` (must succeed — failure fails the skill call per spec §6.4 step 6). When the handoff queue dispatches, the new run carries `delegation_direction` and `delegation_scope` into its own `agent_runs` row (immutable per-run fact); `handoff_source_run_id = context.runId` (INV-1).
    6. Write `delegation_outcomes` row via `insertOutcomeSafe` (INV-3). Emit matching `insertExecutionEventSafe` row if rejected.
  - Both handlers source `runId` from `SkillExecutionContext.runId` for every write site (outcome row, event row, new `agent_runs` pointers). Never regenerate; never read from elsewhere (INV-1).
- `server/services/agentExecutionEventService.ts` (existing) — add `insertExecutionEventSafe(eventInput)` entry point following the same detached-try/catch pattern as `insertOutcomeSafe`. On failure: WARN tag `delegation_event_write_failed` (INV-3, distinct tag per spec §15.8). Strict variant remains for existing callers that expect throw-on-failure; skill handlers never call it. Dual-write is sequenced AFTER the parent skill's core mutation commits.
- `server/skills/spawn_sub_agents.md` — Parameters section adds `delegationScope` with values `children | descendants` and documents the `subaccount` rejection. Prompt language: "use this to route a task within your own team; for cross-team work use `reassign_task`."
- `server/skills/reassign_task.md` — Parameters section adds `delegationScope` plus the upward-escalation note: "any agent may reassign to its immediate parent regardless of `delegationScope`; this is the escalation path."

**Implementation notes.**
- Rejection rows are written for `delegation_out_of_scope` targets only per spec §6.3 step 4. In-scope-but-unexecuted siblings (i.e. the other targets in a partial-reject batch) are NOT written — logging them as `accepted` would be false; as `rejected` would be misleading. This matters for the rejection-rate metric.
- For `cross_subtree_not_permitted` on `spawn_sub_agents`, the rejection is per-target (one row per proposed target), because every target in the batch was rejected by the same policy — spec §6.3 step 2.
- `tasks.delegation_direction` is the CURRENT-task marker. A task reassigned twice has its marker overwritten. The per-run direction on `agent_runs.delegation_direction` is the immutable edge marker. Both are required — they answer different questions (§5.3 vs §5.2).
- Unresolvable targets (target agent id doesn't exist at all) produce a different error class (`target_not_found` or equivalent — existing error) and do NOT write to `delegation_outcomes` because the FK would fail. They surface only in `agent_execution_events` (§4.3 side-effect note). Do not attempt to write a rejection row for these.
- The `insertExecutionEventSafe` write is the lossless-log backstop. If both writes drop, the structured error still returns to the caller (agent prompt) — telemetry surfaces are telemetry, not enforcement (INV-3 degenerate-case contract).
- Rejection error `context` objects carry the spec §4.3 minimum shape: `runId`, `callerAgentId`, plus per-code required fields (`targetAgentId` + `delegationScope` + `callerChildIds` for `delegation_out_of_scope`; `callerParentId` + `suggestedScope` for `cross_subtree_not_permitted`; `skillSlug` for `hierarchy_context_missing`). Serialised ≤ 4 KiB; array fields truncate at 50 with `truncated: true` (INV-2).

**Invariants touched.**
- **INV-1 (runId continuity).** Every write site sources `runId` from `context.runId`. Never null on spawn or handoff child rows.
- **INV-2 (uniform error contract).** Error codes + context shapes as specified. Array truncation at 50 + size cap at 4 KiB.
- **INV-3 (best-effort dual-writes).** Both `insertOutcomeSafe` and `insertExecutionEventSafe` are detached, post-commit, named swallow points. Distinct WARN tags.

**Static gates.**
- `npm run typecheck`.
- `npm run lint`.
- `npm run db:generate` — verify 0215 matches the hand-written SQL.
- `verify-rls-coverage.sh` — no new tables; `rlsProtectedTables` unchanged.
- `npm test -- skillExecutor.spawnSubAgents skillExecutor.reassignTask`.
- Manual: craft a multi-agent fan-out scenario (Orchestrator spawns 3 children, one of which reassigns to its parent → upward escalation), inspect `agent_runs`, `delegation_outcomes`, `agent_execution_events`, `tasks.delegation_direction`. All four tables show consistent correlated ids (INV-1).

**Acceptance criteria.**
- A manager calling `spawn_sub_agents` with three valid children successfully spawns all three; three accepted rows written to `delegation_outcomes`; three new `agent_runs` rows with `delegation_direction='down'`, `delegation_scope='children'`, `parentRunId=caller.runId`.
- Same call with one out-of-scope target rejects the entire batch; only the out-of-scope target has a rejection row; `agent_execution_events` carries the structured `{ code: 'delegation_out_of_scope', context }` payload.
- A non-root agent using `scope: 'subaccount'` is rejected with `cross_subtree_not_permitted`.
- A leaf worker using `reassign_task` on its parent succeeds (upward escalation); `tasks.delegation_direction = 'up'`; `delegation_outcomes.direction = 'up'`.
- The nesting block is gone — a sub-agent can spawn further, up to `MAX_HANDOFF_DEPTH`.
- If an `insertOutcomeSafe` inner call fails (simulated), the delegation still succeeds and a WARN `delegation_outcome_write_failed` appears in logs.
- If an `insertExecutionEventSafe` inner call fails (simulated), the delegation still succeeds, the agent still sees the structured error, and a WARN `delegation_event_write_failed` appears.

### Chunk 4b — Derived skill resolver

**What this chunk ships.** `skillService.resolveSkillsForAgent` unions the agent's attached skill set with a graph-derived set when `context.hierarchy.childIds.length > 0`. Managers emerge from graph position; workers cannot delegate.

**Files — New:**
- `server/services/__tests__/skillService.resolver.test.ts` — per spec §12.2. Covers: `computeDerivedSkills({ hierarchy })` returns `[]` for empty `childIds`; returns `['config_list_agents', 'spawn_sub_agents', 'reassign_task']` for non-empty. Union idempotency — explicit + derived de-dupes. `context.hierarchy` undefined → no derived skills, WARN logged.

**Files — Modified:**
- `server/services/skillService.ts` (inside `resolveSkillsForAgent`) — add derived union per spec §6.5:
  ```ts
  const derivedSlugs = (context.hierarchy?.childIds.length ?? 0) > 0
    ? ['config_list_agents', 'spawn_sub_agents', 'reassign_task']
    : [];
  const effectiveSlugs = Array.from(new Set([...attachedSlugs, ...derivedSlugs]));
  ```
  Extract `computeDerivedSkills({ hierarchy })` as a pure helper (new file `skillServicePure.ts` if one doesn't exist; or inline export on the existing pure helper module). When `context.hierarchy` is undefined, log WARN tag `hierarchy_missing_at_resolver_time` and return attached-only — the resolver does NOT fail the run. Consistent with spec §6.5 "Missing-hierarchy policy for the resolver."

**Implementation notes.**
- Call-ordering assumption: `agentExecutionService` has already built `context.hierarchy` before invoking the resolver (established in Chunk 3a). This chunk relies on that ordering; do NOT re-invoke the builder here.
- Always union all three together. Spec §6.5: giving a manager `spawn_sub_agents` without `config_list_agents` forces guessing target IDs — we do not enable that path.
- Explicit attachment survives the union (narrow escape hatch). The resolver only adds, never removes. For no-child agents with explicit attachments, Phase 4a's validation sharply narrows what the attached skills can DO — that's by design (§6.5).

**Invariants touched.**
- **INV-4.** Consumes `context.hierarchy` without rebuilding. Single source of truth.

**Static gates.**
- `npm run typecheck`.
- `npm run lint`.
- `npm test -- skillService.resolver`.

**Acceptance criteria.**
- Orchestrator on the post-Phase-2 seeded company gets the three derived skills in its resolved tool list (observable via run-trace tool inventory or a one-liner `resolveSkillsForAgent(orchestratorId)` smoke).
- Any leaf worker (no children) does NOT get the derived skills.
- An agent with all three skills attached explicitly + no children still has all three in its resolved set (idempotent union); the subsequent Phase 4a validation blocks broader delegation.
- A run with `context.hierarchy` undefined logs WARN `hierarchy_missing_at_resolver_time` once; the resolver returns attached-only; the run does not fail.

### Chunk 4c — Delegation graph route + service + DelegationGraphView

**What this chunk ships.** `GET /api/agent-runs/:id/delegation-graph` with backing `delegationGraphService`; a new "Delegation graph" tab on the run trace viewer.

**Files — New:**
- `server/services/delegationGraphService.ts` — impure wrapper exporting `buildForRun(runId, orgId): Promise<DelegationGraphResponse>`. Single `orgScopedDb` lookup of the opened run first; 404 if not visible (access assertion per spec §7.2). Then walks outward via recursive queries on `agent_runs.parentRunId === current.id OR handoff_source_run_id === current.id`, bounded by `MAX_HANDOFF_DEPTH + 1 = 6` levels. Denormalises agent name at node-assembly time (one join to `agents` / `subaccount_agents`).
- `server/services/delegationGraphServicePure.ts` — `assembleGraphPure({ rootRunId, rows })` returning `{ rootRunId, nodes, edges }` per spec §7.2. `rows` is the flat list of runs retrieved by the impure wrapper. Pure function: dedup nodes by runId; emit one spawn edge per `parentRunId` pointer and one handoff edge per `handoff_source_run_id` pointer (a run with both → two edges); direction is sourced from the CHILD run's `delegation_direction` column, immutable per INV-1.
- `server/services/__tests__/delegationGraphServicePure.test.ts` — per spec §12.2. Covers: `MAX_HANDOFF_DEPTH` bound holds (depth-6 graph truncates cleanly); both edge types present; a run with both `parentRunId` and `handoffSourceRunId` produces two edges to itself; direction on spawn edge always `'down'`; direction on handoff edge read from the child row; dedup by `runId` — same run referenced twice appears once in `nodes`; opened run has no inbound edge.
- `client/src/components/run-trace/DelegationGraphView.tsx` — consumes `GET /api/agent-runs/:id/delegation-graph`. Renders nodes with agent name, status badge, scope chip (if non-null), `hierarchyDepth` badge. Edges: spawn solid, handoff distinct. Direction-colour: `'down'` green solid, `'up'` amber dashed, `'lateral'` amber dotted (spec §8.2). Click node → navigate to that run's trace tab (in-place). Root expanded by default; descendants collapsed; refresh button triggers refetch. No WebSocket. No test file per framing — tree-shaping logic is in the server-side pure test.

**Files — Modified:**
- `server/routes/agentRuns.ts` — mount `GET /api/agent-runs/:id/delegation-graph` alongside the existing `/:id` route. Middleware chain: `authenticate` + service-layer org check (matches existing `/:id` pattern; no new per-run ACL helper per spec §7.2, §9.3).
- `client/src/pages/RunTraceViewerPage.tsx` — add a third tab labelled "Delegation graph" that renders `<DelegationGraphView runId={currentRunId} />`. Existing tabs (Trace, Payload) unchanged.

**Implementation notes.**
- `delegationGraphService.buildForRun` does ONE query to fetch the opened run (org-scoped; 404 on miss) and a second query (bounded by 6 levels) to fetch the fan-out. No per-node access check. Summary shape is already public-within-org per §9.3.
- Response is lossless: a run with both `parentRunId` and `handoffSourceRunId` appears once as a node and twice as a child of two edges. Client dedups by runId and can render it however it likes.
- `direction` on a node is read from its OWN `agent_runs.delegation_direction` (Phase 4a write). It is null for the opened root iff the opened run was not dispatched by a delegation skill (a Brief's initial run). Edge-direction and node-direction are the same value because direction is stored on the CHILD run per INV-1.
- `MAX_HANDOFF_DEPTH + 1 = 6` bound is a loop-safety cap, not a business cap. If fan-out legitimately exceeds 6 levels (shouldn't — `MAX_HANDOFF_DEPTH = 5` caps upstream), truncate with a flag on the response so the UI can warn. Not expected to fire; write the truncation branch and keep it behind a log.
- The UI file has NO `.test.tsx` per framing (`frontend_tests: none_for_now`). Logic worth testing lives in the server pure module.

**Invariants touched.**
- **INV-1.** Edge direction read from child's immutable `delegation_direction`. Graph correctness depends on every write site having set the pointer at creation time (Phase 4a).
- **INV-4.** Graph reading does not re-invoke the hierarchy builder. It reads the historical snapshot frozen on each run.

**Static gates.**
- `npm run typecheck`.
- `npm run lint`.
- `npm run build` — client build passes.
- `npm test -- delegationGraphServicePure`.
- Manual: open a run with multi-level fan-out, confirm the graph renders both spawn and handoff edges with correct colour / style, click nodes and confirm in-place navigation.

**Acceptance criteria.**
- `GET /api/agent-runs/:id/delegation-graph` returns `{ nodes, edges }` with exactly one node per unique runId and one edge per parent pointer.
- A run dispatched via spawn AND later reassigned appears as the child of two edges (one `spawn`, one `handoff`).
- Cross-org access is rejected (404) even with a valid runId from another org — enforced by `orgScopedDb`.
- Trace viewer's new tab renders a Brief's multi-agent fan-out correctly; direction colours match spec §8.2.

### Chunk 4d — Third detector + architecture doc

**What this chunk ships.** `explicitDelegationSkillsWithoutChildren` detector registered (severity `info`, not `warning`). `architecture.md` gains a new "Hierarchical Agent Delegation" section covering the enforcement model, the root-agent contract, and composition with capability-aware routing.

**Files — New:**
- `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.ts` — exports `{ name: 'explicitDelegationSkillsWithoutChildren', severity: 'info', detect(orgId, db) }`. Query: agents with ALL THREE of `config_list_agents`, `spawn_sub_agents`, `reassign_task` attached explicitly AND `childIds.length === 0` (no active direct reports). Emit an info finding per such agent with the exact message from spec §6.9 case 3. Dedup key `(orgId, 'explicitDelegationSkillsWithoutChildren', 'agent', subaccountAgentId)`.
- `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildrenPure.ts` — pure helper `findAgentsWithExplicitDelegationButNoChildren({ roster, attachments })` so the detector's DB call is separable.
- `server/services/workspaceHealth/detectors/__tests__/explicitDelegationSkillsWithoutChildren.test.ts` — per spec §12.2. Covers: agent with all three attached + no children emits finding; agent with children emits nothing (normal manager); agent with only one of the three attached emits nothing; agent with all three derived but none attached emits nothing (derived-only does NOT trip the detector).

**Files — Modified:**
- `server/services/workspaceHealth/detectors/index.ts` — register `explicitDelegationSkillsWithoutChildren`.
- `architecture.md` — add a new top-level section "Hierarchical Agent Delegation" covering:
  - Root-agent contract (partial unique index, same-tx rotation, resolver fallback).
  - Hierarchy context (built-once-per-run snapshot, immutability, consumers).
  - `DelegationScope` enum + adaptive default + execution model per scope (read vs. write skills).
  - Structured errors (`delegation_out_of_scope`, `cross_subtree_not_permitted`, `hierarchy_context_missing`) + the dual-write contract.
  - Derived delegation skills from graph position.
  - Run-trace delegation graph + the graph-not-tree invariant.
  - Composition with capability-aware routing: hierarchy enforcement constrains delegation targets; capability routing chooses the best agent within the admissible set. Orthogonal systems.
  - Link to `docs/hierarchical-delegation-dev-spec.md` for the full contract.
  This section replaces any stale prose about "Orchestrator resolved by hardcoded slug" — update or remove those references in the same edit.

**Implementation notes.**
- Severity is `info`, not `warning`. Explicit attachment is a SUPPORTED narrow escape hatch per spec §6.5; the detector is an operator-awareness surface, not a drift flag. Copy the severity verbatim from spec §6.9.
- The detector is a Phase 4 register per spec §6.9 / §11 — do NOT backdate into Phase 1.
- Per CLAUDE.md "Docs Stay In Sync With Code", `architecture.md` updates land IN THIS CHUNK, not a follow-up PR.
- Long-doc guard: the `architecture.md` edit MAY trigger the long-doc guard (§12 hook). Use the chunked workflow — small `Edit` appends + a `TodoWrite` task list per section if the chunk crosses 10k chars. Start by reading the current `architecture.md` size + structure to decide placement.

**Invariants touched.** None new. This chunk codifies the invariants in `architecture.md`.

**Static gates.**
- `npm run typecheck`.
- `npm run lint`.
- `npm test -- explicitDelegationSkillsWithoutChildren`.
- Manual: visual check of the new `architecture.md` section; confirm it cross-links to the spec and does not contradict any other section.

**Acceptance criteria.**
- Detector registered; `AdminHealthFindingsPage` lists it under "Info".
- On the seeded company with Orchestrator-has-children, no `explicitDelegationSkillsWithoutChildren` findings (Orchestrator has children; other agents don't have the trio attached explicitly).
- `architecture.md` has a new section linked from the TOC (if the file has one) that captures the contract; no stale "hardcoded Orchestrator slug" language remains for subaccount-scope dispatch.

**Phase 4 exit criteria (cross-chunk roll-up).**
- Migration 0215 applied. `tasks.delegation_direction` populated on reassigned rows.
- `spawn_sub_agents` and `reassign_task` validate scope + emit structured errors + write telemetry dual-writes. Nesting block removed.
- Skill resolver derives the three delegation skills from graph position; managers emerge from having children.
- `GET /api/agent-runs/:id/delegation-graph` returns the DAG; `RunTraceViewerPage` renders it.
- `explicitDelegationSkillsWithoutChildren` registered.
- `architecture.md` updated in the same commit as the Phase 4 code.
- Rejection-rate metrics begin collecting (spec §17.3). Trend monitored during the 1–2 week adjustment period; prompt tweaks happen in-band.
- `subaccountMultipleRoots` still zero.

---

## 8. File inventory cross-reference (spec §14.1–§14.4)

Every file in spec §14 maps to exactly one chunk. This table is the authoritative "which chunk owns which file" index — the chunks above list files per chunk; this table inverts that view so a spec-conformance reader can find any spec-referenced file in one pass. If a file appears in spec §14 but is missing here, the plan has a gap.

| Spec §14 entry | File | Chunk |
|---|---|---|
| §14.1 New | `migrations/0216_agent_runs_delegation_telemetry.sql` | 1a |
| §14.1 New | `migrations/0217_delegation_outcomes.sql` | 1a |
| §14.1 New | `server/db/schema/delegationOutcomes.ts` | 1a |
| §14.1 New | `server/services/delegationOutcomeService.ts` | 1a |
| §14.1 New | `server/services/delegationOutcomeServicePure.ts` | 1a |
| §14.1 New | `server/services/__tests__/delegationOutcomeServicePure.test.ts` | 1a |
| §14.1 New | `server/services/workspaceHealth/detectors/subaccountMultipleRoots.ts` (+ pure sibling) | 1c |
| §14.1 New | `server/services/workspaceHealth/detectors/subaccountNoRoot.ts` (+ pure sibling) | 1c |
| §14.1 New | `server/services/workspaceHealth/detectors/__tests__/subaccountMultipleRoots.test.ts` | 1c |
| §14.1 New | `server/services/workspaceHealth/detectors/__tests__/subaccountNoRoot.test.ts` | 1c |
| §14.1 New | `server/routes/delegationOutcomes.ts` | 1b |
| §14.1 New | `shared/types/delegation.ts` | 1a |
| §14.1 New (optional) | `client/src/pages/AdminDelegationOutcomesPage.tsx` | 1b (optional) |
| §14.1 Modified | `server/db/schema/agentRuns.ts` | 1a |
| §14.1 Modified | `server/db/schema/index.ts` (export `delegationOutcomes`) | 1a |
| §14.1 Modified | `server/config/rlsProtectedTables.ts` (add `delegation_outcomes`) | 1a |
| §14.1 Modified | `server/services/agentExecutionService.ts` (writes new `agent_runs` columns) | 3a (writes `hierarchy_depth`) / 4a (writes remaining columns via dispatched runs) |
| §14.1 Modified | `server/services/workspaceHealth/detectors/index.ts` (register two Phase-1 detectors) | 1c |
| §14.1 Modified | `server/index.ts` (mount `delegationOutcomesRouter`) | 1b |
| §14.1 Modified | `server/lib/permissions.ts` (add `ORG_OBSERVABILITY_VIEW`) | 1b |
| §14.1 Modified (optional) | `client/src/App.tsx` + `client/src/components/Layout.tsx` (route + sidebar) | 1b (optional) |
| §14.2 New | `migrations/0214_subaccount_agents_root_unique.sql` | 2a |
| §14.2 New | `scripts/audit-subaccount-roots.ts` (+ pure sibling + test) | 2a |
| §14.2 New | `server/services/hierarchyRouteResolverService.ts` | 2b |
| §14.2 New | `server/services/hierarchyRouteResolverServicePure.ts` | 2b |
| §14.2 New | `server/services/__tests__/hierarchyRouteResolverServicePure.test.ts` | 2b |
| §14.2 New | `client/src/components/subaccount/StartingTeamPicker.tsx` | 2c |
| §14.2 Modified | `server/db/schema/subaccountAgents.ts` (add `uniqueIndex`) | 2a |
| §14.2 Modified | `server/jobs/orchestratorFromTaskJob.ts` (resolver + scope-from-payload; `ORCHESTRATOR_AGENT_SLUG` retained for org-scope) | 2b |
| §14.2 Modified | `server/services/briefCreationService.ts` (pass `scope` through) | 2b |
| §14.2 Modified | `server/services/hierarchyTemplateService.ts` (same-tx root rotation) | 2a |
| §14.2 Modified | `client/src/pages/AdminSubaccountsPage.tsx` (picker + apply-on-submit) | 2c |
| (pre-flight) | `companies/automation-os/automation-os-manifest.json` | 2.0 |
| §14.3 New | `server/services/hierarchyContextBuilderService.ts` | 3a |
| §14.3 New | `server/services/hierarchyContextBuilderServicePure.ts` | 3a |
| §14.3 New | `server/services/__tests__/hierarchyContextBuilderServicePure.test.ts` | 3a |
| §14.3 New | `server/tools/config/__tests__/configSkillHandlersPure.test.ts` | 3b |
| §14.3 Modified | `server/services/skillExecutor.ts` (`SkillExecutionContext.hierarchy` field) | 3a |
| §14.3 Modified | `server/services/agentExecutionService.ts` (populate `ctx.hierarchy`) | 3a |
| §14.3 Modified | `server/tools/config/configSkillHandlers.ts` (scope param on three list skills) | 3b |
| §14.3 Modified | `server/skills/config_list_agents.md` | 3b |
| §14.3 Modified | `server/skills/config_list_subaccounts.md` | 3b |
| §14.3 Modified | `server/skills/config_list_links.md` | 3b |
| §14.4 New | `migrations/0215_tasks_delegation_direction.sql` | 4a |
| §14.4 New | `server/services/delegationGraphService.ts` | 4c |
| §14.4 New | `server/services/delegationGraphServicePure.ts` | 4c |
| §14.4 New | `server/services/__tests__/delegationGraphServicePure.test.ts` | 4c |
| §14.4 New | `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts` | 4a |
| §14.4 New | `server/services/__tests__/skillExecutor.reassignTask.test.ts` | 4a |
| §14.4 New | `server/services/__tests__/skillService.resolver.test.ts` | 4b |
| §14.4 New | `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.ts` (+ pure sibling) | 4d |
| §14.4 New | `server/services/workspaceHealth/detectors/__tests__/explicitDelegationSkillsWithoutChildren.test.ts` | 4d |
| §14.4 New | `client/src/components/run-trace/DelegationGraphView.tsx` | 4c |
| §14.4 Modified | `server/db/schema/tasks.ts` (add `delegationDirection`) | 4a |
| §14.4 Modified | `server/services/skillExecutor.ts` (scope validation + telemetry + nesting-block removal) | 4a |
| §14.4 Modified | `server/services/skillService.ts` (derive delegation skills) | 4b |
| §14.4 Modified | `server/services/agentExecutionEventService.ts` (new `insertExecutionEventSafe`) | 4a |
| §14.4 Modified | `server/skills/spawn_sub_agents.md` | 4a |
| §14.4 Modified | `server/skills/reassign_task.md` | 4a |
| §14.4 Modified | `server/routes/agentRuns.ts` (mount `/delegation-graph`) | 4c |
| §14.4 Modified | `server/services/workspaceHealth/detectors/index.ts` (register third detector) | 4d |
| §14.4 Modified | `client/src/pages/RunTraceViewerPage.tsx` (new tab) | 4c |
| §14.5 Docs | `architecture.md` (new section) | 4d |
| §14.5 Docs | `KNOWLEDGE.md` | rolling — per phase exit |

**Note on `server/services/agentExecutionService.ts`.** Spec §14.1 lists this file under Phase 1 because Phase 1 introduces the new `agent_runs` columns the service must write. However, the actual write-integration points land in Phases 3 and 4: `hierarchy_depth` starts populating in Chunk 3a (when `context.hierarchy` starts being built), and `delegation_scope` / `delegation_direction` / `handoff_source_run_id` start populating in Chunk 4a (when dispatched runs are created by the two write-side skills). Phase 1 does NOT touch `agentExecutionService` — the columns ship nullable and the service keeps writing NULL until later phases wire in the populators. The table above reflects this integration reality; §14.1's Phase 1 entry is the earliest the column exists, which is the correct narrative for the schema file-inventory even though the service code change is later.

---

## 9. Phase dependency check (forward-only)

Confirmed by reading every chunk and walking the dependency edges. Phase N never references a primitive first introduced in Phase N+k. Three intentional early-introductions are below; all are safe because the later phase that populates / uses them does not depend on mid-phase behaviour.

**1. `agent_runs.delegation_scope` / `.delegation_direction` / `.handoff_source_run_id`** — introduced in Phase 1 (schema) but not populated until Phase 4 (Chunk 4a, when dispatched runs are created by the write-side skills). Rationale: keeping schema migrations grouped in Phase 1 means a single DB-change window instead of two, and Phase 4 becomes all-runtime-no-DDL — important because Phase 4 is the highest-risk phase (enforcement landing). The columns ship nullable and are invisible to every consumer until Chunk 4a / 4c light them up.

**2. `agent_runs.hierarchy_depth`** — introduced in Phase 1 (schema), populated in Phase 3 (Chunk 3a, when `context.hierarchy` starts being built). Rationale: same as above. The column is nullable; rows between Phase 1 land and Phase 3 land have null, which is the honest historical value per spec §16.5.

**3. `delegation_outcomes` table** — introduced in Phase 1 (schema + service + route), populated in Phase 4 (Chunk 4a). Rationale: the admin list route (Chunk 1b) is harmless with an empty table. Landing the schema + service + route + permission in Phase 1 means Phase 4 adds write sites only, keeping Phase 4 code-change-only and easier to revert.

**Backward dependency audit.**
| Primitive | Introduced | First consumer |
|---|---|---|
| `shared/types/delegation.ts` | 1a | 1a (service + tests) |
| `delegation_outcomes` table | 1a | 1a (service `insertOutcomeSafe`; Phase 4 = first real write caller) |
| `agent_runs.delegation_scope` / `hierarchy_depth` / `delegation_direction` / `handoff_source_run_id` | 1a | 3a (hierarchy_depth) / 4a (others) |
| `org.observability.view` permission | 1b | 1b (route), 4c (no — run-trace uses no per-user permission) |
| `subaccountMultipleRoots` / `subaccountNoRoot` detectors | 1c | 1c (registry) |
| Seed manifest re-parented | 2.0 | 2a (migration 0214) |
| Partial unique index + same-tx root rotation | 2a | 2a (service), 2b (resolver reads the invariant-protected roster) |
| `hierarchyRouteResolverService` | 2b | 2b (`orchestratorFromTaskJob`) |
| Scope-from-payload in `briefCreationService` / `orchestratorFromTaskJob` | 2b | 2b |
| `StartingTeamPicker` | 2c | 2c (`AdminSubaccountsPage`) |
| `HierarchyContext` type | 1a | 3a (consumer) — type is defined in Phase 1 but used starting Phase 3 |
| `hierarchyContextBuilderService` | 3a | 3a (`agentExecutionService`), 3b (list skill filter), 4a (write skills), 4b (resolver) |
| `SkillExecutionContext.hierarchy` field | 3a | 3a, 3b, 4a, 4b |
| List-skill scope param | 3b | 3b (handlers), 4a (used adaptively when agents call them) |
| Scope validation on write skills | 4a | 4a |
| Derived delegation skill resolution | 4b | 4b |
| `delegationGraphService` + route + UI | 4c | 4c |
| `explicitDelegationSkillsWithoutChildren` detector | 4d | 4d (registry) |
| `architecture.md` new section | 4d | future readers |

No edge points backward. Plan is forward-only consistent.

**Phase boundary verdicts (per spec §11 phase dependency check).**
- Phase 1 is "no behaviour change" — ✓ migrations only, no code path reads the new columns until Phase 3/4.
- Phase 2 is "routing change" — ✓ one migration (0214) + resolver wiring. No skill-execution change.
- Phase 3 is "no migrations, code-only" — ✓ pure builder + extended context + list-skill scope. No DDL.
- Phase 4 is "one migration + execution change + graph UI" — ✓ migration 0215 plus write-side enforcement + derived skills + trace graph.

---

## 10. Risks

Implementation-time risks and their mitigations. Spec §15 covers the architectural / rollout risks; this section covers the risks that bite a builder inside a chunk.

**R1. Chunk 2.0 is out-of-sync with a teammate's DB.** A teammate seeds a fresh DB between 2.0 landing and 2a running, reintroducing the dual-root. Migration 0214 fails with `23505`.
- **Mitigation.** 2a always runs `scripts/audit-subaccount-roots.ts` BEFORE applying migration 0214. If the audit fails, halt and re-run the manifest edit + re-seed. Document in the Chunk 2a PR description that anyone merging 2a must confirm their local DB is clean.

**R2. `insertOutcomeSafe` inadvertently promoted to strict behaviour.** A well-meaning refactor converts `insertOutcomeSafe`'s catch block into `throw` and the skill handler no longer swallows failures — telemetry DB hiccup becomes a user-facing delegation failure.
- **Mitigation.** JSDoc on `insertOutcomeSafe` names the swallow contract explicitly; the strict variant is named `recordOutcomeStrict` and is JSDoc-tagged "tests/backfills only, never call from skill handlers." Phase 4 pure test `skillExecutor.spawnSubAgents.test.ts` injects a failing inner call and asserts the delegation still succeeds (INV-3 regression guard).

**R3. Special-case ordering regression in `reassign_task`.** A future refactor moves the generic scope-validation check above the upward-escalation special case. Non-root agents can no longer escalate to their parent.
- **Mitigation.** Spec §15.5 flags this. Unit test `skillExecutor.reassignTask.test.ts` (Chunk 4a) specifically covers "non-root caller reassigns to parent with explicit `scope: 'children'` still succeeds" — the special case must run before generic validation for this test to pass.

**R4. `hierarchy` built twice per run by accident.** `skillService` (Chunk 4b) re-invokes `hierarchyContextBuilderService.buildForRun()` instead of reading `context.hierarchy`. Breaks INV-4 (built-once-per-run) and produces wasted DB queries.
- **Mitigation.** `skillService` imports from `shared/types/delegation.ts` only — it does NOT import `hierarchyContextBuilderService`. The code-level absence of the import is the enforcement mechanism. If the import ever lands, code review should block.

**R5. Adaptive-default silently changes Brief behaviour.** Chunk 3b ships adaptive defaults. If a system prompt was written assuming `config_list_agents` returns the whole subaccount, a manager agent now gets only its children — silent behaviour change.
- **Mitigation.** Spec §15.4 budgets this. Adaptive default only bites the Orchestrator (and post-reorg department heads). Prompt tweaks are part of Phase 3 exit criteria. The escape hatch (`scope: 'subaccount'`) is documented in the skill markdown files.

**R6. `architecture.md` long-doc guard blocks the Chunk 4d edit.** The guard triggers at 10,000 chars. Adding a full "Hierarchical Agent Delegation" section in one `Write` call fails.
- **Mitigation.** Use the chunked workflow (CLAUDE.md §Long Document Writing): skeleton first via Write, then per-section Edit appends with a `TodoWrite` task per section. The guard only fires on Write, not Edit.

**R7. Static-gate attempt counter exceeded on a typecheck failure.** CLAUDE.md caps auto-fix attempts per verification command (3 for typecheck). A broken type inference across skill handlers could blow the budget.
- **Mitigation.** Cap each chunk at one typecheck fix attempt that touches the core types (`shared/types/delegation.ts`, `SkillExecutionContext`). If a second fix attempt is needed there, stop and escalate — a type inference regression in that surface area suggests a design problem, not a typo.

**R8. RLS policy drift on `delegation_outcomes`.** A follow-up feature (e.g. a dashboard aggregator) reads `delegation_outcomes` without `orgScopedDb`. `verify-rls-contract-compliance.sh` should catch it, but the gate could be bypassed.
- **Mitigation.** Phase 1 Chunk 1a adds the manifest entry + the check runs in CI. Post-land, `delegationOutcomeService` is the ONLY read path the route uses (§7.1); future readers must go through it. Code review enforces.

**R9. Non-Brief enqueue paths surface wrong default scope.** `taskService.ts:197` enqueues without scope in Chunk 2b. If a future path legitimately needs `scope: 'org'`, the default (`'subaccount'`) silently misroutes.
- **Mitigation.** Chunk 2b documents the default behaviour in `orchestratorFromTaskJob.ts` alongside the `job.data.scope ?? 'subaccount'` line. Any new enqueue path must explicitly decide scope; the default is a compatibility shim, not a policy.

**R10. Phase 4 rollout spikes rejection rate and masks a real bug.** During the 1–2 week adjustment window, prompt drift + real code bugs both produce `delegation_out_of_scope` signals. Hard to tell them apart.
- **Mitigation.** Spec §15.1 + §17.3 frame the adjustment period. `agent_execution_events` is the lossless-log backstop (INV-3) — same rejection structured errors appear there even if `delegation_outcomes` drops. Cross-check rejection patterns between the two surfaces: systematic divergence = real bug; correlated signal = prompt drift.

---

## 11. Architecture docs update (Phase 4 exit)

Per CLAUDE.md §11 ("Docs Stay In Sync With Code"), docs update in the same session + same commit as the code change. This plan lands doc updates at two explicit gates:

**Gate 1 — Chunk 4d.** `architecture.md` gains a new top-level section "Hierarchical Agent Delegation" covering the contract surface end-to-end:
- Four invariants (INV-1 through INV-4) restated briefly with links back to this plan and to spec §4 / §6.
- Root-agent contract: partial unique index + same-tx root rotation + resolver fallback.
- Hierarchy context lifecycle: built once per run, `Readonly<>` + `Object.freeze`, never re-queried mid-run, stale-context errors fail fast.
- `DelegationScope` vocabulary + adaptive default + per-scope validation in spawn vs. reassign.
- Structured errors (codes + context shape + 4 KiB cap + array truncation at 50) and the dual-write contract (`delegation_outcomes` + `agent_execution_events`, distinct WARN tags).
- Derived delegation skills from graph position (manager emerges from having children; no role enum).
- Run-trace delegation graph (DAG, not tree) + two-parent-pointer shape + loop-safety bound.
- Composition with capability-aware routing: hierarchy enforcement narrows the admissible target set; capability routing picks the best agent within it. Orthogonal systems — this section explicitly states so to prevent future drift.

Stale prose to REMOVE or UPDATE in the same edit:
- Any reference to "Orchestrator resolved by hardcoded slug" — replace with the resolver's post-Phase-2 role (subaccount-scope via resolver; org-scope retains slug as documented in §13).
- Any reference to "flat delegation / any agent can delegate to any agent" — replace with the enforcement model (scope validation at call time).

**Gate 2 — Rolling per-phase `KNOWLEDGE.md` entries.** Per CLAUDE.md §3 "Self-Improvement Loop", each phase's exit produces at least one `KNOWLEDGE.md` entry:
- Phase 1: what surprised the builder about RLS manifest + verify-rls-coverage ordering.
- Phase 2: seed-manifest-before-migration gotchas; the resolver / job-payload split decision.
- Phase 3: `Object.freeze` gotchas across the `SkillExecutionContext` boundary; adaptive-default behaviour surprises.
- Phase 4: INV-1 runId-plumbing lessons; the graph-not-tree response shape and why it matters.

**Non-targets.** Per spec §14.5:
- `docs/capabilities.md` — no update. This spec is internal architecture, not customer-visible capability.
- `CLAUDE.md` — no update. Agent fleet unchanged.

**Plan-authored review notes.** This plan itself (`tasks/builds/paperclip-hierarchy/plan.md`) should NOT be edited after implementation begins — it is the architect's frozen plan. Any mid-build drift (new decision, unexpected blocker) gets routed per CLAUDE.md's stuck-detection protocol: blockers go to `tasks/todo.md § Blockers`; directional gaps from `spec-conformance` or `pr-reviewer` go to `tasks/todo.md § PR Review deferred items / ### paperclip-hierarchy`. Do not rewrite this plan as the build progresses — that would erase the architect's reasoning record.

---

## Self-review (against spec)

Walked the spec section by section; every spec requirement appears in a chunk:
- §4 contracts → Chunk 1a (shared types).
- §5.1 migration 0214 + §6.8 same-tx rotation → Chunk 2a.
- §5.2 migration 0215 → Chunk 4a.
- §5.3 migration 0216 → Chunk 1a.
- §5.4 migration 0217 + table + RLS → Chunk 1a.
- §6.1 `hierarchyContextBuilderService` → Chunk 3a.
- §6.2 scope on three list skills → Chunk 3b.
- §6.3 `spawn_sub_agents` validation → Chunk 4a.
- §6.4 `reassign_task` validation + upward escalation → Chunk 4a.
- §6.5 derived skill resolver → Chunk 4b.
- §6.6 `hierarchyRouteResolverService` → Chunk 2b.
- §6.7 `orchestratorFromTaskJob` + scope-from-payload + `briefCreationService` → Chunk 2b.
- §6.8 template service root rotation → Chunk 2a.
- §6.9 three detectors (two Phase 1, one Phase 4) → Chunks 1c + 4d.
- §7.1 `GET /api/org/delegation-outcomes` → Chunk 1b.
- §7.2 `GET /api/agent-runs/:id/delegation-graph` → Chunk 4c.
- §8.1 Starting Team picker → Chunk 2c.
- §8.2 Delegation graph tab → Chunk 4c.
- §8.3 Admin outcomes dashboard (optional) → Chunk 1b (optional).
- §9.2 `org.observability.view` permission → Chunk 1b.
- §9.3 run-access for graph → Chunk 4c.
- §10.3 `insertOutcomeSafe` / §10.6 runId continuity / §15.8 `insertExecutionEventSafe` → Chunks 1a (entry points) + 4a (call sites).
- §11 phase structure → this plan §3–§7.
- §12.1 static gates → every chunk's static-gates block.
- §12.2 pure unit tests → every chunk's test file entry.
- §13 deferred items → §10 risks + referenced spec §13.
- §14 file inventory → §8 cross-reference table.
- §15 risks → §10 risks.
- §16 open questions — all RESOLVED in spec, carried into specific chunks (§16.1 upward escalation → Chunk 4a; §16.2 permission → Chunk 1b; §16.3 no auto-roots → Chunk 2b resolver behaviour; §16.4 pure walk → Chunks 3a/3b; §16.5 no backfill → Chunk 1a note).
- §17 success criteria → Phase 4 exit + §11 architecture docs update.

No spec section without a chunk. No chunk without a spec anchor. Type names (`DelegationScope`, `HierarchyContext`, `DelegationOutcome`, `HierarchyContextBuildError`) are consistent across chunks; method signatures (`insertOutcomeSafe`, `insertExecutionEventSafe`, `recordOutcomeStrict`, `buildForRun`, `resolveRootForScope`, `resolveSkillsForAgent`) are named consistently.

Plan complete.
