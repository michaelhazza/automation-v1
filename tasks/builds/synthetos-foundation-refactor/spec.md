# SynthetOS Phase 1 Foundation Refactor — Implementation Spec

**Status:** Draft v1.0  
**Date:** 2026-05-09  
**Branch:** `claude/synthetos-foundation-refactor-{tbd}`  
**Authoritative brief:** `docs/synthetos-governed-agentic-os-brief-v1.2.md`  
**Companion documents:** `docs/synthetos-brief-v1.1-to-v1.2-changes.md`, `docs/openclaw-strategic-analysis.md`, `docs/iee-delegation-lifecycle-spec.md`  
**Authors:** SynthetOS architecture group  
**Reviewers required:** spec-reviewer (Codex loop), architect (sign-off), pr-reviewer at implementation, dual-reviewer if local Codex available

This spec converts the six Phase 1 foundation items defined in `docs/synthetos-governed-agentic-os-brief-v1.2.md` Section 18.1 into an implementation plan. It is the first of three Phase 1 specs (this one, the Support Desk Canonical spec, the Support Agent MVP spec). Specs B and C consume the primitives shipped here.

---

## Contents

- [0. Status, Scope, Anchors](#0-status-scope-anchors)
- [1. Background and Motivation](#1-background-and-motivation)
- [2. Goals and Non-Goals](#2-goals-and-non-goals)
- [3. Constraints and Invariants](#3-constraints-and-invariants)
- [4. Component Design](#4-component-design)
  - [4.1 controllerStyle field on agent runs](#41-controllerstyle-field-on-agent-runs)
  - [4.2 Risk Tier sweep across action registry](#42-risk-tier-sweep-across-action-registry)
  - [4.3 CredentialBrokerService facade](#43-credentialbrokerservice-facade)
  - [4.4 Run Trace canonical API contract](#44-run-trace-canonical-api-contract)
  - [4.5 Policy Envelope per-run snapshot](#45-policy-envelope-per-run-snapshot)
  - [4.6 Naming pass and glossary document](#46-naming-pass-and-glossary-document)
- [5. UI Changes](#5-ui-changes)
- [6. Schema Migrations Summary](#6-schema-migrations-summary)
- [7. Test Strategy](#7-test-strategy)
- [8. Rollout Plan](#8-rollout-plan)
- [9. Acceptance Criteria](#9-acceptance-criteria)
- [10. Risk Register](#10-risk-register)
- [11. Open Decisions](#11-open-decisions)

---

## 0. Status, Scope, Anchors

### 0.1 What this spec is

The implementation spec for the six Phase 1 foundation items in `docs/synthetos-governed-agentic-os-brief-v1.2.md` Section 18.1. It defines schemas, code changes, migrations, tests, rollout, and acceptance criteria.

### 0.2 What this spec is not

This is not a Phase 1.5 spec. This is not the Support Desk Canonical spec (`tasks/builds/support-desk-canonical/spec.md`, parallel workstream). This is not the Support Agent MVP spec (downstream consumer of A and B). This is not a marketing spec or product brief. UI surfaces are scoped only to the changes required to expose the new primitives; broader UI redesigns are out of scope.

### 0.3 Authority

Where this spec contradicts the v1.2 brief, the v1.2 brief is authoritative for **what** and this spec is authoritative for **how**. Where this spec contradicts existing implementation, this spec is authoritative for the target state and must define a migration. Where the v1.2 brief is silent, this spec may make implementation choices but must enumerate them in Section 11 (Open Decisions) before lock-in.

### 0.4 Companion artefacts

| Artefact | Location | Purpose |
|---|---|---|
| v1.2 master brief | `docs/synthetos-governed-agentic-os-brief-v1.2.md` | Source of truth for terminology, abstractions, phase boundaries |
| v1.1 to v1.2 change list | `docs/synthetos-brief-v1.1-to-v1.2-changes.md` | Diagram update guidance, term mapping |
| OpenClaw Strategic Analysis | `docs/openclaw-strategic-analysis.md` | Phase 3 ExecutionBackend adapter contract, Operator Session Identity lifecycle |
| IEE Delegation Lifecycle Spec | `docs/iee-delegation-lifecycle-spec.md` | Existing pattern for delegated-execution backends |
| Architecture reference | `architecture.md` | Current implementation reference |

### 0.5 Anchors (CI guards required by this spec)

The following CI-enforced contracts must be in place when this spec ships:

1. `scripts/verify-risk-tier-assigned.sh` — every action in `server/config/actionRegistry.ts` has `riskTier` assigned.
2. Existing `scripts/verify-skill-read-paths.sh` — unchanged; new actions inherit the `readPath` requirement.
3. Existing `scripts/verify-job-idempotency-keys.sh` — unchanged.
4. Existing `scripts/verify-no-direct-adapter-calls.sh` — unchanged; LLM router contract preserved.
5. New (optional, advisory): `scripts/verify-controller-style-mapping.sh` — every `executionMode` value has a documented default `controllerStyle` derivation.

---

## 1. Background and Motivation

### 1.1 Why this work exists

The v1.2 brief locked SynthetOS positioning as **the Governed Agentic Operating System for autonomous execution**. The brief separates six abstractions (Agents, Controllers, Execution Environments, IEE Infrastructure, Model Access and Identity, Run Trace) and establishes a Control Plane / Execution Plane boundary.

A May 2026 codebase stress-test confirmed roughly 70% of the v1.2 architecture is already implemented in code, sometimes under different names. The remaining 30% is concentrated in six items that are required before any new product feature in Phase 1 can be built on the right primitives:

1. `controllerStyle` first-class field
2. Risk Tier annotation across action registry
3. `CredentialBrokerService` facade
4. Run Trace canonical API contract
5. Policy Envelope per-run snapshot
6. Naming pass and glossary document

These are tracked as Phase 1 foundation work in `docs/synthetos-governed-agentic-os-brief-v1.2.md` Section 18.1.

### 1.2 Why before product features

Phase 1 ships two showcase product MVPs (42 Macro Task and Support Inbox Workflow) on top of the foundation. Both consume the foundation primitives — risk tiers gate approvals, controller style determines loop limits, the credential broker injects per-subaccount credentials, the run trace surfaces decisions to operators, the policy envelope captures the constraint set per run.

Building either MVP first and retrofitting the foundation later would cost roughly 30 to 50% rework on the MVP. The foundation refactor is roughly 13 to 19 dev-days; the rework saved is 4 to 7 weeks of MVP work. Net: do the foundation first.

### 1.3 What is already in the codebase

The stress-test confirmed the following primitives are production-ready and need no rework, only documentation:

- Three-tier agent model (`system_agents`, `agents`, `subaccount_agents`) with hierarchical delegation, root agent contract, `DelegationScope` enum, and run-trace delegation graph.
- Capability-Aware Orchestrator (`server/jobs/orchestratorFromTaskJob.ts`) with paths A/B/C/D, capability discovery skills, decomposition pipeline, capability budget enforcement.
- IEE worker with browser plus dev modes, contract-enforced page abstraction, idempotency, `iee_runs`/`ieeSteps`/`ieeArtifacts` tables, delegation lifecycle (Phase 0 of OpenClaw Strategic Analysis already shipped).
- HITL approval flow (`actions` to `reviewItems` to `reviewAuditRecords`) with Slack Block Kit integration.
- 48+ RLS-protected tables, principal model (`principal_type` of user, service, delegated).
- Single LLM router entry point (`llmRouter.routeCall`) with statically and runtime-enforced contract.
- 110-action registry with Zod validation, idempotency strategies, gate levels, MCP annotations.
- Credential infrastructure (`integration_connections`, `connectionTokenService`, AES-256-GCM, OAuth refresh with advisory locks).
- Run Trace UI surface (`client/src/pages/operate/RunTracePage.tsx`).
- pg-boss queueing with 25+ job types, DLQs, four idempotency strategies enforced by CI gate.
- Cost ledger (`llm_requests`, `cost_aggregates`) with margin and source attribution.

This spec **extends and consolidates** the above. It does **not** rebuild any of it.

### 1.4 What this spec adds vs. what it renames

| Item | Add (net new) | Rename or facade (existing) |
|---|---|---|
| 1. `controllerStyle` | New schema column, new TS type, new dispatch logic | None |
| 2. Risk Tier sweep | New TS type, new field on action def, new derivation function, new CI gate | Maps to existing `actions.gateLevel` |
| 3. `CredentialBrokerService` | None | Facade over existing `connectionTokenService` and `integrationConnectionService` |
| 4. Run Trace API | New endpoint, new service, new shared type | Joins existing 5+ event tables |
| 5. Policy Envelope snapshot | New JSONB column on `agent_runs`, new type, new resolver function | Aggregates existing constraint sources |
| 6. Naming pass | New glossary doc, file-level awareness comments | Documents existing names |

Schema impact: **two new columns on `agent_runs`** (`controller_style`, `policy_envelope_snapshot`). No new tables. No data destruction. No breaking changes to existing APIs.

---

## 2. Goals and Non-Goals

### 2.1 Goals

**G1. Establish `controllerStyle` as a first-class axis** orthogonal to `executionMode`. Native runs default to short loops with strict templating; Operator runs default to longer loops with adaptive tool use. Loop limits, token budgets, and approval defaults derive from `controllerStyle` plus `executionMode`, not from `executionMode` alone.

**G2. Annotate every action with a Risk Tier (0 to 6).** The 110 actions in `server/config/actionRegistry.ts` each receive a tier classification. The `gateLevel` for each action is derived from its tier plus any policy override; the existing tier-to-gate default (Tier 0-2 auto, Tier 3-5 review, Tier 6 block-unless-policy) holds.

**G3. Expose credential infrastructure as a single named facade.** `CredentialBrokerService` becomes the only documented entry point for credential issuance, revocation, audit, and runtime injection. Existing call sites migrate; new callers must use the facade.

**G4. Provide a server-side Run Trace API contract.** `GET /api/agent-runs/:runId/trace` returns a unified, ordered, paginated, filterable event stream by joining the existing five decision-ledger tables. The existing `RunTracePage.tsx` is updated to consume the endpoint.

**G5. Capture a Policy Envelope snapshot per run.** At run creation, the resolved constraint set (allowed controllers, environments, integrations, tools; budgets; approval requirements; credential availability; HITL rules) is computed and persisted on `agent_runs.policy_envelope_snapshot`. The snapshot is read-only after run start and surfaced in Run Trace.

**G6. Lock canonical names.** A single nomenclature document (`docs/synthetos-nomenclature.md`) maps existing code names to v1.2 brief names. Key files receive awareness comments. Future specs reference the nomenclature document; service-level renames are deferred.

**G7. Update UI to expose foundation primitives in user language.** Run Trace UI shows a one-line headline (controller style, approval status, cost). Agent Config grows four new tabs (Execution, Governance, Models and Identity, Integrations). Approval UX gains risk tier and policy reason context. Credentials gains an audit log section. All UI changes follow the project's frontend design rules (default to hidden, one primary action, inline state, plain language).

**G8. Preserve backward compatibility.** Every existing agent run must continue to execute correctly. Every existing test must continue to pass. Every existing API must continue to return the same shape unless explicitly versioned otherwise.

### 2.2 Non-Goals

The following are explicitly **not** delivered by this spec:

**NG1. Per-task sandbox isolation primitive.** Phase 2 prerequisite. Today's `iee_dev` mode collapses sandbox-style execution and terminal/repo execution; splitting them requires a sandbox isolation primitive (Docker-per-task, gVisor, Firecracker, or hosted execution provider). That decision is a separate spec.

**NG2. ExecutionBackend adapter contract.** Phase 3 prerequisite. The single pluggable interface that lets OpenClaw, future internal backends, and any other operator runtime become participating implementations is defined in `docs/openclaw-strategic-analysis.md` as Phase 1 of the OpenClaw integration roadmap, not in this spec.

**NG3. Operator Session Identity (`auth_type: 'operator_session'`).** ChatGPT OAuth as a session-based model identity is Phase 3. The credential broker facade in Section 4.3 is forward-compatible with this auth_type but does not implement it.

**NG4. Canonical Run Trace event ledger.** Phase 3+ consolidation. The Phase 1 contract is a virtual view across the existing five tables. A canonical `run_trace_events` table is deferred until either scale or audit forces it.

**NG5. Per-task containers, Firecracker, Kubernetes orchestration.** The diagram shows these as future-state IEE infrastructure; the codebase ships Docker Compose. Phase 3+ work.

**NG6. New product features.** This spec ships only the foundation refactor and the minimum UI to expose it. The 42 Macro Task Full MVP and Support Inbox showcase MVP are downstream specs (Phase 1 use case fan-out).

**NG7. Service-wide renames.** The naming pass produces a glossary and awareness comments only. Renaming `orchestratorFromTaskJob` to `routerFromTaskJob` (or similar) is explicitly deferred. The brief locks the canonical name "Router and Execution Planner"; the file prefix stays "Orchestrator" in code.

**NG8. AI and Models settings tab.** The v1.2 brief proposes a Subaccount Settings tab for Model Access, Routing, Limits, Cost Controls, Operator Identities. Phase 1 does not build this; per-agent model selection in the existing Agent Config is sufficient. Phase 1.5 picks it up.

**NG9. Cost analytics dashboards.** Run-level cost is shown in the Run Trace headline (Section 5). Agent-level and org-level cost dashboards are Phase 1.5 or later.

**NG10. Marketplace, multi-region, customer-owned IEE nodes, full autonomy mode.** Phase 4+ items, deferred.

---

## 3. Constraints and Invariants

These are non-negotiable properties of the foundation refactor. Every change must preserve them. Every reviewer must verify them.

### 3.1 Backward compatibility

**INV-1. No existing agent run breaks.** All `agent_runs` rows that exist before migration apply continue to execute correctly with no manual intervention. Backfill is automated; defaults are safe; rollback is supported.

**INV-2. No existing test fails.** The full Vitest test suite (and CI gates) pass after every commit on this branch. New tests cover new behaviour; existing tests cover preserved behaviour.

**INV-3. No existing API breaks.** Every existing route returns the same response shape. New fields may be added to existing response payloads only if all consumers tolerate unknown fields.

**INV-4. Migrations are reversible.** Every migration has a corresponding `.down.sql` (already required by repo convention; see `migrations/_down/` directory). No migration deletes data. No migration rewrites historical rows in a way that loses information.

### 3.2 Schema constraints

**INV-5. Two new columns on `agent_runs`, nothing else.** `controller_style text NOT NULL DEFAULT 'native'` and `policy_envelope_snapshot jsonb`. No other schema changes in this spec. New tables, new event ledgers, and new audit tables are deferred.

**INV-6. Defaults are safe for existing runs.** `controller_style` defaults to `'native'`; this is the conservative choice (Native is the default per v1.2 brief Section 6.3). `policy_envelope_snapshot` defaults to `NULL` (legacy runs predate the snapshot; readers must tolerate `NULL`).

**INV-7. RLS is preserved.** Every new column inherits the existing `agent_runs` RLS policy. No RLS bypass. `policy_envelope_snapshot` JSONB content is per-organisation and never read across tenants.

### 3.3 Behavioural constraints

**INV-8. Risk Tier never changes existing approval behaviour without explicit policy.** A given action's existing `gateLevel` (`auto` / `review` / `block`) must be preserved unless a new policy rule explicitly overrides it. Adding `riskTier` to an action does not silently change its approval behaviour; it documents the tier for future policy consumers and surfaces it in Run Trace.

**INV-9. Policy Envelope snapshot is immutable after run start.** Once written, `policy_envelope_snapshot` is read-only. Mid-run constraint changes (e.g., a credential is revoked while a run is executing) do not retroactively rewrite the snapshot. They surface as separate events in Run Trace and may abort the run via existing policy mechanisms.

**INV-10. Run Trace is read-only.** The new endpoint `GET /api/agent-runs/:runId/trace` is a query surface only. No client may write to the constituent ledger tables through this contract. Existing write paths (`agent_execution_events` inserts from middleware, `routing_outcomes` from orchestrator, etc.) are unchanged.

**INV-11. CredentialBrokerService does not bypass existing controls.** The facade delegates to `connectionTokenService` and `integrationConnectionService`. RLS, OAuth refresh, advisory locks, and audit logging continue to fire from the existing implementations. The facade is structural, not policy.

**INV-12. controllerStyle does not alter LLM router contract.** Native and Operator runs both go through `llmRouter.routeCall`. Static gate `verify-no-direct-adapter-calls.sh` and runtime `assertCalledFromRouter()` continue to enforce single entry. Loop limits and budgets differ; provider invocation does not.

### 3.4 Process constraints

**INV-13. Naming pass is documentation only.** No file or function rename in this spec. `orchestratorFromTaskJob` stays. `iee_*` schema names stay. `executionMode` stays. The glossary doc is the single source of truth for canonical names; code-level renames are deferred to a future spec when refactor benefit clearly outweighs review cost.

**INV-14. Foundation refactor must not block Spec B (Support Desk Canonical) or Spec C (Support Agent MVP).** The two parallel workstreams may reference foundation primitives by name (e.g., a new `support.*` action assigns its `riskTier` per Section 4.2 conventions) but their implementation must not require this spec to fully ship before they begin. Coordination is via shared conventions, not shared commits.

**INV-15. CI gates must remain green throughout.** This includes existing gates: lint, typecheck, build:server, build:client, RLS coverage, idempotency keys, read-paths, no-direct-adapter-calls, canonical-dictionary, integration-reference, test-quality. Plus the new gate added by this spec: `verify-risk-tier-assigned.sh`.

### 3.5 Observability constraints

**INV-16. Structured logs use stable codes.** Foundation work introduces these stable log codes (consumers depend on them; do not rename):

- `foundation.controller_style.derived` — `controllerStyle` resolved at run start, with source (`override` / `executionMode` / `default`).
- `foundation.risk_tier.gate_derived` — `gateLevel` derived from `riskTier`, with source (`tier_default` / `policy_override`).
- `foundation.credential_broker.issued` — credential issued via the facade, with scope and purpose.
- `foundation.policy_envelope.resolved` — snapshot resolved at run start, with source counts.
- `foundation.run_trace.queried` — Run Trace endpoint queried, with event counts and latency.

**INV-17. Telemetry must not regress.** Existing Langfuse spans continue to fire. New spans for foundation primitives use the same registry pattern (`server/lib/tracing.ts`). No new telemetry backend.

---

## 4. Component Design

Each subsection below covers one of the six foundation items. Each subsection has the same structure: current state, target state, schema changes, code changes, derivation rules where applicable, migration strategy, observability, tests, effort estimate, dependencies.

### 4.1 controllerStyle field on agent runs

#### 4.1.1 Current state

The `agent_runs.executionMode` enum (`server/db/schema/agentRuns.ts:39`) encodes execution **capability**: `api` | `headless` | `claude-code` | `iee_browser` | `iee_dev`. Loop dispatch in `server/services/agentExecutionService.ts` branches on `executionMode` (multiple sites). Loop limits are global: `MAX_LOOP_ITERATIONS = 25` (`server/config/limits.ts:6`) is applied uniformly. Token budgets come from `subaccountAgents.tokenBudgetPerRun` (default 30,000) and are not differentiated by execution style.

The v1.2 brief Section 5.2 introduces `controllerStyle` as a separate axis encoding execution **style**: `native` (deterministic, structured, short-lived) or `operator` (adaptive, autonomous, long-running). Style is orthogonal to capability: a deterministic browser flow is `native + iee_browser`; an autonomous browser operator is `operator + iee_browser`.

#### 4.1.2 Target state

A new `controller_style` column on `agent_runs`, plus dispatch logic that picks loop limits and budget defaults from `(controllerStyle, executionMode)` jointly. Default derivation rules are documented and overrideable per run.

#### 4.1.3 Schema changes

```sql
-- Migration NNNN_agent_runs_controller_style.sql
ALTER TABLE agent_runs
  ADD COLUMN controller_style text NOT NULL DEFAULT 'native'
  CHECK (controller_style IN ('native', 'operator'));

-- Index for hot-path queries that filter by style
CREATE INDEX agent_runs_controller_style_idx
  ON agent_runs(controller_style)
  WHERE controller_style = 'operator';
-- Partial index because most runs are native; operator runs are the hot path
-- for dashboards that surface "long-running operators in flight".
```

```sql
-- Migration NNNN_agent_runs_controller_style.down.sql
ALTER TABLE agent_runs DROP COLUMN controller_style;
```

#### 4.1.4 Drizzle schema update

```ts
// server/db/schema/agentRuns.ts
export const agentRuns = pgTable('agent_runs', {
  // existing columns...
  executionMode: text('execution_mode').notNull(),
  controllerStyle: text('controller_style')
    .notNull()
    .default('native')
    .$type<'native' | 'operator'>(),
  // existing columns...
});
```

#### 4.1.5 Shared TypeScript types

```ts
// shared/types/controllerStyle.ts (new file)
export type ControllerStyle = 'native' | 'operator';

export const CONTROLLER_STYLES = ['native', 'operator'] as const;

export interface ControllerLimits {
  maxLoopIterations: number;
  defaultTokenBudgetMultiplier: number; // applied to subaccountAgents.tokenBudgetPerRun
  defaultMaxToolCalls: number;
  approvalDefaultMin: 'auto' | 'review' | 'block'; // floor approval level for this style
}
```

```ts
// server/config/controllerLimits.ts (new file)
export const CONTROLLER_LIMITS: Record<ControllerStyle, ControllerLimits> = {
  native: {
    maxLoopIterations: 25,
    defaultTokenBudgetMultiplier: 1.0,
    defaultMaxToolCalls: 20,
    approvalDefaultMin: 'auto',
  },
  operator: {
    maxLoopIterations: 100,
    defaultTokenBudgetMultiplier: 2.0, // 60K tokens per run by default
    defaultMaxToolCalls: 80,
    approvalDefaultMin: 'review', // Operator runs default to review for any state-changing action
  },
};
```

#### 4.1.6 Default derivation rule

When `controllerStyle` is not explicitly provided at run creation, derive from `executionMode`:

```ts
// server/services/controllerStyleResolver.ts (new file)
export function deriveControllerStyle(
  executionMode: ExecutionMode,
  override?: ControllerStyle,
): { style: ControllerStyle; source: 'override' | 'execution_mode_default' } {
  if (override) return { style: override, source: 'override' };

  switch (executionMode) {
    case 'api':
    case 'headless':
      return { style: 'native', source: 'execution_mode_default' };
    case 'claude-code':
    case 'iee_browser':
    case 'iee_dev':
      return { style: 'operator', source: 'execution_mode_default' };
    default:
      // Forward-compatible: future execution modes default to native (conservative)
      return { style: 'native', source: 'execution_mode_default' };
  }
}
```

The override path supports the orthogonality the brief requires: a 42 Macro Task using `iee_browser` may explicitly request `controllerStyle: 'native'` to inherit short-loop, strict-templating defaults despite running in a browser environment.

#### 4.1.7 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `server/db/schema/agentRuns.ts` | Add `controllerStyle` column | +5 |
| `migrations/NNNN_agent_runs_controller_style.sql` | New migration | +20 |
| `migrations/_down/NNNN_agent_runs_controller_style.down.sql` | Reverse migration | +5 |
| `shared/types/controllerStyle.ts` | New type + constant | +10 |
| `server/config/controllerLimits.ts` | New limits table | +30 |
| `server/services/controllerStyleResolver.ts` | New pure function (testable in isolation) | +30 |
| `server/services/controllerStyleResolverPure.test.ts` | Unit tests | +60 |
| `server/services/agentExecutionService.ts` | Replace `MAX_LOOP_ITERATIONS` with `CONTROLLER_LIMITS[run.controllerStyle].maxLoopIterations`; replace token budget default with multiplier; capture controllerStyle at run creation; emit `foundation.controller_style.derived` log | +40 to +60 |
| `server/services/agentRunService.ts` (or wherever runs are created) | Accept optional `controllerStyle` override on create; persist on insert | +15 |
| `server/routes/agentRuns.ts` | Route handlers accept and pass through `controllerStyle` override (optional query/body param) | +10 |
| Tests | Integration test: native vs operator runs use different loop limits, token budgets | +80 |

**Total: ~290 to 310 LOC.**

#### 4.1.8 Backfill strategy

Existing rows get `controller_style = 'native'` from the column default. This is wrong for some historical runs (e.g., `iee_browser` runs that should map to `operator`), but the historical accuracy is low value and the conservative default is safe. A one-shot backfill job applies the derivation rule retroactively:

```sql
-- backfill (run once, post-migration)
UPDATE agent_runs
SET controller_style = 'operator'
WHERE execution_mode IN ('claude-code', 'iee_browser', 'iee_dev')
  AND controller_style = 'native';
```

The backfill is idempotent and can be re-run safely. It is not in the migration itself because it locks the table; it runs as a separate maintenance task after migration apply.

#### 4.1.9 Observability

- Span: `agent.run.controller_style.derived` (created in `agentExecutionService` at run start).
- Event: `foundation.controller_style.derived` with payload `{ runId, executionMode, controllerStyle, source }`.
- Run Trace event type: `controller_style_decided` (Section 4.4 inherits this).

#### 4.1.10 Tests

- Pure: `controllerStyleResolver.test.ts` covers all five `executionMode` values, override path, undefined case, forward-compat default.
- Integration: spawn a native run and an operator run from the same agent; assert different `MAX_LOOP_ITERATIONS` are applied; assert different token budgets resolve.
- Regression: existing `agentExecutionService` tests pass unchanged; the `MAX_LOOP_ITERATIONS` constant is replaced with a derivation lookup that returns 25 for native (preserving prior behaviour).

#### 4.1.11 Effort estimate

**2 to 3 dev-days.** Schema migration, type, resolver, dispatch refactor, integration test. Risk: low; purely additive, defaults preserve existing behaviour.

#### 4.1.12 Dependencies

- Blocks: Section 4.5 Policy Envelope (envelope captures `controllerStyle` as a snapshot field).
- Blocked by: none.

### 4.2 Risk Tier sweep across action registry

#### 4.2.1 Current state

`server/config/actionRegistry.ts` registers approximately 110 actions. Each action declares a `gateLevel: 'auto' | 'review' | 'block'`. Approximate distribution from current registry:

- 52 actions at `auto`
- 54 actions at `review`
- 1 action at `block`
- A small number of methodology / universal actions bypass the gate

The 3-level gate is too coarse for the 7-tier model the v1.2 brief Section 11 introduces. Risk Tier is a finer-grained classification that drives default `gateLevel`, default approval requirement, default Run Trace detail, and default policy enforcement.

#### 4.2.2 Target state

Every action in `actionRegistry.ts` has a `riskTier: 0 | 1 | 2 | 3 | 4 | 5 | 6` field. The `gateLevel` derives from `riskTier` plus optional policy override (per v1.2 brief Section 11.2). A CI gate enforces that every action has a tier assigned.

#### 4.2.3 Tier classification rubric

Per v1.2 brief Section 11:

| Tier | Capability | Example actions |
|---|---|---|
| 0 | Model reasoning only, no external interaction | Pure reasoning skills, methodology skills with no I/O |
| 1 | Internal data reads (own org, own subaccount) | Memory queries, belief reads, capability-map reads, agent-config reads |
| 2 | External API reads and writes | List inboxes, fetch tickets, read CRM contacts, list Slack channels |
| 3 | Browser actions and web extraction | Navigate, click, type, extract, login_test |
| 4 | Sandboxed code execution | (Phase 2) CSV transformations, attachment analysis |
| 5 | Terminal, repo, filesystem access | `iee_dev` actions: `run_command`, `git_clone`, `git_commit`, `write_file` |
| 6 | Deploy, funds, client messaging, high-impact | Send email to client, post to client channel, pause campaign, deploy code, transfer funds |

Per v1.2 brief Section 11.1: tier is **single-axis max-tier**. The action's tier is the highest applicable level across technical capability and audience impact. Example: "Send email" has technical tier 2 (external API write) and audience-impact tier 6 (client messaging) → max-tier = 6.

#### 4.2.4 Tier-to-gateLevel derivation

```ts
// shared/types/riskTier.ts (new file)
export type RiskTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const RISK_TIERS = [0, 1, 2, 3, 4, 5, 6] as const;

export type GateLevel = 'auto' | 'review' | 'block';

export function deriveGateLevel(
  riskTier: RiskTier,
  policyOverride?: GateLevel,
): { gateLevel: GateLevel; source: 'tier_default' | 'policy_override' } {
  if (policyOverride) return { gateLevel: policyOverride, source: 'policy_override' };

  if (riskTier <= 2) return { gateLevel: 'auto', source: 'tier_default' };
  if (riskTier <= 5) return { gateLevel: 'review', source: 'tier_default' };
  return { gateLevel: 'block', source: 'tier_default' };
}
```

This function is pure and lives in `shared/`. Test coverage in `shared/types/__tests__/riskTier.test.ts`.

#### 4.2.5 ActionDefinition update

```ts
// server/config/actionRegistry.ts (existing file, type extended)
export interface ActionDefinition {
  // existing fields...
  gateLevel: GateLevel;
  riskTier: RiskTier; // NEW: required field
  // existing fields...
}
```

The field is **required at the type level**. TypeScript will fail to compile if any action is missing a tier. This is a stronger guarantee than the CI gate alone.

#### 4.2.6 Tier assignment for existing 110 actions

Per Section 1 of the codebase research, the rough distribution by tier:

| Tier | Approx count | Categories |
|---|---|---|
| 0 | ~5 | Pure inference, methodology skills, internal config reads |
| 1 | ~8 | Memory queries, beliefs, capability map, list_skills |
| 2 | ~20 | List inboxes, fetch tickets, list CRM contacts, list Slack channels, read connections |
| 3 | ~30 | Browser actions: navigate, click, type, extract, login_test, web_search |
| 4 | ~10 | Sandboxed code (most are Phase 2; a few exist today for analysis) |
| 5 | ~25 | Dev: run_command, git_clone, git_commit, write_file, read_file, run tests |
| 6 | ~12 | Send email to client, post to client Slack, pause campaign, deploy, transfer funds |

The tier assignment for each of the 110 actions is not enumerated in this spec. It is enumerated in the implementation PR as a checklist artefact. The implementation PR includes a CSV attachment (`tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv`) with one row per action, reviewed by the architect before merge. Disagreements escalate to the operator.

The assignment process:

1. Implementer reads each action's docstring and `gateLevel`.
2. Implementer assigns tier per the rubric in 4.2.3.
3. Implementer verifies tier-to-gateLevel derivation matches existing `gateLevel`. **If derivation differs from existing `gateLevel`, the existing `gateLevel` wins and is recorded as a `policyOverride` per INV-8.**
4. Architect reviews the full CSV before the PR merges.

#### 4.2.7 CI gate

```bash
#!/usr/bin/env bash
# scripts/verify-risk-tier-assigned.sh
# Verifies every action in actionRegistry.ts has riskTier assigned.

set -euo pipefail

# Find all action definitions and check riskTier presence
node --eval "
  const reg = require('./server/config/actionRegistry.ts');
  const missing = Object.entries(reg.ACTION_REGISTRY)
    .filter(([_, def]) => def.riskTier === undefined || def.riskTier === null)
    .map(([slug]) => slug);
  if (missing.length > 0) {
    console.error('Actions missing riskTier:', missing.join(', '));
    process.exit(1);
  }
  console.log('All actions have riskTier assigned.');
"
```

Registered in `scripts/run-all-gates.sh` alongside existing gates. Failure blocks the build.

#### 4.2.8 policyEngineService integration

`server/services/policyEngineService.ts` consults `riskTier` when evaluating a policy decision:

```ts
// server/services/policyEngineService.ts (extended)
async function evaluatePolicy(action: ActionDefinition, context: PolicyContext): Promise<PolicyDecision> {
  const policyOverride = await lookupPolicyOverride(action.slug, context);
  const { gateLevel, source } = deriveGateLevel(action.riskTier, policyOverride);

  emitEvent('foundation.risk_tier.gate_derived', {
    actionSlug: action.slug,
    riskTier: action.riskTier,
    gateLevel,
    source,
    runId: context.runId,
  });

  return { gateLevel, source, riskTier: action.riskTier };
}
```

The `riskTier` and the derivation source are returned from the policy decision so middleware (`proposeActionMiddleware`) and Run Trace can surface them.

#### 4.2.9 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `shared/types/riskTier.ts` | New type, constant, `deriveGateLevel` pure function | +30 |
| `shared/types/__tests__/riskTier.test.ts` | Pure function tests | +60 |
| `server/config/actionRegistry.ts` | Extend `ActionDefinition` interface; assign tier to ~110 actions | +110 (one line per action) |
| `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv` | Reviewable artefact | (CSV, not LOC) |
| `scripts/verify-risk-tier-assigned.sh` | New CI gate | +30 |
| `scripts/run-all-gates.sh` | Register new gate | +1 |
| `server/services/policyEngineService.ts` | Integrate `riskTier` in decision evaluation | +20 |
| `server/services/middleware/proposeActionMiddleware.ts` | Pass through `riskTier` to decision record | +5 |
| Tests | Integration test: action with tier 6 routes to review by default; policy override to auto works | +80 |

**Total: ~340 LOC plus the registry sweep.**

#### 4.2.10 Migration strategy

No database migration. The change is type-level and config-level only. Backfill is a one-time code edit (the registry sweep), not a data migration.

For existing in-flight runs: they continue to use the existing `gateLevel` because `gateLevel` derivation falls back to the explicit value when present. This is the conservative path.

#### 4.2.11 Observability

- Event: `foundation.risk_tier.gate_derived` with payload `{ runId, actionSlug, riskTier, gateLevel, source }`.
- Surfaced in Run Trace (Section 4.4) per decision event.

#### 4.2.12 Tests

- Pure: `riskTier.test.ts` covers all 7 tier values with and without policy override.
- Registry: `actionRegistry.test.ts` (existing) extended to verify every action has `riskTier`.
- Integration: a tier-6 action without policy override blocks; with policy override allowing review, it goes to review queue; reviewer approval allows execution.
- Regression: full existing test suite passes; `gateLevel` behaviour for every existing action is preserved (no silent change).

#### 4.2.13 Effort estimate

**2 to 4 dev-days.** Tier assignment for 110 actions is the bulk of the work (roughly 0.5 to 1 day if methodical). The rest is the type, derivation function, CI gate, integration. Risk: medium. Misclassification is recoverable post-ship (update tier, redeploy) but produces audit pain if it changes approval behaviour. Architect review of the CSV is the mitigation.

#### 4.2.14 Dependencies

- Blocks: Section 4.5 Policy Envelope (envelope captures resolved tiers per run).
- Blocked by: none.
- Coordinates with: Spec B (Support Desk Canonical) — new `support.*` actions assign their tier per the rubric in 4.2.3 as part of their own PR; this spec does not enumerate them.

### 4.3 CredentialBrokerService facade

#### 4.3.1 Current state

Credential infrastructure is mature but exposed across multiple services with no single named entry point:

- `server/db/schema/integrationConnections.ts` — `integration_connections` table with org/subaccount/agent scoping, OAuth + web_login + api_key auth_types, AES-256-GCM encryption.
- `server/services/connectionTokenService.ts` (655 lines) — token refresh logic, advisory locks, drop-after-use for web login, OAuth refresh with 15-min early refresh buffer.
- `server/services/integrationConnectionService.ts` (655 lines) — CRUD, sanitisation, per-scope resolution.
- `server/db/schema/auditEvents.ts` — credential audit logging.

Call sites (current scattered usage):

- Routes: `server/routes/integrationConnections.ts`, `server/routes/webLoginConnections.ts`.
- Services: `server/services/ieeExecutionService.ts` (credential injection at IEE worker dispatch).
- Worker: `worker/src/browser/login.ts` (web login credential consumption).
- Middleware: token refresh middleware on connection-using requests.

Each call site reaches into `connectionTokenService` or `integrationConnectionService` directly. There is no single named primitive.

#### 4.3.2 Target state

A `CredentialBrokerService` facade exposed as `server/services/credentialBrokerService.ts`. The facade is the only documented entry point for new code; existing code is migrated. The facade delegates to existing services internally; mechanics are unchanged.

#### 4.3.3 Facade API

```ts
// server/services/credentialBrokerService.ts (new file)

export interface CredentialScope {
  organisationId: string;
  subaccountId?: string | null;
  agentId?: string | null;
  agentRunId?: string | null;
  purpose: string; // "iee_browser_login", "send_email", "support_reply", etc.
}

export interface IssuedCredential {
  credentialId: string;
  authType: 'oauth2' | 'api_key' | 'web_login'; // forward-compatible: 'operator_session' added in Phase 3
  providerSlug: string;
  scope: CredentialScope;
  // Decrypted material is returned only via injectIntoEnvironment; never on this object.
}

export interface CredentialAuditEntry {
  credentialId: string;
  action: 'issued' | 'refreshed' | 'revoked' | 'used';
  scope: CredentialScope;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

export const credentialBrokerService = {
  /**
   * Issue a credential reference for the given scope and purpose.
   * Returns an opaque credential id; decrypted material is not returned here.
   */
  async issueCredential(scope: CredentialScope, ttlMs?: number): Promise<IssuedCredential>,

  /**
   * Inject credential material into an environment dict for runtime use.
   * Decrypted material is short-lived and dropped at the end of the call site's lifecycle.
   */
  async injectIntoEnvironment(
    env: Record<string, string>,
    credentialId: string,
  ): Promise<Record<string, string>>,

  /**
   * Revoke a credential. Existing in-flight uses continue until completion;
   * new requests fail.
   */
  async revoke(credentialId: string, organisationId: string): Promise<void>,

  /**
   * Query credential audit log for a given scope.
   */
  async audit(query: {
    organisationId: string;
    subaccountId?: string;
    credentialId?: string;
    sinceTimestamp?: Date;
    limit?: number;
  }): Promise<CredentialAuditEntry[]>,

  /**
   * Resolve the available credentials for a run context.
   * Used by Policy Envelope (Section 4.5) to capture credential availability
   * at run start.
   */
  async resolveAvailableCredentials(scope: CredentialScope): Promise<IssuedCredential[]>,
};
```

#### 4.3.4 Implementation strategy

The facade is **structural, not policy**. Each method delegates to existing services:

```ts
// server/services/credentialBrokerService.ts (sketch)
import { connectionTokenService } from './connectionTokenService.js';
import { integrationConnectionService } from './integrationConnectionService.js';
import { db } from '../db/index.js';

export const credentialBrokerService = {
  async issueCredential(scope, ttlMs) {
    // Delegates to integrationConnectionService.findActiveConnection + connectionTokenService.refreshIfNeeded
    // Emits foundation.credential_broker.issued event
    // Returns IssuedCredential
  },

  async injectIntoEnvironment(env, credentialId) {
    // Delegates to connectionTokenService.decryptForUse
    // Caller is responsible for dropping the decrypted material at end of use
    // Existing drop-after-use semantics preserved
  },

  async revoke(credentialId, organisationId) {
    // Delegates to integrationConnectionService.revoke
    // Emits foundation.credential_broker.revoked event
  },

  async audit(query) {
    // Reads from auditEvents table with scope filter
  },

  async resolveAvailableCredentials(scope) {
    // Lists active connections matching scope; does NOT decrypt
  },
};
```

#### 4.3.5 Call site migration

Every existing call to `connectionTokenService.*` or `integrationConnectionService.*` from outside those services migrates to `credentialBrokerService.*`. The two underlying services remain as private implementations; they are not deprecated, but new code does not call them directly.

| Existing call site | Migrated to |
|---|---|
| `server/routes/integrationConnections.ts` | `credentialBrokerService.audit`, `revoke`, `resolveAvailableCredentials` |
| `server/routes/webLoginConnections.ts` | `credentialBrokerService.issueCredential`, `revoke` |
| `server/services/ieeExecutionService.ts` | `credentialBrokerService.injectIntoEnvironment` |
| `worker/src/browser/login.ts` | (worker-side; consumes injected env, no facade call) |
| Future: Spec B Teamwork adapter | `credentialBrokerService.injectIntoEnvironment` |
| Future: Phase 3 Operator Session Identity | `credentialBrokerService.issueCredential` with new `auth_type` |

#### 4.3.6 Forward-compatibility for Phase 3

`IssuedCredential.authType` includes a forward-comment for `'operator_session'` (Phase 3 ChatGPT OAuth). The facade does not implement this auth_type today, but the type union signals where it lands.

When Phase 3 adds `auth_type: 'operator_session'` (per `docs/openclaw-strategic-analysis.md` Phase 3), the facade signature does not change. Only the underlying `connectionTokenService` gains support for the new auth_type.

#### 4.3.7 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `server/services/credentialBrokerService.ts` | New facade | +150 |
| `server/services/__tests__/credentialBrokerService.test.ts` | Unit tests with mocks | +80 |
| `server/routes/integrationConnections.ts` | Migrate to facade calls | +/-20 (mostly replacements) |
| `server/routes/webLoginConnections.ts` | Migrate to facade calls | +/-15 |
| `server/services/ieeExecutionService.ts` | Migrate to facade calls | +/-10 |
| `architecture.md` | Reference facade in Credentials section | +10 |
| `docs/synthetos-nomenclature.md` | Reference facade as canonical name (Section 4.6) | +5 |

**Total: ~250 to 290 LOC, mostly the facade and tests; call site migrations are net-zero refactors.**

#### 4.3.8 Migration strategy

No database migration. Code-only refactor. The facade is added; call sites migrate; underlying services preserved.

Rollout: the facade ships alongside its first migrated call site. Subsequent migrations land in follow-up PRs. The grace period is one sprint: by end of foundation refactor, every call site outside `connectionTokenService` and `integrationConnectionService` uses the facade.

#### 4.3.9 Observability

- Event: `foundation.credential_broker.issued` with payload `{ credentialId, scope, ttlMs }`.
- Event: `foundation.credential_broker.revoked` with payload `{ credentialId, scope, revokedBy }`.
- Existing audit events from `connectionTokenService` continue unchanged.

#### 4.3.10 Tests

- Unit: facade methods tested with mocked underlying services (verify delegation correctness).
- Integration: end-to-end credential issuance, injection, revocation, audit on a test integration connection.
- Regression: existing connection tests pass unchanged.

#### 4.3.11 Effort estimate

**1 to 2 dev-days.** Facade is structural; underlying mechanics are reused. Risk: low. Backward compatibility is straightforward because the underlying services keep working.

#### 4.3.12 Dependencies

- Blocks: Section 4.5 Policy Envelope (envelope captures `resolveAvailableCredentials` at run start).
- Blocked by: none.
- Coordinates with: Spec B (Support Desk Canonical) — Teamwork adapter consumes the facade for credential injection.

### 4.4 Run Trace canonical API contract

#### 4.4.1 Current state

Decision audit lives across at least seven tables today:

- `agent_execution_events` — per-run event log with `eventType`, `sequenceNumber`, ordered by run.
- `routing_outcomes` — Orchestrator path A/B/C/D classification + outcome.
- `delegation_outcomes` — agent-to-agent spawn / handoff outcomes.
- `tool_call_security_events` — `proposeActionMiddleware` decisions (allow/deny/review).
- `reviewAuditRecords` — HITL approval decisions.
- `actions` — proposed actions with gateLevel and reasoning.
- `llm_requests` — every LLM call with full attribution.

The existing UI surface is `client/src/pages/operate/RunTracePage.tsx` (~350 lines). It joins these tables client-side: it fetches run detail, IEE progress, delegation graph, and renders them as a tree of tool-call events. Each event surface (delegation, IEE progress, runtime checks) has its own fetch and render path.

There is **no server-side endpoint that returns a unified, ordered, queryable Run Trace event stream**. The client orchestrates the joins, and consumers wanting to programmatically replay a run trace (CI, eval, audit export) must replicate that orchestration.

#### 4.4.2 Target state

A `GET /api/agent-runs/:runId/trace` endpoint that returns a unified, ordered, paginated, filterable event stream by joining the existing five decision-ledger tables on the server. The endpoint is a **virtual view** per v1.2 brief Section 12.1; no new tables are introduced. The contract is forward-compatible with the Phase 3+ canonical ledger consolidation (v1.2 brief Section 12.2).

#### 4.4.3 Endpoint contract

```
GET /api/agent-runs/:runId/trace

Query parameters:
  cursor?: string             // opaque pagination cursor
  limit?: number              // default 50, max 200
  eventTypes?: string[]       // filter by event type(s); comma-separated
  sinceTimestamp?: ISO8601    // start of time range
  untilTimestamp?: ISO8601    // end of time range
  toolSlug?: string           // filter to events involving a tool

Response: 200 OK
{
  runId: string,
  events: RunTraceEvent[],
  pagination: {
    nextCursor: string | null,
    hasMore: boolean,
    totalEstimate?: number,
  },
  envelope: PolicyEnvelopeSnapshot | null,    // see Section 4.5
  controllerStyle: 'native' | 'operator',
  summary: {
    finalStatus: string,
    totalCostCents: number,
    totalDurationMs: number,
    eventCounts: Record<string, number>,
  },
}

Response: 401, 403, 404 standard

Permissions: same as GET /api/agent-runs/:runId; org-scoped via RLS.
```

#### 4.4.4 Unified event type

```ts
// shared/types/runTraceEvent.ts (new file)

export type RunTraceEventType =
  | 'controller_style_decided'         // from agent_execution_events
  | 'policy_envelope_resolved'         // from agent_execution_events (new event type, Section 4.5)
  | 'routing_path_chosen'              // from routing_outcomes
  | 'tool_proposed'                    // from actions
  | 'tool_security_decision'           // from tool_call_security_events
  | 'tool_call'                        // from agent_execution_events
  | 'tool_result'                      // from agent_execution_events
  | 'llm_call'                         // from llm_requests
  | 'delegation_spawned'               // from delegation_outcomes
  | 'delegation_completed'             // from delegation_outcomes
  | 'review_requested'                 // from actions + reviewAuditRecords
  | 'review_decided'                   // from reviewAuditRecords
  | 'iee_step'                         // from iee_steps
  | 'run_started'                      // from agent_runs
  | 'run_terminated';                  // from agent_runs

export interface RunTraceEventBase {
  eventType: RunTraceEventType;
  runId: string;
  organisationId: string;
  timestamp: string;            // ISO8601
  sequenceNumber: number;       // global per run, monotonically increasing
  sourceTable: string;          // for debugging only; consumers do not depend on this
  payload: Record<string, unknown>; // event-type-specific shape (discriminated)
}

export type RunTraceEvent =
  | RunTraceEventBase & { eventType: 'controller_style_decided'; payload: { controllerStyle: ControllerStyle; source: 'override' | 'execution_mode_default' } }
  | RunTraceEventBase & { eventType: 'tool_security_decision'; payload: { toolSlug: string; decision: 'allow' | 'deny' | 'review'; riskTier: RiskTier; gateLevel: GateLevel; gateLevelSource: 'tier_default' | 'policy_override' } }
  // ... full discriminated union for each event type
  ;
```

The discriminated union shape is the consumer contract. New event types may be added; existing event type payloads are append-only (no breaking changes).

#### 4.4.5 Server-side query strategy

Single query with `UNION ALL` across the five tables, projected to the common `RunTraceEvent` shape, ordered by `(timestamp, sequence_number, id)` tiebreaker, paginated by cursor.

```sql
-- sketch only; production query lives in runTraceService.ts
WITH events AS (
  SELECT
    'controller_style_decided' AS event_type,
    run_id,
    organisation_id,
    created_at AS timestamp,
    sequence_number,
    'agent_execution_events' AS source_table,
    payload
  FROM agent_execution_events
  WHERE run_id = $1 AND event_type = 'controller_style_decided'

  UNION ALL

  SELECT
    'routing_path_chosen' AS event_type,
    agent_run_id AS run_id,
    organisation_id,
    created_at AS timestamp,
    NULL AS sequence_number,
    'routing_outcomes' AS source_table,
    jsonb_build_object('pathTaken', path_taken, 'outcome', outcome, 'reason', decision_reason) AS payload
  FROM routing_outcomes
  WHERE agent_run_id = $1

  -- ... unions for delegation_outcomes, tool_call_security_events, reviewAuditRecords, etc.
)
SELECT * FROM events
WHERE
  ($cursor_timestamp IS NULL OR (timestamp, sequence_number) > ($cursor_timestamp, $cursor_seq))
  AND ($event_types IS NULL OR event_type = ANY($event_types))
  AND ($since_timestamp IS NULL OR timestamp >= $since_timestamp)
  AND ($until_timestamp IS NULL OR timestamp <= $until_timestamp)
ORDER BY timestamp, COALESCE(sequence_number, 0), source_table
LIMIT $limit;
```

Performance notes:

- The query relies on existing indexes on `(run_id, sequence_number)`, `(agent_run_id)` on each table.
- For runs with thousands of events, the cursor pagination ensures no full-table scans.
- Query timing is logged via `foundation.run_trace.queried` event so we can detect regression.

#### 4.4.6 Service layer

```ts
// server/services/runTraceService.ts (new file)

export interface RunTraceQuery {
  runId: string;
  organisationId: string;
  cursor?: string;
  limit?: number;
  eventTypes?: RunTraceEventType[];
  sinceTimestamp?: Date;
  untilTimestamp?: Date;
  toolSlug?: string;
}

export interface RunTraceResult {
  runId: string;
  events: RunTraceEvent[];
  pagination: { nextCursor: string | null; hasMore: boolean };
  envelope: PolicyEnvelopeSnapshot | null;
  controllerStyle: ControllerStyle;
  summary: RunTraceSummary;
}

export const runTraceService = {
  async query(q: RunTraceQuery): Promise<RunTraceResult>,
};
```

The service is the single boundary; the route is a thin handler.

#### 4.4.7 Route handler

```ts
// server/routes/agentRuns.ts (extended)
router.get('/:runId/trace', authenticate, asyncHandler(async (req, res) => {
  const { runId } = req.params;
  const query = parseRunTraceQuery(req.query);
  const result = await runTraceService.query({
    runId,
    organisationId: req.orgId,
    ...query,
  });
  res.json(result);
}));
```

Standard route conventions apply (`authenticate`, org scoping via `req.orgId`, RLS at DB layer, no direct DB access in route handler).

#### 4.4.8 Client integration

`client/src/pages/operate/RunTracePage.tsx` is updated to:

1. Call the new `/api/agent-runs/:runId/trace` endpoint.
2. Render the unified event stream (instead of orchestrating the joins client-side).
3. Continue to render the existing tree-of-tool-calls view by filtering the unified stream for tool events.
4. Add new event types (controller_style_decided, policy_envelope_resolved, tool_security_decision) to the renderer.
5. Surface the `envelope`, `controllerStyle`, and `summary` fields in the headline (Section 5).

The existing `RunTraceEventRenderer.tsx`, `DelegationGraphView.tsx`, and helper components are reused; their input shapes are updated to consume the unified event type.

#### 4.4.9 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `shared/types/runTraceEvent.ts` | New discriminated union | +120 |
| `shared/types/__tests__/runTraceEvent.test.ts` | Pure tests | +60 |
| `server/services/runTraceService.ts` | New query service | +180 |
| `server/services/__tests__/runTraceService.test.ts` | Integration tests with seed data | +120 |
| `server/routes/agentRuns.ts` | New route handler | +30 |
| `client/src/pages/operate/RunTracePage.tsx` | Migrate to new endpoint | +/-50 |
| `client/src/components/run-trace/RunTraceEventRenderer.tsx` | Add renderers for new event types | +60 |
| `client/src/lib/api/runTrace.ts` | New API client wrapper | +30 |

**Total: ~650 LOC.**

#### 4.4.10 Migration strategy

No database migration. The endpoint reads existing tables. The client switch from old fetch paths to the new endpoint is a single-PR change behind a feature flag (`RUN_TRACE_API_V1`) that defaults on after one week of dogfooding.

#### 4.4.11 Observability

- Event: `foundation.run_trace.queried` with payload `{ runId, eventCount, latencyMs, filters }`.
- Performance: `agent.run.trace_queried` Langfuse span around the service call.
- Alerting threshold: query p95 over 500ms triggers a follow-up to consider partial indexes or canonical ledger consolidation.

#### 4.4.12 Tests

- Pure: type discrimination tests, cursor encoding/decoding tests.
- Integration: seed a run with events across all five tables; query with various filters and pagination; assert result shape and ordering.
- Regression: existing RunTracePage rendering tests pass with the new endpoint.
- Performance: a synthetic run with 5,000 events queries in under 500ms.

#### 4.4.13 Effort estimate

**3 to 4 dev-days.** Schema design, query, service, types, route, client migration, tests. Risk: medium (multi-table query performance) but bounded by alerting.

#### 4.4.14 Dependencies

- Blocks: Phase 3+ canonical ledger consolidation (the API contract is forward-compatible; backend swap is transparent to clients).
- Blocked by: Section 4.1 (controllerStyle event type), Section 4.2 (riskTier surfaced in tool_security_decision events), Section 4.5 (envelope returned in response).

### 4.5 Policy Envelope per-run snapshot

#### 4.5.1 Current state

Constraint enforcement is mature but distributed across multiple sources:

- `policy_rules` table + `policyEngineService.ts` (357 lines) — action-level allow/deny/escalate with confidence thresholds and guidance text.
- `actions.gateLevel` (registry) — per-action default approval level.
- `subaccountAgents.{tokenBudgetPerRun, maxToolCallsPerRun, maxCostPerRunCents, allowedSkillSlugs}` — per-agent runtime constraints.
- `spendingPolicies` table — per-org and per-subaccount cost guardrails.
- `toolRestrictionMiddleware`, `proposeActionMiddleware`, `loopDetectionMiddleware`, `confidenceEscapeMiddleware` — runtime enforcement points.
- `integration_connections` (filtered by status, scope) — credential availability.

Each enforcement point queries its source on-demand. There is no single record of "what policy was in force when this run executed." Consumers wanting to replay the constraint set (eval, audit export, debugging) must reconstruct it from the originating tables, which may have changed since the run.

#### 4.5.2 Target state

A `policy_envelope_snapshot` JSONB column on `agent_runs`, written at run creation (before the first tool call) with the resolved constraint set. The snapshot is **immutable after run start** (INV-9). Consumers (Run Trace, eval, audit) read the snapshot directly; the snapshot is the single source of truth for "what was in force during this run."

#### 4.5.3 Schema changes

```sql
-- Migration NNNN_agent_runs_policy_envelope.sql
ALTER TABLE agent_runs
  ADD COLUMN policy_envelope_snapshot jsonb;
-- NULL is valid (legacy runs predate the snapshot).
-- Reads must tolerate NULL; new runs always populate it.
```

```sql
-- Migration NNNN_agent_runs_policy_envelope.down.sql
ALTER TABLE agent_runs DROP COLUMN policy_envelope_snapshot;
```

No index. The snapshot is read with the run row, never queried independently.

#### 4.5.4 Snapshot type

```ts
// shared/types/policyEnvelope.ts (new file)

export interface PolicyEnvelopeSnapshot {
  schemaVersion: 1;
  resolvedAt: string; // ISO8601

  // Identity context
  runId: string;
  agentId: string;
  subaccountAgentId: string | null;
  organisationId: string;
  subaccountId: string | null;

  // Style and capability
  controllerStyle: ControllerStyle;
  executionMode: ExecutionMode;
  controllerLimits: ControllerLimits; // resolved from CONTROLLER_LIMITS lookup

  // Permitted operations
  allowedControllers: ControllerStyle[];          // future-proof: today often ['native', 'operator'] both
  allowedEnvironments: ExecutionEnvironment[];    // ['browser', 'api_tool', 'terminal_repo', ...]
  allowedSkillSlugs: string[];                    // from subaccountAgents.allowedSkillSlugs
  allowedIntegrationSlugs: string[];              // from active integration_connections

  // Risk constraints
  maxRiskTier: RiskTier;                          // ceiling for this run; tools above this require explicit policy
  riskTierApprovalDefaults: Record<RiskTier, GateLevel>; // tier -> gateLevel default for this run

  // Budget constraints
  budgets: {
    tokenBudget: number;
    maxToolCalls: number;
    maxCostCents: number;
    maxLlmCalls: number;
  };

  // Approval requirements
  approvalDefaults: {
    sendEmailToClient: GateLevel;
    sendSlackToClient: GateLevel;
    deployOrFundsTransfer: GateLevel;
    // future: extensible map keyed by capability category
  };

  // Credential availability snapshot (id list, not material)
  availableCredentialIds: string[]; // from credentialBrokerService.resolveAvailableCredentials

  // Active policy rules at run start (slugs only; full rules looked up live if needed)
  activePolicyRuleIds: string[];

  // Source manifest for debugging
  sources: {
    subaccountAgentVersion: string | null; // hash or updatedAt
    spendingPoliciesVersion: string | null;
    activePolicyRulesVersion: string | null;
    capabilityMapVersion: string | null;
  };
}
```

The schema version field allows future evolution of the snapshot shape without breaking readers. v1 is the only supported version at this spec.

#### 4.5.5 Resolver function

```ts
// server/services/policyEnvelopeResolver.ts (new file)

export interface RunCreationContext {
  runId: string;
  agentId: string;
  subaccountAgentId: string | null;
  organisationId: string;
  subaccountId: string | null;
  controllerStyle: ControllerStyle;
  executionMode: ExecutionMode;
  override?: Partial<PolicyEnvelopeSnapshot>; // explicit overrides (rare; debugging only)
}

export async function resolvePolicyEnvelope(
  ctx: RunCreationContext,
): Promise<PolicyEnvelopeSnapshot> {
  // 1. Resolve subaccountAgent constraints (budgets, allowedSkillSlugs)
  // 2. Resolve org and subaccount spending policies
  // 3. Resolve active policy rules for this scope
  // 4. Resolve available credentials via credentialBrokerService.resolveAvailableCredentials
  // 5. Resolve capability map (allowedIntegrationSlugs)
  // 6. Compute controllerLimits from CONTROLLER_LIMITS[controllerStyle]
  // 7. Compute riskTierApprovalDefaults using deriveGateLevel for each tier
  // 8. Apply explicit overrides (if any)
  // 9. Stamp resolvedAt; return snapshot

  // Emits foundation.policy_envelope.resolved event
}
```

The resolver is **pure relative to its inputs** but reads from the database to gather constraint sources. It is tested with seeded constraint data.

#### 4.5.6 Write site

In `server/services/agentExecutionService.ts`, at run creation (before the first tool call):

```ts
// after creating agent_runs row, before runAgenticLoop
const snapshot = await resolvePolicyEnvelope({
  runId: run.id,
  agentId: run.agentId,
  subaccountAgentId: run.subaccountAgentId,
  organisationId: run.organisationId,
  subaccountId: run.subaccountId,
  controllerStyle: run.controllerStyle,
  executionMode: run.executionMode,
});

await db.update(agentRuns)
  .set({ policyEnvelopeSnapshot: snapshot })
  .where(eq(agentRuns.id, run.id));

emitEvent('foundation.policy_envelope.resolved', {
  runId: run.id,
  schemaVersion: snapshot.schemaVersion,
  sourceCounts: {
    activePolicyRules: snapshot.activePolicyRuleIds.length,
    availableCredentials: snapshot.availableCredentialIds.length,
    allowedIntegrations: snapshot.allowedIntegrationSlugs.length,
  },
});
```

Mid-run constraint changes (e.g., a credential is revoked) do NOT rewrite the snapshot. They surface as separate Run Trace events. The snapshot answers "what was in force at run start"; live state changes are tracked separately.

#### 4.5.7 Read sites

- Run Trace API (Section 4.4) returns the snapshot in the response envelope.
- `RunTracePage.tsx` headline (Section 5) reads the snapshot for the one-line summary.
- Eval harness reads the snapshot to replay the constraint set during regression testing.
- Audit export reads the snapshot for compliance reports.

Middleware does **not** read the snapshot for runtime decisions. Runtime enforcement reads the live constraint sources because mid-run changes (credential revoked, policy rule updated) must take effect immediately. The snapshot is for replay and audit, not for enforcement.

#### 4.5.8 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `migrations/NNNN_agent_runs_policy_envelope.sql` + `.down.sql` | New migration | +25 |
| `server/db/schema/agentRuns.ts` | Add column to Drizzle schema | +5 |
| `shared/types/policyEnvelope.ts` | New type | +120 |
| `shared/types/__tests__/policyEnvelope.test.ts` | Pure tests for type integrity | +40 |
| `server/services/policyEnvelopeResolver.ts` | New resolver | +200 |
| `server/services/policyEnvelopeResolverPure.ts` | Pure helpers (extracted for testability) | +80 |
| `server/services/__tests__/policyEnvelopeResolver.test.ts` | Integration tests | +120 |
| `server/services/agentExecutionService.ts` | Wire resolver call at run creation | +15 |

**Total: ~600 LOC.**

#### 4.5.9 Migration strategy

Existing runs have `policy_envelope_snapshot = NULL`. Readers must tolerate NULL (legacy run, snapshot unavailable). Run Trace UI shows "Snapshot unavailable (legacy run)" for these.

No backfill. Backfilling historical runs would require reconstructing constraints from change history, which is unreliable. Forward-only is the correct trade.

#### 4.5.10 Observability

- Event: `foundation.policy_envelope.resolved` with payload `{ runId, schemaVersion, sourceCounts }`.
- Span: `agent.run.policy_envelope.resolved` Langfuse span around the resolver call.
- Latency budget: resolver should complete in under 100ms p95. Above that triggers investigation (likely DB query optimisation or indexing).

#### 4.5.11 Tests

- Pure: type integrity, derivation rules within the snapshot.
- Integration: seed a subaccount-agent with known constraints; create a run; assert snapshot fields match expected values.
- Mid-run mutation: create a run, change a constraint mid-run, assert snapshot is unchanged.
- NULL tolerance: legacy run with NULL snapshot renders correctly in Run Trace UI.

#### 4.5.12 Effort estimate

**3 to 4 dev-days.** Resolver is the bulk: aggregating six constraint sources into one shape requires care to avoid missing a source. The implementation checklist (in the PR) enumerates each source for sign-off. Risk: medium; mitigations are the test seeding and the source manifest in the snapshot.

#### 4.5.13 Dependencies

- Blocks: Run Trace API (Section 4.4) returns the snapshot in its response envelope.
- Blocked by: Section 4.1 (controllerStyle), Section 4.2 (riskTier in actionRegistry), Section 4.3 (credentialBrokerService.resolveAvailableCredentials).

### 4.6 Naming pass and glossary document

#### 4.6.1 Current state

The codebase uses several names that do not match the v1.2 brief vocabulary:

- `Capability-Aware Orchestrator` (file prefix `orchestratorFromTaskJob`) is the brief's "Router and Execution Planner".
- `executionMode` enum is the brief's "Execution Environment".
- `iee_*` schema names refer to the narrow definition (browser plus dev worker); the brief's "IEE Execution Plane" is broader.
- `policyRules` is one component of the brief's "Policy Envelope".
- `actions.gateLevel` is now derived from "Risk Tier" plus policy.

Per INV-13, **no service-wide rename is in scope**. The naming pass is documentation only.

#### 4.6.2 Target state

A single glossary document at `docs/synthetos-nomenclature.md` that locks canonical names per v1.2 brief Section 4.0. Five to ten high-traffic files receive awareness comments. `architecture.md` cross-references the glossary.

#### 4.6.3 Glossary document structure

```markdown
# SynthetOS Nomenclature

This document is the single source of truth for canonical names used across the
SynthetOS architecture. It is the operationalisation of v1.2 brief Section 4.0
(Naming Map).

## Canonical names

For each concept, three values: the v1.2 brief name (canonical), the existing
code name(s), and a meaning.

| v1.2 Brief Name | Existing Code Name | Meaning |
|---|---|---|
| Router and Execution Planner | Capability-Aware Orchestrator (`orchestratorFromTaskJob`) | The dynamic decision engine that performs intent understanding, task decomposition, capability matching, controller selection, environment selection, and dispatch. |
| Execution Environment | `executionMode` enum (`api`, `headless`, `claude-code`, `iee_browser`, `iee_dev`) | The capability surface invoked by a controller. |
| Controller | `controllerStyle` field (new in Phase 1 foundation) | The execution style: deterministic Native or adaptive Operator. |
| IEE Execution Plane | IEE worker (browser plus dev worker today; expanded scope per v1.2) | The execution substrate that manages sessions, workers, environments, queues, isolation, credentials, artifacts, telemetry, and Run Trace event publication. |
| Approval Level | `actions.gateLevel` (`auto`, `review`, `block`) | The approval requirement for an action; derived from Risk Tier plus Policy Envelope. |
| Risk Tier | (new in Phase 1 foundation) | The capability risk classification (0 to 6) per v1.2 brief Section 11. |
| Policy Engine | `policy_rules` plus `policyEngineService` | The runtime enforcement of declared policy rules; one component of the broader Policy Envelope. |
| Policy Envelope | (new in Phase 1 foundation) | The resolved constraint set captured per run; aggregates Policy Engine, budgets, credentials, environments, etc. |
| Run Trace | `agent_execution_events` plus 4 sibling tables (Phase 1 virtual view); `RunTracePage.tsx` UI surface | The governed execution observability layer: ordered, queryable, decision-aware event stream per run. |
| Credential Broker and Identity Boundary | `CredentialBrokerService` facade over `connectionTokenService` plus `integrationConnectionService` | The named primitive for credential issuance, injection, audit, revocation, and tenant isolation. |
| Capability Matching | `list_platform_capabilities`, `check_capability_gap`, `list_connections`, `request_feature` skills | The Router's mechanism for resolving available capabilities at routing time. |
| Agent Capability Map | `subaccountAgents.capabilityMap` (JSONB) | Per-agent snapshot of resolved integrations, read capabilities, write capabilities, skills, primitives. |
| Three-tier Agent Model | `system_agents`, `agents`, `subaccount_agents` | Unchanged; brief and code agree. |
| Agent Hierarchy | Root agent contract + `DelegationScope` enum + delegation graph | Hierarchical delegation primitive. |
| Model Invocation Capability | `llmRouter.routeCall` (single entry point) | The runtime act of calling a model. Statically and runtime-enforced contract. |
| Billing and Usage | `llm_requests` plus `cost_aggregates` | Cost ledger and aggregated usage. |

## When to use which name

- **In specs and architecture documents**: use the v1.2 brief name (canonical).
- **In code identifiers**: keep the existing code name. Service prefixes, file names, table names, and exports stay as they are.
- **In code comments and docstrings**: use the v1.2 brief name when describing a concept; reference the code name when describing a specific implementation.
- **In user-facing UI**: use plain English, not either name. The user does not need to know about Routers, Orchestrators, or Capability Maps. The user sees "When this agent gets a task" and "What this agent can do."

## Why we are not renaming code

Per Phase 1 foundation refactor INV-13, no service-wide rename is in scope. Renaming `orchestratorFromTaskJob` to `routerFromTaskJob` (or similar) is a high-cost, low-value refactor:

- 217+ references across the codebase to the existing name.
- Every rename is a merge-conflict generator for in-flight branches.
- The functional behaviour does not change; only the label changes.
- Reviewers cannot tell at a glance if a rename PR introduced a logic bug.

The glossary plus awareness comments achieve the goal (consistent vocabulary across docs and specs) without the rename cost. A future spec may revisit the rename when a clear refactor benefit emerges (e.g., a substantial restructuring of orchestration code that justifies the rename as part of the larger change).

## Cross-references

- `docs/synthetos-governed-agentic-os-brief-v1.2.md` Section 4.0 (Naming Map source of truth)
- `docs/synthetos-brief-v1.1-to-v1.2-changes.md` Part 1 (terminology mapping for diagram and brief)
- `architecture.md` Section "Orchestrator Capability-Aware Routing" (existing implementation reference)
```

The full glossary document is roughly 200 to 300 lines.

#### 4.6.4 Awareness comments

Five to ten high-traffic files receive a brief comment at the top of file or above the relevant export. Pattern:

```ts
/**
 * Capability-Aware Orchestrator (aka "Router and Execution Planner" per v1.2 brief).
 * See docs/synthetos-nomenclature.md for the full naming map.
 */
export async function processOrchestratorFromTask(payload: OrchestratorFromTaskPayload) {
  // existing implementation
}
```

Files receiving awareness comments:

| File | Comment about |
|---|---|
| `server/jobs/orchestratorFromTaskJob.ts` | Orchestrator = Router and Execution Planner |
| `server/services/agentExecutionService.ts` | executionMode = Execution Environment; controllerStyle = Controller |
| `server/services/policyEngineService.ts` | Policy Engine is one component of Policy Envelope |
| `server/services/credentialBrokerService.ts` | Credential Broker and Identity Boundary primitive |
| `server/services/runTraceService.ts` | Run Trace virtual view; canonical ledger Phase 3+ |
| `worker/src/handlers/browserTask.ts` | IEE narrow scope today; expanded per v1.2 |
| `worker/src/handlers/devTask.ts` | Same |
| `client/src/pages/operate/RunTracePage.tsx` | Run Trace UI; consumes new API contract |
| `architecture.md` Section "Orchestrator Capability-Aware Routing" | Cross-reference glossary at top |
| `architecture.md` Section "IEE Integrated Execution Environment" | Cross-reference glossary at top |

#### 4.6.5 Future spec convention

Every new spec from this point on opens with a paragraph in Section 0 stating:

> Naming follows `docs/synthetos-nomenclature.md`. Where this spec uses a v1.2 brief term that has a different code-level name, the glossary applies.

This is a process convention, not a CI gate. Compliance is a spec-reviewer responsibility.

#### 4.6.6 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `docs/synthetos-nomenclature.md` | New glossary doc | +250 |
| `architecture.md` | Add cross-reference at relevant section headers | +15 |
| `server/jobs/orchestratorFromTaskJob.ts` | Awareness comment | +5 |
| `server/services/agentExecutionService.ts` | Awareness comment | +5 |
| `server/services/policyEngineService.ts` | Awareness comment | +5 |
| `server/services/credentialBrokerService.ts` | Awareness comment | +3 (already in the new file) |
| `server/services/runTraceService.ts` | Awareness comment | +3 (already in the new file) |
| `worker/src/handlers/browserTask.ts` | Awareness comment | +5 |
| `worker/src/handlers/devTask.ts` | Awareness comment | +5 |
| `client/src/pages/operate/RunTracePage.tsx` | Awareness comment | +5 |

**Total: ~300 LOC, mostly in the glossary doc.**

#### 4.6.7 Migration strategy

Documentation-only. No schema, no migrations, no backfill, no rollback.

#### 4.6.8 Observability

None. Documentation does not emit telemetry.

#### 4.6.9 Tests

None. Documentation does not have unit tests. The glossary is reviewed by the architect.

#### 4.6.10 Effort estimate

**1 to 2 dev-days.** Glossary doc roughly 4 hours; awareness comments roughly 1 hour; cross-reference updates in `architecture.md` roughly 1 hour. Risk: low. Documentation-only; no functional risk.

#### 4.6.11 Dependencies

- Depends on: Sections 4.1 to 4.5 to complete so the glossary entries reflect the locked names of new primitives.
- Blocks: future specs that need to use canonical names.

---

## 5. UI Changes

UI changes are scoped to the minimum required to expose the new foundation primitives without overwhelming the user. Per project frontend design rules: default to hidden, one primary action per screen, inline state beats dashboards, plain language not data model, would a non-technical operator complete the task without feeling overwhelmed.

### 5.1 Run Trace UI: one-line headline badge

#### 5.1.1 Current state

`client/src/pages/operate/RunTracePage.tsx` renders a tree-view of tool-call events, runtime check summaries, delegation graph, IEE progress polling, role-aware masking, correction affordance. The page is information-dense and works well for technical operators but does not summarise the run for a non-technical viewer.

#### 5.1.2 Target state

Above the existing tree-view, add a single one-line headline badge that summarises the run in plain English. The headline is the first thing a non-technical operator sees. The full tree-view remains for those who need details.

#### 5.1.3 Headline design

```
Native run · approved by Sarah · 45 seconds · $0.08
```

Variations by run state:

```
Operator run · auto-approved · 2 min 14 sec · $0.42
Native run · awaiting approval · 12 sec · $0.03
Operator run · blocked by policy · 8 sec · $0.01
Native run · failed · 3 sec · $0.00
```

What the headline shows:

- **Controller**: "Native run" or "Operator run" (only shown if Operator; Native is silent if it's the most common case).
- **Approval status**: "auto-approved" / "approved by [name]" / "awaiting approval" / "blocked by policy" / not shown if not applicable.
- **Duration**: human-readable.
- **Cost**: formatted in dollars.

What the headline does NOT show:

- No Risk Tier number (backend detail).
- No Policy Envelope JSON (backend detail).
- No model name (backend detail; available in details panel if needed).
- No execution mode label (`iee_browser` etc; backend detail).

#### 5.1.4 Details panel (deferred to Phase 1.5)

A "Details" link from the headline opens a side-panel with full Policy Envelope, Risk Tier per action, model routing, credential scopes. The link is present but the panel content is Phase 1.5 work. For Phase 1, the link reads "Coming soon."

#### 5.1.5 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `client/src/components/run-trace/RunTraceHeadline.tsx` | New component | +80 |
| `client/src/pages/operate/RunTracePage.tsx` | Render headline above existing tree | +10 |
| `client/src/lib/runTraceFormatters.ts` | Helper formatters (duration, cost, controller label) | +40 |
| `client/src/components/run-trace/__tests__/RunTraceHeadline.test.tsx` | Component tests | +60 |

**Total: ~190 LOC.**

### 5.2 Agent Configuration: four new tabs

#### 5.2.1 Current state

`client/src/pages/admin/SubaccountAgentEditPage.tsx` (or equivalent) has tabs: Skills, Instructions, Budget, Scheduling, Beliefs, Identity, Activity. The page is the admin surface for configuring an agent within a subaccount.

#### 5.2.2 Target state

Add four new tabs that expose the foundation primitives:

1. **Execution** — controllerStyle, allowed environments
2. **Governance** — Risk Tier limits, approval rules
3. **Models and Identity** — default model selection (existing surface, formalised)
4. **Integrations** — connection toggles (existing surface, formalised)

Some existing tabs may be merged or moved (e.g., Scheduling rolls into Execution). The page navigation stays familiar.

#### 5.2.3 Execution tab (new)

```
┌─ Execution ────────────────────────────────────────┐
│                                                     │
│ Allow Operator mode for this agent?    [ ] Yes      │
│   (default: off; Native mode only for predictable   │
│    deterministic workflows)                          │
│                                                     │
│ Allowed environments:                               │
│   [✓] Browser (iee_browser)                         │
│   [✓] API and Tool                                  │
│   [ ] Sandbox (Phase 2)                              │
│   [ ] Terminal and Repo (system agents only)        │
│                                                     │
│ ▸ Advanced scheduling                               │
│   (collapsible: existing scheduling fields)         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The "Advanced scheduling" disclosure preserves the existing scheduling fields without cluttering the primary surface.

#### 5.2.4 Governance tab (new)

```
┌─ Governance ────────────────────────────────────────┐
│                                                     │
│ Risk Tier limit for this agent:    [Tier 3 ▾]       │
│   (highest tier this agent may invoke without       │
│    explicit approval; default: 3)                   │
│                                                     │
│ Require approval for Tier 4+ actions?  [✓] Yes      │
│   (uncheck only if you trust this agent for         │
│    higher-risk operations)                          │
│                                                     │
│ Escalation rules:                                   │
│   (Phase 1.5 — comes after first showcase MVP)      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### 5.2.5 Models and Identity tab (new)

```
┌─ Models and Identity ───────────────────────────────┐
│                                                     │
│ Default model:                  [Claude Sonnet ▾]   │
│   (only models already connected are shown)         │
│                                                     │
│ Use Operator Session Identity?   [grayed out]       │
│   ChatGPT OAuth — Phase 2                            │
│                                                     │
│ Bring-your-own API keys:        [Phase 1.5]          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Most of this is placeholder; the model dropdown is the only live control in Phase 1.

#### 5.2.6 Integrations tab (new)

```
┌─ Integrations ──────────────────────────────────────┐
│                                                     │
│ Slack            [✓] Connected   [Configure]         │
│ Gmail            [✓] Connected   [Configure]         │
│ HubSpot          [ ] Not connected   [Connect]       │
│ GoHighLevel      [ ] Not connected   [Connect]       │
│                                                     │
│ Credentials this agent can use:                     │
│   (managed at Subaccount level)  [Manage]           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The "Credentials this agent can use" disclosure links to the Subaccount-level credential management screen.

#### 5.2.7 Tabs deferred to Phase 1.5+

- Beliefs tab: defer (it's already there but it's a Phase 2 conceptual fit).
- Per-agent cost limits separate from subaccount-level: defer (subaccount-level is enough for Phase 1).
- Escalation rules matrix: Phase 1.5.
- BYO API keys: Phase 1.5.

#### 5.2.8 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `client/src/pages/admin/SubaccountAgentEditPage.tsx` | Add four new tabs; reorganise existing | +/-100 |
| `client/src/components/agent-config/ExecutionTab.tsx` | New tab component | +120 |
| `client/src/components/agent-config/GovernanceTab.tsx` | New tab component | +100 |
| `client/src/components/agent-config/ModelsIdentityTab.tsx` | New tab component | +80 |
| `client/src/components/agent-config/IntegrationsTab.tsx` | New tab component (may reuse existing) | +60 |
| `server/db/schema/subaccountAgents.ts` | Add fields if not present: `controllerStyleAllowed`, `allowedEnvironments`, `maxRiskTier`, `requireApprovalAtTier` | +20 |
| `migrations/NNNN_subaccount_agents_governance.sql` | Migration for new fields | +30 |
| Tests | Component tests for each new tab | +200 |

**Total: ~700 LOC.**

#### 5.2.9 Schema additions

```sql
-- Migration NNNN_subaccount_agents_governance.sql
ALTER TABLE subaccount_agents
  ADD COLUMN controller_style_allowed text NOT NULL DEFAULT 'native_only'
    CHECK (controller_style_allowed IN ('native_only', 'native_and_operator')),
  ADD COLUMN allowed_environments text[] NOT NULL DEFAULT ARRAY['browser', 'api_tool'],
  ADD COLUMN max_risk_tier integer NOT NULL DEFAULT 3
    CHECK (max_risk_tier BETWEEN 0 AND 6),
  ADD COLUMN require_approval_at_tier integer NOT NULL DEFAULT 4
    CHECK (require_approval_at_tier BETWEEN 0 AND 6);
```

### 5.3 Approval UX: risk tier and policy reason context

#### 5.3.1 Current state

`client/src/pages/admin/ReviewQueuePage.tsx` shows review items with action type, reasoning, proposed payload, run timestamp, run trace link. Slack approval cards show similar context plus Approve/Reject buttons.

#### 5.3.2 Target state

Add a two-line context header to each review item showing the Risk Tier and the policy reason for the approval requirement.

#### 5.3.3 Review item card design

```
Action: Send email to client (Tier 6 · requires approval per policy)
Context: Using Gmail support@example.com; customer database read

  [reasoning text]
  [proposed payload preview]

  [View Run Trace]  [Approve]  [Reject]  [Edit and re-submit]
```

#### 5.3.4 Slack approval card

```
[Block: Header]
Tier 6 · Approval required
Send email to client

[Block: Section]
Reasoning: [first 200 chars of agent's reasoning]
Context: Using Gmail support@example.com

[Block: Actions]
[Approve]  [Reject]  [View Run Trace]
```

#### 5.3.5 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `client/src/components/review/ApprovalRiskContext.tsx` | New component | +50 |
| `client/src/pages/admin/ReviewQueuePage.tsx` | Render context header | +15 |
| `server/services/slackConversationService.ts` | Update Block Kit template to include tier + policy | +30 |
| Tests | Component tests | +60 |

**Total: ~155 LOC.**

### 5.4 Credentials: audit log section

#### 5.4.1 Current state

`client/src/components/CredentialsTab.tsx` (existing) shows OAuth provider dropdown, connection status badges, web login modal, Slack channel config modal. No audit trail surface.

#### 5.4.2 Target state

Add an Audit Log section at the bottom of the Credentials tab showing recent credential events (issued, revoked, refreshed). Read-only. Most users do not need this; it's a "Default to hidden" panel that admins can expand.

#### 5.4.3 Audit log design

```
▸ Audit log (last 30 days)
   sarah.smith connected Gmail (support@example.com)            2 hours ago
   ─ Refreshed (auto)                                            1 hour ago
   john.doe revoked HubSpot                                      Yesterday
   sarah.smith connected Slack (#support-internal)               3 days ago
   ─ Refreshed (auto)                                            3 days ago
```

Defaulted-collapsed disclosure. Expanding shows the last 30 days of credential events scoped to the current subaccount.

#### 5.4.4 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `client/src/components/CredentialsAuditLog.tsx` | New component | +80 |
| `client/src/components/CredentialsTab.tsx` | Add audit log section | +20 |
| `server/routes/credentials.ts` | New endpoint `GET /api/subaccounts/:id/credential-audit` | +40 |
| Tests | Component and route tests | +80 |

**Total: ~220 LOC.**

### 5.5 UI changes summary

| Surface | Effort | Priority |
|---|---|---|
| Run Trace headline | Small (~190 LOC) | Must have |
| Agent Config tabs | Medium (~700 LOC plus migration) | Must have |
| Approval UX context | Small (~155 LOC) | Should have |
| Credentials audit log | Small (~220 LOC) | Nice to have |

**Total UI effort: ~1,265 LOC plus one migration. Roughly 5 to 8 dev-days.**

UI work runs in parallel with foundation work in Section 4. Both ship together.

---

## 6. Schema Migrations Summary

### 6.1 Migrations introduced by this spec

| # | File | Purpose | Reversible | Locks table? |
|---|---|---|---|---|
| 1 | `NNNN_agent_runs_controller_style.sql` | Add `controller_style` column with default `'native'`; partial index for operator runs | Yes | Briefly (column add) |
| 2 | `NNNN_agent_runs_policy_envelope.sql` | Add `policy_envelope_snapshot jsonb` column; nullable | Yes | Briefly |
| 3 | `NNNN_subaccount_agents_governance.sql` | Add `controller_style_allowed`, `allowed_environments`, `max_risk_tier`, `require_approval_at_tier` columns | Yes | Briefly |

All migrations have `.down.sql` counterparts in `migrations/_down/`.

### 6.2 No new tables

This spec deliberately introduces zero new tables. All net-new state is captured as columns on existing tables (`agent_runs`, `subaccount_agents`). This minimises schema risk and preserves rollback simplicity.

### 6.3 Migration ordering

The three migrations are independent and can apply in any order. They are:

1. Idempotent on re-apply (no-op if column exists).
2. Reversible (drop column reverses).
3. Non-destructive (no data loss).

### 6.4 Backfill jobs

Two one-time backfill jobs run after migrations land:

| Job | Trigger | Idempotent | Effect |
|---|---|---|---|
| `backfill_controller_style_from_execution_mode` | Manual; run once after migration 1 | Yes | Updates existing `agent_runs` rows with derived `controller_style` based on `execution_mode` |
| (no backfill for `policy_envelope_snapshot`) | NA | NA | Existing rows keep NULL; readers tolerate NULL |
| (no backfill for `subaccount_agents` governance fields) | NA | NA | Existing rows use the column defaults |

### 6.5 Migration risk

- **Column adds on `agent_runs`**: this table is hot. Migrations should run during a low-traffic window. Postgres `ALTER TABLE ADD COLUMN ... DEFAULT ...` is metadata-only on Postgres 11+ and does not rewrite the table; verify the version on the target environment before running.
- **JSONB column add**: nullable, no default; metadata-only.
- **Partial index creation**: small; the partial index on `controller_style = 'operator'` is built fast because the column is fresh.

Risk mitigation: run migrations on staging first, time the apply, monitor lock duration on production.

---

## 7. Test Strategy

### 7.1 Test pyramid

The spec follows the project test pyramid:

- **Pure tests (Vitest)**: derivation functions, type integrity, snapshot shape. Co-located with source as `*.test.ts`. Fast, deterministic, run in CI on every commit.
- **Integration tests (Vitest, scope-tagged)**: schema migrations, end-to-end run with new primitives, multi-table query correctness. Run in CI gate jobs.
- **Component tests (Vitest, jsdom)**: UI component rendering and interaction. Run in CI.
- **End-to-end smoke tests (manual or scripted)**: a real run from creation through completion, asserting all foundation primitives engage correctly. Run before merge.

### 7.2 New test files

| Test file | Coverage |
|---|---|
| `server/services/__tests__/controllerStyleResolverPure.test.ts` | Derivation rule for all `executionMode` values |
| `shared/types/__tests__/riskTier.test.ts` | `deriveGateLevel` for all tier values, with and without override |
| `shared/types/__tests__/policyEnvelope.test.ts` | Snapshot shape integrity |
| `server/services/__tests__/credentialBrokerService.test.ts` | Facade delegation correctness with mocked underlying services |
| `server/services/__tests__/policyEnvelopeResolver.test.ts` | Resolver aggregates all six constraint sources |
| `server/services/__tests__/runTraceService.test.ts` | Multi-table query, pagination, filtering |
| `client/src/components/run-trace/__tests__/RunTraceHeadline.test.tsx` | Headline rendering for all run states |
| `client/src/components/agent-config/__tests__/ExecutionTab.test.tsx` | Tab rendering and state |
| `client/src/components/agent-config/__tests__/GovernanceTab.test.tsx` | Tab rendering and state |
| `client/src/components/review/__tests__/ApprovalRiskContext.test.tsx` | Context header for tier and policy |

### 7.3 Existing test regression

Every existing test must continue to pass without modification. Specifically:

- All `agentExecutionService` tests pass with `controllerStyle` defaulting to `native`.
- All `policyEngineService` tests pass with `riskTier` derivation falling back to existing `gateLevel`.
- All credential connection tests pass with calls migrated to the facade.
- All Run Trace UI tests pass with the new endpoint feature-flagged.

### 7.4 New CI gate

`scripts/verify-risk-tier-assigned.sh` (Section 4.2.7) is added to `scripts/run-all-gates.sh`. The gate fails the build if any action in `actionRegistry.ts` is missing a `riskTier`.

### 7.5 Performance baselines

Baseline metrics captured before merge so regression is detectable:

| Metric | Baseline target | Measurement |
|---|---|---|
| Run start latency | Existing p95 (capture from staging) | New `policy_envelope.resolved` event latency |
| Run Trace endpoint p95 | Under 500ms for runs with up to 5,000 events | Synthetic run with 5,000 events |
| Action gate evaluation latency | Existing p95 (capture from staging) | Existing `policy_engine.decision` event latency |

If any metric regresses by more than 20%, investigate before merge.

### 7.6 Smoke test scenarios

Five scenarios covered in the smoke test before merge:

1. **Native run with auto-approved actions** — assert `controller_style = 'native'`, `policy_envelope_snapshot` populated, all actions Tier 0 to 2 auto-approve, Run Trace headline reads "Native run · auto-approved · ...".
2. **Operator run with review-required action** — assert `controller_style = 'operator'`, action at Tier 4 routes to review queue, reviewer approves, run completes, Run Trace headline reads "Operator run · approved by [reviewer] · ...".
3. **Tier 6 action blocked by default** — assert action without explicit policy override is blocked, run terminates with policy block reason, Run Trace headline reads "blocked by policy".
4. **Credential broker facade** — assert credentials issued via facade, used by IEE worker, audit log entry visible in Credentials tab.
5. **Run Trace endpoint** — query the endpoint for the runs above, assert event ordering and payloads match expectations.

---

## 8. Rollout Plan

### 8.1 Sequencing within Phase 1A to 1D

Per v1.2 brief Section 18.1 and the phasing recommendation in `docs/synthetos-v1.2-codebase-gap-analysis.md`, foundation work runs in four sub-phases over 3 to 4 weeks.

**Phase 1A (Weeks 1 to 2): Independent foundations in parallel**
- Section 4.1 (controllerStyle): 2 to 3 dev-days
- Section 4.2 (Risk Tier sweep): 2 to 4 dev-days
- Section 4.4 (Run Trace API): 3 to 4 dev-days

These three are independent and can run in parallel with three engineers, or sequentially with one engineer.

**Phase 1B (Weeks 2 to 3): Items that depend on Phase 1A**
- Section 4.3 (CredentialBrokerService): 1 to 2 dev-days
- Section 4.5 (Policy Envelope): 3 to 4 dev-days

Section 4.5 depends on Sections 4.1, 4.2, 4.3 to feed the snapshot.

**Phase 1C (Week 3): Documentation pass**
- Section 4.6 (Naming pass): 1 to 2 dev-days

**Phase 1D (Weeks 3 to 4): UI updates for foundation**
- Section 5 (UI changes): 5 to 8 dev-days

Phase 1D can start in parallel with Phase 1B once Phase 1A primitives are stable.

### 8.2 Branch and PR strategy

| Phase | Branch | PRs |
|---|---|---|
| 1A | `claude/synthetos-foundation-1a` | 1 PR per item, parallel |
| 1B | `claude/synthetos-foundation-1b` | 1 PR for Section 4.3, 1 PR for Section 4.5 |
| 1C | `claude/synthetos-foundation-1c` | 1 PR (glossary doc + awareness comments) |
| 1D | `claude/synthetos-foundation-1d` | 4 PRs, one per UI surface |

Each PR goes through spec-conformance, pr-reviewer, and (if local Codex available) dual-reviewer before merge.

### 8.3 Feature flags

| Flag | Default | Cleanup |
|---|---|---|
| `RUN_TRACE_API_V1` | off | On after one week of dogfooding; remove flag after one month |
| `POLICY_ENVELOPE_SNAPSHOT` | on | Always on; flag for emergency disable only |
| (no flags for controllerStyle, Risk Tier, CredentialBroker; backward-compat defaults handle gradual rollout) | NA | NA |

### 8.4 Rollback plan

Each migration has a `.down.sql`. Rollback procedure:

1. Disable feature flag (if applicable).
2. Revert PR(s) for the affected item.
3. Run `.down.sql` migrations in reverse order.
4. Re-deploy previous worker version.

Rollback is item-by-item; the foundation refactor does not need to be rolled back as a unit.

### 8.5 Production verification

After merge to main and deploy:

1. Confirm migrations applied (verify column existence on `agent_runs` and `subaccount_agents`).
2. Run smoke tests (Section 7.6) on production.
3. Monitor `foundation.*` log codes for the first 24 hours.
4. Monitor Run Trace endpoint p95 latency for the first week.
5. Run Risk Tier audit: dump `actionRegistry` tier assignments and review for anomalies.

### 8.6 Lock-in

Foundation refactor is "locked" once:

- All five smoke tests pass on production.
- All performance baselines are within the 20% tolerance.
- Architecture team has signed off the Risk Tier assignment CSV.
- Glossary doc is published and referenced from `architecture.md`.
- The two showcase MVPs (42 Macro and Support Inbox) have begun consuming the foundation primitives.

After lock-in, the foundation surface is stable. Future changes to foundation primitives go through their own specs.

---

## 9. Acceptance Criteria

The foundation refactor is **accepted** when all of the following are true.

### 9.1 Schema and code

- [ ] `agent_runs.controller_style text NOT NULL DEFAULT 'native'` column exists in production.
- [ ] `agent_runs.policy_envelope_snapshot jsonb` column exists in production.
- [ ] `subaccount_agents.controller_style_allowed`, `allowed_environments`, `max_risk_tier`, `require_approval_at_tier` columns exist.
- [ ] All migrations have `.down.sql` counterparts that successfully reverse them on staging.
- [ ] All 110 actions in `actionRegistry.ts` have `riskTier` assigned (CI gate passes).
- [ ] `CredentialBrokerService` exists at `server/services/credentialBrokerService.ts` with the four methods specified in Section 4.3.3.
- [ ] All call sites outside `connectionTokenService` and `integrationConnectionService` use the facade.
- [ ] `GET /api/agent-runs/:runId/trace` endpoint returns the unified event stream per the contract in Section 4.4.3.
- [ ] `policy_envelope_snapshot` is populated on every new run (verify with sample of recent runs).
- [ ] `docs/synthetos-nomenclature.md` exists and is referenced from `architecture.md`.

### 9.2 Tests

- [ ] All new test files exist and pass.
- [ ] Existing test suite passes without modification.
- [ ] CI gates pass: lint, typecheck, build:server, build:client, RLS coverage, idempotency keys, read-paths, no-direct-adapter-calls, canonical-dictionary, integration-reference, test-quality, plus the new `verify-risk-tier-assigned.sh`.
- [ ] All five smoke test scenarios pass on staging.

### 9.3 UI

- [ ] Run Trace UI shows the one-line headline above the existing tree view.
- [ ] Agent Configuration has the four new tabs (Execution, Governance, Models and Identity, Integrations).
- [ ] Approval UX shows risk tier and policy reason context in both the Review Queue and Slack messages.
- [ ] Credentials tab has an Audit Log section (collapsed by default).

### 9.4 Observability

- [ ] All five new log codes (`foundation.controller_style.derived`, `foundation.risk_tier.gate_derived`, `foundation.credential_broker.issued`, `foundation.policy_envelope.resolved`, `foundation.run_trace.queried`) are emitted in expected scenarios.
- [ ] Existing Langfuse spans continue to fire.
- [ ] Run Trace endpoint p95 under 500ms for runs with up to 5,000 events.

### 9.5 Process

- [ ] Architecture team has reviewed and signed off the Risk Tier assignment CSV.
- [ ] All six items have passed spec-conformance, pr-reviewer, and (where applicable) dual-reviewer.
- [ ] Glossary doc cross-referenced in `architecture.md`.
- [ ] `tasks/current-focus.md` updated to MERGE_READY.

---

## 10. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Risk Tier misclassification changes existing approval behaviour silently | Medium | Medium | INV-8 mandates that existing `gateLevel` is preserved unless explicit policy override; architect review of CSV before merge; smoke test 1 verifies auto-approve flow |
| Policy Envelope resolver misses a constraint source | Medium | Medium | Source manifest in snapshot makes omissions discoverable; integration test with seeded constraints; resolver checklist in PR description |
| Run Trace endpoint performance regression at scale | Medium | High | Performance baseline captured pre-merge; alerting threshold p95 over 500ms; partial indexes available as escape hatch; canonical ledger consolidation already roadmapped (Phase 3+) |
| controllerStyle backfill misclassifies historical runs | Low | Low | Historical accuracy is low-value; Native default is the conservative choice; backfill is idempotent and re-runnable |
| CredentialBrokerService facade has subtle delegation bugs | Low | High | Underlying services unchanged; facade is structural; integration tests verify delegation correctness; existing connection tests cover regression |
| New JSONB column on `agent_runs` causes table bloat | Low | Medium | Snapshot is roughly 2-5KB per run; at 10K runs/day, roughly 50MB/day; existing retention policy applies; monitor over first month |
| Migration locks `agent_runs` table during business hours | Low | High | Postgres 11+ ADD COLUMN with DEFAULT is metadata-only; verify Postgres version on target environment before running; staging dry-run |
| Glossary drift over time as code evolves | Medium | Low | Glossary is source of truth; future specs reference it; awareness comments anchor key files; periodic review (quarterly) |
| Foundation work overruns 4 weeks | Medium | Medium | Phased plan (1A to 1D) with explicit dependencies; each item has a specific dev-day estimate; can de-scope Phase 1D UI items if needed (defer to Phase 1.5) |
| Spec-reviewer surfaces fundamental design issue mid-build | Low | High | Spec goes through spec-reviewer loop before any implementation begins; this is the safety net |
| UI changes overwhelm non-technical operators | Medium | Medium | Frontend design rules applied (default to hidden, plain language); Run Trace headline keeps complexity behind progressive disclosure; Phase 1.5 details panel deferred |
| Coordination gap with Spec B (Support Desk Canonical) on Risk Tier conventions | Medium | Low | Section 4.2 establishes the rubric; Spec B references it; one architect owns consistency |
| Operator loop limits (`maxLoopIterations: 100`) too high or too low for real workloads | Medium | Medium | Configurable per agent via `subaccount_agents` (existing `maxToolCallsPerRun` extended); monitor in production; tunable post-merge |

---

## 11. Open Decisions

These are decisions that need to be made before this spec is locked. Each is small enough that the spec-reviewer or architect can resolve them; they do not need a separate spec.

### 11.1 Operator default loop iteration limit

**Decision needed**: should `CONTROLLER_LIMITS.operator.maxLoopIterations` default to 100, or some other value?

**Discussion**: 100 is 4x the Native default of 25. This roughly matches the difference between "a structured workflow with well-defined steps" (Native) and "an investigative loop that explores and corrects" (Operator). Higher values (200+) risk runaway loops; lower values (50) might prematurely terminate legitimate Operator work.

**Recommendation**: 100 as default. Configurable per agent via existing `maxToolCallsPerRun` field. Monitor in production after Spec C (Support Agent MVP) ships.

**Owner**: Architect.

### 11.2 Risk Tier 0 to 2 default to `auto`

**Decision needed**: is the default mapping (Tier 0-2 → auto, Tier 3-5 → review, Tier 6 → block) the right floor for **every** subaccount, or should it be configurable per subaccount?

**Discussion**: A high-trust subaccount might want Tier 3 actions to default to `auto`. A high-stakes subaccount might want Tier 2 to default to `review`. The existing `subaccountAgents.requireApprovalAtTier` field (Section 5.2.9) handles this per-agent; do we need per-subaccount?

**Recommendation**: Per-agent is sufficient for Phase 1. Per-subaccount default can be added in Phase 1.5 if customer demand surfaces.

**Owner**: Product + Architect.

### 11.3 Run Trace pagination default size

**Decision needed**: default `limit` for `GET /api/agent-runs/:runId/trace` queries.

**Discussion**: 50 is a reasonable scrollable page. 100 risks showing too much at once for non-technical operators. The UI mostly consumes this for the tree view, which can paginate.

**Recommendation**: default 50, max 200.

**Owner**: Architect.

### 11.4 Policy Envelope snapshot location: column vs separate table

**Decision needed**: store as JSONB column on `agent_runs`, or as a separate `policy_envelope_snapshots` table keyed by `agent_run_id`?

**Discussion**: Column is simpler (single read with the run row), but increases `agent_runs` row size. Separate table is more flexible (could share snapshots across related runs in the future) but adds a join.

**Recommendation**: JSONB column. Single-read semantic is the right trade for Phase 1; row size impact is bounded (2-5KB per run). Future migration to a separate table is straightforward if scale forces it.

**Owner**: Architect.

### 11.5 Should the Risk Tier CSV ship with this spec, or as a separate artefact?

**Decision needed**: where does the per-action Risk Tier assignment live?

**Discussion**: Including in this spec makes it part of the architectural baseline. Storing as a separate CSV (`tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv`) keeps the spec focused on the architecture.

**Recommendation**: separate CSV, per Section 4.2.6. Linked from this spec.

**Owner**: Architect.

### 11.6 Do we ship the "Phase 2" placeholder rows in the Models and Identity tab, or hide them entirely?

**Decision needed**: UI surface for Operator Session Identity (ChatGPT OAuth) and BYO API keys in Phase 1.

**Discussion**: Showing "Phase 2" placeholders signals roadmap to admins but adds clutter. Hiding entirely keeps the UI clean but operators may not know these are coming.

**Recommendation**: ship with placeholders, grayed out, label "Phase 2 — coming soon." Operators benefit from visibility; the visual treatment makes clear they are not active.

**Owner**: Product + Design.

### 11.7 Does the foundation refactor need its own dedicated `feature-coordinator` run, or can each item ship via the standard Significant-task pipeline?

**Decision needed**: invocation pattern for the build.

**Discussion**: The spec is large but each item is medium complexity. `feature-coordinator` orchestrates a chunked build with builder sub-agents; it is heavier than necessary for individual items but lighter than running each item as a separate Major task.

**Recommendation**: single `feature-coordinator` run on this spec, with the chunked plan covering all six items in dependency order. Each item is a chunk; the coordinator handles the per-chunk gates.

**Owner**: Operator.

---

## End of spec

This spec is a draft. Lifecycle:

1. Operator review for completeness.
2. spec-reviewer (Codex) loop for technical adjudication.
3. chatgpt-spec-review for external pressure-test.
4. Lock; transition to Phase 2 (build).
5. `feature-coordinator` consumes the locked spec and produces an implementation plan.
6. Builder sub-agents execute the plan chunk-by-chunk.
7. Branch-level review pass: spec-conformance, pr-reviewer, dual-reviewer (if Codex available), adversarial-reviewer (if security surface touched).
8. `finalisation-coordinator` runs the merge-ready pipeline.

Acceptance criteria in Section 9 must be true at merge.
