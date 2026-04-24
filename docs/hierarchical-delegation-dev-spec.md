# Hierarchical Agent Delegation — Development Spec

**Status:** Draft — ready for `spec-reviewer`
**Branch:** `claude/paperclip-agent-hierarchy-9VJyt`
**Author:** Spec drafted from `docs/hierarchical-delegation-dev-brief.md` rev 5 (2026-04-22).
**Classification:** Major — cross-cutting concern, architectural change, new subsystem.

## Related artefacts

- **Dev brief:** `docs/hierarchical-delegation-dev-brief.md` — locked product-level framing, five revisions, three external review rounds. The spec implements the brief; it does not re-argue it.
- **Framing ground truth:** `docs/spec-context.md`.
- **Existing routing subsystem (reused, not redesigned):** `architecture.md §Orchestrator Capability-Aware Routing`.
- **Existing hierarchy schema:** `server/db/schema/agents.ts`, `server/db/schema/subaccountAgents.ts`, `server/db/schema/systemAgents.ts`. Parent pointers already exist at every tier (`parentAgentId`, `parentSubaccountAgentId`, `parentSystemAgentId`).
- **Existing hierarchy template machinery:** `server/services/hierarchyTemplateService.ts` with `apply()` + `importToSubaccount()`.

## Framing

This spec follows the conventions in `docs/spec-context.md`:

- **Testing posture:** `static_gates_primary` + `runtime_tests: pure_function_only`. No frontend, API-contract, or E2E tests for this work (§12).
- **Rollout model:** `commit_and_revert`. No staged rollout, no feature flags. Behaviour-mode toggles only for adaptive defaults (§6.2).
- **Primitive reuse:** every new primitive has a "why not reuse" justification. Extension of existing tables (`subaccount_agents`, `tasks`) is preferred over new tables; one new table (`delegation_outcomes`) is justified in §5.4.
- **Pre-production:** no live users; breaking changes to skill handler signatures are expected.

**Scope of enforcement — one-line contract.** Hierarchy enforcement is intentionally minimal: it constrains *delegation* and the derived set of delegation skills (§6.5). It does NOT constrain agent cognition, planning, or non-delegation capability selection.

---

## Table of contents

1. Overview
2. Background & current state
3. Scope & dependencies
4. Contracts
   - 4.1 `HierarchyContext` (SkillExecutionContext extension)
   - 4.2 `DelegationScope` enum
   - 4.3 Delegation skill error codes
   - 4.4 `DelegationOutcome` row shape
   - 4.5 `DelegationDirection` marker
5. Schema changes
   - 5.1 `subaccount_agents` — partial unique index for root enforcement
   - 5.2 `tasks` — `delegation_direction` column
   - 5.3 `agent_runs` — `delegation_scope` + `hierarchy_depth` + `delegation_direction` + `handoff_source_run_id` columns
   - 5.4 `delegation_outcomes` — new table
6. Services
   - 6.1 `hierarchyContextBuilderService` — new
   - 6.2 `config_list_agents` / `list_subaccounts` / `list_links` — scope param
   - 6.3 `spawn_sub_agents` — `delegationScope` validation
   - 6.4 `reassign_task` — `delegationScope` validation + direction marker
   - 6.5 Skill resolver — derive delegation skills from graph position
   - 6.6 `hierarchyRouteResolverService` — new
   - 6.7 `orchestratorFromTaskJob` — scope-aware dispatch, slug removal
   - 6.8 `hierarchyTemplateService.apply()` + `importToSubaccount()` — root rotation
   - 6.9 Workspace health detectors — three new
7. Routes
8. Client
9. Permissions / RLS
10. Execution model
11. Phased implementation
12. Testing plan
13. Deferred items
14. File inventory
15. Risks & mitigations
16. Open questions
17. Success criteria

---

## 1. Overview

This spec adds runtime enforcement to the agent hierarchy that already exists in schema. The platform already has `parentAgentId` / `parentSubaccountAgentId` / `parentSystemAgentId` columns and seed data that wires them — but at runtime, delegation is flat: any agent can delegate to any agent, the Orchestrator is resolved by a hardcoded slug, and the triage classifier's scope decision is logged then thrown away. This spec makes the hierarchy *mean* something at runtime without introducing a role system.

**What ships (nine changes, grouped into four phases):**

1. **Observability foundations (Phase 1).** A new `delegation_outcomes` table is created (write path ships Phase 4; the table ships empty). `agent_runs` gains `delegation_scope`, `hierarchy_depth`, `delegation_direction`, and `handoff_source_run_id` columns (all nullable; `hierarchy_depth` populated from Phase 3 onward; `delegation_scope` / `delegation_direction` / `handoff_source_run_id` populated from Phase 4 onward). Two health detectors register: `subaccountMultipleRoots` (critical) and `subaccountNoRoot` (severity `info` — zero roots is a valid steady state per §16.3; detector is informational, not a failure). The Run Trace delegation-graph view is a Phase 4 deliverable (§8.2) — it is not part of Phase 1.

2. **Root-agent contract (Phase 2).** Partial unique index on `subaccount_agents (subaccount_id) WHERE parent_subaccount_agent_id IS NULL AND is_active = true` — **at most one** active root per subaccount (zero is allowed until a root is configured; the resolver falls back to the org-level Orchestrator in that case per §6.6). `hierarchyTemplateService.apply()` and `importToSubaccount()` gain same-transaction root rotation so re-applies don't split-brain.

3. **Scope-aware orchestrator routing (Phase 2).** New `hierarchyRouteResolverService.resolveRootForScope(orgId, subaccountId, scope)` becomes the canonical way to find the entry-point agent. `orchestratorFromTaskJob` replaces the hardcoded `'orchestrator'` slug with this resolver; `briefCreationService` passes the triage classifier's `scope` in. Graceful degradation paths (zero-roots, multi-roots) fall back with structured logs; the Phase 1 detectors surface these invariant violations on the next scheduled Workspace Health audit sweep (§10.5 — detectors are async, run on schedule).

4. **Hierarchy context (Phase 3).** `SkillExecutionContext` gains a read-only `hierarchy: { parentId, childIds, depth, rootId }` snapshot built once per run by `hierarchyContextBuilderService`. Three existing list skills (`config_list_agents`, `config_list_subaccounts`, `config_list_links`) gain an optional `scope: 'children' | 'descendants' | 'subaccount'` parameter with adaptive default (`children` if the caller has subordinates, otherwise `subaccount`).

5. **Delegation execution enforcement (Phase 4).** `spawn_sub_agents` and `reassign_task` gain a `delegationScope` parameter with the same vocabulary. Validation runs at call time: `children` asserts `target.parentSubaccountAgentId === caller.agentId`; `descendants` asserts the target is in the caller's subtree; `subaccount` is root-agent-only. Two new structured error codes: `delegation_out_of_scope` and `cross_subtree_not_permitted`. `reassign_task` carries one narrow special case: any agent may reassign to `context.hierarchy.parentId` regardless of `delegationScope`, marked `delegationDirection: 'up'` (§6.4 "upward escalation").

6. **Derived delegation skills (Phase 4).** The skill resolver unions the agent's attached skills with a graph-derived set: when `context.hierarchy.childIds.length > 0`, add `config_list_agents` + `spawn_sub_agents` + `reassign_task` to the available tools for this run. Managers become managers by having children; workers stop being managers by losing them. Derived resolution handles the normal case; explicit attachment remains a narrow escape hatch (see §6.5) and is never removed by the resolver, only added to. No role enum.

7. **Partial slug removal (Phase 2).** `const ORCHESTRATOR_AGENT_SLUG = 'orchestrator'` in `server/jobs/orchestratorFromTaskJob.ts:21` is **no longer used for subaccount-scope routing**; the resolver replaces it for that path. Org-scope (`scope === 'org'`) still uses the hardcoded Orchestrator system agent per §6.6 / §13 — the slug reference stays present for that narrow fallback path until a second org-level root candidate is introduced (deferred, §13). Full slug deletion is NOT in this spec.

8. **Subaccount template picker UX (Phase 2).** The subaccount creation form gains a "Starting team" dropdown that lists available hierarchy templates and calls `POST /api/hierarchy-templates/:id/apply` on submit. Backend verb already exists.

9. **Run trace delegation graph (Phase 4).** `RunTraceViewerPage` gains a DAG view over `agent_runs.parentRunId` / `isSubAgent` / `handoffDepth` (existing) + `agent_runs.handoff_source_run_id` + `delegation_scope` + `delegation_direction` + `hierarchy_depth` (new in Phase 1 migration 0216, populated from Phase 4).

**What this spec does NOT cover.** Reorganising the seeded 16-agent Automation OS company into a multi-tier org chart (separate track). Mesh / dynamic-team / task-based-grouping delegation patterns (out of scope per §3.2). Cost rollups per subtree or performance-attribution per manager (future capability surface — the hierarchy primitives this spec ships are designed to support those later without redesign). Changes to the Universal Brief UX itself — GlobalAskBar, conversations table, triage classifier, artefact contracts stay as they are; we augment how they route, not redesign the surface.

**Classification.** Major per `CLAUDE.md`. Phased over ~4–6 weeks multi-session. Implementation starts after the Universal Brief work on main stabilises.

---

## 2. Background & current state

### 2.1 What exists today

**Hierarchy schema at every tier.**
- `systemAgents.parentSystemAgentId` uuid (`server/db/schema/systemAgents.ts:18`).
- `agents.parentAgentId` uuid (`server/db/schema/agents.ts:28`).
- `subaccountAgents.parentSubaccountAgentId` uuid (`server/db/schema/subaccountAgents.ts:22`).
- Shared `validateHierarchy()` in `server/services/hierarchyService.ts` enforces `MAX_DEPTH = 10` and cycle detection at write time.
- `buildTree()` helper in the same service composes nested trees for template-preview rendering. No runtime consumer uses it for delegation.

**Seeded company with flat hierarchy (current manifest).** `companies/automation-os/automation-os-manifest.json` now defines 16 agents with TWO `reportsTo: null` agents: the Orchestrator (historical root) and the `portfolio-health-agent` (added recently). The other 14 agents have `reportsTo: orchestrator`. There is no middle-management tier in the seeded data; the flat-with-two-roots shape is a transitional artefact of adding the portfolio-health agent before this spec's root-agent-contract ships — once Phase 2 lands, the seed reorg track (§3.2 out-of-scope) needs to decide which agent is the canonical root and whether `portfolio-health-agent` reparents under the Orchestrator or shifts to a separate subaccount. `scripts/seed.ts` resolves `reportsTo` strings into FK IDs at seed time — the seed script already handles arbitrary-depth trees; the flatness is a data choice, not a limitation.

**Implication for the partial unique index (§5.1).** The seeded company runs on the org sentinel subaccount; the two `reportsTo: null` agents both land on that single subaccount during seed. This trips the at-most-one-active-root partial unique index in Phase 2 migration 0214. The audit script (§5.1 pre-migration audit, `scripts/audit-subaccount-roots.ts`) must call this out, and the seed-reorg track must resolve one of the two to non-root before migration 0214 applies. §13 pull-forward: "seeded company cleanup before Phase 2 migration" is now a concrete gate.

**Delegation primitives (flat).**
- `spawn_sub_agents` (`server/services/skillExecutor.ts:3410`+) — creates 2–3 sub-tasks and dispatches them in parallel. Validates `requireSubaccountContext()` and agent existence; does NOT filter targets by `parentSubaccountAgentId`. Hard-blocks nesting ("sub-agents cannot spawn sub-agents") at line ~3415.
- `reassign_task` (`server/services/skillExecutor.ts:3330`+) — hands off a task to another agent. Validates org membership via `taskService.updateTask`; does NOT filter by hierarchy. Global handoff-depth cap of `MAX_HANDOFF_DEPTH = 5` (`server/config/limits.ts`) tracked on the task, not per-level.
- `config_list_agents` (`server/tools/config/configSkillHandlers.ts:491`+) — returns every active agent in the org. No `parentAgentId` filter.

**Orchestrator routing.** `server/jobs/orchestratorFromTaskJob.ts` is the Orchestrator's entry point. It's invoked by the `org_task_created` trigger when an eligible task is created (inbox status, unassigned, not sub-task, not agent-created, description ≥10 chars — see `isEligibleForOrchestratorRouting` at line ~59). The dispatch flow:

1. Load the system agent with `slug = 'orchestrator'` (hardcoded at line 21: `const ORCHESTRATOR_AGENT_SLUG = 'orchestrator'`).
2. Resolve the Orchestrator's subaccount-agent link — prefer the task's own subaccount, else fall back to any active link for the org, ordered by `(createdAt, id)` for deterministic selection.
3. Enqueue the run into the agent execution queue.

**Triage classifier produces `scope` that routing ignores.** `server/services/chatTriageClassifierPure.ts` + `chatTriageClassifier.ts` produce a `FastPathDecision` with `route` (`simple_reply` / `cheap_answer` / `needs_clarification` / `needs_orchestrator`) and `scope` (`subaccount` / `org` / `system`). `briefCreationService.ts` logs both to `fast_path_decisions.decidedRoute` / `decidedScope` for shadow-eval, then calls `enqueueOrchestratorRoutingIfEligible` with no scope awareness. `scope` reaches the dispatcher as dead data.

**Hierarchy templates.** `server/services/hierarchyTemplateService.ts` exposes `apply(templateId, organisationId, { subaccountId, mode, preview })` at line ~607 and `importToSubaccount(organisationId, { subaccountId, name, manifest, saveAsTemplate })` at line ~647. Endpoints: `POST /api/hierarchy-templates/:id/apply` and `POST /api/subaccounts/:subaccountId/agents/import`. Both create per-subaccount agent links from a manifest, wire up `parentSubaccountAgentId`, and respect `MAX_DEPTH`. No subaccount-creation UX currently lists templates.

**`SkillExecutionContext`.** Defined at `server/services/skillExecutor.ts:119`. Carries `runId`, `organisationId`, `subaccountId`, `agentId`, `allowedSubaccountIds`, `userId`, `handoffDepth`, `isSubAgent`, plus MCP / cost / budget fields. No `hierarchy` field. No `parentAgentId`.

**Workspace Health Audit subsystem.** `server/services/workspaceHealth/` with `detectors/index.ts` as a plug-and-play registry. Each detector exports `{ name, severity, detect(orgId, db) }`. Existing detectors: `agentNoRecentRuns`, `processBrokenConnectionMapping`, `processNoEngine`, `subaccountAgentNoSchedule`, `subaccountAgentNoSkills`, `systemAgentLinkNeverSynced`. Three new detectors in this spec (§6.9) slot into this registry.

**Run trace.** `agent_runs` already carries `parentRunId`, `isSubAgent`, `parentSpawnRunId`, `handoffDepth` (integer, default 0). The handoff source run id currently lives on `tasks.handoff_source_run_id`, NOT on `agent_runs`. This spec adds `agent_runs.handoff_source_run_id` in migration 0216 (§5.3) so the delegation graph can be built from `agent_runs` alone. `client/src/pages/RunTraceViewerPage.tsx` renders single-run detail. No cross-run tree view yet.

### 2.2 What does NOT exist

- **No hierarchy-aware delegation.** `spawn_sub_agents` and `reassign_task` ignore `parentSubaccountAgentId`.
- **No hierarchy context in skills.** `SkillExecutionContext` has no `hierarchy` / `parentAgentId` / `childIds`.
- **No scope parameter on list skills.** `config_list_agents` is org-wide only.
- **No root-agent invariant.** Zero or multiple active roots per subaccount is allowed.
- **No scope-aware orchestrator routing.** Triage classifier's `scope` reaches the dispatcher unused.
- **No delegation outcome record.** Every delegation is invisible to post-hoc analysis.
- **No delegation graph UI.** Cross-run fan-out is reconstructable from DB but not rendered.
- **No template picker in subaccount creation.** Users must create subaccounts, then separately run template apply.
- **No hardcoded-slug alternative.** Removing the slug requires the resolver first.

### 2.3 Why now

The gating prerequisites are in place:

1. **Universal Brief is live** (PR #176). GlobalAskBar routes every Brief to the Orchestrator; the triage classifier produces `scope`. The infrastructure exists, we just don't route on scope.
2. **Hierarchy templates work end-to-end** (`apply()` + `importToSubaccount()` shipped). The backend verbs for per-subaccount team installs are already there — only the UX layer is missing.
3. **Observability primitives exist.** `agent_runs` carries the fields needed for the trace graph; Workspace Health Audit has a plug-and-play detector framework; `fast_path_decisions` demonstrates the outcome-logging pattern.

Without these, this spec would have had to build its own scope / template / observability foundations. With them, every recommendation is an extension of an existing primitive, not a new subsystem.

## 3. Scope & dependencies

### 3.1 In scope (this spec)

**Schema (§5):**
- `subaccount_agents` — partial unique index for root-agent contract (migration 0214).
- `tasks` — new `delegation_direction` text column (migration 0215).
- `agent_runs` — new `delegation_scope` text column, `hierarchy_depth` smallint column, `delegation_direction` text column, and `handoff_source_run_id` uuid column (migration 0216).
- `delegation_outcomes` — new table with RLS policy + `rlsProtectedTables` manifest entry (migration 0217).

**Services (§6):**
- `hierarchyContextBuilderService` — new pure + impure service for building `context.hierarchy` snapshots.
- `hierarchyRouteResolverService` — new service: `resolveRootForScope(orgId, subaccountId, scope) → agentId`.
- Extensions to: `config_list_agents`, `config_list_subaccounts`, `config_list_links` (scope param + adaptive default); `spawn_sub_agents` and `reassign_task` (`delegationScope` param + validation + outcome logging); `orchestratorFromTaskJob` (scope-aware dispatch, slug removal); `briefCreationService` (pass `scope` into dispatch); `hierarchyTemplateService.apply()` + `importToSubaccount()` (same-transaction root rotation); skill resolver in `skillService` (derive delegation skills from `hierarchy.childIds`).
- Three new Workspace Health detectors (phase-staggered per §6.9): `subaccountMultipleRoots` (Phase 1), `subaccountNoRoot` (Phase 1), `explicitDelegationSkillsWithoutChildren` (Phase 4).

**Routes (§7):**
- `GET /api/org/delegation-outcomes` — list outcomes with filters (admin only).
- `GET /api/agent-runs/:id/delegation-graph` — returns the run's fan-out DAG for the trace-graph UI.

**Client (§8):**
- `AdminSubaccountsPage` — new "Starting team" dropdown, calls `apply` after create. (The Layout quick-create flow is untouched in v1.)
- `RunTraceViewerPage` — new delegation-graph tab.
- `AdminDelegationOutcomesPage` (optional v1 — see §13 Deferred items) — admin dashboard for outcome metrics.

### 3.2 Out of scope

- **Restructuring the seeded 16-agent Automation OS company.** Design on separate track. This spec assumes a tree exists somewhere; the seeded flat company is a data state, not a limitation to solve here.
- **Mesh / dynamic-team / task-based-grouping delegation.** v1 is tree-with-escape-hatches. The enforcement model is designed so these patterns relax in later (a `delegationScope: 'pair'` or task-scoped-membership primitive does not require this spec's work to be redesigned).
- **Cost rollups per subtree, performance attribution per manager, delegation learning, automated restructuring.** Future capability surface enabled by these primitives. Not built here.
- **Changes to the Universal Brief UX.** GlobalAskBar, conversations, artefact contracts untouched; we change *how* the Orchestrator is resolved, not how Briefs are submitted.
- **RLS-layer delegation enforcement.** Deferred — RLS governs data access, not workflow authorisation. If sustained application-layer bypass emerges, revisit.
- **Role enum / authority enum on agents.** Rejected in brief §10 — role is emergent from graph position.
- **Per-subaccount-agent `delegation_authority` override column.** Rejected (same reason).
- **Changes to heartbeat scheduling for manager agents.** Brief §9 resolved as "managers run on-demand"; this is a data / prompt decision at company-seed time, not a code change.
- **Changes to the capability-aware routing system.** Path A/B/C/D stays as-is. Hierarchy enforcement composes with it — §4.1 clarifies the boundary.

### 3.3 Cross-branch dependencies

No code dependencies outside `main`. All prerequisite primitives (hierarchy schema, Universal Brief, triage classifier, hierarchy templates, run-trace fields, Workspace Health framework, `rlsProtectedTables` manifest) are on main as of 2026-04-22.

**One non-code prerequisite, BLOCKING for Phase 2:** the seeded Automation OS company currently has two `reportsTo: null` agents (§2.1 current state). Migration 0214's partial unique index will fail until the dual-root is resolved (re-seed with `portfolio-health-agent` reparented, moved to a separate subaccount, or marked inactive). This is a manifest edit + re-seed, not a code change — flagged in §13 as a Phase 2 gate.

### 3.4 Primitive reuse decisions

Every new primitive has a justification for not-reusing:

| Proposed primitive | Reused? | Rationale |
|---|---|---|
| `HierarchyContext` object on `SkillExecutionContext` | **Extend** existing `SkillExecutionContext` | Brief §5.1: scalar `parentAgentId` is too thin for skill logic (skills need children + depth + root). A new field on the existing struct is cheaper than a parallel context object. |
| `hierarchyContextBuilderService` | **New** | No existing builder composes parent + children + depth + root for a single agent. The shape is too specific to fit into `hierarchyService.ts` (which handles validation, not context construction). Pure shape-derivation logic lives in `*Pure.ts` per convention. |
| `hierarchyRouteResolverService.resolveRootForScope()` | **New** | The closest existing logic is the hardcoded-slug lookup in `orchestratorFromTaskJob.ts:21`. For subaccount scope, the resolver replaces it; for org scope the slug is retained (§6.6 case 2, §13 deferred). Single caller: `orchestratorFromTaskJob` (§6.7). `briefCreationService` does not call the resolver directly; it passes `fastPathDecision.scope` into the pg-boss job payload via `enqueueOrchestratorRoutingIfEligible(task, { scope })`, and the job reads `job.data.scope` and performs the resolution. No task-column change — no `tasks.triggerContext`. |
| `delegation_outcomes` table | **New** | Closest existing table is `routing_outcomes` (capability-routing observability, `architecture.md §Orchestrator Capability-Aware Routing`). Considered extending with a new `outcome_type` variant — rejected because the two have disjoint column sets (`required_capabilities` / `candidate_agents` for routing vs `caller_agent_id` / `target_agent_id` / `delegation_scope` for delegation) and conflating them creates a wide, sparse table. The two tables sit side-by-side under the same manifest. |
| `DelegationScope` TypeScript enum | **New** | No existing enum has this shape. Defined in `shared/types/delegation.ts` (new file). |
| `DelegationDirection` marker on `tasks` | **Extend** existing `tasks` table | `tasks` already has `handoffDepth`, `handoffSourceRunId`, `reviewRequired`. Adding a nullable text column `delegation_direction` is consistent with how the table records handoff metadata. |
| Three workspace health detectors | **Extend** existing Workspace Health framework | `server/services/workspaceHealth/detectors/` is a plug-and-play registry; each new detector is a ~30-line file. No new primitive. |
| Run trace graph UI | **Extend** `RunTraceViewerPage` | Data exists in `agent_runs` (`parentRunId`, `isSubAgent`, `parentSpawnRunId`, `handoffSourceRunId`). This is a rendering layer, not new persistence. |
| Subaccount template picker | **Extend** subaccount creation form + call existing `POST /api/hierarchy-templates/:id/apply` | Backend verb already ships. |

**What did NOT get invented.** No new skill system, no new context propagation mechanism, no new retry / backoff / cost-breaker primitive, no new RLS layer, no new jobs queue. Everything either extends an existing primitive or is a thin new service that replaces a hardcoded string.

---

## 4. Contracts

All contracts live in `shared/types/delegation.ts` (new file) unless otherwise noted. TypeScript-first; Drizzle schemas in §5 import from here.

### 4.1 `HierarchyContext` — `SkillExecutionContext` extension

**Name:** `HierarchyContext`
**Type:** TypeScript interface, embedded as an optional field on `SkillExecutionContext` (`server/services/skillExecutor.ts:119`).
**Shape:**

```ts
export interface HierarchyContext {
  /** The caller's parent agent id. Null iff the caller IS the subaccount root (the active row with `parent_subaccount_agent_id IS NULL` per §5.1 schema predicate). */
  parentId: string | null;
  /** Direct reports only. Empty array for leaf agents. Ordered by id asc for determinism. */
  childIds: string[];
  /** 0 at the root, incremented per level walking down. Bounded by MAX_DEPTH = 10. */
  depth: number;
  /** The subaccount root's agent id. Equals `agentId` when the caller IS the root. Always populated for an executing agent (the builder throws if the caller's subaccount has no root — §6.1 `HierarchyContextBuildError`). */
  rootId: string;
}
```

**Example instance (middle manager with two children, one level below root):**

```json
{
  "parentId": "agt_orch_abc",
  "childIds": ["agt_dev_1", "agt_qa_2"],
  "depth": 1,
  "rootId": "agt_orch_abc"
}
```

**Example instance (subaccount root — the common "everyone routes through me" case):**

```json
{
  "parentId": null,
  "childIds": ["agt_dev_1", "agt_qa_2", "agt_sales_1"],
  "depth": 0,
  "rootId": "agt_orch_root"
}
```

Note: `parentId === null` means "this agent IS the subaccount root" — by the §5.1 schema predicate, any active `subaccount_agents` row with `parent_subaccount_agent_id IS NULL` is a root. There is no other semantic. The `rootId` field is therefore always populated for any executing agent (it equals this agent's id when the caller is the root).

**Nullability and defaults:**
- `parentId` is `null` iff the caller IS the subaccount root (per §5.1's partial unique index: `parent_subaccount_agent_id IS NULL AND is_active = true`). Any active executing agent with `parentId === null` is therefore the configured root of its subaccount. There is no "rootless" state for a running agent — the builder never successfully constructs a context with no root.
- `childIds` is always an array (empty for leaves, never null). Sorted by `id` ascending for determinism — the pure builder does this in a stable sort so two invocations over the same roster produce identical output.
- `depth` is always present and non-negative. `0` for root callers.
- `rootId` is always populated for an executing agent. It equals the id of the subaccount's active root (equals `context.agentId` when the caller IS the root). If the builder can't find a root during the upward walk (the agent's ancestor chain terminates at a row that is not `parent_subaccount_agent_id IS NULL`), it throws `HierarchyContextBuildError('agent_not_in_subaccount')` per §6.1.
- **About "root-less subaccounts" in earlier prose:** when §6.6 refers to a subaccount having no root, that means no subaccount-level root; the Brief dispatches to the ORG-level Orchestrator instead. The org Orchestrator runs inside ITS own subaccount (the org sentinel), which does have a root — itself. So the executing agent always sees a well-formed `HierarchyContext` with a non-null `rootId`.
- The entire `hierarchy` field on `SkillExecutionContext` is optional (`hierarchy?: HierarchyContext`). Skills that don't need it don't pay for it. Missing-hierarchy handling differs by skill type:
  - **Write-side delegation skills** (`spawn_sub_agents`, `reassign_task` — §6.3, §6.4) MUST fail closed with `hierarchy_context_missing` (§4.3) if invoked without `context.hierarchy`. They cannot validate scope without it, and silent fallthrough would be a correctness hole.
  - **Read-side list skills** (`config_list_agents`, `config_list_subaccounts`, `config_list_links` — §6.2) fall through to the subaccount-wide result with a WARN-level telemetry log. Read skills are not correctness-critical; falling through preserves behaviour for diagnostic / system runs where hierarchy wasn't built.

**Producer:** `hierarchyContextBuilderService.buildForRun()` (§6.1), called by `agentExecutionService` when it constructs the `SkillExecutionContext` for a run.
**Consumers:** `config_list_agents`, `config_list_subaccounts`, `config_list_links` (§6.2); `spawn_sub_agents` (§6.3); `reassign_task` (§6.4); skill resolver (§6.5). The resolver reads `hierarchy.childIds.length` to decide whether to union in the delegation skill set.

**Immutability contract.** `hierarchy` is a read-only per-run snapshot. Skill handlers MUST NOT mutate any field, MUST NOT re-query the graph mid-run, MUST NOT reinterpret it. If the graph changes during a run, changes take effect from the next run of that agent. TypeScript-level: type is `Readonly<HierarchyContext>`; runtime enforcement via `Object.freeze()` in the builder (§6.1).

### 4.2 `DelegationScope` enum

**Name:** `DelegationScope`
**Type:** TypeScript string-literal union + Zod enum for runtime validation.
**Shape:**

```ts
export const DELEGATION_SCOPE_VALUES = ['children', 'descendants', 'subaccount'] as const;
export type DelegationScope = typeof DELEGATION_SCOPE_VALUES[number];

export const DelegationScopeSchema = z.enum(DELEGATION_SCOPE_VALUES);
```

**Semantics (shared across §6.2 visibility and §6.3 / §6.4 execution layers):**

| Value | Visibility layer — `config_list_agents` (§6.2) | `reassign_task` (§6.4) | `spawn_sub_agents` (§6.3) |
|---|---|---|---|
| `children` | Return agents where `parentSubaccountAgentId === caller.agentId`. | Assert `target.parentSubaccountAgentId === caller.agentId`; reject with `delegation_out_of_scope` if not. | Same as reassign. |
| `descendants` | Return every agent in the caller's subtree (walk downward, bounded by `MAX_DEPTH`). | Assert the target is in the caller's subtree (upward walk from target → caller); reject with `delegation_out_of_scope` if not. | Same as reassign. |
| `subaccount` | Return every active agent in the subaccount (current flat behaviour). | Accept any target in the subaccount. Only callable when `caller.hierarchy.rootId === caller.agentId && caller.hierarchy.rootId !== null` (caller IS the configured subaccount root); reject with `cross_subtree_not_permitted` otherwise. | **Always rejected for `spawn_sub_agents`** regardless of caller role. Spawn is descent-only; roots crossing subtrees use `reassign_task`. Rejected with `cross_subtree_not_permitted`. |

**Note on `config_list_subaccounts` / `config_list_links`:** per §6.2, the `scope` vocabulary is accepted for signature consistency but has no filter effect on these container-level list skills.

**Adaptive default.** When the caller does not pass a `scope` / `delegationScope`:
- If `context.hierarchy.childIds.length > 0` → default is `children`.
- Otherwise (leaf agents, includes root if root has no children yet) → default is `subaccount`.

Computed once per call, inside the skill handler, before validation. The adaptive default is a *default* — callers can always override with an explicit value, subject to the same validation rules.

**Producer:** Skill handler call-site (explicit or adaptive).
**Consumer:** Validation in `spawn_sub_agents` / `reassign_task` (§6.3 / §6.4); filter in the three list skills (§6.2).

### 4.3 Delegation skill error codes

Structured errors returned by `spawn_sub_agents` and `reassign_task` when validation fails. Shape follows the existing structured-error convention used elsewhere in `skillExecutor.ts` — `{ success: false, error: { code, message, context } }`.

**Uniform contract (applies to every error code in this section).**
- `code` is one of the string literals enumerated below. The enum is closed for v1 — adding a new code requires a spec update.
- `message` is human-readable, intended for the agent's prompt context. It may include runtime identifiers but MUST NOT include values that can drift between spec revisions (e.g. do not embed schema version numbers in the message).
- `context` is an object with a stable minimum shape: it MUST include `runId` (the `SkillExecutionContext.runId` the skill was called with) and `callerAgentId` (the `SkillExecutionContext.agentId`). Additional per-code fields listed in each example below are also required when the relevant identifier is resolvable at validation time (e.g. `targetAgentId` for `delegation_out_of_scope`). Extra diagnostic fields MAY be added by the skill handler without a spec update, but MUST be additive — never rename or remove a field that has already shipped. This is the stability contract the Brief prompt scaffolding and `agent_execution_events` consumers rely on.
- `context` size bound: the serialised `context` object MUST NOT exceed 4 KiB. Array-valued diagnostic fields (e.g. `callerChildIds`) are truncated to the first 50 elements with a `truncated: true` sibling flag when the full list would breach the cap. This bound keeps the payload agent-prompt-friendly (fits in a single tool-result message without blowing the context window) and prevents a misbehaving caller with thousands of children from producing multi-megabyte error rows in `agent_execution_events`.
- Every error emitted by these skills is also written to `agent_execution_events` with the same `{ code, context }` payload so the Live Execution Log stays lossless even when `delegation_outcomes` writes are dropped (§10.3). The event-log write is itself best-effort — failure-mode contract in §15.8.

**`delegation_out_of_scope`** — target is not within the resolved scope for this call.

```json
{
  "success": false,
  "error": {
    "code": "delegation_out_of_scope",
    "message": "Target agent agt_marketing_x is not a direct report of caller agt_sales_mgr under scope 'children'.",
    "context": {
      "runId": "run_abc",
      "callerAgentId": "agt_sales_mgr",
      "targetAgentId": "agt_marketing_x",
      "delegationScope": "children",
      "callerChildIds": ["agt_sdr_1", "agt_sdr_2", "agt_sdr_3"]
    }
  }
}
```

**`cross_subtree_not_permitted`** — caller attempted `delegationScope: 'subaccount'` but is not the subaccount root.

```json
{
  "success": false,
  "error": {
    "code": "cross_subtree_not_permitted",
    "message": "Only the subaccount root can use delegationScope='subaccount'. Caller agt_sales_mgr has parentId=agt_orch_abc.",
    "context": {
      "runId": "run_abc",
      "callerAgentId": "agt_sales_mgr",
      "callerParentId": "agt_orch_abc",
      "suggestedScope": "descendants"
    }
  }
}
```

**`hierarchy_context_missing`** — emitted ONLY by the write-side delegation skills (`spawn_sub_agents`, `reassign_task`) when they are invoked without `context.hierarchy`. Read-side list skills fall through to subaccount-wide results (§4.1, §6.2) rather than failing closed. This error represents a construction-path bug in `agentExecutionService` — it should never fire in practice; fail-closed safety net for write skills where missing hierarchy means scope cannot be validated.

```json
{
  "success": false,
  "error": {
    "code": "hierarchy_context_missing",
    "message": "Skill spawn_sub_agents requires context.hierarchy to validate delegation scope but it was not provided. This is a bug in context construction.",
    "context": { "runId": "run_abc", "callerAgentId": "agt_sales_mgr", "skillSlug": "spawn_sub_agents" }
  }
}
```

**Producer:** Skill handlers in `skillExecutor.ts`.
**Consumer:** Caller's prompt (agent sees the error and adjusts). Also written to `agent_execution_events` per existing conventions so the error appears in the Live Execution Log.

**Side-effect on rejection.** Scope-validation rejections with resolvable actors (both caller and target are valid `subaccount_agents` FKs) write one row to `delegation_outcomes` (§4.4) with `outcome = 'rejected'` and `reason = error.code`. Rejections where the target cannot be resolved at all (e.g. target agent id doesn't exist — a different error class from `delegation_out_of_scope`) are NOT written to `delegation_outcomes` because the FK would fail; they're visible only in `agent_execution_events` (the agent's execution log). Successful delegations write `outcome = 'accepted'`. This is the primary source of scope-validation telemetry (writes are best-effort per §10.3; under sustained DB pressure a small fraction of rows may be missed — acceptable for metrics, not accounting). Unresolvable-target errors + DB-write-failure gaps mean the table is not a complete audit record — pair with `agent_execution_events` for that.

### 4.4 `DelegationOutcome` row shape

**Name:** `delegation_outcomes` (Drizzle table)
**Type:** Postgres table with RLS, tenant-scoped (organisation_id + subaccount_id). Schema in §5.4.
**Shape (as TypeScript interface):**

```ts
export interface DelegationOutcome {
  id: string;                      // uuid
  organisationId: string;          // RLS scope
  subaccountId: string;            // RLS scope; NOT NULL — both actor FKs point at subaccount_agents so a subaccount is always derivable
  runId: string;                   // the run that invoked the skill
  callerAgentId: string;           // the delegating agent (FK subaccount_agents.id)
  targetAgentId: string;           // the proposed delegate (FK subaccount_agents.id)
  delegationScope: DelegationScope;
  outcome: 'accepted' | 'rejected';
  reason: string | null;           // null when accepted; error code when rejected
  delegationDirection: 'down' | 'up' | 'lateral';
  createdAt: Date;
}
```

**Example instance (rejected, out-of-scope):**

```json
{
  "id": "delout_xyz",
  "organisationId": "org_abc",
  "subaccountId": "sub_acme",
  "runId": "run_123",
  "callerAgentId": "agt_sales_mgr",
  "targetAgentId": "agt_marketing_x",
  "delegationScope": "children",
  "outcome": "rejected",
  "reason": "delegation_out_of_scope",
  "delegationDirection": "lateral",
  "createdAt": "2026-04-25T10:42:00Z"
}
```

**Nullability and defaults:**
- `subaccountId` NOT NULL — the subaccount is derived at write time from `context.subaccountId` (the dispatching skill's run). The schema itself does not cross-check that `callerAgentId` and `targetAgentId` actually belong to `subaccountId`; that integrity is enforced in the SERVICE LAYER by `delegationOutcomeService.insertOutcomeSafe()` (§10.3), which (a) reads both actor rows inside the same org-scoped query, (b) asserts their `subaccount_id` matches the outcome's `subaccountId`, (c) refuses the insert otherwise and logs WARN. A composite FK/CHECK at the DB layer would require cross-table integrity that Postgres does not support cleanly; the service-layer check is the pragmatic equivalent.
- `organisationId` always set and similarly cross-checked at service layer.
- `reason` null iff `outcome = 'accepted'`. Zod check enforces this at write time (mirrors the DB CHECK constraint so callers don't surface Postgres errors).
- `delegationDirection` always set — computed by the skill handler from `caller.hierarchy` + target position. **Spawn direction is always `'down'` by construction** (§6.3: spawn rejects `subaccount` scope; the only accepted targets are descendants of the caller). Reassign direction is one of:
  - `down` — target is a descendant of caller (including direct child).
  - `up` — target is an ancestor of caller (typically the caller's parent; only reachable by `reassign_task`'s upward-escalation special case in §6.4 step 2, or by a root using `subaccount` scope to reassign to its own ancestor path — which is empty because roots have no ancestor; effectively only the step-2 special case produces `up`).
  - `lateral` — target is neither (escape hatch path; root-only — only possible when `effectiveScope === 'subaccount'` in `reassign_task` and caller is the subaccount root).

**Producer:** `spawn_sub_agents` and `reassign_task` after validation decides accept/reject. Write is best-effort and non-blocking — a write failure logs at WARN and does not fail the skill call. The outcome table is the primary telemetry source for delegation behaviour; under DB-hiccup conditions a small fraction of writes may be missed. Metrics reading this table (§17) should be treated as best-effort signal, not accounting-grade audit data.
**Consumers:**
- Health detectors (§6.9) — `subaccountNoRoot` / `subaccountMultipleRoots` do not read this table; `explicitDelegationSkillsWithoutChildren` doesn't either — those detectors query the schema directly. But future detectors (e.g. "agent with sustained rejection rate") will read this table.
- Admin UI (§7, §8.3) — `GET /api/org/delegation-outcomes` dashboards.

### 4.5 `DelegationDirection` marker on `tasks`

**Name:** `tasks.delegation_direction` (new nullable text column).
**Type:** Postgres `text`, Zod enum at service layer.
**Allowed values:** `'down' | 'up' | 'lateral' | null` (null for pre-Phase-4 rows and for tasks created outside a delegation path).

**Shape:** Single enum value. Written by `reassign_task` at the moment of reassignment, reflecting the relationship between the new `assignedAgentId` and the caller that invoked the skill.

**Example (an upward reassignment, worker → parent):**

```json
{
  "id": "task_abc",
  "assignedAgentId": "agt_sales_mgr",
  "handoffDepth": 2,
  "handoffSourceRunId": "run_xyz",
  "delegationDirection": "up"
}
```

**Nullability and defaults:** Nullable. Old rows have null; new rows written by `reassign_task` always have a non-null value. Not backfilled.

**Producer:** `reassign_task` (§6.4). `spawn_sub_agents` does not write to this column because sub-agent sub-tasks are always `down` by construction.
**Consumers:**
- Run trace graph UI (§8.2) — colour-codes edges by direction.
- Admin dashboard (§7).
- Metric queries: `SELECT count(*) FROM tasks WHERE delegation_direction = 'up' GROUP BY ...` to validate the brief's "upward hops should be rare" assumption (§17 success criteria).

---

## 5. Schema changes

Four migrations total. Numbering assumes 0201 is the latest on main at spec merge; if later migrations land first, renumber in-order without gaps.

### 5.1 `subaccount_agents` — partial unique index for root enforcement

**Migration:** `0214_subaccount_agents_root_unique.sql` (Phase 2).

**Invariant enforced:** **at most one** active root per subaccount. Zero active roots is a valid state (unconfigured subaccount; resolver falls back to the org-level Orchestrator per §6.6). The partial unique index enforces the at-most-one bound; presence is not required.

**Change:** Add a partial unique index enforcing at most one active root per subaccount.

```sql
CREATE UNIQUE INDEX subaccount_agents_one_root_per_subaccount
  ON subaccount_agents (subaccount_id)
  WHERE parent_subaccount_agent_id IS NULL
    AND is_active = true;
```

**Drizzle reflection:** Add to `server/db/schema/subaccountAgents.ts` as a table-level `uniqueIndex().on(subaccountId).where(sql\`parent_subaccount_agent_id IS NULL AND is_active = true\`)`.

**Pre-migration audit.** The migration script itself does not back-fill or auto-resolve violations. Before applying the migration, run `scripts/audit-subaccount-roots.ts` (new, §6, Phase 2 kickoff) to list any subaccount with zero or multiple active roots. Expected result based on current data: most subaccounts have zero subaccount-level roots because the Orchestrator currently lives on the org sentinel subaccount only (see `architecture.md §Orchestrator link resolution`). The audit output is an operator checklist — each row needs manual resolution (assign a root or document why one isn't needed) before migration proceeds.

**If the migration fails to apply** (a duplicate-active-root violation exists): the failure is loud (Postgres `23505`), logged, and does not silently drop rows. Operator re-runs the audit, resolves, retries.

**RLS:** No change. `subaccount_agents` is already in `rlsProtectedTables.ts`.

**Backward compatibility:** A subaccount with zero active roots (expected for most today) does not violate the index — the index is a partial uniqueness constraint, not a presence requirement. Zero-roots is handled at runtime by the resolver's fallback (§6.6).

### 5.2 `tasks` — `delegation_direction` column

**Migration:** `0215_tasks_delegation_direction.sql` (Phase 4).

**Change:**

```sql
ALTER TABLE tasks
  ADD COLUMN delegation_direction text;

-- No backfill; existing rows stay NULL. New writes by reassign_task always populate.
-- Optional CHECK constraint to enforce allowed values:
ALTER TABLE tasks
  ADD CONSTRAINT tasks_delegation_direction_chk
  CHECK (delegation_direction IS NULL OR delegation_direction IN ('down', 'up', 'lateral'));
```

**Drizzle reflection:** Add `delegationDirection: text('delegation_direction')` to `server/db/schema/tasks.ts`. Zod enum validation at the service layer (`reassign_task` handler, §6.4).

**RLS:** Inherited from `tasks` — already org-scoped. No manifest change.

**Why nullable, not default.** Old rows (pre-migration) have no delegation context to infer a direction from. Defaulting them to `'down'` would be misleading; null is honest. New writes always set a value.

### 5.3 `agent_runs` — `delegation_scope` + `hierarchy_depth` + `delegation_direction` + `handoff_source_run_id` columns

**Migration:** `0216_agent_runs_delegation_telemetry.sql` (Phase 1 — all columns ship nullable; populators land in later phases).

**Context (repo-state fact).** `agent_runs` today has `parentRunId`, `parentSpawnRunId`, `isSubAgent`, `handoffDepth` — but NOT `handoffSourceRunId`. The handoff source run ID lives on `tasks.handoff_source_run_id` (via `handoffJson`) in the current schema. Because the delegation graph (§7.2) is a per-run view keyed on `agent_runs`, the spec adds `handoff_source_run_id` to `agent_runs` directly — single-table lookup, no join to `tasks` for graph construction.

**Change:**

```sql
ALTER TABLE agent_runs
  ADD COLUMN delegation_scope text,
  ADD COLUMN hierarchy_depth smallint,
  ADD COLUMN delegation_direction text,
  ADD COLUMN handoff_source_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_delegation_scope_chk
  CHECK (delegation_scope IS NULL OR delegation_scope IN ('children', 'descendants', 'subaccount')),
  ADD CONSTRAINT agent_runs_delegation_direction_chk
  CHECK (delegation_direction IS NULL OR delegation_direction IN ('down', 'up', 'lateral'));

CREATE INDEX agent_runs_hierarchy_depth_idx ON agent_runs (hierarchy_depth)
  WHERE hierarchy_depth IS NOT NULL;

CREATE INDEX agent_runs_handoff_source_run_id_idx ON agent_runs (handoff_source_run_id)
  WHERE handoff_source_run_id IS NOT NULL;
```

**Drizzle reflection:** Add `delegationScope: text('delegation_scope')`, `hierarchyDepth: smallint('hierarchy_depth')`, `delegationDirection: text('delegation_direction')`, and `handoffSourceRunId: uuid('handoff_source_run_id').references(() => agentRuns.id)` to `server/db/schema/agentRuns.ts`.

**Relationship to `tasks.handoff_source_run_id`.** The existing column on `tasks` remains unchanged. When `reassign_task` dispatches a handoff, the NEW run's `agent_runs.handoff_source_run_id` is set to the calling run's id (the run that invoked `reassign_task`). The task row also gets its `handoff_source_run_id` updated to the same value per current behaviour. Both are populated; the per-run column is the one the graph reads.

**Population schedule (phase-staggered):**
- Phase 1: columns exist; all three are null on every new `agent_runs` row.
- Phase 3: `hierarchy_depth` starts being populated by `agentExecutionService` from `context.hierarchy.depth` at run start (built by `hierarchyContextBuilderService`).
- Phase 4: `delegation_scope` and `delegation_direction` start being populated by the dispatching skill handler (`spawn_sub_agents` / `reassign_task`) at the moment the new run is created. For the ROOT run of a Brief fan-out (the first run, not dispatched by any skill), both are null. For dispatched runs (sub-agent or handoff), both are set and are immutable — they record the edge that created THIS run, not the current state of the dispatching task.

**Why on `agent_runs`, not `tasks`:** `tasks.delegation_direction` (§5.2) is the current-task marker and is mutable (a task reassigned twice has its current direction overwritten). The delegation GRAPH (§7.2) needs the direction of the edge that CREATED each run, which is a per-run immutable fact. Storing it on `agent_runs` keeps it immutable and queryable without joining through `tasks`.

**Why these columns on `agent_runs` and not elsewhere:** they're read by the trace graph UI alongside the existing `parentRunId` / `isSubAgent` / `handoffDepth` fields. Putting them anywhere else forces the UI to join.

**RLS:** Inherited from `agent_runs` — already org-scoped. No manifest change.

### 5.4 `delegation_outcomes` — new table

**Migration:** `0217_delegation_outcomes.sql` (Phase 1).

**Change (table creation + RLS policy in the same migration — pattern enforced by `verify-rls-coverage.sh`):**

```sql
CREATE TABLE delegation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  caller_agent_id uuid NOT NULL REFERENCES subaccount_agents(id) ON DELETE CASCADE,
  target_agent_id uuid NOT NULL REFERENCES subaccount_agents(id) ON DELETE CASCADE,
  delegation_scope text NOT NULL,
  outcome text NOT NULL,
  reason text,
  delegation_direction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delegation_outcomes_scope_chk
    CHECK (delegation_scope IN ('children', 'descendants', 'subaccount')),
  CONSTRAINT delegation_outcomes_outcome_chk
    CHECK (outcome IN ('accepted', 'rejected')),
  CONSTRAINT delegation_outcomes_reason_chk
    CHECK (
      (outcome = 'accepted' AND reason IS NULL)
      OR (outcome = 'rejected' AND reason IS NOT NULL)
    ),
  CONSTRAINT delegation_outcomes_direction_chk
    CHECK (delegation_direction IN ('down', 'up', 'lateral'))
);

CREATE INDEX delegation_outcomes_org_created_idx
  ON delegation_outcomes (organisation_id, created_at DESC);

CREATE INDEX delegation_outcomes_caller_created_idx
  ON delegation_outcomes (caller_agent_id, created_at DESC);

CREATE INDEX delegation_outcomes_run_idx
  ON delegation_outcomes (run_id);

-- RLS — uses app.organisation_id per the existing repo-wide RLS contract (see migrations 0080+).
ALTER TABLE delegation_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY delegation_outcomes_org_isolation
  ON delegation_outcomes
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

**Drizzle reflection:** New file `server/db/schema/delegationOutcomes.ts`. Export from `server/db/schema/index.ts`.

**`rlsProtectedTables.ts` entry:** add `delegation_outcomes` to the manifest in the same commit as the migration. `verify-rls-coverage.sh` fails CI if missing.

**Why a new table, not an extension of `routing_outcomes`:** §3.4 row. Disjoint column sets; conflating them creates a wide, sparse table and couples two independent observability subsystems.

**Write path:** `spawn_sub_agents` and `reassign_task` (§6.3 / §6.4) insert a row per delegation decision. Writes are best-effort; failure logs at WARN and does not fail the skill call (the delegation itself succeeded or was rejected for its own reason; telemetry isn't allowed to block user work).

**Retention:** Not bounded in v1. Deferred to a follow-up pruning job (§13) if the table grows — at expected volumes (one row per delegation attempt per run; maybe 5–10 attempts per active Brief), six months of history is well under 10M rows for any single org, well within Postgres's comfort zone.

### 5.5 Files-to-change index for schema

For the self-consistency audit and Phase 1 planning, every schema change referenced in prose above maps one-to-one to:

| Migration | Phase | Files |
|---|---|---|
| 0214 | Phase 2 | `migrations/0214_subaccount_agents_root_unique.sql`, `server/db/schema/subaccountAgents.ts` (add `uniqueIndex`), `scripts/audit-subaccount-roots.ts` (new) |
| 0215 | Phase 4 | `migrations/0215_tasks_delegation_direction.sql`, `server/db/schema/tasks.ts` (add column) |
| 0216 | Phase 1 | `migrations/0216_agent_runs_delegation_telemetry.sql` — adds `delegation_scope`, `hierarchy_depth`, `delegation_direction`, `handoff_source_run_id` (all nullable); `server/db/schema/agentRuns.ts` (add four columns) |
| 0217 | Phase 1 | `migrations/0217_delegation_outcomes.sql`, `server/db/schema/delegationOutcomes.ts` (new), `server/db/schema/index.ts` (export), `server/config/rlsProtectedTables.ts` (manifest entry) |

All four migration files, all six schema file references, roll forward into §14 File inventory.

---

## 6. Services

All service code follows the existing `*Service.ts` + `*ServicePure.ts` convention (impure wrapper + pure tested core). New and modified services below.

### 6.1 `hierarchyContextBuilderService` — new

**File:** `server/services/hierarchyContextBuilderService.ts` (impure) + `hierarchyContextBuilderServicePure.ts` (pure).

**Responsibility:** Build the `HierarchyContext` (§4.1) for a given `(agentId, subaccountId)` pair. Called once per run by `agentExecutionService` when constructing `SkillExecutionContext`.

**Pure API:**

```ts
// hierarchyContextBuilderServicePure.ts
export function buildHierarchyContextPure(input: {
  agentId: string;
  agents: Array<{ id: string; parentSubaccountAgentId: string | null }>;
}): HierarchyContext {
  // Pure derivation from the full subaccount agent roster:
  // 1. find caller in roster → parentId
  // 2. filter roster where parentSubaccountAgentId === agentId → childIds (sorted by id asc for determinism)
  // 3. walk upward to root, counting depth
  // 4. return frozen object
}
```

**Impure wrapper:**

```ts
// hierarchyContextBuilderService.ts
export async function buildForRun(params: {
  agentId: string;
  subaccountId: string;
  organisationId: string;
}): Promise<HierarchyContext> {
  const roster = await db.select({...}).from(subaccountAgents)
    .where(and(eq(subaccountAgents.subaccountId, params.subaccountId), eq(subaccountAgents.isActive, true)));
  return Object.freeze(buildHierarchyContextPure({ agentId: params.agentId, agents: roster }));
}
```

**Caller:** `agentExecutionService` at run construction. New code path that populates `ctx.hierarchy` before the skill executor is handed the context.

**Error class:** `HierarchyContextBuildError` is declared in `server/services/hierarchyContextBuilderService.ts` (co-located with the impure wrapper):

```ts
export class HierarchyContextBuildError extends Error {
  constructor(
    public readonly code: 'agent_not_in_subaccount' | 'depth_exceeded' | 'cycle_detected',
    message?: string
  ) {
    super(message ?? code);
    this.name = 'HierarchyContextBuildError';
  }
}
```

Not exported from `shared/types/delegation.ts` — it is a server-side construction error, not a contract that crosses the shared boundary.

**Error modes:**
- Caller agent not found in roster → throw `new HierarchyContextBuildError('agent_not_in_subaccount')`. Caught by `agentExecutionService` and surfaced on the run as a hard failure (the agent cannot execute with a broken hierarchy context).
- Roster walk exceeds `MAX_DEPTH = 10` → should be impossible (validated at write time by `hierarchyService.validateHierarchy`), but if it happens, throw `new HierarchyContextBuildError('depth_exceeded')`. Same fail-closed posture.
- Cycle detected during upward walk → throw `new HierarchyContextBuildError('cycle_detected')`. Defence-in-depth — `validateHierarchy` already prevents cycles at write time.

**Depth bound + cycle-safety.** The upward walk is bounded by `MAX_DEPTH + 1 = 11` iterations before throwing. The pure function rejects cycles (if the walk revisits a node, throw) — this is a defence-in-depth check since `validateHierarchy` already prevents cycles at write time.

**Why pure + impure split:** per spec-context convention. Pure function is unit-tested (§12); impure wrapper handles DB access. Also lets the trace-graph UI (§8.2) reuse the pure function if it needs to reconstruct hierarchy from a historical roster snapshot.

### 6.2 `config_list_agents` / `config_list_subaccounts` / `config_list_links` — scope param

**File:** `server/tools/config/configSkillHandlers.ts` (existing, extended).

**Change:** Each of the three skills accepts an optional `scope` parameter.

**New signature shape (all three, shared `scope` semantics):**

```ts
// Existing skills, new parameter
interface ConfigListAgentsInput {
  /** Optional: 'children' | 'descendants' | 'subaccount'. Default is adaptive (see below). */
  scope?: DelegationScope;
}
```

**Adaptive default (computed inside the handler):**

```ts
const effectiveScope = input.scope ?? (
  (context.hierarchy?.childIds.length ?? 0) > 0 ? 'children' : 'subaccount'
);
```

**Scope → filter (applied to the base query). Semantics per skill:**

**`config_list_agents`** — the scope vocabulary maps directly onto the agent hierarchy:

- `children` → `WHERE parent_subaccount_agent_id = $callerAgentId AND is_active = true`
- `descendants` → `WHERE id IN (walk downward from $callerAgentId)` — implemented via the pure hierarchy builder's downward walk over the active roster (§6.1). No recursive CTE; the pure function is cheap at expected sizes (<100 agents per subaccount).
- `subaccount` → existing behaviour (`WHERE subaccount_id = $subaccountId AND is_active = true`).

**`config_list_subaccounts`** — subaccounts are container-level resources; the agent hierarchy vocabulary does not map cleanly onto them. For this skill, `children` and `descendants` are equivalent to `subaccount` (they return the full set of subaccounts the caller can see via `allowedSubaccountIds`). The `scope` parameter is accepted for vocabulary consistency across the three list skills but has no filter effect — documented in the tool definition so callers know not to rely on it narrowing the result. Future versions may tighten this (e.g. narrow to subaccounts where the caller has an active agent link), but v1 preserves current behaviour.

**`config_list_links`** — links are the edges between system agents and subaccounts. For this skill, `scope` narrows the set to links touching the caller's subaccount (equivalent to the existing default). `children` / `descendants` / `subaccount` are all no-ops in v1 for the same container-level reason; again accepted for vocabulary consistency, future versions may distinguish them.

**Rationale.** The three list skills share a tool-signature shape so callers don't have to remember which accepts `scope`. For `config_list_agents` the parameter is load-bearing; for the other two it is documentation-only in v1. The alternative — dropping `scope` from two of the three — produces three different signatures for "list X" skills and bleeds into prompt surface area.

**Missing-context handling:** If `context.hierarchy` is undefined when the handler runs, the adaptive path falls through to `subaccount` (safe default). A telemetry log at WARN records this — it indicates a builder bug, not a caller bug.

**Why not hard-fail on missing context:** these are read skills, not write skills. Falling through to `subaccount` preserves behaviour for any edge-case run (system tasks, diagnostic runs, tests) where hierarchy wasn't built. The §4.3 `hierarchy_context_missing` error is reserved for write skills (§6.3, §6.4) where missing context is a correctness issue.

**Back-compat:** Existing callers that pass no `scope` get `subaccount` behaviour if they have no children (every current agent) — identical to today. The behaviour change only bites for agents with children, which in the seeded company are only the Orchestrator and (post-reorg, separate track) the four department heads.

### 6.3 `spawn_sub_agents` — `delegationScope` validation

**File:** `server/services/skillExecutor.ts` (existing, extended around line 3410).

**Change:** Accept an optional `delegationScope` parameter. Validate every proposed sub-task target against the resolved scope. Write a `delegation_outcomes` row per target per decision.

**New input shape:**

```ts
interface SpawnSubAgentsInput {
  sub_tasks: Array<{ title: string; brief: string; assigned_agent_id: string }>;
  /** Optional. Default is adaptive from context.hierarchy. */
  delegationScope?: DelegationScope;
}
```

**Validation flow (per target):**

1. Resolve `effectiveScope` (adaptive default as §6.2).
2. If `effectiveScope === 'subaccount'` → reject the **entire call** with `cross_subtree_not_permitted`, regardless of whether the caller is root (spawn is always a descent operation — see step 6; roots crossing subtrees use `reassign_task`). Write one `delegation_outcomes` row per proposed target with `outcome: 'rejected'`, `reason: 'cross_subtree_not_permitted'`. Do not spawn anything.
3. Per target, classify in-scope / out-of-scope:
   - Look up target's `parentSubaccountAgentId` from the same roster used in §6.1.
   - If `effectiveScope === 'children'` and `target.parentSubaccountAgentId !== context.agentId` → target is out-of-scope.
   - If `effectiveScope === 'descendants'` and target is not in caller's subtree → out-of-scope.
   - Otherwise → in-scope.
4. If ANY target is out-of-scope, reject the entire call (atomic — don't spawn a partial set; the caller's prompt re-plans). Write rejection rows for the out-of-scope targets only, with `reason: 'delegation_out_of_scope'`. In-scope-but-not-executed siblings are NOT logged (no delegation happened for them; logging them as `accepted` would be false and logging them as `rejected` would be misleading).
5. If all targets are in-scope, spawn the entire set. For each spawned sub-agent run, write `agent_runs.delegation_direction = 'down'` and `agent_runs.delegation_scope = effectiveScope` at run creation (immutable per-run fact, read by the graph in §7.2). Write one `delegation_outcomes` row per target with `outcome: 'accepted'`, `reason: null`, `delegationDirection: 'down'` via `insertOutcomeSafe()` (§10.3).
6. **Direction for spawn is always `'down'` by construction.** The roots-can-use-`subaccount`-scope case from §4.2 does NOT apply to `spawn_sub_agents` — roots wanting to hand work across subtrees use `reassign_task`, not spawn. Concretely: for `spawn_sub_agents`, `effectiveScope === 'subaccount'` is rejected for every caller (including roots) with `cross_subtree_not_permitted`. The `subaccount` scope is a `reassign_task` / list-skill concept; spawning into another subtree is semantically wrong because sub-agents are children by definition. Roots who want to kick off work in another subtree either reassign the task to that subtree's manager (who then spawns within), or create the task via the brief path and let the router resolve.

**Nesting block removal.** The existing "sub-agents cannot spawn sub-agents" hard-block at line ~3415 is **deleted**. Multi-level fan-out is allowed up to `MAX_HANDOFF_DEPTH = 5`.

**Depth enforcement for spawn chains.** Re-use the existing `agent_runs.handoffDepth` integer column (default 0) for both handoff AND spawn chains — one shared counter, one limit. When `spawn_sub_agents` enqueues a new sub-agent run, the new run's `handoffDepth` is set to `context.handoffDepth + 1`. If `context.handoffDepth >= MAX_HANDOFF_DEPTH` (5) before the call, reject the entire spawn call with error code `max_handoff_depth_exceeded` (an existing error code in `skillExecutor.ts`; no new code needed). Same rule is already applied by `reassign_task` — spawn now aligns. Each nested spawn is also subject to its own scope validation per this section — a sub-agent with no children will have its adaptive default resolve to `subaccount`, which this skill rejects (§6.3 step 2), so sub-agent-without-children cannot spawn further. In practice, only managers (agents with children) can spawn; workers (no children) can't. This is the graph-position-grants-authority model in action.

**Context propagation.** The spawned sub-agent run's `SkillExecutionContext` is constructed by `agentExecutionService` independently — the sub-agent builds its own `hierarchy` from its own position. Parent's `hierarchy` is not propagated (the sub-agent has its own parent relationship).

### 6.4 `reassign_task` — `delegationScope` validation + direction marker

**File:** `server/services/skillExecutor.ts` (existing, extended around line 3330).

**Change:** Accept optional `delegationScope`. Validate target. Write `delegation_outcomes` row. Write `tasks.delegation_direction` based on the graph relationship.

**New input shape:**

```ts
interface ReassignTaskInput {
  task_id: string;
  assigned_agent_id: string;
  handoff_context?: string;
  /** Optional. Default is adaptive. */
  delegationScope?: DelegationScope;
}
```

**Validation flow:**

1. Resolve `effectiveScope`.
2. **Upward-escalation special case (committed per §16.1, option b).** If `target.subaccountAgentId === context.hierarchy.parentId` (the target IS the caller's immediate parent), skip scope validation; the call is accepted regardless of `effectiveScope`. Set `delegationDirection: 'up'`, proceed to step 5.
3. Otherwise, if `effectiveScope === 'subaccount'`, assert the caller is the CONFIGURED subaccount root: `context.hierarchy.rootId === context.agentId && context.hierarchy.rootId !== null`. This is NOT equivalent to `parentId === null` — rootless subaccounts also have `parentId === null` on every agent (§4.1), and they must NOT be permitted to use `subaccount` scope. Reject with `cross_subtree_not_permitted` if the assertion fails.
4. Apply the same target-in-scope rule.
5. Compute `delegationDirection` (only for the non-special-case path):
   - If `target.parentSubaccountAgentId === context.agentId` or target is in caller's subtree → `'down'`.
   - If target is an ancestor of caller (walk caller upward; if target is on the path — this includes the `parentId` special case already handled in step 2, and any higher ancestor reached only by the root-using-`subaccount` scope) → `'up'`.
   - Otherwise → `'lateral'` (only possible when `effectiveScope === 'subaccount'` and caller is root).
6. Write `tasks.delegation_direction` to the resolved direction (the current-task marker — this reflects the LATEST reassignment; older directions are not preserved here). A failed write fails the skill call.
7. When the handoff queue dispatches the new run, the dispatch carries the direction into the newly-created `agent_runs.delegation_direction` column. This is the IMMUTABLE per-run edge-direction that the trace graph reads (§7.2). Written once at run creation; never mutated.
8. Write `delegation_outcomes` row via `insertOutcomeSafe()` (§10.3, best-effort).
9. Dispatch completes via the existing handoff queue.

**Upward reassign (worker → parent) — supported via narrow special case.** The step-2 special case keeps the brief's "upward escalation allowed, logged" commitment without widening the `delegationScope` surface. Any agent can reassign to its own parent. Upward targets two or more levels up (grand-parent, etc.) remain gated behind `subaccount` scope (root-only) — there is no multi-level upward escape hatch in v1. The two-step "escalate to parent → parent escalates further" pattern covers deeper upward hops.

**Why this shape (option b, per §16.1).** Considered and rejected: (a) "roots only" drops a brief commitment; (c) a fourth `delegationScope: 'parent'` adds vocabulary for a single-target case; (d) a separate `escalate_upward` skill adds platform surface. Option (b) is a one-line check in the validator.

### 6.5 Skill resolver — derive delegation skills from graph position

**File:** `server/services/skillService.ts` (existing, extended in `resolveSkillsForAgent`).

**Change:** When building the tool list for a run, union the agent's attached skills with a graph-derived set.

**Logic:**

```ts
// Inside resolveSkillsForAgent (simplified)
// Hierarchy is already built once per run by agentExecutionService (§4.1 "built once per run" contract).
// The skill resolver consumes the already-built snapshot from the same SkillExecutionContext it's
// constructing for this run — it does NOT re-invoke hierarchyContextBuilderService.
const attachedSlugs = await getAttachedSkillSlugs(agentId, subaccountId);
const derivedSlugs = (context.hierarchy?.childIds.length ?? 0) > 0
  ? ['config_list_agents', 'spawn_sub_agents', 'reassign_task']
  : [];
const effectiveSlugs = Array.from(new Set([...attachedSlugs, ...derivedSlugs]));
return resolveSlugsToTools(effectiveSlugs);
```

**Call-ordering note.** `agentExecutionService` builds `context.hierarchy` (via `hierarchyContextBuilderService.buildForRun()`) BEFORE it invokes the skill resolver. The resolver reads the already-built snapshot; no second build. This is the "built once per run" contract stated in §4.1.

**Missing-hierarchy policy for the resolver.** If `context.hierarchy` is undefined at resolver time (a construction bug in `agentExecutionService`), the resolver does NOT fail the run. It logs WARN (`hierarchy_missing_at_resolver_time`) and returns the agent's explicitly-attached skill set only — derived delegation skills are dropped silently. This preserves behaviour for diagnostic / system runs that might legitimately bypass the builder. A Phase 4 integration check confirms the resolver always sees `context.hierarchy` on normal Brief-dispatched runs.

**Why all three derived together:** the three skills form a coherent "can delegate" capability. Giving a manager any one without the others creates a half-working agent (e.g. `spawn_sub_agents` without `config_list_agents` forces the manager to guess target IDs). Always unioned together keeps prompts and behaviours consistent.

**Interaction with explicit attachment (narrow escape hatch — realistic scope).** If an agent already has any of the three attached explicitly, the union is idempotent (de-duped via Set). The graph-derived logic only *adds*, never *removes*. **However, for agents with `childIds.length === 0`, the execution-side validation (§6.3, §6.4) sharply narrows what the attached skills can DO:**

- `spawn_sub_agents` — unusable. With no children, `effectiveScope` resolves to `subaccount` (adaptive default §4.2), which §6.3 step 2 rejects for all callers. An explicit `delegationScope: 'children'` or `'descendants'` would also be rejected because `childIds` is empty, so every target is out-of-scope.
- `reassign_task` — usable only for the upward-escalation special case (§6.4 step 2): a no-child agent can reassign to its own `parentId`. All other targets fail scope validation.
- `config_list_agents` — fully usable (read-side; no scope validation blocks results per §6.2).

**Effective practical use.** Explicit attachment for a no-child agent grants "see the list of org agents + escalate upward." This is a coherent narrow capability (an escalation-only role). The `explicitDelegationSkillsWithoutChildren` detector (§6.9) surfaces it as informational for operator awareness, not as drift.

**If broader delegation capability is needed for a no-child agent,** the right approach is to give the agent children (restructure the hierarchy), not to rely on explicit attachment — the validation will block any broader use regardless.

**When children change mid-session:** No mid-run effect (§4.1 immutability contract). Next run of the agent reads the updated roster and resolves accordingly. Transition is automatic, drift-free.

### 6.6 `hierarchyRouteResolverService` — new

**File:** `server/services/hierarchyRouteResolverService.ts` + `*Pure.ts`.

**Responsibility:** Find the entry-point agent for a given `(organisationId, subaccountId, scope)` tuple. Replaces the hardcoded-slug lookup in `orchestratorFromTaskJob.ts:21`.

**API:**

```ts
export interface ResolveRootResult {
  subaccountAgentId: string;
  agentId: string;
  fallback: 'none' | 'expected' | 'degraded';
}

export async function resolveRootForScope(params: {
  organisationId: string;
  subaccountId: string | null;
  scope: 'subaccount' | 'org' | 'system';
}): Promise<ResolveRootResult | null>;
// Returns null when the scope is unsupported (scope === 'system' in v1 — §13 deferred).
// Callers surface a Brief error artefact on null (see §6.7).
//
// `fallback` semantics:
//   'none'     — direct match, no fallback.
//   'expected' — caller did not scope a subaccount (subaccountId: null); org-level fallback is the
//                intended behaviour. Informational, not actionable.
//   'degraded' — the requested subaccount exists but has zero active root agents. Misconfiguration;
//                the `subaccountNoRoot` workspace-health detector is the canonical surface.
```

**Resolution logic:**

1. **`scope === 'subaccount'`** (most common path, Brief scoped to a client subaccount):
   - If `subaccountId` is null → fall through to the org-level Orchestrator link (§2.1 current behaviour). Return with `fallback: 'expected'`. This happens for Brief enqueues that don't have a subaccount context (e.g. a task created at org level but routed with default scope); the fallback restores pre-spec behaviour and is expected, not degraded.
   - Otherwise, query `subaccount_agents WHERE subaccount_id = $subaccountId AND parent_subaccount_agent_id IS NULL AND is_active = true`.
   - Expected: exactly one row (enforced by partial unique index §5.1). Return with `fallback: 'none'`.
   - Zero rows: fall back to the org-level Orchestrator link. Log WARN with a structured event that the `subaccountNoRoot` detector picks up on the next audit sweep. Return with `fallback: 'degraded'` — this is the misconfiguration case and callers should treat it as actionable (separate log tag from the expected-fallback case).
   - Multiple rows: impossible post-migration. Pre-migration window: pick oldest by `createdAt`, log CRITICAL with a structured event that the `subaccountMultipleRoots` detector picks up on the next audit sweep. Return with `fallback: 'none'` but flagged.

2. **`scope === 'org'`:**
   - Query for the org-level Orchestrator link (existing behaviour — system agent with `slug = 'orchestrator'` linked to the org sentinel subaccount).
   - Not yet migrated away from hardcoded slug at this layer — documented in §13 Deferred items.

3. **`scope === 'system'`:**
   - Not yet supported. Returns `null` from the resolver; caller (`briefCreationService`) treats this as an unsupported scope and surfaces a placeholder "system-scope Briefs are not yet routable" error artefact. Deferred to §13.

**Pure core:** `resolveRootForScopePure()` takes the query results and implements the decision tree — testable without DB.

**Caching:** None in v1. Each Brief dispatch does one indexed query (< 1ms). Can add a request-scoped cache later if profiling shows it matters.

### 6.7 `orchestratorFromTaskJob` — scope-aware dispatch, slug removal

**File:** `server/jobs/orchestratorFromTaskJob.ts` (existing, modified).

**Change:** Replace the hardcoded slug lookup + link resolution with a call to `hierarchyRouteResolverService.resolveRootForScope()`.

**Before (line 21 + the full resolver block lines ~129–196):**
```ts
const ORCHESTRATOR_AGENT_SLUG = 'orchestrator';
// ... load system agent, resolve link, fall back, etc.
```

**After:**
```ts
// Slug constant retained — used ONLY by the org-scope branch of the resolver (§6.6 case 2)
// pending §13 deferred work. Subaccount-scope routing no longer reads it.
const ORCHESTRATOR_AGENT_SLUG = 'orchestrator';  // unchanged

// Scope comes from the pg-boss job payload — enqueue-time producer
// (briefCreationService) reads fastPathDecision.scope and includes it in the job data.
// orchestratorFromTaskJob reads job.data.scope (default 'subaccount' for backward compat
// with any enqueue path that doesn't yet pass scope — chiefly the non-Brief trigger paths).
const scope = job.data.scope ?? 'subaccount';
const result = await hierarchyRouteResolverService.resolveRootForScope({
  organisationId: task.organisationId,
  subaccountId: task.subaccountId,
  scope,
});
if (!result) {
  // System scope not yet supported, or unresolvable. Surface as a conversation-level
  // error artefact via briefConversationWriter (the existing primitive) so the brief
  // author sees "system-scope Briefs are not yet routable" in the conversation thread.
  await briefConversationWriter.appendSystemErrorArtefact({
    conversationId: task.conversationId,
    message: 'system-scope Briefs are not yet routable (§13 deferred)',
    organisationId: task.organisationId,
  });
  return;
}
// Dispatch to result.subaccountAgentId.
```

**Why the job payload, not a task column.** Adding `tasks.trigger_context` would be a schema migration for no durable benefit — the scope is a one-time dispatch routing hint, consumed when `orchestratorFromTaskJob` runs, never read again. The pg-boss job payload is the natural carrier for transient dispatch metadata. No new column; no new file-inventory entry for `tasks`.

**Enqueue-side change.** `briefCreationService` (existing) currently calls `enqueueOrchestratorRoutingIfEligible(task)`; Phase 2 widens the enqueue signature to `enqueueOrchestratorRoutingIfEligible(task, { scope })` and the job enqueue carries `scope` in the job data. Non-Brief trigger paths (the `org_task_created` DB trigger path) don't know scope; they enqueue without it and the job defaults to `'subaccount'`.

**Fallback observability:** `result.fallback` is written to structured logs so ops can measure how often fallback paths fire. Phase 2 success criterion: after migration + template re-applies, `fallback !== 'none'` should be rare (<1% of dispatches after the first week).

**Eligibility predicate unchanged.** `isEligibleForOrchestratorRouting` keeps its current shape.

**Idempotency key unchanged.** Still keyed on `orchestrator-from-task:${taskId}:${task.updatedAt.getTime()}`.

### 6.8 `hierarchyTemplateService.apply()` + `importToSubaccount()` — root rotation

**File:** `server/services/hierarchyTemplateService.ts` (existing, modified).

**Change:** Both methods, when they would create a new subaccount-level root, deactivate the prior active root in the same transaction.

**Added pre-step (before inserting / activating the new root):**

```ts
// Inside the apply() / importToSubaccount() transaction
await tx.update(subaccountAgents)
  .set({ isActive: false, deactivatedAt: new Date(), deactivatedReason: 'superseded_by_template_apply' })
  .where(and(
    eq(subaccountAgents.subaccountId, params.subaccountId),
    isNull(subaccountAgents.parentSubaccountAgentId),
    eq(subaccountAgents.isActive, true),
  ));

// Then insert the new root(s) with is_active = true.
```

**Why same transaction:** prevents a split-brain window where two rows briefly satisfy the root predicate. Without this, the partial unique index from §5.1 would reject the second insert, forcing the apply to fail — which is strictly safer, but surfaces as a confusing user error. Same-tx deactivation avoids it entirely.

**New columns referenced:** `subaccountAgents.deactivatedAt` + `subaccountAgents.deactivatedReason` — **check if these exist.** If they don't, either (a) add them in a schema migration before Phase 2 or (b) use the existing `isActive` flag only and accept no audit trail on deactivation.

**Verdict:** Use option (b) for v1 — audit trail on deactivation is nice-to-have, not required. §13 Deferred items lists "full deactivation audit columns" as a follow-up.

### 6.9 Workspace Health detectors — three new (phase-staggered)

**Directory:** `server/services/workspaceHealth/detectors/` (existing, extended).

**New files — Phase 1 registration:**

1. **`subaccountMultipleRoots.ts`** — severity `critical`. Query: subaccounts where `COUNT(*) > 1` over active roots. Emit one finding per offending subaccount. Post-§5.1-index (Phase 2) this should never fire in normal operation; Phase 1 registers the detector so pre-index violations become visible. Message: *"Subaccount {id} has {n} active root agents. Partial unique index violation — investigate immediately."*

2. **`subaccountNoRoot.ts`** — severity `info` (steady-state verdict per §16.3: zero-root is a valid operator-opt-in state; the resolver's org-level fallback handles dispatch correctly in this case). The detector surfaces the state as informational — "this subaccount is using the org-level fallback; assign a subaccount-level root to unlock per-subaccount CEO semantics." Not elevated to `warning` or `critical` across phases. Query: subaccounts where `COUNT(*) = 0` over active roots. Emit one finding per offending subaccount (dedup by `(orgId, 'subaccountNoRoot', 'subaccount', subaccountId)`). Message: *"Subaccount {id} has no active root agent. Briefs route to the org-level fallback; assign a subaccount-level root (e.g. via hierarchy template) to enable per-subaccount routing."*

**New file — Phase 4 registration:**

3. **`explicitDelegationSkillsWithoutChildren.ts`** — severity `info` (not `warning`). Query: agents with explicit `config_list_agents` + `spawn_sub_agents` + `reassign_task` attached but `childIds.length === 0`. This is a SUPPORTED state per §6.5 (explicit attachment is a narrow escape hatch — the resolver only adds, never removes). The detector surfaces it as informational — not as drift — so operators can confirm the state is still intentional after team restructures. Message: *"Agent {id} has delegation skills attached explicitly but no active children. This is a supported configuration (explicit attachment is an escape hatch — §6.5). Informational only: verify the explicit attachment is still intentional after recent team changes."* Ships in Phase 4 alongside the §6.5 derived resolver.

**Registration:** Phase 1 adds two lines to `server/services/workspaceHealth/detectors/index.ts`; Phase 4 adds one more line.

**No new endpoints, no new UI.** These surface through the existing `AdminHealthFindingsPage` which already groups by severity.

---

## 7. Routes

Two new endpoints. No changes to existing routes (the Brief creation, subaccount creation, and run detail endpoints keep their current shapes; new behaviour lives in their handlers via services).

### 7.1 `GET /api/org/delegation-outcomes`

**File:** `server/routes/delegationOutcomes.ts` (new).

**Purpose:** List delegation outcome rows for the admin dashboard (§8.3). Admin-scoped — a future feature-owner role could narrow this.

**Query params:**
- `callerAgentId?: string` — filter to one caller.
- `targetAgentId?: string` — filter to one target.
- `outcome?: 'accepted' | 'rejected'`
- `delegationDirection?: 'down' | 'up' | 'lateral'`
- `since?: ISO8601` — default 7 days ago.
- `limit?: number` — default 100, max 500.

**Middleware chain:**

```ts
router.get('/api/org/delegation-outcomes',
  authenticate,
  requireOrgPermission('org.observability.view'),
  asyncHandler(async (req, res) => {
    const rows = await delegationOutcomeService.list(req.orgId!, req.query);
    res.json(rows);
  }));
```

**Permission:** new permission `org.observability.view` (or reuse `org.health_audit.view` if that's closer). Decision in §9.

**RLS:** `delegation_outcomes` is in the manifest per §5.4. Every query uses `orgScopedDb` so the RLS policy enforces org isolation even if the service code drifts.

**Response shape:** `DelegationOutcome[]` per §4.4, sorted by `created_at DESC`.

### 7.2 `GET /api/agent-runs/:id/delegation-graph`

**File:** `server/routes/agentRuns.ts` (existing, extended) — new sub-route in the existing `/api/agent-runs/:id` family.

**Purpose:** Return the delegation DAG rooted at this run, for the Run Trace Viewer's new tab (§8.2). Read-only, synchronous, no side effects.

**Middleware chain:** matches the existing `/api/agent-runs/:id` pattern in the same file — `authenticate` plus service-layer org scoping (no `requireRunAccess` helper exists in the repo; the spec does not invent one).

```ts
router.get('/api/agent-runs/:id/delegation-graph',
  authenticate,
  asyncHandler(async (req, res) => {
    // Service asserts the opened run belongs to req.orgId (mirrors agentActivityService.getRunDetail).
    const graph = await delegationGraphService.buildForRun(req.params.id, req.orgId!);
    res.json(graph);
  }));
```

**Access assertion at the service layer.** `delegationGraphService.buildForRun(runId, orgId)` does a single RLS-scoped lookup of the opened run (`orgScopedDb.select().from(agentRuns).where(eq(id, runId))`); if the row isn't visible (wrong org or missing), it throws `NotFoundError` which the route surfaces as 404. No separate per-run ACL check, matching the existing `/api/agent-runs/:id` pattern.

**Response shape (graph / DAG — not a tree):**

```ts
interface DelegationGraphNode {
  runId: string;
  agentId: string;
  agentName: string;        // denormalised for UI convenience
  isSubAgent: boolean;
  delegationScope: DelegationScope | null;  // read from agent_runs.delegation_scope
  hierarchyDepth: number | null;
  delegationDirection: 'down' | 'up' | 'lateral' | null;  // read from agent_runs.delegation_direction; null for the opened root and for runs not dispatched by a skill
  status: AgentRunStatus;
  startedAt: string;
  completedAt: string | null;
}

type DelegationEdgeKind = 'spawn' | 'handoff';

interface DelegationGraphEdge {
  parentRunId: string;
  childRunId: string;
  kind: DelegationEdgeKind;   // 'spawn' means parent→child via agent_runs.parentRunId; 'handoff' means parent→child via agent_runs.handoffSourceRunId
}

interface DelegationGraphResponse {
  rootRunId: string;                  // the run the user opened
  nodes: DelegationGraphNode[];       // unique by runId
  edges: DelegationGraphEdge[];       // one edge per parent-child relationship; a run can appear as the child of at most two edges (spawn + handoff)
}
```

**Why graph, not tree.** A run can have both `parentRunId` (spawn parent) and `handoffSourceRunId` (handoff parent) set. A tree would force us to pick one parent as canonical and discard information; the graph response preserves both edges. The UI can render the DAG as a tree by picking spawn edges first and showing handoff edges as annotations, or as a full graph — either way, the data the route returns is lossless.

**Service backing it:** `server/services/delegationGraphService.ts` (new). Bounded by `MAX_HANDOFF_DEPTH + 1 = 6` levels for loop-safety.

**Edge source of truth.** Two parent-pointer columns on `agent_runs` define edges in the graph. The direction of each edge is stored on the CHILD run (`agent_runs.delegation_direction`, §5.3), making it immutable and queryable without joining through mutable task state.

1. **Spawn edges.** `agent_runs.parentRunId` + `isSubAgent = true` define spawn parentage (a sub-agent run's parent is the run that spawned it via `spawn_sub_agents`). `delegation_direction` on the child run is always `'down'` by spawn construction (§6.3).
2. **Handoff edges.** `agent_runs.handoffSourceRunId` defines handoff parentage (a handoff run's parent is the run that called `reassign_task`). `delegation_direction` on the handoff run is `'down'` / `'up'` / `'lateral'` exactly as computed by `reassign_task` at dispatch time (§6.4 step 5).

**Traversal algorithm:**

- Start at `runId` (the opened run).
- Recursively find all runs whose `parentRunId === current.id` OR `handoffSourceRunId === current.id` (children in either chain).
- For each child node, read `delegation_direction` and `delegation_scope` directly from the child's own `agent_runs` row — no join to `tasks` needed.
- Bounded by `MAX_HANDOFF_DEPTH + 1 = 6` levels.

**Why two parent pointers, not one.** `parentRunId` and `handoffSourceRunId` are orthogonal — a sub-agent run has `parentRunId` set (spawn chain) but no `handoffSourceRunId`; a handoff run has `handoffSourceRunId` but no `parentRunId` (unless it was itself spawned, in which case both are set and the run appears once as the child of its spawn-parent, with a separate edge indicating the handoff).

**Response is a graph, not a tree.** Because a run can have up to two parent edges (spawn + handoff), the response is a DAG, not a strict tree. Shape: `{ nodes: DelegationGraphNode[], edges: DelegationGraphEdge[] }` — see updated response shape below. The UI renders the DAG as a tree that may render a run node twice if it has two parents (once as spawn-child, once as handoff-child); deduplication is handled client-side by `runId`.

**Null for the opened-run's own row.** The opened run is the graph root; its own `delegation_direction` and `delegation_scope` come directly from its `agent_runs` row (null if the opened run is a Brief's initial run that wasn't dispatched by any skill; populated if the opened run is itself a sub-agent or handoff run).

**RLS:** Inherited — `agent_runs` is org-scoped. `authenticate` middleware + service-layer org-scoped lookup enforce access (same pattern as `/api/agent-runs/:id`); no separate per-run ACL helper is introduced.

**No write path.** The graph is fully reconstructable from existing columns; nothing new is persisted.

---

## 8. Client

Three client-side changes, all scoped to existing pages except the optional `AdminDelegationOutcomesPage` (§8.3) which adds a new top-level route `/admin/delegation-outcomes` if it ships in v1. Two mandatory changes (§8.1, §8.2) extend existing pages.

### 8.1 Subaccount creation — "Starting team" picker (Phase 2)

**Files:**
- `client/src/pages/AdminSubaccountsPage.tsx` (existing — this is the actual create surface; `SubaccountCreatePage.tsx` does NOT exist in the repo, correcting an earlier spec draft error)
- `client/src/components/Layout.tsx` (existing — carries a quick-create path for subaccount creation; add the picker here IF the quick-create flow is in scope for v1, otherwise document that Layout's quick-create skips the picker)
- `client/src/components/subaccount/StartingTeamPicker.tsx` (new — the reusable dropdown component)

**Verdict:** v1 scope is the full-form create in `AdminSubaccountsPage.tsx`. The Layout quick-create flow stays unchanged (no picker in the compact quick-create UI); users who want to pick a starting team use the full form. §13 lists "picker in quick-create" as a minor pull-forward item.

**Change:** Add a dropdown field labelled *"Starting team"* between the subaccount name field and the submit button in `AdminSubaccountsPage.tsx`'s create form. Options:

- **None / configure later** (default)
- Available hierarchy templates — fetched from `GET /api/hierarchy-templates` (existing endpoint), sorted by name. Includes system-shipped templates and any templates saved by the org.

**On submit:**

1. Create the subaccount (existing `POST /api/subaccounts` call).
2. If a template was selected, immediately call `POST /api/hierarchy-templates/:id/apply` with `{ subaccountId: createdId, mode: 'replace' }`.
3. On template-apply success, show toast *"Team installed: {templateName}"* and navigate to the subaccount's agent list.
4. On template-apply failure, show an inline warning on the (now-created) subaccount page — the subaccount exists; the team didn't install — and offer a retry button. Do NOT roll back the subaccount.

**Error surface:** If the user picks "None / configure later," behaviour is identical to today. The picker is additive.

**Accessibility:** Picker is a standard `<select>` / combobox. Descriptions for each template show on hover / focus (helpful for templates with similar names like "Marketing Team v1" vs "Marketing Team v2").

**Empty state:** If no templates are available (an org that hasn't saved any and chose not to ship system templates), show the picker collapsed to a single *"None"* option with a helper link *"Import a team to get started"* pointing at the existing hierarchy-templates admin page.

### 8.2 Run Trace Viewer — delegation graph tab (Phase 4)

**File:** `client/src/pages/RunTraceViewerPage.tsx` (existing, extended) + `client/src/components/run-trace/DelegationGraphView.tsx` (new).

**Testing note.** Per framing (`frontend_tests: none_for_now`), there is no `.test.tsx` alongside the component. Any tree-shaping logic that is worth testing lives in `delegationGraphServicePure.ts` (server-side pure helper, §7.2) and is covered by the pure unit test listed in §12.2. The component consumes the already-tested response shape and renders it; no client-side logic is load-bearing enough to require its own test.

**Change:** Add a third tab to the run trace viewer. Existing tabs: *Trace* (single-run event list), *Payload* (LLM payload). New tab: *Delegation graph*.

**Tab content:** Collapsible DAG rendered from the `{ nodes, edges }` response of `GET /api/agent-runs/:id/delegation-graph` (§7.2). The UI deduplicates nodes by `runId` and draws spawn edges as solid arrows, handoff edges as distinct arrows (see colour coding below). Node shape:

- Agent name + avatar/icon.
- Status badge (matches existing run-status vocabulary).
- Delegation-scope chip (`children` / `descendants` / `subaccount`) if non-null.
- Arrow colour / icon coding by `delegationDirection`:
  - Down → solid arrow (green when accepted).
  - Up → dashed arrow (amber — signals rarity).
  - Lateral → dotted arrow (amber — root-only, visually distinct).
- Click a node → navigate to that run's trace tab (in-place, preserves the graph selection).

**Interaction:**
- Root node expanded by default; descendants collapsed. User expands to drill in.
- Shows which node is the *current run* (the one the user opened). Highlights that node.
- Shows hierarchy depth badge on each node (from `hierarchyDepth` column, §5.3).

**Performance:** Server response is bounded by `MAX_HANDOFF_DEPTH + 1 = 6` levels per §7.2. Typical Brief fan-out is 1–3 levels. Client renders the full tree eagerly — no pagination, no lazy load.

**No WebSocket / live updates in v1.** The graph is a historical view of a completed (or in-progress) run. Refresh button triggers a refetch. §13 Deferred items notes live updates as a follow-up.

### 8.3 Admin delegation outcomes dashboard (Phase 1, optional)

**File:** `client/src/pages/AdminDelegationOutcomesPage.tsx` (new).

**Route:** `/admin/delegation-outcomes` — admin sidebar entry added.

**Change:** Simple table view over `GET /api/org/delegation-outcomes` (§7.1). Columns: timestamp, run, caller, target, scope, outcome, direction, reason. Filters across the top (caller, outcome, direction, since).

**Why optional for v1:** The core value of Phase 1 is the observability *data* (rows getting written, trace graph reconstructable). A dedicated dashboard is a nicer surface but not essential — the same information is queryable from the DB in the adjustment-period first week and surfaces via the health detectors in the existing `AdminHealthFindingsPage` once invariants are broken. Flagged in §13 as an optional Phase 1 deliverable — ship if there's time, defer to Phase 5 (polish) otherwise.

**Permission:** `org.observability.view` (see §9).

---

## 9. Permissions / RLS

### 9.1 RLS coverage

One new tenant-scoped table (§5.4):

| Table | `organisation_id` | `subaccount_id` | RLS policy in migration? | `rlsProtectedTables.ts` entry? | Route guard? | Principal context? |
|---|---|---|---|---|---|---|
| `delegation_outcomes` | yes | yes (NOT NULL — §4.4) | yes — `delegation_outcomes_org_isolation` (USING + WITH CHECK) in 0217 | yes — added in same commit | yes — `requireOrgPermission` on `/api/org/delegation-outcomes` (§7.1) | yes — reads always via `orgScopedDb` / `withPrincipalContext` |

All four RLS requirements from the Spec Authoring Checklist §4 are met for the one new tenant-scoped table.

**Existing tables modified (§5.1, §5.2, §5.3) already have RLS** and are in the manifest. The new columns and partial index inherit existing policies — no per-column RLS needed (Postgres RLS scopes by row, not by column).

### 9.2 New permission: `org.observability.view`

**Purpose:** Gate the delegation outcomes dashboard (§7.1, §8.3) and future observability surfaces (trace graph filtering, delegation direction metrics).

**Why new, not reused:**
- `org.agents.view` is agent-focused; delegation outcomes are cross-agent observability.
- `org.health_audit.view` was considered — reasonably close semantically (health audit + delegation observability both surface "system health"). However, `org.health_audit.view` is scoped specifically to the health audit feature; conflating it with delegation outcomes couples two independent surfaces. A new narrow permission is cleaner.

**Alternative considered (rejected):** Reuse `org.health_audit.view`. Rejection rationale: the health audit permission is owned by that feature's policy; dragging delegation observability under it makes it harder to grant one surface without the other. v1 adds one narrow permission; if the set of observability surfaces grows, we'll consider a role-based grouping at that point (not now).

**Permission set seeding:** Add `org.observability.view` to the system `org_admin` permission set. `system_admin` bypasses per existing convention.

**Where it's checked:** `server/routes/delegationOutcomes.ts` (new, §7.1). Client-side UI rendering respects `/api/my-permissions` as usual.

### 9.3 Run-access guard for delegation graph

`GET /api/agent-runs/:id/delegation-graph` (§7.2) reuses the route-family pattern of `/api/agent-runs/:id`: `authenticate` middleware + service-layer org-scoped lookup. No separate per-run ACL helper is invented (none exists in the repo today).

**Subtree access policy — root-grants-summary.** If the user can view the root run (the one they opened from the Brief), they see **summary-level** data for every run in the DAG returned by the graph route: `runId`, `agentId`, `agentName`, `isSubAgent`, `delegationScope`, `hierarchyDepth`, `delegationDirection`, `status`, `startedAt`, `completedAt`. These summary fields are not sensitive individually — the same data appears on the agent detail page anyone in the org can see. Cross-org jumps are impossible because the service runs under `orgScopedDb`; RLS on `agent_runs` prevents any row from a different org from being returned even if the service code drifts.

**Under the current access model, same-org users can read both graph summaries and run details.** `authenticate` + service-layer org-scoping is the only access gate in v1 (there is no per-run ACL helper — see §7.2). A user in the org who can view the graph can also navigate to each child run's detail page. The graph is a summary rendering, not a stricter permission surface. If and when a finer-grained per-run ACL lands in a future spec, this section will need re-evaluation; for v1, same-org-reads-everything is the full policy.

**What the graph response deliberately omits.** Per-run LLM payload, tool-call arguments, scratch-pad content, cost breakdowns — none appear in `DelegationGraphNode` shape (§7.2). Only the already-public summary fields ship, so per-node access checking is not required for correctness.

**Why not per-node access check in the service.** That would require threading the principal into `delegationGraphService.buildForRun` and querying per-run ACLs for every subtree node on the hot path. Given that the summary shape is already public-within-org, the check adds cost without adding safety.

### 9.4 Opt-outs

No table in this spec is intentionally non-tenant-scoped. All four RLS requirements apply to every table change listed.

---

## 10. Execution model

This spec makes five execution-model decisions. Each is stated explicitly so goals, prose, and schema stay consistent (per Spec Authoring Checklist §5).

### 10.1 Hierarchy context construction — inline / synchronous

`hierarchyContextBuilderService.buildForRun()` (§6.1) is called **synchronously** during `SkillExecutionContext` construction. The context must be fully populated before the agent run starts executing tools. Blocking cost: one indexed query against `subaccount_agents` for the active roster. Typical cost < 5ms per run.

- No pg-boss job row for hierarchy context construction.
- No caching in v1 — the roster may have changed since the last run of this agent. Per-run freshness is cheap enough.
- No retry — if the query fails, the run fails (the agent can't execute with a broken context).

### 10.2 Delegation skill validation — inline / synchronous

`spawn_sub_agents` and `reassign_task` (§6.3, §6.4) perform validation inline, before any handoff or sub-agent dispatch. The caller blocks on validation; a rejected call returns immediately with a structured error.

- No job row for the validation step.
- Job row appears only for the *accepted* delegation, on the existing `agent-handoff-run` or sub-agent dispatch queues — shape unchanged from today.

### 10.3 Delegation outcome writes — fire-and-forget, non-blocking

Writes to `delegation_outcomes` (§5.4) are **best-effort, non-blocking** from the caller's perspective. The concrete mechanism is a single entry point on `delegationOutcomeService`:

```ts
// delegationOutcomeService.ts
export async function insertOutcomeSafe(input: DelegationOutcome): Promise<void> {
  try {
    // Service-layer integrity check (§4.4, §5.4):
    await assertActorsMatchSubaccount(input);
    // Single INSERT, no transaction. Runs AFTER the parent skill's core mutation has committed.
    await orgScopedDb.insert(delegationOutcomes).values(input).execute();
  } catch (err) {
    logger.warn({ err, outcome: input }, 'delegation_outcome_write_failed');
    // Do not re-throw. Failure is absorbed.
  }
}
```

The calling skill handler invokes `insertOutcomeSafe` after its own mutation has committed (not inside the skill's transaction). This is a detached try/catch, not a post-commit hook — the hook concept was dropped as over-engineered for this volume.

- A write failure logs at WARN and does NOT fail the skill call. The delegation itself succeeded or failed for its own reason; telemetry isn't allowed to block user work.
- No job queue for outcome writes — the row is small (~100 bytes) and the volume is bounded by delegation attempts per run.
- No batching — at expected volumes (5–10 delegations per Brief, a few hundred Briefs per day across a mature org), individual INSERTs are fine.
- A `recordOutcomeStrict()` variant exists for test / backfill contexts where write failure should propagate; skill handlers never call it.

### 10.4 Orchestrator route resolution — inline / synchronous, per dispatch

`hierarchyRouteResolverService.resolveRootForScope()` (§6.6) is called **synchronously** by `orchestratorFromTaskJob` (§6.7) only. `briefCreationService` does not call the resolver; it passes `fastPathDecision.scope` into the pg-boss job payload (`enqueueOrchestratorRoutingIfEligible(task, { scope })`) and the job reads it from `job.data.scope`. One indexed query per dispatch. No caching — freshness matters (a template apply changes the root mid-day).

- Fallback paths (zero-roots, multi-roots) return the fallback agent synchronously; the health detectors fire asynchronously via the existing Workspace Health Audit scheduled run.
- The `orchestrator-from-task` pg-boss job itself is unchanged (still queued per today). The resolver runs *inside* that job's handler, not as a separate job.

### 10.5 Workspace health detectors — queued / asynchronous

The three new detectors (§6.9) plug into the existing Workspace Health Audit scheduling:

- `runAudit(orgId)` is already invoked on schedule by the existing audit worker.
- New detectors register via `workspaceHealth/detectors/index.ts` and are called in the existing audit sweep.
- Findings are written to `health_findings` via the existing dedup / resolve logic. No new job, no new queue, no new table.

Health findings about root-agent invariant violations (`subaccountMultipleRoots`, `subaccountNoRoot`) lag behind real-time. If a template apply splits brain for seconds (shouldn't, per §6.8 same-tx rotation), the detector sees it only on the next audit sweep. Acceptable — the partial unique index (§5.1) is the real-time enforcement; detectors are the backstop.

### 10.6 Run-id trace continuity invariant

Every delegation-spawned run (sub-agent via `spawn_sub_agents`, handoff via `reassign_task`) MUST preserve `runId` lineage so the DAG traversal in §7.2 cannot silently break. The invariant is stated here because it cuts across §6.3, §6.4, §7.2, and §8.2 — one canonical statement prevents drift.

**The invariant.** For every row in `agent_runs` whose existence was caused by a delegation skill call:

1. **Spawn chain.** If the row represents a sub-agent run (`isSubAgent = true`), `parentRunId` MUST equal the `SkillExecutionContext.runId` of the `spawn_sub_agents` call that created it. Never null, never rewritten.
2. **Handoff chain.** If the row represents a handoff run (created by `reassign_task`'s dispatch of `agent-handoff-run`), `handoffSourceRunId` MUST equal the `SkillExecutionContext.runId` of the `reassign_task` call. Never null, never rewritten.
3. **Both pointers when both caused it.** If a run was spawned as a sub-agent AND later had its task reassigned to it via a handoff (edge case, but possible), both `parentRunId` and `handoffSourceRunId` are populated — the former for the spawn lineage, the latter for the handoff lineage. Both MUST remain immutable once set.
4. **Telemetry alignment.** The corresponding `delegation_outcomes` row (§4.4) for an accepted delegation MUST carry the SAME `runId` as the parent pointer on the child run (`delegation_outcomes.runId === child.parentRunId` for spawns, `=== child.handoffSourceRunId` for handoffs). The write-site for `delegation_outcomes` reads `SkillExecutionContext.runId` — the same value — so this is a call-site invariant, not a reconciliation step. Error rows in `agent_execution_events` (§4.3) carry `context.runId` sourced from the same `SkillExecutionContext.runId`; a single correlated id threads every artefact the delegation produces.

**Why an explicit invariant.** The DAG traversal in §7.2 walks edges by `parentRunId === current.id` or `handoffSourceRunId === current.id`. If either pointer is null when it shouldn't be, or if the runId written to `delegation_outcomes` diverges from the runId on the parent pointer, the graph loses an edge silently — the UI renders a "disconnected" node and the rejection-telemetry metrics in §17 mis-attribute outcomes. The invariant names the call-site requirement once so every downstream consumer (graph, metrics, error log) can rely on a single correlated id per delegation.

**Where it's enforced (call-site, not reconciliation):**
- `spawn_sub_agents` handler (§6.3) sets `parentRunId = context.runId` in the sub-agent's `agent_runs` insert.
- `reassign_task` handler (§6.4) sets `handoffSourceRunId = context.runId` in the handoff run's dispatch payload, which `agentExecutionService` persists on the new run's row.
- Both handlers pass `context.runId` into `delegationOutcomeService.insertOutcomeSafe()` (§10.3).
- Error objects emitted by these handlers (§4.3) carry `context.runId` from the same source. No alternative runId source is acceptable — never regenerate, never read from another field.

**No reconciliation job.** There is no back-fill or re-linking path. The invariant holds by construction at write time, or the row is broken and must be investigated as a bug — not auto-repaired. A broken pointer in practice means a code change bypassed the handler's write site, which the type system + pure-core tests (§12) catch before merge.

### 10.7 Consistency pass (per checklist §5)

- **No pg-boss job row claimed for inline operations.** ✓ §10.1–§10.4 are explicitly inline.
- **Prose vs execution model consistency.** ✓ §6 describes synchronous service calls; §7 describes synchronous HTTP handlers; §10 pins both as inline. No "service does X" → job-row contradictions.
- **Non-functional goals.** No latency budgets or cache-efficiency claims that would contradict the model. Phase-1 adds a table write per delegation; at expected volume (<100 delegation attempts per org per day in the Automation OS internal company), this does not meaningfully change per-run latency.
- **Run-id trace continuity.** ✓ §10.6 names the cross-cutting invariant; §6.3 / §6.4 / §7.2 / §4.3 / §4.4 all source `runId` from `SkillExecutionContext.runId` at their respective write sites. No reconciliation path; invariant holds by construction or the row is a bug.

---

## 11. Phased implementation

Four phases. Each is independently shippable, commit-and-revert. Each completes a coherent slice of user-visible or operator-visible value. Dependency graph is strictly forward — Phase N never references primitives introduced in Phase N+k.

### Phase 1 — Observability foundations

**Ships:** Telemetry STORAGE (tables + columns), health detectors, and the schema to hold future telemetry. No write paths ship in Phase 1 — the `delegation_outcomes` table is empty until Phase 4 activates the write path in `spawn_sub_agents` / `reassign_task`. The `agent_runs` new columns are null on new rows until Phase 3 (hierarchy_depth) and Phase 4 (delegation_scope, delegation_direction, handoff_source_run_id) populate them. No behaviour change to delegation or routing in this phase.

**Schema (§5):**
- Migration 0216 — `agent_runs.delegation_scope`, `hierarchy_depth`, `delegation_direction`, `handoff_source_run_id` (all nullable; populated in later phases per §5.3)
- Migration 0217 — `delegation_outcomes` table + RLS + manifest entry

**Services introduced (§6):**
- `delegationOutcomeService` (new; thin wrapper over the new table, used for inserts and the admin list — writes start in Phase 4)
- Two health detectors: `subaccountMultipleRoots` and `subaccountNoRoot`. `subaccountNoRoot` is expected to fire for most subaccounts pre-Phase-2 (every subaccount currently has zero subaccount-level roots); operators treat this as the "per-subaccount CEO not yet configured" signal.
- `explicitDelegationSkillsWithoutChildren` detector is deferred to Phase 4 — it checks for agents with the delegation trio attached but no children, which is only meaningful once Phase 4's derived-skill resolution is active.

**Services modified (§6):**
- `agentExecutionService` — writes `delegation_scope` + `hierarchy_depth` columns on run rows. In Phase 1 both are null on every new row; Phase 3 starts populating `hierarchy_depth` from `context.hierarchy.depth`; Phase 4 starts populating `delegation_scope` from the dispatching skill (§5.3).

**Routes introduced (§7):**
- `GET /api/org/delegation-outcomes` + the new permission `org.observability.view`

**Client (§8):**
- `AdminDelegationOutcomesPage` — optional; see §13

**Columns referenced by code in this phase:** `agent_runs.delegation_scope`, `agent_runs.hierarchy_depth`, `agent_runs.delegation_direction`, `agent_runs.handoff_source_run_id`, `delegation_outcomes.*`. All introduced in this phase (schema only; values are null until later phases populate).

**Exit criteria:**
- Migrations 0216 + 0217 applied cleanly.
- `rlsProtectedTables` manifest covers `delegation_outcomes`; `verify-rls-coverage.sh` green.
- `subaccountMultipleRoots` and `subaccountNoRoot` detectors registered and visible in `AdminHealthFindingsPage`. `explicitDelegationSkillsWithoutChildren` is NOT registered in this phase — it depends on Phase 4's derived-skill resolution and ships with Phase 4.
- `delegation_outcomes` ships empty; `agent_runs.delegation_scope` / `hierarchy_depth` / `delegation_direction` / `handoff_source_run_id` columns exist but are null on new rows until later phases populate them.
- No-op for end users; no delegation behaviour changes.

### Phase 2 — Root contract + scope-aware routing + template picker

**Ships:** Per-subaccount CEOs. Briefs filed against a subaccount route to that subaccount's root agent instead of the hardcoded global Orchestrator. Creating a subaccount offers a starting team template.

**Schema (§5):**
- Migration 0214 — partial unique index on `subaccount_agents` for root enforcement
- Prerequisite: run `scripts/audit-subaccount-roots.ts` and resolve any pre-existing violations before applying the migration

**Services introduced (§6):**
- `hierarchyRouteResolverService` with `resolveRootForScope()`

**Services modified (§6):**
- `orchestratorFromTaskJob` — delete `ORCHESTRATOR_AGENT_SLUG` for subaccount scope; call the resolver; read `scope` from the pg-boss job payload (default `'subaccount'` for backward compat with trigger-path enqueues)
- `briefCreationService` — pass `fastPathDecision.scope` into the `enqueueOrchestratorRoutingIfEligible` call so the job payload carries it
- `hierarchyTemplateService.apply()` + `importToSubaccount()` — same-transaction root rotation (§6.8)

**Routes:** No change. Existing `POST /api/hierarchy-templates/:id/apply` is the backend verb for the template picker.

**Client (§8):**
- `AdminSubaccountsPage` — add the Starting Team picker to the full create form

**Columns referenced by code in this phase:** `subaccount_agents.parent_subaccount_agent_id` (existing), `subaccount_agents.is_active` (existing). No new columns.

**Exit criteria:**
- Migration 0214 applied cleanly; audit script shows zero violations.
- A Brief filed against a subaccount with a configured root routes to that subaccount's root, observable in the Brief detail page's handling-agent display.
- Template picker in subaccount creation successfully installs the chosen template.
- Phase-1 detectors register zero `subaccountMultipleRoots` findings; `subaccountNoRoot` findings remain at their natural count (informational, not a failure — operators assign roots when they want per-subaccount routing, and the org-level fallback continues to work in the meantime).
- Subaccount-scope routing no longer uses the hardcoded slug; `ORCHESTRATOR_AGENT_SLUG` constant retained for org-scope fallback only (§6.6 case 2). Full slug deletion deferred until §13's org-scope resolver lands.

**Why this phase before Phase 3:** the routing layer doesn't depend on hierarchy context inside skills. Per-subaccount CEOs are a user-visible win that doesn't require enforcement to land first. Also proves the root-agent contract under real traffic before the enforcement layer depends on it.

### Phase 3 — Hierarchy context + visibility layer

**Ships:** `SkillExecutionContext.hierarchy` populated per run. Three list skills respect `scope`. No execution enforcement yet — agents can still delegate anywhere, but they now *see* scoped results by default.

**Schema:** No migrations. All work is code.

**Services introduced (§6):**
- `hierarchyContextBuilderService` + `*Pure.ts`

**Services modified (§6):**
- `agentExecutionService` — populate `ctx.hierarchy` before handing context to `skillExecutor`
- `config_list_agents`, `config_list_subaccounts`, `config_list_links` — `scope` param + adaptive default

**Routes:** No change.

**Client:** No change.

**Columns referenced by code in this phase:** `subaccount_agents.parent_subaccount_agent_id` (existing), plus `agent_runs.hierarchy_depth` (introduced Phase 1) which starts getting populated from `context.hierarchy.depth`.

**Exit criteria:**
- Agents with children see a `children`-scoped list by default when calling `config_list_agents`.
- `hierarchy.depth` values start appearing on new `agent_runs` rows.
- No rejection-rate spike in delegation skills (still flat execution; Phase 4 introduces the spike).

### Phase 4 — Execution enforcement + derived skill resolution + trace graph

**Ships:** Hierarchy becomes binding. Agents can only delegate within scope. Managers emerge from graph position. The trace graph makes multi-agent fan-out legible for debugging the adjustment period.

**Schema (§5):**
- Migration 0215 — `tasks.delegation_direction` column

**Services introduced (§6):**
- `delegationGraphService` — composes subtree response for the new route
- `explicitDelegationSkillsWithoutChildren` detector — registered now that derived-skill resolution is live (moved from Phase 1 per §6.9)

**Services modified (§6):**
- `spawn_sub_agents` — `delegationScope` param + validation + outcome writes + nesting-block removal
- `reassign_task` — same, plus `delegation_direction` writes
- `skillService` (resolver) — derive delegation skills from `hierarchy.childIds`

**Routes introduced (§7):**
- `GET /api/agent-runs/:id/delegation-graph`

**Client (§8):**
- `RunTraceViewerPage` — new Delegation graph tab

**Columns referenced by code in this phase:** `tasks.delegation_direction` (introduced this phase). All Phase 1 / Phase 2 / Phase 3 columns are used — this phase introduces no backward-dependency on later work.

**Exit criteria:**
- Rejection-rate metrics show an initial spike that trends down over the first 1–2 weeks.
- Trace graph UI renders fan-out correctly for sub-agent and handoff chains.
- `config_list_agents` + `spawn_sub_agents` + `reassign_task` are automatically available to any agent with children (observable in the agent's resolved tool list, surfaced in `AgentExecutionLog` / run trace).
- `delegation_outcomes` table is receiving accept + reject rows on a best-effort basis for resolvable actors (per §4.3 / §10.3). Unresolvable-target errors and any DB-write gaps remain visible in `agent_execution_events` — that table is the lossless companion for audit-grade rejection accounting.

**Rollout posture (brief §6):**
- 1–2 week adjustment period after Phase 4 lands is expected. Prompt tweaks surface during this window.
- Violation rates are monitored via the detectors and the Phase-1 dashboard.
- No rollback required during the window; the enforcement layer is revealing prompt bugs, not introducing them.

### Phase 5 (optional — polish)

**Ships:** Remaining UX polish identified during Phase 4 rollout. Not committed up front.

**Likely candidates:**
- Admin dashboard for delegation outcomes (§8.3) if not delivered in Phase 1.
- Live updates on the delegation-graph tab via WebSocket subscription.
- Inline tooltip explanations of rejection errors in run traces.
- Export button on the outcomes dashboard.

**Pulled in based on Phase-4 friction observations.** May be empty if Phase 4 is smooth.

### Phase dependency graph (the three checks from checklist §6)

**1. Backward dependency check.** None. Every column referenced in Phase N is introduced in Phase ≤N:

| Column | Introduced in | First referenced in |
|---|---|---|
| `agent_runs.delegation_scope`, `hierarchy_depth`, `delegation_direction`, `handoff_source_run_id` | Phase 1 | Phase 1 (schema); populated Phase 3 (`hierarchy_depth`) and Phase 4 (others) |
| `delegation_outcomes.*` | Phase 1 | Phase 1 |
| partial unique index on `subaccount_agents` | Phase 2 | Phase 2 |
| `tasks.delegation_direction` | Phase 4 | Phase 4 |

**2. Orphaned deferral check.** Every "deferred" mention in this spec resolves to §13 Deferred items. No phase defers to a non-existent phase. `delegation_outcomes` retention pruning is deferred; admin dashboard (§8.3) may be deferred — both listed in §13.

**3. Phase-boundary contradiction check.** Phase 1 is "no behaviour change"; it introduces migrations but no enforcement. Phase 2 is "routing change"; it introduces one migration but no skill-execution change. Phase 3 is "no migrations, code-only." Phase 4 is "one migration + execution change." All consistent.

---

## 12. Testing plan

Per `docs/spec-context.md`: `testing_posture: static_gates_primary` + `runtime_tests: pure_function_only`. No frontend, API-contract, or E2E tests. This plan respects those defaults — every test below is either a static gate or a pure-function unit test.

### 12.1 Static gates (all phases)

**CI gates already enforced by the repo — this spec must not regress any of them:**

- `npm run typecheck` — TypeScript compiles. New interfaces in `shared/types/delegation.ts` and extended `SkillExecutionContext` must type-check across all call sites.
- `npm run lint` — ESLint passes. No new disables.
- `verify-rls-coverage.sh` — `delegation_outcomes` added to manifest in the same commit as migration 0217. Gate fails if not.
- `verify-rls-contract-compliance.sh` — no direct DB access outside `orgScopedDb` / `withAdminConnection` for the new table.
- `scripts/verify-integration-reference.mjs` — unaffected (no integration changes).

### 12.2 Pure unit tests (per-phase)

One test file per pure module. Each lives alongside its source under `__tests__/`.

**Phase 1:**
- `delegationOutcomeServicePure.test.ts` — insert-shape assembly, reason-when-rejected invariant (the CHECK constraint's logic replicated in a pure validator so callers don't surface a Postgres error). Covers: accepted-without-reason, rejected-with-reason, invalid-direction, invalid-scope.
- `workspaceHealth/detectors/subaccountMultipleRoots.test.ts` — detector pure function: given a roster, return the finding set.
- `workspaceHealth/detectors/subaccountNoRoot.test.ts` — same.

**Phase 2:**
- `hierarchyRouteResolverServicePure.test.ts` — decision tree given query results. Covers: exactly one root → none fallback; zero roots → org-root fallback; multiple roots → oldest-wins + flagged; scope=org → org-level path; scope=system → returns null.
- `scripts/audit-subaccount-roots.test.ts` (pure core) — given a roster, produce the operator checklist.

**Phase 3:**
- `hierarchyContextBuilderServicePure.test.ts` — the main workhorse. Covers: root agent (parentId null, depth 0, rootId === agentId); middle manager (parentId set, childIds populated, depth 1); leaf worker (childIds empty); cycle detection throws; depth > MAX_DEPTH throws; agent-not-in-roster throws.
- `config/configSkillHandlersPure.test.ts` (new or extend existing) — scope filter logic. Covers adaptive default (has-children → children, no-children → subaccount); explicit scope override; missing-context fallback.

**Phase 4:**
- `skillExecutor.spawnSubAgents.test.ts` — pure validation logic extracted from the handler. Covers: all-children-accepted with `delegationDirection: 'down'`; one-out-of-scope → whole call rejected with only out-of-scope targets logged as rejected; `cross_subtree_not_permitted` when `effectiveScope === 'subaccount'` regardless of caller role; `max_handoff_depth_exceeded` when `context.handoffDepth >= MAX_HANDOFF_DEPTH`. `up` and `lateral` directions are NOT valid outcomes for spawn — they're tested under `reassign_task` only.
- `skillExecutor.reassignTask.test.ts` — same shape. Covers direction computation (down / up / lateral) and the upward-escalation special case (§6.4 step 2) committed in §16.1.
- `skillService.resolver.test.ts` — pure `computeDerivedSkills({ hierarchy })` returns `[]` when childIds is empty, returns the trio when non-empty.
- `delegationGraphServicePure.test.ts` — given a flat run list, assemble the `{ nodes, edges }` graph. Covers MAX_HANDOFF_DEPTH bound, both edge types (spawn via `parentRunId`, handoff via `handoffSourceRunId`), direction sourcing (spawn→always down per §6.3; handoff→from `agent_runs.delegation_direction` on the child run, §5.3), and deduplication when a run has both a spawn-parent and a handoff-parent.
- `workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.test.ts` — detector pure function: given a roster + skill attachments, return the finding set (moved from Phase 1 to match §6.9 staggered registration).

### 12.3 Deliberate non-tests

Documented per checklist §9 — flag deviations from framing ground truth, but do not add the tests:

- **No API contract tests** for `GET /api/org/delegation-outcomes` or `GET /api/agent-runs/:id/delegation-graph`. `api_contract_tests: none_for_now`.
- **No E2E tests** for the subaccount-creation template picker. `e2e_tests_of_own_app: none_for_now`.
- **No frontend component tests** for `DelegationGraphView` or the picker. `frontend_tests: none_for_now`.
- **No performance baselines** for the hierarchy context builder or the resolver. `performance_baselines: defer_until_production`. Expected sub-5ms per run is stated as prose; we'll measure if it matters.
- **No migration safety tests** for 0214 (root enforcement). `migration_safety_tests: defer_until_live_data_exists`. Pre-production; audit script output is the safety gate.
- **No composition tests** cross-phase (e.g. "Phase 2 routing + Phase 4 enforcement together"). `composition_tests: defer_until_stabilisation`. Each phase's exit criteria are the tests; full composition validates in production use.

### 12.4 Manual verification per phase

Static gates + pure tests validate correctness. The brief's success criteria (§17) are behavioural and require manual / observational verification during rollout:

- **Phase 1:** Confirm migrations 0216 + 0217 apply cleanly and `rlsProtectedTables` manifest is green. `delegation_outcomes` ships empty — no writes until Phase 4 (§6.3 / §6.4 are the only producers). `agent_runs.delegation_scope` and `hierarchy_depth` ship null on new rows until Phase 3 populates `hierarchy_depth` from `context.hierarchy.depth` and Phase 4 populates `delegation_scope` from the dispatching skill. Health detectors register; `subaccountNoRoot` is expected to fire for most subaccounts pre-Phase-2 (intentional signal, not a bug).
- **Phase 2:** File a Brief scoped to a subaccount with a configured root; confirm it dispatches to the subaccount's root, not the global Orchestrator. Confirm the template picker installs a starting team.
- **Phase 3:** Trigger a Brief that involves a manager calling `config_list_agents`; confirm the returned list is scoped to children by default.
- **Phase 4:** Observe rejection-rate metrics over the first week post-rollout. Trend should be down; prompts should be updated as violations surface. Trace graph renders fan-out correctly for a multi-agent Brief.

These manual checks are not tests in the repo's framework; they are the exit-criteria observations for each phase.

---

## 13. Deferred items

Items mentioned in prose but intentionally not shipped in this spec. Each has a reason and a condition that would pull it forward.

- **`org`-scope and `system`-scope routing beyond the hardcoded Orchestrator.** §6.6 handles `scope === 'subaccount'` via the resolver; `scope === 'org'` still resolves to the org-level Orchestrator via the same discovery path used today (system agent + sentinel subaccount link). `scope === 'system'` returns null. **Reason:** org-scope and system-scope Briefs are rare and the hardcoded-slug path is acceptable there until there's a second system agent competing for the same role. **Pull-forward condition:** a second org-level or system-level root candidate is introduced (a separate planning-agent pattern would qualify).

- **Full deactivation audit trail on `subaccount_agents`.** §6.8 uses the existing `is_active` flag only. Audit columns (`deactivatedAt`, `deactivatedReason`, `deactivatedByUserId`) would let us trace who-deactivated-whom. **Reason:** nice-to-have, not correctness-critical. **Pull-forward condition:** first incident where a deactivation mystery requires DB forensics.

- **`delegation_outcomes` retention pruning job.** §5.4 ships unbounded retention. **Reason:** at expected volume (<100 delegations per org per day, compressed rows ~100 bytes), six months of history is <20MB per org. **Pull-forward condition:** measured row count exceeds 10M in any single org, OR query performance degrades beyond a configurable threshold on the common filters (`caller_agent_id + created_at`).

- **Live updates on the delegation graph tab.** §8.2 ships with a refresh button only. **Reason:** the graph is a historical / completed-fan-out view in 90% of cases. **Pull-forward condition:** usability feedback during Phase 4 rollout indicates the refresh friction is slowing triage.

- **`AdminDelegationOutcomesPage` dashboard.** §8.3 is flagged as optional for v1. **Reason:** the data is queryable via DB in the adjustment week; health detectors surface invariant violations without needing a dashboard. **Pull-forward condition:** operators triaging Phase 4 rollout ask for it more than twice in the first week.

- **Scope-violation per-agent rate alerting.** §6.9 has detectors for invariant violations, but not for "agent X has 40% rejection rate over the last 24h" — which would be a prompt-drift signal, not a config issue. **Reason:** not mature enough to set thresholds. **Pull-forward condition:** after ~30 days of Phase 4 operation, threshold candidates become obvious from the data.

- **Persist caller-hierarchy facts on `delegation_outcomes` rows.** v1 joins against current `subaccount_agents` for hierarchy facts (§17.1 caveat). If an agent changes position mid-week, historical metrics reflect the new position, not the position at write time. **Reason:** pre-production; roster-churn low enough that current-state joins are accurate enough. **Pull-forward condition:** roster changes become frequent enough that metric skew is misleading. Fix would add `caller_role_at_write` / `caller_parent_id_at_write` denormalised columns on the outcome row.

- **Multi-tier seeded Automation OS company.** §3.2 carries this explicitly. Restructuring `companies/automation-os/` into a 3-tier org chart (Orchestrator → department heads → specialists) is designed on a separate track. **Pull-forward condition:** this spec ships and the team wants a dogfood target for recursive delegation.

- **Seed-company dual-root cleanup before Phase 2 migration.** Per §2.1 current state, the Automation OS manifest has two `reportsTo: null` agents (Orchestrator + portfolio-health-agent). Migration 0214's partial unique index will fail if both are active on the same subaccount. **Pull-forward status:** BLOCKING for Phase 2. The Phase 2 kickoff audit (§5.1 `scripts/audit-subaccount-roots.ts`) surfaces this; the fix is either reparenting `portfolio-health-agent` under Orchestrator, or moving it to a different subaccount, or marking it inactive pre-migration. Resolution is a one-manifest-edit + re-seed; not a code change.

- **Cost rollups per subtree and performance attribution per manager.** Framing in §1 flagged these as future capabilities the primitives enable. Neither is built here. **Pull-forward condition:** the Cost / Observability working group picks up either as a first-class feature.

- **Mesh / dynamic-team / task-scoped grouping primitives.** §3.2 (plus the brief's §7) explicitly call these out-of-scope. **Pull-forward condition:** usage patterns post-Phase-4 show a sustained need for lateral collaboration that the `'subaccount'` escape hatch doesn't cleanly cover.

- **RLS-layer delegation enforcement.** §3.2 defers this. **Pull-forward condition:** sustained application-layer bypass attempts (caught via `delegation_out_of_scope` counters trending *up* over months).


---

## 14. File inventory

Single source of truth for what the spec touches. Grouped by phase; every prose reference to a new file, column, migration, table, service, or endpoint earlier in the spec appears here.

### 14.1 Phase 1 — Observability foundations

**New:**
- `migrations/0216_agent_runs_delegation_telemetry.sql` — adds `delegation_scope`, `hierarchy_depth`, `delegation_direction`, `handoff_source_run_id` columns (all nullable; §5.3)
- `migrations/0217_delegation_outcomes.sql` — creates table + RLS policy + indexes (§5.4)
- `server/db/schema/delegationOutcomes.ts` — Drizzle reflection (§5.4)
- `server/services/delegationOutcomeService.ts` + `delegationOutcomeServicePure.ts` — insert + list helpers (§6, §7.1)
- `server/services/__tests__/delegationOutcomeServicePure.test.ts` (§12.2)
- `server/services/workspaceHealth/detectors/subaccountMultipleRoots.ts` (§6.9)
- `server/services/workspaceHealth/detectors/subaccountNoRoot.ts` (§6.9)
- `server/services/workspaceHealth/detectors/__tests__/subaccountMultipleRoots.test.ts`, `subaccountNoRoot.test.ts` (§12.2)
- (`explicitDelegationSkillsWithoutChildren.ts` + its test move to Phase 4 — see §14.4)
- `server/routes/delegationOutcomes.ts` (§7.1)
- `shared/types/delegation.ts` — `DelegationScope`, `DelegationOutcome`, error-code constants, `HierarchyContext` (§4)
- (Optional) `client/src/pages/AdminDelegationOutcomesPage.tsx` (§8.3)

**Modified:**
- `server/db/schema/agentRuns.ts` — new columns
- `server/db/schema/index.ts` — export `delegationOutcomes`
- `server/config/rlsProtectedTables.ts` — add `delegation_outcomes`
- `server/services/agentExecutionService.ts` — writes new `agent_runs` columns at run construction (Phase 3 populates `hierarchy_depth`; Phase 4 populates `delegation_scope`, `delegation_direction`, `handoff_source_run_id`; Phase 1 values are null)
- `server/services/workspaceHealth/detectors/index.ts` — register two new Phase-1 detectors (`subaccountMultipleRoots`, `subaccountNoRoot`); `explicitDelegationSkillsWithoutChildren` registered in Phase 4
- `server/index.ts` — mount new route
- `server/lib/permissions.ts` — add `ORG_OBSERVABILITY_VIEW` permission key to `ALL_PERMISSIONS`; add it to the `org_admin` entry in `DEFAULT_PERMISSION_SET_TEMPLATES` (the seed consumer is `server/services/permissionSeedService.ts` which loops `DEFAULT_PERMISSION_SET_TEMPLATES` — no change needed there)
- **(Optional, if `AdminDelegationOutcomesPage` ships in Phase 1):** `client/src/App.tsx` — register `/admin/delegation-outcomes` route; `client/src/components/Layout.tsx` — add sidebar entry behind `org.observability.view` permission gate

### 14.2 Phase 2 — Root contract + scope-aware routing + template picker

**New:**
- `migrations/0214_subaccount_agents_root_unique.sql` — partial unique index (§5.1)
- `scripts/audit-subaccount-roots.ts` — pre-migration audit (§5.1, §6)
- `server/services/hierarchyRouteResolverService.ts` + `hierarchyRouteResolverServicePure.ts` (§6.6)
- `server/services/__tests__/hierarchyRouteResolverServicePure.test.ts` (§12.2)
- `client/src/components/subaccount/StartingTeamPicker.tsx` (§8.1)

**Modified:**
- `server/db/schema/subaccountAgents.ts` — add `uniqueIndex` declaration matching the partial unique index
- `server/jobs/orchestratorFromTaskJob.ts` — subaccount-scope routing now calls the resolver (reads `scope` from pg-boss job payload); `ORCHESTRATOR_AGENT_SLUG` constant retained for the org-scope fallback path (§6.6 case 2, §13). No `triggerContext` column change.
- `server/services/briefCreationService.ts` — pass `fastPathDecision.scope` into the pg-boss job payload via `enqueueOrchestratorRoutingIfEligible(task, { scope })` (no task-column change)
- `server/services/hierarchyTemplateService.ts` — same-transaction root rotation in `apply()` and `importToSubaccount()`
- `client/src/pages/AdminSubaccountsPage.tsx` — add picker + apply-on-submit (the actual create surface in the repo; `SubaccountCreatePage.tsx` does not exist)

### 14.3 Phase 3 — Hierarchy context + visibility layer

**New:**
- `server/services/hierarchyContextBuilderService.ts` + `hierarchyContextBuilderServicePure.ts` (§6.1)
- `server/services/__tests__/hierarchyContextBuilderServicePure.test.ts` (§12.2)
- `server/tools/config/__tests__/configSkillHandlersPure.test.ts` (§12.2, may extend existing)

**Modified:**
- `server/services/skillExecutor.ts` — add `hierarchy?: Readonly<HierarchyContext>` field to `SkillExecutionContext`
- `server/services/agentExecutionService.ts` — populate `ctx.hierarchy` before passing to `skillExecutor`
- `server/tools/config/configSkillHandlers.ts` — scope param + adaptive default in `executeConfigListAgents`, `executeConfigListSubaccounts`, `executeConfigListLinks` (actual implementation; the `skillExecutor.ts:1714` dispatcher thunks call these)
- `server/skills/config_list_agents.md`, `config_list_subaccounts.md`, `config_list_links.md` — Parameters sections updated to document the optional `scope` parameter (the JSON-schema source of truth for LLM-visible tool definitions lives in these markdown skill files, NOT in `actionRegistry.ts` — which hosts a different action registry)

### 14.4 Phase 4 — Execution enforcement + derived skill resolution + trace graph

**New:**
- `migrations/0215_tasks_delegation_direction.sql` (§5.2)
- `server/services/delegationGraphService.ts` + `delegationGraphServicePure.ts` (§7.2)
- `server/services/__tests__/delegationGraphServicePure.test.ts` (§12.2)
- `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts` (§12.2)
- `server/services/__tests__/skillExecutor.reassignTask.test.ts` (§12.2)
- `server/services/__tests__/skillService.resolver.test.ts` (§12.2)
- `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.ts` (§6.9 — moved from Phase 1 because the detector's invariant depends on derived-skill resolution landing in this phase)
- `server/services/workspaceHealth/detectors/__tests__/explicitDelegationSkillsWithoutChildren.test.ts` (§12.2)
- `client/src/components/run-trace/DelegationGraphView.tsx` (§8.2) — no component test per framing; tree-shaping pure logic tested in `delegationGraphServicePure.test.ts`

**Modified:**
- `server/db/schema/tasks.ts` — add `delegationDirection: text('delegation_direction')`
- `server/services/skillExecutor.ts` — `spawn_sub_agents` + `reassign_task` validation, outcome writes, direction computation, remove nesting block (§6.3, §6.4)
- `server/services/skillService.ts` — derive delegation skills in resolver (§6.5)
- `server/skills/spawn_sub_agents.md`, `reassign_task.md` — Parameters sections updated to document the optional `delegationScope` parameter (tool definition source of truth lives in the skill markdown files)
- `server/routes/agentRuns.ts` — mount `GET /api/agent-runs/:id/delegation-graph` sub-route
- `server/services/workspaceHealth/detectors/index.ts` — register `explicitDelegationSkillsWithoutChildren`
- `client/src/pages/RunTraceViewerPage.tsx` — new tab

### 14.5 Docs

- `architecture.md` — new section "Hierarchical Agent Delegation" describing the enforcement model, root-agent contract, and how it composes with capability-aware routing. Landed in the same commit as Phase 4's exit (after the full system is real, not before).
- `docs/capabilities.md` — no update needed; this is internal architecture, not customer-visible capability.
- `CLAUDE.md` — no update needed; agent fleet unchanged.
- `KNOWLEDGE.md` — update with at least one lesson per phase during rollout (expected).

### 14.6 Consistency audit summary

Every prose reference in §2 through §11 is accounted for in this inventory:

| Prose mention (sample) | Inventory line |
|---|---|
| "new `delegation_outcomes` table" (§1, §5.4) | §14.1 — `migrations/0217`, `server/db/schema/delegationOutcomes.ts` |
| "partial slug removal (subaccount-scope only)" (§1, §6.7) | §14.2 — `server/jobs/orchestratorFromTaskJob.ts` modified; `ORCHESTRATOR_AGENT_SLUG` retained for org-scope fallback per §6.6 case 2 |
| "new `hierarchyContextBuilderService`" (§6.1) | §14.3 — two new files + test |
| "`tasks.delegation_direction` column" (§5.2) | §14.4 — migration 0215 + schema change |
| "three new detectors" (§6.9) | §14.1 — two new files (`subaccountMultipleRoots`, `subaccountNoRoot`) under `workspaceHealth/detectors/`. Third detector (`explicitDelegationSkillsWithoutChildren`) ships in Phase 4 — §14.4. |
| "`GET /api/org/delegation-outcomes`" (§7.1) | §14.1 — `server/routes/delegationOutcomes.ts` |
| "Starting team picker" (§8.1) | §14.2 — `StartingTeamPicker.tsx` new + `AdminSubaccountsPage.tsx` modified |
| "delegation graph tab" (§8.2) | §14.4 — `DelegationGraphView.tsx` + `RunTraceViewerPage.tsx` |

If a future prose mention is added that doesn't appear here, the spec-reviewer will raise a `file-inventory-drift` finding.

---

## 15. Risks & mitigations

### 15.1 Phase 4 rollout friction (expected, not a surprise)

**Risk:** When execution enforcement lands, existing agent prompts that assume flat delegation will produce `delegation_out_of_scope` and `cross_subtree_not_permitted` rejections. Rejection rate spikes in the first week.

**Likelihood:** High. **Impact:** Medium — agents appear broken until prompts adjust; user-facing failures are contained to Brief-handling regressions, not platform outages.

**Mitigation:**
- Phase 1 ships the observability storage (tables + columns + detectors) but NOT the write paths or graph UI (those ship in Phase 4, same commit as enforcement). So "observability" in Phase 1 means "storage and detectors exist"; the actual rows and graph rendering arrive together with the enforcement code that produces them. This is still a dependency-ordering win — the detectors for invariant violations register early, and the schema is ready so Phase 4's code change is all-runtime-no-DDL.
- Brief §6 budgets 1–2 weeks of prompt tweaks as the intended Phase 4 rollout posture. During this window, the team reviews outcome rows directly from the database using the query patterns in §17.1 / §17.2 / §17.3 (ad-hoc SQL against `delegation_outcomes`) and from `agent_execution_events` for lossless rejection signals. The `AdminDelegationOutcomesPage` dashboard (§8.3) is a nicer surface but is optional — daily review does not depend on it. If the dashboard ships with Phase 4, it's the primary surface; otherwise the SQL queries in §17 are.
- Rejections return structured errors with `suggestedScope` hints where possible (see §4.3) so the agent's next attempt is informed, not random.

### 15.2 Split-brain root window during template re-apply

**Risk:** If two template applies execute concurrently against the same subaccount, or if the same-transaction root rotation (§6.8) has a bug, two rows briefly satisfy the root predicate.

**Likelihood:** Low. **Impact:** High — non-deterministic routing, "wrong CEO" behaviour for any Briefs dispatched in that window.

**Mitigation:**
- Partial unique index (§5.1) makes the two-active-roots state impossible post-migration — Postgres rejects the second insert.
- Same-transaction rotation in `hierarchyTemplateService.apply()` / `importToSubaccount()` (§6.8) closes the window at the service layer.
- `subaccountMultipleRoots` health detector fires if the invariant is ever violated (pre-migration window, bad DB edit, etc).
- Template apply is not expected to be a hot path — apply-to-subaccount runs during subaccount creation or admin-initiated template switches, both low-frequency.

### 15.3 Hierarchy context staleness within a long-running agent run

**Risk:** `context.hierarchy` is an immutable per-run snapshot (§4.1). If an agent run spans many minutes and the roster changes mid-run (manager loses a child, template is re-applied), the run still sees the old graph.

**Likelihood:** Medium (for long runs). **Impact:** Low — the run completes based on stale context, next run picks up fresh context. In the worst case, a delegation targeted at a since-deleted child fails at the execution layer (not a `delegation_out_of_scope` error, but a different "target not found" error that already exists today).

**Mitigation:**
- Immutability is the design decision, not a bug (§4.1 contract). We accept the staleness because the alternative — re-querying mid-run — creates TOCTOU races, non-determinism, and complicates the mental model.
- Long agent runs are bounded by existing run-cost breakers and timeouts (`server/lib/runCostBreaker.ts`, `SkillExecutionContext.timeoutMs`). A run that encounters stale-context errors will fail fast and retry from scratch.
- Document the behaviour in `architecture.md` at Phase 4 landing (§14.5).

### 15.4 Adaptive default producing surprising visibility changes

**Risk:** When Phase 3 ships, a manager agent's default view via `config_list_agents` shifts from "whole subaccount" to "my children only." An agent prompt written against the old behaviour (e.g. "scan the Marketing team for a candidate") may now return zero results.

**Likelihood:** Medium. **Impact:** Low — the agent receives an empty list and can explicitly pass `scope: 'subaccount'` to get the old behaviour; the explicit path is documented in the skill's tool definition.

**Mitigation:**
- Adaptive default only bites for agents with children. In the current seeded company, only the Orchestrator has children (15 of them). Post-seed-reorg (out of scope here) that number grows to ~5 managers.
- Prompt tweaks are part of the Phase 3 exit criteria — the same team that drafts system prompts reviews outputs during Phase 3 rollout.
- The escape hatch (explicit `scope: 'subaccount'`) keeps the old behaviour one parameter away.

### 15.5 Upward-reassign resolution — contract now fixed

**Resolution:** §16.1 committed option (b). §6.4 step 2 implements the narrow special case.

**Residual risk:** Implementation of §6.4 step 2 must compile the special-case check before the generic scope validation — order matters. A Phase 4 code review should confirm the validator orders the special case first; otherwise the upward-reassign path rejects before the special case fires. Covered by the §12.2 `skillExecutor.reassignTask.test.ts` unit test (direction computation must include the special-case path).

**Impact:** Low — the contract is fixed; only a code-ordering bug could regress it.

### 15.6 `delegation_outcomes` write failure cascading to skill failure

**Risk:** If the `delegation_outcomes` insert throws inside the skill handler (DB hiccup, transaction isolation, etc.), a naive implementation fails the skill call — which converts a telemetry problem into a real user-facing delegation failure.

**Likelihood:** Low. **Impact:** Medium — fails delegations that should succeed.

**Mitigation:**
- §10.3 pins the mechanism: skill handlers call `delegationOutcomeService.insertOutcomeSafe()` AFTER their own mutation commits. `insertOutcomeSafe` is a detached try/catch — the only entry point from skill handlers. Errors are swallowed and logged at WARN. The alternative `recordOutcomeStrict()` (for tests / backfills) is not called from skill handlers.
- Monitored via platform-level DB error logs — if `delegation_outcome_write_failed` starts appearing at volume, it's a DB health issue, not a spec issue.

### 15.7 Seeded company stays flat after spec lands

**Risk:** The seeded Automation OS company is still flat after Phase 4. Managers-must-have-children logic applies to zero agents. The new infrastructure is invisible in the product until someone restructures.

**Likelihood:** High (by construction — seed reorg is explicitly out of scope). **Impact:** Low — the infrastructure is still correct; it just isn't exercised.

**Mitigation:**
- §3.2 states this explicitly. Seed reorg is a separate track.
- The four phases are each shippable standalone — they deliver value (observability, per-subaccount CEOs, visibility scoping, enforcement) regardless of whether a tree exists to enforce against.
- Phase-1 detectors fire `subaccountNoRoot` findings for every subaccount until someone assigns roots — this is the intended signal, not a bug. The findings tell operators "you haven't configured a team yet."

### 15.8 `agent_execution_events` dual-write failure for delegation errors

**Risk:** §4.3 specifies that every delegation skill error is *also* written to `agent_execution_events` with the same `{ code, context }` payload — this is the "lossless Live Execution Log" guarantee that backstops `delegation_outcomes` drops (§10.3). If the event-log write itself throws inside the skill handler (DB hiccup, RLS mismatch, transaction isolation, etc.), a naive implementation either (a) fails the skill call — converting a telemetry problem into a user-facing delegation failure — or (b) silently swallows the error and the Live Execution Log loses the one signal §10.3 promised would always be present.

**Likelihood:** Low. **Impact:** Medium — depending on the naive branch, either fails delegations that should succeed, or creates a blind spot in the lossless-log contract that `delegation_outcomes`-drop tolerance depends on.

**Mitigation:**
- The event-log write mirrors §10.3's pattern: skill handlers call an `insertExecutionEventSafe()` entry point on the existing `agentExecutionEventService`, which is a detached try/catch — errors are swallowed and logged at WARN under a distinct tag (`delegation_event_write_failed`) so they are distinguishable from `delegation_outcome_write_failed`. The skill call does not fail on event-log write failure.
- The error is still returned to the caller (the agent's prompt) with the full `{ code, message, context }` payload, so even in the degenerate case where both `delegation_outcomes` AND `agent_execution_events` writes are dropped, the agent itself sees the rejection and adjusts. The log surfaces are telemetry, not enforcement.
- Monitored via platform-level DB error logs — sustained `delegation_event_write_failed` volume is a DB health issue, not a spec issue. If it trends with `delegation_outcome_write_failed`, it's shared infra (connection pool, RLS, tenant-scope config); if it trends alone, the event-log write site needs investigation.
- The dual-write is sequenced AFTER the parent skill's core mutation commits (same discipline as `delegationOutcomeService.insertOutcomeSafe()` in §10.3). Neither telemetry write is ever in the skill's critical-path transaction.

---

## 16. Open questions

Open questions that must be resolved before or during implementation. Each is scoped so `spec-reviewer` or the implementing session can make the call without reopening design.

### 16.1 Upward reassign for non-root agents — RESOLVED

**Status:** Resolved by `spec-reviewer` in review round 1. Committed: **option (b)** — narrow special case. Implementation reflected in §6.4 step 2.

**The question (historical, for context):** Brief §9 decision 4 said "upward escalation is allowed, logged." The strict reading of §6.3 / §6.4 blocked it for non-root agents because their adaptive default is `subaccount`-requires-root, and `children` / `descendants` scopes don't include the parent.

**Resolution options considered:**

- **(a) Drop it.** Only roots can upward-reassign. Dropped — contradicts brief's commitment.
- **(b) Narrow special case — CHOSEN.** `reassign_task` allows a target equal to `context.hierarchy.parentId` regardless of `delegationScope`. Separate `delegationDirection: 'up'` path, written with that direction. Minimal additional surface.
- **(c) Introduce `delegationScope: 'parent'`.** Rejected — adds vocabulary for a single-target case.
- **(d) Introduce a separate `escalate_upward` skill.** Rejected — adds platform surface.

**Rationale for (b):** Single line in the `reassign_task` validator (§6.4 step 2). Preserves brief's intent. Only the immediate parent is special-cased; deeper upward hops (grand-parent etc.) require the two-step "escalate to parent → parent escalates further" pattern.

### 16.2 `org.observability.view` vs `org.health_audit.view` — RESOLVED

**Status:** Resolved by `spec-reviewer` in review round 1. Committed: **option (a)** — new permission `org.observability.view`. §9.2 stands.

**Rationale:** Cheap to add one permission; expensive to split one later. Future observability features (trace-graph dashboards, metric drill-downs) will grant cleanly under the new key without retrofitting the health-audit permission.

### 16.3 Seed organisations without any root agents during Phase 2 rollout — RESOLVED

**Status:** Resolved by `spec-reviewer` in review round 1. Committed: **option (a)** — no auto-creation. Fallback is clean; let the operator opt in to per-subaccount CEOs by assigning a root when they want one.

**Rationale:** Auto-creating roots pollutes the data with placeholder links that operators will have to clean up. The fallback path (§6.6) is the intended behaviour pre-configuration; the `subaccountNoRoot` detector is the nudge for operators to set a root when they want one.

### 16.4 Should `scope: 'descendants'` compute the subtree pure or via recursive CTE? — RESOLVED

**Status:** Resolved by `spec-reviewer` in review round 1. Committed: **option (a)** — pure function over the full roster. §6.2's "recursive CTE" language already updated to reflect this (no CTE; pure TS downward walk).

**Rationale:** Reuses `hierarchyContextBuilderService`'s pure walk. Cheap at expected sizes (<100 agents per subaccount). Simpler to test (no DB in the unit test).

### 16.5 `hierarchyDepth` column population for existing `agent_runs`

**The question:** §5.3 adds nullable `hierarchyDepth` to `agent_runs`. Existing rows have null. Do we backfill historical runs (expensive; requires reconstructing roster-at-the-time) or accept null-for-historical?

**Resolution options:**

- **(a) No backfill (recommended).** Null is the honest value for pre-Phase-1 runs. New rows always populated.
- **(b) Backfill with current-roster depth.** Misleading (roster may have changed since the run); introduces false data.

**Spec author's recommendation:** (a). No backfill. Documented in §5.3.

**Who decides:** Already decided in §5.3; listed here for completeness.

---

## 17. Success criteria

Behavioural success criteria from the brief (§8 of `docs/hierarchical-delegation-dev-brief.md`), promoted here with concrete measurements. Each is observable against `delegation_outcomes` + `agent_runs.delegation_direction` / `.delegation_scope` + run traces. `tasks.delegation_direction` is the current-task marker (§5.2); it answers "what direction was this task LAST reassigned" which is orthogonal to the per-delegation audit in `delegation_outcomes`.

### 17.1 Managers predominantly delegate within their subtree

**Measurement:** Post-Phase-4 adjustment period (day 14+), for each agent with children per the CURRENT `subaccount_agents` roster (join `delegation_outcomes.caller_agent_id → subaccount_agents.id` and filter to callers with any child `WHERE parent_subaccount_agent_id = caller.id AND is_active = true`), ratio of `delegation_outcomes` rows where `outcome = 'accepted'` AND `delegation_scope IN ('children', 'descendants')` AND `delegation_direction = 'down'` to total accepted outcomes for that caller.

**Important caveat.** This metric joins against CURRENT roster state, not write-time state. If an agent had children last week but doesn't today, its historical outcomes are excluded from "manager" aggregation even though the delegations happened under the managerial context. Acceptable in v1; §13 lists "persist caller-hierarchy facts at write time" as a future pull-forward if this skew matters.

**Target:** ≥95% for every current manager agent over a rolling 7-day window.

**What a violation means:** an agent whose ratio stays below 95% after the adjustment period has a prompt bug (treating `'subaccount'` as normal operation, per brief §5.3 on escape-hatch intent). Flagged for prompt review.

**Caveat:** `delegation_outcomes` writes are best-effort (§10.3). Metric is advisory — a sudden gap can be a DB-write blip, not a behaviour change. Cross-check against `agent_execution_events` rejection signals before concluding a prompt bug.

**Query pattern:** `SELECT caller_agent_id, COUNT(*) FILTER (WHERE delegation_scope IN ('children', 'descendants') AND delegation_direction = 'down') * 100.0 / COUNT(*) FROM delegation_outcomes WHERE outcome = 'accepted' AND created_at > NOW() - INTERVAL '7 days' GROUP BY caller_agent_id HAVING COUNT(*) > 10;`

### 17.2 Cross-team hops happen via nearest common ancestor

**Primary invariant (non-lossy enforcement):** The `skillExecutor.ts` validator for `reassign_task` rejects any call with `effectiveScope === 'subaccount'` where the caller is not the configured root (§6.4 step 3). This is a hard code path — every rejected call returns a structured error to the agent before any task state mutates. The invariant is enforced by code, not by the telemetry table.

**Advisory measurement (best-effort signal):** Count of `delegation_outcomes` rows with `delegation_direction = 'lateral'` where the caller is NOT the current subaccount root (join `delegation_outcomes.caller_agent_id → subaccount_agents.id` and filter `WHERE parent_subaccount_agent_id IS NOT NULL`). Join is against current roster for the same reason as §17.1. This count should be zero given the primary invariant; a non-zero count is a SIGNAL that something bypassed the validator (test harness gap, data edit, etc.).

**Advisory target:** Zero. Because outcome writes are best-effort (§10.3), a true zero count does not prove zero events; it just fails to disprove. Pair with: audit `agent_execution_events` for `delegation_out_of_scope` / `cross_subtree_not_permitted` rejections (these are lossless because they're in the agent's own execution log).

**What a non-zero count means:** a code bug in `skillExecutor.ts` validation — NOT a prompt or data bug. Triggers immediate investigation, cross-checked against `agent_execution_events`.

### 17.3 Violation rates trend down after the adjustment period

**Measurement:** Daily count of `delegation_outcomes` rows where `outcome = 'rejected'`, grouped by caller and rejection reason. Fit to a rolling 7-day window starting at Phase 4 launch.

**Target:**
- Day 1–7: rejection rate elevated (expected adjustment period — no target).
- Day 8–14: declining trend for every caller that had rejections in week 1.
- Day 15+: plateau at <5% of total delegation attempts for any caller over a rolling 7-day window.

**What a violation means:** a caller whose rejection rate stays above 5% after day 14 has prompt debt. Feeds into a prompt-review checklist (not spec'd here; ops process).

### 17.4 Delegation traces are explainable in one pass

**Measurement:** Qualitative — an engineer or operator opening `RunTraceViewerPage` → Delegation graph tab for a multi-agent Brief should be able to answer "why did X delegate to Y" in a single read without leaving the page.

**Target:** Five randomly-sampled multi-agent Briefs post-Phase-4 all pass the test during a dogfood review session. Failures drive UI iteration (Phase 5 polish).

**What a violation means:** the trace graph or node tooltips are missing a key piece of context (e.g. rejection reason not visible on failed delegations). Iteration target, not a launch blocker.

### 17.5 Infrastructure integrity

**Measurement:** Post-launch health detector state:
- `subaccountMultipleRoots` — zero findings (if any, partial unique index was violated or race occurred).
- `subaccountNoRoot` — acceptable number (depends on operator choices; not a success threshold, just observable).
- `explicitDelegationSkillsWithoutChildren` — informational count; not a target. Operators review when the count changes materially to verify the attachments are still intentional.

**Target:** Zero `subaccountMultipleRoots` findings at steady state. Every other detector is informational.

### 17.6 Implementation efficiency

**Measurement (vanity, for retrospective):**
- Total LOC added across all four phases: target <3,500 lines including tests. (Revised up from an earlier 2,500-line estimate after §14 file inventory grew during review.)
- Number of new files: the §14 inventory currently lists ~25 new files across all phases (including tests, pure-core pairs, detectors, client components, and the one new table + migrations). Target is not a strict cap — the file count reflects the pure+impure convention (each service doubles file count) and per-detector-test convention. Informational only.
- Static gate passes first try rate: target ≥80% of commits (measures spec-to-code fidelity).

**Not a launch gate.** Informational for the retrospective that feeds `KNOWLEDGE.md` entries.

---

## Self-consistency pass (per checklist §8)

Final pass over the spec before handing to `spec-reviewer`. Each question answered.

**Do Goals/Philosophy match Implementation?**
- §1's nine-change enumeration maps one-to-one to §5–§8 artefacts. ✓
- §3.2 out-of-scope items (mesh, cost rollups, role enums) have no prose references in §5–§8 that contradict them. ✓
- Brief's "hierarchy enforcement is intentionally minimal" (§5.0 of brief) is mirrored in spec §3.2 and §10. ✓

**Does every phase item have an explicit verdict?**
- Every item in §11's phase-to-item tables has a phase assignment.
- Every item in §13 Deferred is labelled "deferred" with a pull-forward condition.
- §16 open questions have a recommendation + decision owner, not left abstract. ✓

**Does every "single source of truth" claim survive?**
- §4.3 / §4.4 frame `delegation_outcomes` as the **primary** source of delegation telemetry (best-effort; scope-validation rejections with resolvable actors). Unresolvable-target errors and any DB-write gaps surface via `agent_execution_events` (the lossless companion). Two-table model is consistent across §4.3, §10.3, §17.2-3 after iter3/iter4/iter5 clean-up. ✓
- §5.5 claims the Files-to-change table is the single source for schema changes. §14 mirrors and extends. ✓
- §6.6 claims `hierarchyRouteResolverService` is the canonical root-finding path post-Phase-2. §6.7 confirms the only caller change is `orchestratorFromTaskJob`; §6.8 doesn't call it (template apply handles root-rotation directly on the table). ✓

**Do non-functional claims match execution model?**
- §6.1 claims "< 5ms per run" for hierarchy context construction. §10.1 states this is synchronous / no cache. Internally consistent — one indexed query, bounded roster. ✓
- §5.4 claims retention is unbounded in v1. §13 has the deferral with a pull-forward condition. ✓
- No cache-efficiency targets; no contradictions.

**Do load-bearing claims have named mechanisms?**
- "Exactly one active root per subaccount" — §5.1 partial unique index + §6.8 same-transaction rotation + §6.9 detectors. ✓
- "Managers get delegation skills derived at runtime" — §6.5 resolver logic. ✓
- "Hierarchy context is read-only" — §4.1 `Readonly<>` type + §6.1 `Object.freeze()`. ✓
- "Phase 1 MUST ship before Phase 4" — §11 dependency graph + §15.1 mitigation. ✓

Spec is internally consistent. Ready for `spec-reviewer`.
