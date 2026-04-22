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

**Scope of enforcement — one-line contract.** Hierarchy enforcement is intentionally minimal: it constrains *delegation*, not agent cognition, planning, or capability selection.

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
   - 5.3 `agent_runs` — `delegation_scope` + `hierarchy_depth` columns
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

1. **Observability foundations (Phase 1).** A new `delegation_outcomes` table records every delegation attempt (accepted or rejected) with caller, target, scope, and reason. Three new health detectors fire on hierarchy invariant violations. The Run Trace Viewer gains a delegation-graph view that stitches parent / sub-agent runs into a single legible tree.

2. **Root-agent contract (Phase 2).** Partial unique index on `subaccount_agents (subaccount_id) WHERE parent_subaccount_agent_id IS NULL AND is_active = true` — exactly one active root per subaccount. `hierarchyTemplateService.apply()` and `importToSubaccount()` gain same-transaction root rotation so re-applies don't split-brain.

3. **Scope-aware orchestrator routing (Phase 2).** New `hierarchyRouteResolverService.resolveRootForScope(orgId, subaccountId, scope)` becomes the canonical way to find the entry-point agent. `orchestratorFromTaskJob` replaces the hardcoded `'orchestrator'` slug with this resolver; `briefCreationService` passes the triage classifier's `scope` in. Graceful degradation paths (zero-roots, multi-roots) fall back with structured logs that fire the Phase 1 detectors.

4. **Hierarchy context (Phase 3).** `SkillExecutionContext` gains a read-only `hierarchy: { parentId, childIds, depth, rootId }` snapshot built once per run by `hierarchyContextBuilderService`. Three existing list skills (`config_list_agents`, `config_list_subaccounts`, `config_list_links`) gain an optional `scope: 'children' | 'descendants' | 'subaccount'` parameter with adaptive default (`children` if the caller has subordinates, otherwise `subaccount`).

5. **Delegation execution enforcement (Phase 4).** `spawn_sub_agents` and `reassign_task` gain a `delegationScope` parameter with the same vocabulary. Validation runs at call time: `children` asserts `target.parentSubaccountAgentId === caller.agentId`; `descendants` asserts the target is in the caller's subtree; `subaccount` is root-agent-only. Two new structured error codes: `delegation_out_of_scope` and `cross_subtree_not_permitted`. Upward reassigns (non-root agent → its parent) are allowed and marked `delegationDirection: 'up'`.

6. **Derived delegation skills (Phase 4).** The skill resolver unions the agent's attached skills with a graph-derived set: when `context.hierarchy.childIds.length > 0`, add `config_list_agents` + `spawn_sub_agents` + `reassign_task` to the available tools for this run. Managers become managers by having children; workers stop being managers by losing them. No attachment, no role enum, no drift.

7. **Slug removal (Phase 2).** `const ORCHESTRATOR_AGENT_SLUG = 'orchestrator'` in `server/jobs/orchestratorFromTaskJob.ts:21` is deleted. The resolver replaces it.

8. **Subaccount template picker UX (Phase 2).** The subaccount creation form gains a "Starting team" dropdown that lists available hierarchy templates and calls `POST /api/hierarchy-templates/:id/apply` on submit. Backend verb already exists.

9. **Run trace delegation graph (Phase 4).** `RunTraceViewerPage` gains a tree view that cross-references `agent_runs.parentRunId` / `isSubAgent` / `handoffDepth` / `handoffSourceRunId` and renders the full fan-out as a collapsible graph. Reads existing columns — no new persistence.

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

**Seeded company with flat hierarchy.** `companies/automation-os/automation-os-manifest.json` defines 16 agents: the Orchestrator (root, `reportsTo: null`) and 15 direct reports. Every non-Orchestrator agent has `reportsTo: orchestrator`. There is no middle-management tier in the seeded data. `scripts/seed.ts` resolves `reportsTo` strings into FK IDs at seed time — the seed script already handles arbitrary-depth trees; the flatness is a data choice, not a limitation.

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

**Run trace.** `agent_runs` already carries `parentRunId`, `isSubAgent`, `parentSpawnRunId`, `handoffDepth`, `handoffSourceRunId` — the data needed to reconstruct a delegation graph exists. `client/src/pages/RunTraceViewerPage.tsx` renders single-run detail. No cross-run tree view yet.

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
- `subaccount_agents` — partial unique index for root-agent contract (migration 0202).
- `tasks` — new `delegation_direction` text column (migration 0203).
- `agent_runs` — new `delegation_scope` text column + `hierarchy_depth` smallint column (migration 0204).
- `delegation_outcomes` — new table with RLS policy + `rlsProtectedTables` manifest entry (migration 0205).

**Services (§6):**
- `hierarchyContextBuilderService` — new pure + impure service for building `context.hierarchy` snapshots.
- `hierarchyRouteResolverService` — new service: `resolveRootForScope(orgId, subaccountId, scope) → agentId`.
- Extensions to: `config_list_agents`, `config_list_subaccounts`, `config_list_links` (scope param + adaptive default); `spawn_sub_agents` and `reassign_task` (`delegationScope` param + validation + outcome logging); `orchestratorFromTaskJob` (scope-aware dispatch, slug removal); `briefCreationService` (pass `scope` into dispatch); `hierarchyTemplateService.apply()` + `importToSubaccount()` (same-transaction root rotation); skill resolver in `skillService` (derive delegation skills from `hierarchy.childIds`).
- Three new Workspace Health detectors: `subaccountMultipleRoots`, `subaccountNoRoot`, `managerWithoutDerivedSkills`.

**Routes (§7):**
- `GET /api/org/delegation-outcomes` — list outcomes with filters (admin only).
- `GET /api/runs/:runId/delegation-graph` — returns the run's fan-out tree for the trace-graph UI.

**Client (§8):**
- `SubaccountCreatePage` — new "Starting team" dropdown, calls `apply` after create.
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

Nothing in this spec depends on work outside `main`. All prerequisite primitives (hierarchy schema, Universal Brief, triage classifier, hierarchy templates, run-trace fields, Workspace Health framework, `rlsProtectedTables` manifest) are on main as of 2026-04-22.

### 3.4 Primitive reuse decisions

Every new primitive has a justification for not-reusing:

| Proposed primitive | Reused? | Rationale |
|---|---|---|
| `HierarchyContext` object on `SkillExecutionContext` | **Extend** existing `SkillExecutionContext` | Brief §5.1: scalar `parentAgentId` is too thin for skill logic (skills need children + depth + root). A new field on the existing struct is cheaper than a parallel context object. |
| `hierarchyContextBuilderService` | **New** | No existing builder composes parent + children + depth + root for a single agent. The shape is too specific to fit into `hierarchyService.ts` (which handles validation, not context construction). Pure shape-derivation logic lives in `*Pure.ts` per convention. |
| `hierarchyRouteResolverService.resolveRootForScope()` | **New** | The closest existing logic is the hardcoded-slug lookup in `orchestratorFromTaskJob.ts:21`. That's being deleted — the new resolver replaces it. Not reusable from `orchestratorFromTaskJob` because `briefCreationService` also needs to call it (§6.7). |
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
  /** The caller's parent agent id. Null iff the caller is the subaccount root. */
  parentId: string | null;
  /** Direct reports only. Empty array for leaf agents. Ordered by createdAt asc for determinism. */
  childIds: string[];
  /** 0 at the root, incremented per level walking down. Bounded by MAX_DEPTH = 10. */
  depth: number;
  /** The subaccount root's agent id. Equals `agentId` if the caller is the root. */
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

**Nullability and defaults:**
- `parentId` is `null` iff the caller's `parentSubaccountAgentId IS NULL` (the subaccount root).
- `childIds` is always an array (empty for leaves, never null).
- `depth` is always present and non-negative. `0` for root.
- `rootId` is always present. Equals `context.agentId` for the root.
- The entire `hierarchy` field on `SkillExecutionContext` is optional (`hierarchy?: HierarchyContext`). Skills that don't need it don't pay for it. Missing `hierarchy` in a skill that needs it is a contract bug — the skill must fail closed with `hierarchy_context_missing` (a structured error, §4.3).

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

| Value | Visibility layer (§6.2) | Execution layer (§6.3 / §6.4) |
|---|---|---|
| `children` | Return agents where `parentSubaccountAgentId === caller.agentId`. | Assert `target.parentSubaccountAgentId === caller.agentId`; reject with `delegation_out_of_scope` if not. |
| `descendants` | Return every agent in the caller's subtree (walk downward, bounded by `MAX_DEPTH`). | Assert the target is in the caller's subtree (upward walk from target → caller); reject with `delegation_out_of_scope` if not. |
| `subaccount` | Return every active agent in the subaccount (current flat behaviour). | Accept any target in the subaccount. **Only callable when `caller.hierarchy.parentId === null`** (the caller is the subaccount root); reject with `cross_subtree_not_permitted` otherwise. |

**Adaptive default.** When the caller does not pass a `scope` / `delegationScope`:
- If `context.hierarchy.childIds.length > 0` → default is `children`.
- Otherwise (leaf agents, includes root if root has no children yet) → default is `subaccount`.

Computed once per call, inside the skill handler, before validation. The adaptive default is a *default* — callers can always override with an explicit value, subject to the same validation rules.

**Producer:** Skill handler call-site (explicit or adaptive).
**Consumer:** Validation in `spawn_sub_agents` / `reassign_task` (§6.3 / §6.4); filter in the three list skills (§6.2).

### 4.3 Delegation skill error codes

Structured errors returned by `spawn_sub_agents` and `reassign_task` when validation fails. Shape follows the existing structured-error convention used elsewhere in `skillExecutor.ts` — `{ success: false, error: { code, message, context } }`.

**`delegation_out_of_scope`** — target is not within the resolved scope for this call.

```json
{
  "success": false,
  "error": {
    "code": "delegation_out_of_scope",
    "message": "Target agent agt_marketing_x is not a direct report of caller agt_sales_mgr under scope 'children'.",
    "context": {
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
      "callerAgentId": "agt_sales_mgr",
      "callerParentId": "agt_orch_abc",
      "suggestedScope": "descendants"
    }
  }
}
```

**`hierarchy_context_missing`** — emitted when a skill that requires `context.hierarchy` is invoked without it. Represents a construction-path bug (should never happen in practice; fail-closed safety net).

```json
{
  "success": false,
  "error": {
    "code": "hierarchy_context_missing",
    "message": "Skill config_list_agents requires context.hierarchy but it was not provided. This is a bug in context construction.",
    "context": { "runId": "run_abc", "agentId": "agt_sales_mgr" }
  }
}
```

**Producer:** Skill handlers in `skillExecutor.ts`.
**Consumer:** Caller's prompt (agent sees the error and adjusts). Also written to `agent_execution_events` per existing conventions so the error appears in the Live Execution Log.

**Side-effect on rejection.** Every rejection writes a row to `delegation_outcomes` (§4.4) with `outcome = 'rejected'` and `reason = error.code`. Successful delegations write `outcome = 'accepted'`. This is the sole source of delegation telemetry — it supersedes ad-hoc log counters.

### 4.4 `DelegationOutcome` row shape

**Name:** `delegation_outcomes` (Drizzle table)
**Type:** Postgres table with RLS, tenant-scoped (organisation_id + subaccount_id). Schema in §5.4.
**Shape (as TypeScript interface):**

```ts
export interface DelegationOutcome {
  id: string;                      // uuid
  organisationId: string;          // RLS scope
  subaccountId: string | null;     // RLS scope; null only if the run was org-scoped (rare)
  runId: string;                   // the run that invoked the skill
  callerAgentId: string;           // the delegating agent
  targetAgentId: string;           // the proposed delegate
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
- `subaccountId` nullable (for org-scoped runs). `organisationId` always set.
- `reason` null iff `outcome = 'accepted'`. Zod check enforces this at write time.
- `delegationDirection` always set — derived by the skill handler from `caller.hierarchy` + target position:
  - `down` — target is a descendant of caller (including direct child).
  - `up` — target is an ancestor of caller (typically the caller's parent).
  - `lateral` — target is neither (escape hatch path; root-agent-only when accepted).

**Producer:** `spawn_sub_agents` and `reassign_task` after validation decides accept/reject. Write is best-effort and non-blocking — a write failure logs at WARN and does not fail the skill call. (The primary function of these skills is delegation; outcome logging is telemetry.)
**Consumers:**
- Health detectors (§6.9) — `subaccountNoRoot` / `subaccountMultipleRoots` do not read this table; `managerWithoutDerivedSkills` doesn't either — those detectors query the schema directly. But future detectors (e.g. "agent with sustained rejection rate") will read this table.
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

**Migration:** `0202_subaccount_agents_root_unique.sql` (Phase 2).

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

**Migration:** `0203_tasks_delegation_direction.sql` (Phase 4).

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

### 5.3 `agent_runs` — `delegation_scope` + `hierarchy_depth` columns

**Migration:** `0204_agent_runs_delegation_telemetry.sql` (Phase 1 — the values are written regardless of whether enforcement is on).

**Change:**

```sql
ALTER TABLE agent_runs
  ADD COLUMN delegation_scope text,
  ADD COLUMN hierarchy_depth smallint;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_delegation_scope_chk
  CHECK (delegation_scope IS NULL OR delegation_scope IN ('children', 'descendants', 'subaccount'));

CREATE INDEX agent_runs_hierarchy_depth_idx ON agent_runs (hierarchy_depth)
  WHERE hierarchy_depth IS NOT NULL;
```

**Drizzle reflection:** Add `delegationScope: text('delegation_scope')` and `hierarchyDepth: smallint('hierarchy_depth')` to `server/db/schema/agentRuns.ts`.

**Populated by:** `agentExecutionService` at run start, via the new `hierarchyContextBuilderService` (§6.1). `hierarchyDepth` mirrors `hierarchy.depth`; `delegationScope` is set only for runs that were dispatched by `spawn_sub_agents` or `reassign_task` (i.e. sub-agent runs and handoff runs) — it records the scope under which the dispatching skill resolved the target.

**Why these columns on `agent_runs` and not elsewhere:** they're read by the trace graph UI alongside the existing `parentRunId` / `isSubAgent` / `handoffDepth` fields. Putting them anywhere else forces the UI to join.

**RLS:** Inherited from `agent_runs` — already org-scoped. No manifest change.

### 5.4 `delegation_outcomes` — new table

**Migration:** `0205_delegation_outcomes.sql` (Phase 1).

**Change (table creation + RLS policy in the same migration — pattern enforced by `verify-rls-coverage.sh`):**

```sql
CREATE TABLE delegation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id uuid REFERENCES subaccounts(id) ON DELETE CASCADE,
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

-- RLS
ALTER TABLE delegation_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY delegation_outcomes_org_isolation
  ON delegation_outcomes
  USING (organisation_id = current_setting('app.current_organisation_id')::uuid);
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
| 0202 | Phase 2 | `migrations/0202_subaccount_agents_root_unique.sql`, `server/db/schema/subaccountAgents.ts` (add `uniqueIndex`), `scripts/audit-subaccount-roots.ts` (new) |
| 0203 | Phase 4 | `migrations/0203_tasks_delegation_direction.sql`, `server/db/schema/tasks.ts` (add column) |
| 0204 | Phase 1 | `migrations/0204_agent_runs_delegation_telemetry.sql`, `server/db/schema/agentRuns.ts` (add columns) |
| 0205 | Phase 1 | `migrations/0205_delegation_outcomes.sql`, `server/db/schema/delegationOutcomes.ts` (new), `server/db/schema/index.ts` (export), `server/config/rlsProtectedTables.ts` (manifest entry) |

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
  // 2. filter roster where parentSubaccountAgentId === agentId → childIds (sorted)
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

**Error modes:**
- Caller agent not found in roster → throw `HierarchyContextBuildError('agent_not_in_subaccount')`. Caught by `agentExecutionService` and surfaced on the run as a hard failure (the agent cannot execute with a broken hierarchy context).
- Roster walk exceeds `MAX_DEPTH = 10` → should be impossible (validated at write time by `hierarchyService.validateHierarchy`), but if it happens, throw `HierarchyContextBuildError('depth_exceeded')`. Same fail-closed posture.

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

**Scope → filter (applied to the base query):**

- `children` → `WHERE parent_subaccount_agent_id = $callerAgentId AND is_active = true`
- `descendants` → `WHERE id IN (walk downward from $callerAgentId)` — implemented via recursive CTE bounded by `MAX_DEPTH`. Handler builds the set via the pure hierarchy builder's downward walk.
- `subaccount` → existing behaviour (`WHERE subaccount_id = $subaccountId AND is_active = true`).

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
2. If `effectiveScope === 'subaccount'` AND `context.hierarchy?.parentId !== null` → reject the **entire call** with `cross_subtree_not_permitted`. (Do not reject per-target — the caller either has subaccount authority or they don't; mixed outcomes inside a single spawn call are a confusing UX.)
3. Per target:
   - Look up target's `parentSubaccountAgentId` from the same roster used in §6.1.
   - If `effectiveScope === 'children'` and `target.parentSubaccountAgentId !== context.agentId` → reject target with `delegation_out_of_scope`.
   - If `effectiveScope === 'descendants'` and target is not in caller's subtree → reject target with `delegation_out_of_scope`.
   - Otherwise → accept target.
4. If any target was rejected, reject the entire call (atomic — don't spawn a partial set of sub-agents; the caller's prompt re-plans).
5. For each target (accepted or rejected), write one row to `delegation_outcomes` with `delegationDirection: 'down'` (sub-agents are always down by construction).

**Nesting block removal.** The existing "sub-agents cannot spawn sub-agents" hard-block at line ~3415 is **deleted**. Multi-level fan-out is allowed up to `MAX_HANDOFF_DEPTH = 5`. Each nested spawn is subject to its own scope validation per this section — a sub-agent with no children will have its adaptive default resolve to `subaccount`, which means it cannot spawn unless it's a root (rare in sub-agent context). In practice, only managers (agents with children) can spawn; workers (no children) can't. This is the graph-position-grants-authority model in action.

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
2. Apply the same `subaccount`-only-for-root rule as §6.3.
3. Apply the same target-in-scope rule.
4. Compute `delegationDirection`:
   - If `target.parentSubaccountAgentId === context.agentId` or target is in caller's subtree → `'down'`.
   - If target is an ancestor of caller (walk caller upward; if target is on the path) → `'up'`.
   - Otherwise → `'lateral'` (only possible when `effectiveScope === 'subaccount'` and caller is root).
5. Write `tasks.delegation_direction` to the resolved direction (this is a correctness-critical column; a failed write fails the skill call).
6. Write `delegation_outcomes` row (best-effort).
7. Dispatch handoff via the existing handoff queue.

**Upward reassign (worker → parent) — allowed but marked.** When `delegationDirection === 'up'`, the reassignment is accepted (subject to the same scope rules — `children` scope rejects all upward hops, `descendants` likewise, `subaccount` accepts only for root). A non-root agent targeting its own parent uses the adaptive default (`subaccount` for leaves, since leaf agents default to `subaccount`) — and rejects because leaves aren't roots. To upward-reassign, a non-root agent MUST be the subaccount root — but if they're the root, upward has no meaning. **This means upward reassign from a non-root agent is effectively blocked by construction, which contradicts the brief's "upward escalation allowed" rule.**

**Open question flagged to §16:** the brief resolved upward escalation as "allowed, logged." The strict interpretation of §6.3 / §6.4 blocks it in practice. Resolution options: (a) accept that only roots can upward-reassign (simpler, drops the feature); (b) add a special case — any agent can `reassign_task` to its own parent regardless of `effectiveScope`, with `delegationDirection: 'up'` (more permissive, keeps the brief promise); (c) introduce `delegationScope: 'parent'` as a fourth value (explicit, more surface area). **Spec author's recommendation: (b) — narrow special case, minimal surface.** Documented in §16 for `spec-reviewer` to confirm before implementation.

### 6.5 Skill resolver — derive delegation skills from graph position

**File:** `server/services/skillService.ts` (existing, extended in `resolveSkillsForAgent`).

**Change:** When building the tool list for a run, union the agent's attached skills with a graph-derived set.

**Logic:**

```ts
// Inside resolveSkillsForAgent (simplified)
const attachedSlugs = await getAttachedSkillSlugs(agentId, subaccountId);
const hierarchy = await hierarchyContextBuilderService.buildForRun({...});
const derivedSlugs = hierarchy.childIds.length > 0
  ? ['config_list_agents', 'spawn_sub_agents', 'reassign_task']
  : [];
const effectiveSlugs = Array.from(new Set([...attachedSlugs, ...derivedSlugs]));
return resolveSlugsToTools(effectiveSlugs);
```

**Why all three derived together:** the three skills form a coherent "can delegate" capability. Giving a manager any one without the others creates a half-working agent (e.g. `spawn_sub_agents` without `config_list_agents` forces the manager to guess target IDs). Always unioned together keeps prompts and behaviours consistent.

**Interaction with explicit attachment:** If an agent already has any of the three attached explicitly, the union is idempotent (de-duped via Set). Explicit attachment continues to work for any special case (e.g. an agent with no children that needs delegation for a narrow reason can have the skills explicitly attached; the graph-derived logic only *adds*, never *removes*).

**When children change mid-session:** No mid-run effect (§4.1 immutability contract). Next run of the agent reads the updated roster and resolves accordingly. Transition is automatic, drift-free.

### 6.6 `hierarchyRouteResolverService` — new

**File:** `server/services/hierarchyRouteResolverService.ts` + `*Pure.ts`.

**Responsibility:** Find the entry-point agent for a given `(organisationId, subaccountId, scope)` tuple. Replaces the hardcoded-slug lookup in `orchestratorFromTaskJob.ts:21`.

**API:**

```ts
export interface ResolveRootResult {
  subaccountAgentId: string;
  agentId: string;
  fallback: 'none' | 'org_root' | 'hardcoded_slug';
}

export async function resolveRootForScope(params: {
  organisationId: string;
  subaccountId: string | null;
  scope: 'subaccount' | 'org' | 'system';
}): Promise<ResolveRootResult>;
```

**Resolution logic:**

1. **`scope === 'subaccount'`** (most common path, Brief scoped to a client subaccount):
   - Query `subaccount_agents WHERE subaccount_id = $subaccountId AND parent_subaccount_agent_id IS NULL AND is_active = true`.
   - Expected: exactly one row (enforced by partial unique index §5.1). Return with `fallback: 'none'`.
   - Zero rows: fall back to the org-level Orchestrator link (§2.1 current behaviour). Log WARN + fire `subaccountNoRoot` detector. Return with `fallback: 'org_root'`.
   - Multiple rows: impossible post-migration. Pre-migration window: pick oldest by `createdAt`, log CRITICAL, fire `subaccountMultipleRoots`. Return with `fallback: 'none'` but flagged.

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
// No slug constant. Scope comes from task.triggerContext (passed through by briefCreationService, §6.8).
const scope = task.triggerContext?.scope ?? 'subaccount';
const result = await hierarchyRouteResolverService.resolveRootForScope({
  organisationId: task.organisationId,
  subaccountId: task.subaccountId,
  scope,
});
if (!result) {
  // System scope not yet supported, or unresolvable. Surface as a Brief error artefact.
  await briefErrorArtefactService.emit({ ... });
  return;
}
// Dispatch to result.subaccountAgentId. Carry triggerContext.taskSubaccountId as before.
```

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

### 6.9 Workspace Health detectors — three new

**Directory:** `server/services/workspaceHealth/detectors/` (existing, extended).

**New files:**

1. **`subaccountMultipleRoots.ts`** — severity `critical`. Query: subaccounts where `COUNT(*) > 1` over active roots. Emit one finding per offending subaccount. Post-§5.1-index this should never fire in normal operation. Message: *"Subaccount {id} has {n} active root agents. Partial unique index violation — investigate immediately."*

2. **`subaccountNoRoot.ts`** — severity `critical`. Query: subaccounts where `COUNT(*) = 0` over active roots. Emit one finding per offending subaccount (dedup by `(orgId, 'subaccountNoRoot', 'subaccount', subaccountId)`). Message: *"Subaccount {id} has no active root agent. Briefs route to the org-level fallback; per-subaccount CEO model is disabled for this subaccount."*

3. **`managerWithoutDerivedSkills.ts`** — severity `warning`. Query: agents with explicit `config_list_agents` + `spawn_sub_agents` + `reassign_task` attached but `childIds.length === 0`. Typically indicates a previously-managed team was migrated away and old explicit attachments remain. Message: *"Agent {id} has delegation skills attached but no active children. Consider detaching the skills; derived resolution handles managers automatically."*

**Registration:** add three lines to `server/services/workspaceHealth/detectors/index.ts` exporting the new detectors.

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

### 7.2 `GET /api/runs/:runId/delegation-graph`

**File:** `server/routes/agentRuns.ts` (existing, extended) — new sub-route.

**Purpose:** Return the delegation tree rooted at this run, for the Run Trace Viewer's new tab (§8.2). Read-only, synchronous, no side effects.

**Middleware chain:**

```ts
router.get('/api/runs/:runId/delegation-graph',
  authenticate,
  requireRunAccess('view'),  // existing guard used by /api/runs/:runId
  asyncHandler(async (req, res) => {
    const graph = await delegationGraphService.buildForRun(req.params.runId, req.orgId!);
    res.json(graph);
  }));
```

**Response shape:**

```ts
interface DelegationGraphNode {
  runId: string;
  agentId: string;
  agentName: string;        // denormalised for UI convenience
  parentRunId: string | null;
  isSubAgent: boolean;
  handoffSourceRunId: string | null;
  delegationScope: DelegationScope | null;
  hierarchyDepth: number | null;
  delegationDirection: 'down' | 'up' | 'lateral' | null;  // null for the root of the fan-out
  status: AgentRunStatus;
  startedAt: string;
  completedAt: string | null;
  children: DelegationGraphNode[];
}
```

**Service backing it:** `server/services/delegationGraphService.ts` (new). Loads the run's subtree using the existing `agentRuns.parentRunId` chain and the new `delegationScope` / `hierarchyDepth` columns from §5.3. Bounded by `MAX_HANDOFF_DEPTH + 1 = 6` levels for loop-safety.

**RLS:** Inherited — `agent_runs` is org-scoped. `requireRunAccess('view')` guards on top.

**No write path.** The graph is fully reconstructable from existing columns; nothing new is persisted.

---

## 8. Client

Three client-side changes, all scoped to existing pages. No new top-level routes.

### 8.1 Subaccount creation — "Starting team" picker (Phase 2)

**File:** `client/src/pages/SubaccountCreatePage.tsx` (existing) + `client/src/components/subaccount/StartingTeamPicker.tsx` (new).

**Change:** Add a dropdown field labelled *"Starting team"* between the subaccount name field and the submit button. Options:

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

**File:** `client/src/pages/RunTraceViewerPage.tsx` (existing, extended) + `client/src/components/run-trace/DelegationGraphView.tsx` (new) + `client/src/components/run-trace/DelegationGraphView.test.tsx` (pure render test per §12).

**Change:** Add a third tab to the run trace viewer. Existing tabs: *Trace* (single-run event list), *Payload* (LLM payload). New tab: *Delegation graph*.

**Tab content:** Collapsible tree rendered from the response of `GET /api/runs/:runId/delegation-graph` (§7.2). Node shape:

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
| `delegation_outcomes` | yes | yes (nullable) | yes — `delegation_outcomes_org_isolation` in 0205 | yes — added in same commit | yes — `requireOrgPermission` on `/api/org/delegation-outcomes` (§7.1) | yes — reads always via `orgScopedDb` / `withPrincipalContext` |

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

`GET /api/runs/:runId/delegation-graph` (§7.2) reuses the existing `requireRunAccess('view')` guard already attached to `/api/runs/:runId`. Same auth logic, same org / subaccount scoping rules. Because the graph response can reach up to `MAX_HANDOFF_DEPTH + 1` related runs, the service asserts every returned run is accessible to the caller under the same `view` scope before rendering.

**Edge case:** sub-agent runs may have been dispatched by agents the current user doesn't have direct permissions to see. The guard policy: if the user can view the *root* run of the subtree (which they opened from the Brief), they can view the whole delegation graph starting at that root. Cross-tree jumps that cross org boundaries are impossible by construction (`orgScopedDb` prevents it).

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

Writes to `delegation_outcomes` (§5.4) are **best-effort, non-blocking** from the caller's perspective. The skill handler schedules the write (inline, same transaction if cheap; otherwise a post-commit hook) and does not wait on its success.

- A write failure logs at WARN and does NOT fail the skill call. The delegation itself succeeded or failed for its own reason; telemetry isn't allowed to block user work.
- No job queue for outcome writes — the row is small (~100 bytes) and the volume is bounded by delegation attempts per run.
- No batching — at expected volumes (5–10 delegations per Brief, a few hundred Briefs per day across a mature org), individual INSERTs are fine.

### 10.4 Orchestrator route resolution — inline / synchronous, per dispatch

`hierarchyRouteResolverService.resolveRootForScope()` (§6.6) is called **synchronously** by `orchestratorFromTaskJob` (§6.7) and `briefCreationService`. One indexed query per dispatch. No caching — freshness matters (a template apply changes the root mid-day).

- Fallback paths (zero-roots, multi-roots) return the fallback agent synchronously; the health detectors fire asynchronously via the existing Workspace Health Audit scheduled run.
- The `orchestrator-from-task` pg-boss job itself is unchanged (still queued per today). The resolver runs *inside* that job's handler, not as a separate job.

### 10.5 Workspace health detectors — queued / asynchronous

The three new detectors (§6.9) plug into the existing Workspace Health Audit scheduling:

- `runAudit(orgId)` is already invoked on schedule by the existing audit worker.
- New detectors register via `workspaceHealth/detectors/index.ts` and are called in the existing audit sweep.
- Findings are written to `health_findings` via the existing dedup / resolve logic. No new job, no new queue, no new table.

Health findings about root-agent invariant violations (`subaccountMultipleRoots`, `subaccountNoRoot`) lag behind real-time. If a template apply splits brain for seconds (shouldn't, per §6.8 same-tx rotation), the detector sees it only on the next audit sweep. Acceptable — the partial unique index (§5.1) is the real-time enforcement; detectors are the backstop.

### 10.6 Consistency pass (per checklist §5)

- **No pg-boss job row claimed for inline operations.** ✓ §10.1–§10.4 are explicitly inline.
- **Prose vs execution model consistency.** ✓ §6 describes synchronous service calls; §7 describes synchronous HTTP handlers; §10 pins both as inline. No "service does X" → job-row contradictions.
- **Non-functional goals.** No latency budgets or cache-efficiency claims that would contradict the model. Phase-1 adds a table write per delegation; at expected volume (<100 delegation attempts per org per day in the Automation OS internal company), this does not meaningfully change per-run latency.

---

## 11. Phased implementation

Four phases. Each is independently shippable, commit-and-revert. Each completes a coherent slice of user-visible or operator-visible value. Dependency graph is strictly forward — Phase N never references primitives introduced in Phase N+k.

### Phase 1 — Observability foundations

**Ships:** Telemetry writes, health detectors, run-trace data columns. No behaviour change to delegation or routing. The platform records what's happening under the flat model BEFORE any enforcement lands.

**Schema (§5):**
- Migration 0204 — `agent_runs.delegation_scope`, `hierarchy_depth`
- Migration 0205 — `delegation_outcomes` table + RLS + manifest entry

**Services introduced (§6):**
- `delegationOutcomeService` (new; thin wrapper over the new table, used for inserts and the admin list)
- Three health detectors: `subaccountMultipleRoots`, `subaccountNoRoot`, `managerWithoutDerivedSkills` (pre-registration — they'll observe "no-root" as the normal state until Phase 2 flips the expectation)

**Services modified (§6):**
- `agentExecutionService` — writes `delegation_scope` + `hierarchy_depth` columns on run rows (reads from trigger context; values are null before Phase 3 supplies a hierarchy)

**Routes introduced (§7):**
- `GET /api/org/delegation-outcomes` + the new permission `org.observability.view`

**Client (§8):**
- `AdminDelegationOutcomesPage` — optional; see §13

**Columns referenced by code in this phase:** `agent_runs.delegation_scope`, `agent_runs.hierarchy_depth`, `delegation_outcomes.*`. All introduced in this phase.

**Exit criteria:**
- Migrations 0204 + 0205 applied cleanly.
- `rlsProtectedTables` manifest covers `delegation_outcomes`; `verify-rls-coverage.sh` green.
- Health detectors registered and visible in `AdminHealthFindingsPage`.
- No-op for end users; no delegation behaviour changes.

### Phase 2 — Root contract + scope-aware routing + template picker

**Ships:** Per-subaccount CEOs. Briefs filed against a subaccount route to that subaccount's root agent instead of the hardcoded global Orchestrator. Creating a subaccount offers a starting team template.

**Schema (§5):**
- Migration 0202 — partial unique index on `subaccount_agents` for root enforcement
- Prerequisite: run `scripts/audit-subaccount-roots.ts` and resolve any pre-existing violations before applying the migration

**Services introduced (§6):**
- `hierarchyRouteResolverService` with `resolveRootForScope()`

**Services modified (§6):**
- `orchestratorFromTaskJob` — delete `ORCHESTRATOR_AGENT_SLUG`; call the resolver; carry `scope` through `task.triggerContext`
- `briefCreationService` — pass `fastPathDecision.scope` into the task's `triggerContext` so the dispatcher can resolve correctly
- `hierarchyTemplateService.apply()` + `importToSubaccount()` — same-transaction root rotation (§6.8)

**Routes:** No change. Existing `POST /api/hierarchy-templates/:id/apply` is the backend verb for the template picker.

**Client (§8):**
- `SubaccountCreatePage` — add the Starting Team picker

**Columns referenced by code in this phase:** `subaccount_agents.parent_subaccount_agent_id` (existing), `subaccount_agents.is_active` (existing). No new columns.

**Exit criteria:**
- Migration 0202 applied cleanly; audit script shows zero violations.
- A Brief filed against a subaccount with a configured root routes to that subaccount's root, observable in the Brief detail page's handling-agent display.
- Template picker in subaccount creation successfully installs the chosen template.
- Phase-1 detectors register zero `subaccountMultipleRoots` findings; `subaccountNoRoot` count decreases as users assign roots.
- `ORCHESTRATOR_AGENT_SLUG` constant deleted from `orchestratorFromTaskJob.ts`.

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
- Migration 0203 — `tasks.delegation_direction` column

**Services modified (§6):**
- `spawn_sub_agents` — `delegationScope` param + validation + outcome writes + nesting-block removal
- `reassign_task` — same, plus `delegation_direction` writes
- `skillService` (resolver) — derive delegation skills from `hierarchy.childIds`

**Routes introduced (§7):**
- `GET /api/runs/:runId/delegation-graph`

**Services introduced (§6):**
- `delegationGraphService` — composes subtree response for the new route

**Client (§8):**
- `RunTraceViewerPage` — new Delegation graph tab

**Columns referenced by code in this phase:** `tasks.delegation_direction` (introduced this phase). All Phase 1 / Phase 2 / Phase 3 columns are used — this phase introduces no backward-dependency on later work.

**Exit criteria:**
- Rejection-rate metrics show an initial spike that trends down over the first 1–2 weeks.
- Trace graph UI renders fan-out correctly for sub-agent and handoff chains.
- `config_list_agents` + `spawn_sub_agents` + `reassign_task` are automatically available to any agent with children (observable in the agent's resolved tool list, surfaced in `AgentExecutionLog` / run trace).
- `delegation_outcomes` table is receiving accept + reject rows with full fidelity.

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
| `agent_runs.delegation_scope`, `hierarchy_depth` | Phase 1 | Phase 1 |
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
- `verify-rls-coverage.sh` — `delegation_outcomes` added to manifest in the same commit as migration 0205. Gate fails if not.
- `verify-rls-contract-compliance.sh` — no direct DB access outside `orgScopedDb` / `withAdminConnection` for the new table.
- `scripts/verify-integration-reference.mjs` — unaffected (no integration changes).

### 12.2 Pure unit tests (per-phase)

One test file per pure module. Each lives alongside its source under `__tests__/`.

**Phase 1:**
- `delegationOutcomeServicePure.test.ts` — insert-shape assembly, reason-when-rejected invariant (the CHECK constraint's logic replicated in a pure validator so callers don't surface a Postgres error). Covers: accepted-without-reason, rejected-with-reason, invalid-direction, invalid-scope.
- `workspaceHealth/detectors/subaccountMultipleRoots.test.ts` — detector pure function: given a roster, return the finding set.
- `workspaceHealth/detectors/subaccountNoRoot.test.ts` — same.
- `workspaceHealth/detectors/managerWithoutDerivedSkills.test.ts` — same.

**Phase 2:**
- `hierarchyRouteResolverServicePure.test.ts` — decision tree given query results. Covers: exactly one root → none fallback; zero roots → org-root fallback; multiple roots → oldest-wins + flagged; scope=org → org-level path; scope=system → returns null.
- `scripts/audit-subaccount-roots.test.ts` (pure core) — given a roster, produce the operator checklist.

**Phase 3:**
- `hierarchyContextBuilderServicePure.test.ts` — the main workhorse. Covers: root agent (parentId null, depth 0, rootId === agentId); middle manager (parentId set, childIds populated, depth 1); leaf worker (childIds empty); cycle detection throws; depth > MAX_DEPTH throws; agent-not-in-roster throws.
- `config/configSkillHandlersPure.test.ts` (new or extend existing) — scope filter logic. Covers adaptive default (has-children → children, no-children → subaccount); explicit scope override; missing-context fallback.

**Phase 4:**
- `skillExecutor.spawnSubAgents.test.ts` — pure validation logic extracted from the handler. Covers: all-children-accepted; one-out-of-scope → whole call rejected; cross_subtree_not_permitted when non-root uses subaccount scope; outcome row shape per target.
- `skillExecutor.reassignTask.test.ts` — same shape. Covers direction computation (down / up / lateral) + the upward-reassign special case once resolved in §16.
- `skillService.resolver.test.ts` — pure `computeDerivedSkills({ hierarchy })` returns `[]` when childIds is empty, returns the trio when non-empty.
- `delegationGraphServicePure.test.ts` — given a flat run list, assemble the tree. Covers MAX_DEPTH bound, orphan handling (a child with no accessible parent), and direction-colour coding.

### 12.3 Deliberate non-tests

Documented per checklist §9 — flag deviations from framing ground truth, but do not add the tests:

- **No API contract tests** for `GET /api/org/delegation-outcomes` or `GET /api/runs/:runId/delegation-graph`. `api_contract_tests: none_for_now`.
- **No E2E tests** for the subaccount-creation template picker. `e2e_tests_of_own_app: none_for_now`.
- **No frontend component tests** for `DelegationGraphView` or the picker. `frontend_tests: none_for_now`.
- **No performance baselines** for the hierarchy context builder or the resolver. `performance_baselines: defer_until_production`. Expected sub-5ms per run is stated as prose; we'll measure if it matters.
- **No migration safety tests** for 0202 (root enforcement). `migration_safety_tests: defer_until_live_data_exists`. Pre-production; audit script output is the safety gate.
- **No composition tests** cross-phase (e.g. "Phase 2 routing + Phase 4 enforcement together"). `composition_tests: defer_until_stabilisation`. Each phase's exit criteria are the tests; full composition validates in production use.

### 12.4 Manual verification per phase

Static gates + pure tests validate correctness. The brief's success criteria (§17) are behavioural and require manual / observational verification during rollout:

- **Phase 1:** Confirm `delegation_outcomes` rows appear for existing (flat) delegations during normal Brief fan-out. Expect `outcome: 'accepted'`, `delegationDirection: 'down'` for every row (flat world; nothing can be out-of-scope yet).
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

- **Scope-violation per-agent rate alerting.** §5.9 has detectors for invariant violations, but not for "agent X has 40% rejection rate over the last 24h" — which would be a prompt-drift signal, not a config issue. **Reason:** not mature enough to set thresholds. **Pull-forward condition:** after ~30 days of Phase 4 operation, threshold candidates become obvious from the data.

- **Multi-tier seeded Automation OS company.** §3.2 carries this explicitly. Restructuring `companies/automation-os/` into a 3-tier org chart (Orchestrator → department heads → specialists) is designed on a separate track. **Pull-forward condition:** this spec ships and the team wants a dogfood target for recursive delegation.

- **Cost rollups per subtree and performance attribution per manager.** Framing in §1 flagged these as future capabilities the primitives enable. Neither is built here. **Pull-forward condition:** the Cost / Observability working group picks up either as a first-class feature.

- **Mesh / dynamic-team / task-scoped grouping primitives.** §3.2 (plus the brief's §7) explicitly call these out-of-scope. **Pull-forward condition:** usage patterns post-Phase-4 show a sustained need for lateral collaboration that the `'subaccount'` escape hatch doesn't cleanly cover.

- **RLS-layer delegation enforcement.** §3.2 defers this. **Pull-forward condition:** sustained application-layer bypass attempts (caught via `delegation_out_of_scope` counters trending *up* over months).

- **Upward-reassign implementation detail (§6.4 open issue).** The brief says "upward allowed, logged"; the strict reading of §6.3 / §6.4 blocks it for non-roots. Resolution is a §16 open question. **Pull-forward condition:** resolved by `spec-reviewer` before Phase 4 implementation begins — this is not really "deferred" but flagged in §16 pending a decision.

---

## 14. File inventory

Single source of truth for what the spec touches. Grouped by phase; every prose reference to a new file, column, migration, table, service, or endpoint earlier in the spec appears here.

### 14.1 Phase 1 — Observability foundations

**New:**
- `migrations/0204_agent_runs_delegation_telemetry.sql` — adds `delegation_scope` + `hierarchy_depth` columns (§5.3)
- `migrations/0205_delegation_outcomes.sql` — creates table + RLS policy + indexes (§5.4)
- `server/db/schema/delegationOutcomes.ts` — Drizzle reflection (§5.4)
- `server/services/delegationOutcomeService.ts` + `delegationOutcomeServicePure.ts` — insert + list helpers (§6, §7.1)
- `server/services/__tests__/delegationOutcomeServicePure.test.ts` (§12.2)
- `server/services/workspaceHealth/detectors/subaccountMultipleRoots.ts` (§6.9)
- `server/services/workspaceHealth/detectors/subaccountNoRoot.ts` (§6.9)
- `server/services/workspaceHealth/detectors/managerWithoutDerivedSkills.ts` (§6.9)
- `server/services/workspaceHealth/detectors/__tests__/*.test.ts` — one per detector (§12.2)
- `server/routes/delegationOutcomes.ts` (§7.1)
- `shared/types/delegation.ts` — `DelegationScope`, `DelegationOutcome`, error-code constants, `HierarchyContext` (§4)
- (Optional) `client/src/pages/AdminDelegationOutcomesPage.tsx` (§8.3)

**Modified:**
- `server/db/schema/agentRuns.ts` — new columns
- `server/db/schema/index.ts` — export `delegationOutcomes`
- `server/config/rlsProtectedTables.ts` — add `delegation_outcomes`
- `server/services/agentExecutionService.ts` — write new run-row columns (reads from trigger context initially; fully populated once Phase 3 ships the hierarchy builder)
- `server/services/workspaceHealth/detectors/index.ts` — register three new detectors
- `server/index.ts` — mount new route
- Permission-set seeds — add `org.observability.view` to `org_admin` set

### 14.2 Phase 2 — Root contract + scope-aware routing + template picker

**New:**
- `migrations/0202_subaccount_agents_root_unique.sql` — partial unique index (§5.1)
- `scripts/audit-subaccount-roots.ts` — pre-migration audit (§5.1, §6)
- `server/services/hierarchyRouteResolverService.ts` + `hierarchyRouteResolverServicePure.ts` (§6.6)
- `server/services/__tests__/hierarchyRouteResolverServicePure.test.ts` (§12.2)
- `client/src/components/subaccount/StartingTeamPicker.tsx` (§8.1)

**Modified:**
- `server/db/schema/subaccountAgents.ts` — add `uniqueIndex` declaration matching the partial unique index
- `server/jobs/orchestratorFromTaskJob.ts` — delete `ORCHESTRATOR_AGENT_SLUG`, call the resolver, carry scope through trigger context
- `server/services/briefCreationService.ts` — pass `fastPathDecision.scope` into task trigger context
- `server/services/hierarchyTemplateService.ts` — same-transaction root rotation in `apply()` and `importToSubaccount()`
- `client/src/pages/SubaccountCreatePage.tsx` — add picker + apply-on-submit

### 14.3 Phase 3 — Hierarchy context + visibility layer

**New:**
- `server/services/hierarchyContextBuilderService.ts` + `hierarchyContextBuilderServicePure.ts` (§6.1)
- `server/services/__tests__/hierarchyContextBuilderServicePure.test.ts` (§12.2)
- `server/tools/config/__tests__/configSkillHandlersPure.test.ts` (§12.2, may extend existing)

**Modified:**
- `server/services/skillExecutor.ts` — add `hierarchy?: Readonly<HierarchyContext>` field to `SkillExecutionContext`
- `server/services/agentExecutionService.ts` — populate `ctx.hierarchy` before passing to `skillExecutor`
- `server/tools/config/configSkillHandlers.ts` — scope param + adaptive default in the three list handlers
- `server/config/actionRegistry.ts` — tool-definition updates for the three skills (add `scope` parameter to their JSON schemas)

### 14.4 Phase 4 — Execution enforcement + derived skill resolution + trace graph

**New:**
- `migrations/0203_tasks_delegation_direction.sql` (§5.2)
- `server/services/delegationGraphService.ts` + `delegationGraphServicePure.ts` (§7.2)
- `server/services/__tests__/delegationGraphServicePure.test.ts` (§12.2)
- `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts` (§12.2)
- `server/services/__tests__/skillExecutor.reassignTask.test.ts` (§12.2)
- `server/services/__tests__/skillService.resolver.test.ts` (§12.2)
- `client/src/components/run-trace/DelegationGraphView.tsx` (§8.2)
- `client/src/components/run-trace/DelegationGraphView.test.tsx` — pure render test (§12.2)

**Modified:**
- `server/db/schema/tasks.ts` — add `delegationDirection: text('delegation_direction')`
- `server/services/skillExecutor.ts` — `spawn_sub_agents` + `reassign_task` validation, outcome writes, direction computation, remove nesting block (§6.3, §6.4)
- `server/services/skillService.ts` — derive delegation skills in resolver (§6.5)
- `server/config/actionRegistry.ts` — tool-definition updates for `spawn_sub_agents` + `reassign_task` (add `delegationScope` parameter)
- `server/routes/agentRuns.ts` — mount `GET /api/runs/:runId/delegation-graph` sub-route
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
| "new `delegation_outcomes` table" (§1, §5.4) | §14.1 — `migrations/0205`, `server/db/schema/delegationOutcomes.ts` |
| "remove `ORCHESTRATOR_AGENT_SLUG`" (§1, §6.7) | §14.2 — `server/jobs/orchestratorFromTaskJob.ts` modified |
| "new `hierarchyContextBuilderService`" (§6.1) | §14.3 — two new files + test |
| "`tasks.delegation_direction` column" (§5.2) | §14.4 — migration 0203 + schema change |
| "three new detectors" (§6.9) | §14.1 — three new files under `workspaceHealth/detectors/` |
| "`GET /api/org/delegation-outcomes`" (§7.1) | §14.1 — `server/routes/delegationOutcomes.ts` |
| "Starting team picker" (§8.1) | §14.2 — `StartingTeamPicker.tsx` new + `SubaccountCreatePage.tsx` modified |
| "delegation graph tab" (§8.2) | §14.4 — `DelegationGraphView.tsx` + `RunTraceViewerPage.tsx` |

If a future prose mention is added that doesn't appear here, the spec-reviewer will raise a `file-inventory-drift` finding.

---

## 15. Risks & mitigations

### 15.1 Phase 4 rollout friction (expected, not a surprise)

**Risk:** When execution enforcement lands, existing agent prompts that assume flat delegation will produce `delegation_out_of_scope` and `cross_subtree_not_permitted` rejections. Rejection rate spikes in the first week.

**Likelihood:** High. **Impact:** Medium — agents appear broken until prompts adjust; user-facing failures are contained to Brief-handling regressions, not platform outages.

**Mitigation:**
- Phase 1 ships observability BEFORE Phase 4 — the trace graph, delegation outcome rows, and detectors are in place the moment enforcement bites. Per §6 dependency graph, Phase 1 MUST ship before Phase 4.
- Brief §6 budgets 1–2 weeks of prompt tweaks as the intended Phase 4 rollout posture. The team reviews outcome rows in the dashboard daily during this window.
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

### 15.5 Upward-reassign open question affecting Phase 4 implementation

**Risk:** §6.4 flags that the strict scope model blocks a non-root agent from reassigning upward to its parent. The brief promised upward escalation was allowed. This is an unresolved spec gap that Phase 4 implementation will hit on day one.

**Likelihood:** 100% — implementation will encounter this. **Impact:** Medium — resolution direction changes the `reassign_task` handler's validation shape.

**Mitigation:**
- Raised to `spec-reviewer` in §16. Resolution must land before Phase 4 implementation starts.
- Spec author's recommendation: option (b) — narrow special case allowing any agent to reassign to its own parent regardless of `delegationScope`. Documented in §16 for review.

### 15.6 `delegation_outcomes` write failure cascading to skill failure

**Risk:** If the `delegation_outcomes` insert throws inside the skill handler (DB hiccup, transaction isolation, etc.), a naive implementation fails the skill call — which converts a telemetry problem into a real user-facing delegation failure.

**Likelihood:** Low. **Impact:** Medium — fails delegations that should succeed.

**Mitigation:**
- §10.3 explicitly says outcome writes are best-effort / non-blocking. Skill handler wraps the insert in a try/catch and logs WARN on failure.
- Phase 1 `delegationOutcomeService` has a `recordOutcomeSafe()` variant that's the only entry point from skill handlers — it swallows errors and logs. The primary `recordOutcome()` is strict-mode, used only from contexts where write failure should propagate (batch backfills, tests).
- Monitored via platform-level DB error logs — if this starts happening, it's a DB health issue, not a spec issue.

### 15.7 Seeded company stays flat after spec lands

**Risk:** The seeded Automation OS company is still flat after Phase 4. Managers-must-have-children logic applies to zero agents. The new infrastructure is invisible in the product until someone restructures.

**Likelihood:** High (by construction — seed reorg is explicitly out of scope). **Impact:** Low — the infrastructure is still correct; it just isn't exercised.

**Mitigation:**
- §3.2 states this explicitly. Seed reorg is a separate track.
- The four phases are each shippable standalone — they deliver value (observability, per-subaccount CEOs, visibility scoping, enforcement) regardless of whether a tree exists to enforce against.
- Phase-1 detectors fire `subaccountNoRoot` findings for every subaccount until someone assigns roots — this is the intended signal, not a bug. The findings tell operators "you haven't configured a team yet."

---

## 16. Open questions

Open questions that must be resolved before or during implementation. Each is scoped so `spec-reviewer` or the implementing session can make the call without reopening design.

### 16.1 Upward reassign for non-root agents (BLOCKING for Phase 4)

**The question:** Brief §9 decision 4 said "upward escalation is allowed, logged." The strict reading of §6.3 / §6.4 blocks it for non-root agents because their adaptive default is `subaccount`-requires-root, and `children` / `descendants` scopes don't include the parent.

**Resolution options:**

- **(a) Drop it.** Only roots can upward-reassign. Upward hops between non-root agents happen via a two-step "escalate to root → root reassigns lateral" pattern. Simpler, drops a brief commitment.
- **(b) Narrow special case (recommended by spec author).** `reassign_task` allows a target equal to `context.hierarchy.parentId` regardless of `delegationScope`. Separate `delegationDirection: 'up'` path, written with that direction. Minimal additional surface.
- **(c) Introduce `delegationScope: 'parent'`.** Explicit fourth scope value. Wider surface area.
- **(d) Introduce a separate `escalate_upward` skill.** Keeps `reassign_task` clean but adds a skill to the platform.

**Spec author's recommendation:** (b). Single line in the `reassign_task` validator. Preserves brief's intent. §15.5 lists this as a risk to close before Phase 4 starts.

**Who decides:** `spec-reviewer` during review round 1, or explicit HITL from the project owner if the reviewer abstains.

### 16.2 `org.observability.view` vs `org.health_audit.view`

**The question:** §9.2 introduces a new permission. Rejected alternative was reusing `org.health_audit.view`. Is the separation actually worth a new permission, or should delegation outcomes fold under health-audit?

**Resolution options:**

- **(a) New `org.observability.view` (recommended).** Keeps surfaces separable. Future observability features (trace-graph dashboards, metric drill-downs) grant cleanly.
- **(b) Reuse `org.health_audit.view`.** Fewer permissions to manage.

**Spec author's recommendation:** (a). Cheap to add one permission; expensive to split one later.

**Who decides:** `spec-reviewer` (low-stakes call; default to recommended unless reviewer objects).

### 16.3 Seed organisations without any root agents during Phase 2 rollout

**The question:** The current data state is "most subaccounts have zero subaccount-level roots." §6.6's zero-root fallback routes to the org-level Orchestrator. That's correct, but should we auto-create a subaccount-level root for every existing subaccount during the Phase 2 migration?

**Resolution options:**

- **(a) No auto-creation.** Let operators assign roots when they want per-subaccount CEOs. Fallback handles the rest. Chosen default.
- **(b) Auto-create by cloning the org-Orchestrator into each subaccount.** Creates many subaccount-level root links with the same system agent behind them. Simplifies the mental model (every subaccount has a root) at the cost of proliferating links.
- **(c) Auto-create only for subaccounts that have any linked agents.** Middle path.

**Spec author's recommendation:** (a). No auto-creation. Fallback is clean; let the operator opt in to per-subaccount CEOs by assigning a root when they want one.

**Who decides:** `spec-reviewer`, or the Phase 2 implementer if reviewer abstains.

### 16.4 Should `scope: 'descendants'` compute the subtree pure or via recursive CTE?

**The question:** §6.2 mentions a recursive CTE. §6.1's pure function walks from the full roster. Implementation choice: which does the runtime list-agents handler use?

**Resolution options:**

- **(a) Pure function over the full roster (recommended).** Already required by `hierarchyContextBuilderService`. Reuses existing code. Cost: one roster fetch per list call.
- **(b) Recursive CTE in the DB.** Push traversal to Postgres. Cost: dedicated query path; more complex to test.

**Spec author's recommendation:** (a). Subtree computation is cheap in pure TS at expected sizes (<100 agents per subaccount). Reuses the hierarchy builder. Simpler to test.

**Who decides:** Phase 3 implementer; no external review needed.

### 16.5 `hierarchyDepth` column population for existing `agent_runs`

**The question:** §5.3 adds nullable `hierarchyDepth` to `agent_runs`. Existing rows have null. Do we backfill historical runs (expensive; requires reconstructing roster-at-the-time) or accept null-for-historical?

**Resolution options:**

- **(a) No backfill (recommended).** Null is the honest value for pre-Phase-1 runs. New rows always populated.
- **(b) Backfill with current-roster depth.** Misleading (roster may have changed since the run); introduces false data.

**Spec author's recommendation:** (a). No backfill. Documented in §5.3.

**Who decides:** Already decided in §5.3; listed here for completeness.

---

## 17. Success criteria

Behavioural success criteria from the brief (§8 of `docs/hierarchical-delegation-dev-brief.md`), promoted here with concrete measurements. Each is observable against `delegation_outcomes` + `tasks.delegation_direction` + run traces.

### 17.1 Managers predominantly delegate within their subtree

**Measurement:** Post-Phase-4 adjustment period (day 14+), for each agent with `hierarchy.childIds.length > 0`, ratio of `delegation_outcomes` rows where `outcome = 'accepted'` AND `delegation_scope IN ('children', 'descendants')` AND `delegation_direction = 'down'` to total accepted outcomes for that agent.

**Target:** ≥95% for every manager agent over a rolling 7-day window.

**What a violation means:** an agent whose ratio stays below 95% after the adjustment period has a prompt bug (treating `'subaccount'` as normal operation, per brief §5.3 on escape-hatch intent). Flagged for prompt review.

**Query pattern:** `SELECT caller_agent_id, COUNT(*) FILTER (WHERE delegation_scope IN ('children', 'descendants') AND delegation_direction = 'down') * 100.0 / COUNT(*) FROM delegation_outcomes WHERE outcome = 'accepted' AND created_at > NOW() - INTERVAL '7 days' GROUP BY caller_agent_id HAVING COUNT(*) > 10;`

### 17.2 Cross-team hops happen via nearest common ancestor

**Measurement:** Count of `delegation_outcomes` rows with `delegation_direction = 'lateral'` AND the caller is NOT the subaccount root (`hierarchy.parentId IS NOT NULL`). This should be zero by construction — the executor rejects such calls — but the metric is the forcing function that detects a bypass.

**Target:** Zero lateral delegations from non-root agents. Any non-zero count indicates the enforcement layer has a bug.

**What a violation means:** a code bug in `skillExecutor.ts` validation — NOT a prompt or data bug. Triggers immediate investigation.

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
- `managerWithoutDerivedSkills` — trending toward zero as operators clean up explicit attachments.

**Target:** Zero `subaccountMultipleRoots` findings at steady state. Every other detector is informational.

### 17.6 Implementation efficiency

**Measurement (vanity, for retrospective):**
- Total LOC added across all four phases: target <2,500 lines including tests.
- Number of new files: target <15.
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
- §4.4 claims `delegation_outcomes` is the sole source of delegation telemetry. Grep confirms: only `spawn_sub_agents` and `reassign_task` write to it; no other path logs delegations. ✓
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
