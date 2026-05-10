**Status:** draft
**Spec date:** 2026-05-10
**Last updated:** 2026-05-10
**Author:** main session (operator-driven)
**Build slug:** execution-backend-adapter-contract

# ExecutionBackend Adapter Contract — Implementation Spec

## Contents

- [0. Framing](#0-framing)
- [1. Problem statement](#1-problem-statement)
- [2. Goals and non-goals](#2-goals-and-non-goals)
- [3. Existing primitives reused](#3-existing-primitives-reused)
- [4. Contracts](#4-contracts)
  - [4.1 `ExecutionBackend` interface](#41-executionbackend-interface)
  - [4.2 `BackendOptions` discriminated union](#42-backendoptions-discriminated-union)
  - [4.3 Source-of-truth precedence](#43-source-of-truth-precedence)
  - [4.4 New columns](#44-new-columns)
  - [4.5 Worked example — IEE adapter shape](#45-worked-example--iee-adapter-shape)
- [5. State model (unchanged)](#5-state-model-unchanged)
- [6. Execution model](#6-execution-model)
- [7. Refactor mapping — existing modes → adapters](#7-refactor-mapping--existing-modes--adapters)
- [8. Adapter registry](#8-adapter-registry)
- [9. Generalised finalisation and reconciliation](#9-generalised-finalisation-and-reconciliation)
- [10. Optional-now metadata (build, do not act on)](#10-optional-now-metadata-build-do-not-act-on)
- [11. Components affected](#11-components-affected)
- [12. Permissions / RLS](#12-permissions--rls)
- [13. Execution-safety contracts](#13-execution-safety-contracts)
- [14. Phase plan](#14-phase-plan)
- [15. Testing posture](#15-testing-posture)
- [16. Acceptance criteria](#16-acceptance-criteria)
- [17. Risks](#17-risks)
- [18. File inventory](#18-file-inventory)
- [19. Deferred Items](#19-deferred-items)
- [20. Out of scope](#20-out-of-scope)

---

## 0. Framing

This spec generalises the proven IEE delegation lifecycle pattern (PR #279, `docs/iee-delegation-lifecycle-spec.md`) into a single named contract that every per-run execution backend implements — including the four already in production today.

It is **Spec A** of the bundle locked in `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` Decision 2. Sandbox isolation (Decision 1, e2b vendor adapter) and Operator Session Identity (Decision 3, ChatGPT OAuth posture) are separate specs that plug into this contract. Locking this contract first removes the dispatch coupling that would otherwise force B and C to reproduce the IEE pattern each time.

Authoritative parents:
- `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` § 3 (Decision 2)
- `docs/iee-delegation-lifecycle-spec.md` (the pattern being generalised)
- `docs/openclaw-strategic-analysis.md` (Phase 1 of OpenClaw Strategic Analysis)
- `docs/synthetos-governed-agentic-os-brief-v1.2.md` § 18.3 (Phase 3 prerequisite)

Behaviour change: **none for V1**. This is a structural refactor that turns a hardcoded `if/else` switch on `executionMode` into a registry-resolved adapter call. Every existing run continues to take the same physical path through the same code. The contract becomes the new extension seam for OpenClaw, Operator Session Identity, and any future internal backend.

---

## 1. Problem statement

Per-run dispatch in `server/services/agentExecutionService.ts` (lines 1408–1521) is a hardcoded `if/else if/else` ladder on `request.executionMode`. Today there are three physical branches:

1. `iee_browser` / `iee_dev` — delegated execution via the IEE worker. Parent agent run parks in `delegated`, terminal event fires from worker, finalisation reconciles parent. Pattern proven in PR #279.
2. `claude-code` — in-process subprocess invocation of the Claude Code CLI runner. Synchronous wait for terminal exit.
3. `api` / `headless` — in-process agentic loop via `runAgenticLoop`. Default path. Both modes share the same dispatch branch; `headless` is a configuration variant of the loop, not a separate runtime.

Three near-term backends will land on this dispatch site:

- **Sandbox-backed code execution** (Spec B) — every Tier 4 task that runs LLM-derived code. Sandbox is a primitive *consumed by* an adapter, not an adapter itself. The current `iee_dev` adapter will internally consume the Sandbox primitive once Spec B lands; OpenClaw will consume the same primitive.
- **OpenClaw Operator Controller** (Phase 3) — `openclaw_managed` initially, `openclaw_external` later. Long-running autonomous backend. Reuses the IEE delegation lifecycle exactly.
- **ChatGPT OAuth Operator Session Identity** (Spec C) — not a backend itself, but a credential type consumed by the OpenClaw adapter (and any other backend that supports session-based model identities).

Adding each as another `if` branch reproduces the synthetic-completion failure pattern from PR #279 once per backend, multiplies the cross-branch interaction test surface, and entangles backend-specific quirks with shared dispatch code.

The fix is the abstraction the brief Decision 2 specifies: every per-run execution backend implements one named contract; dispatch becomes a registry lookup; the IEE delegation lifecycle (delegated → pg-boss event → finalise → reconcile) becomes the lifecycle that every delegated backend reuses by name.

---

## 2. Goals and non-goals

### Goals (V1)

1. Replace the dispatch ladder in `agentExecutionService.ts` with a registry-resolved `ExecutionBackend.dispatch()` call.
2. Refactor the four existing dispatch branches (`api`, `headless` shared, `claude-code`, `iee_browser`, `iee_dev`) into adapter implementations that satisfy the contract. **No behaviour change.**
3. Generalise `finaliseAgentRunFromIeeRun` → `finaliseAgentRunFromBackend` so any delegated backend can finalise via one shared code path.
4. Generalise the existing `maintenance:iee-main-app-reconciliation` cron into a backend-iterating reconciliation that walks every registered adapter declaring a delegated lifecycle.
5. Declare `capabilities`, `costModel`, and `sandboxRequirements` metadata on every adapter so downstream specs (Sandbox, Operator Session Identity, future routing) consume metadata rather than introspecting `executionMode` strings.
6. Add a per-organisation backend preference field (`organisations.preferredBackends`) so customer-pinning is possible *without* a router. Used by adapter resolution as a tie-break when an organisation is configured to a specific backend variant.
7. Forward-compat the contract for `auth_type: 'operator_session'` (Spec C) and `sandboxRequirements: ['code_execution']` (Spec B) without naming either explicitly in V1 dispatch logic.

### Non-goals (V1)

- **Routing policy / cost-aware dispatch.** Phase 3.5+. V1 has one adapter per `executionMode` value; no choice is made at dispatch time. (See § 19 Deferred Items.)
- **Health-check / fallback chain.** Same. The contract reserves an optional `healthCheck()` slot that is not called by any V1 code path.
- **Streaming / progress events as a first-class capability.** The IEE polling endpoint (`GET /api/iee/runs/:ieeRunId/progress`) stays as the visibility primitive in V1. The contract reserves an optional `onProgress` slot that V1 implementations leave undefined.
- **Migration of historical `agent_runs` rows.** No backfill. Any in-flight delegation at deploy time continues to work via the unchanged delegation lifecycle.
- **OpenClaw adapter implementation.** Phase 3 spec, depends on this contract being locked.
- **Sandbox vendor selection or `SandboxExecutionService` interface.** Spec B.
- **Credential Broker `auth_type: 'operator_session'` schema.** Spec C.

### Hard constraints (locked at brief level)

These are restated from `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` § 3.6 so the implementation has them inline:

1. The existing five `executionMode` values become participating implementations of the new contract. Behaviour does not change.
2. The contract names a generalisation of `finaliseAgentRunFromIeeRun` (call it `finaliseAgentRunFromBackend`) that the existing IEE handler delegates to.
3. The existing 2-minute cron `maintenance:iee-main-app-reconciliation` becomes a backend-iterating cron `maintenance:backend-reconciliation` that calls each registered adapter's reconciliation entry point.
4. The contract is forward-compatible with `auth_type: 'operator_session'` without naming it explicitly.

---

## 3. Existing primitives reused

Per `docs/spec-authoring-checklist.md` § 1, every new primitive proposed below first checks for existing reuse:

| Concept | Existing primitive | Reuse / extend / new |
|---|---|---|
| Per-run dispatch | `server/services/agentExecutionService.ts` lines 1408–1521 | **Refactor.** The if/else ladder becomes `registry.resolve(executionMode).dispatch(input)`. No new dispatch service. |
| Delegation lifecycle | IEE pattern: parked `delegated` → pg-boss `iee-run-completed` → `finaliseAgentRunFromIeeRun` → `reconcileStuckDelegatedRuns` cron | **Generalise.** Pattern stays; names become backend-agnostic. The IEE adapter is the first implementation. |
| Terminal finalisation | `finaliseAgentRunFromIeeRun` in `server/services/agentRunFinalizationService.ts:162` | **Rename + generalise.** Becomes `finaliseAgentRunFromBackend`. The existing IEE-specific logic moves into the IEE adapter's `finalise()` method, which the shared finaliser invokes. |
| Reconciliation cron | `maintenance:iee-main-app-reconciliation` registered in `server/services/queueService.ts:1160` (every 2 min) | **Rename + generalise.** Cron becomes `maintenance:backend-reconciliation`; iterates over registered adapters that declare a delegated lifecycle. |
| Pg-boss event handler | `server/jobs/ieeRunCompletedHandler.ts` consumes `iee-run-completed` | **Keep the queue, generalise the entry point.** The handler remains for the IEE adapter; new adapters declare their own queue name. The shared finaliser is the common consumer. |
| Status enum | `agent_runs.status` includes `'delegated'` and `'cancelling'` (PR #279) | **Reuse.** No new statuses. |
| Denormalised reference | `agent_runs.ieeRunId` (uuid, nullable; migration 0176) | **Generalise via second column.** Add `agent_runs.backendTaskId text` (nullable) and `agent_runs.backendId text` (nullable). The existing `ieeRunId` column stays as the IEE adapter's persistence (kept for index continuity); new adapters use the generic columns. |
| Capability declaration | None — capabilities are inferred from `executionMode` strings today | **New.** Adapter exposes `readonly capabilities: ExecutionCapability[]`. Defined in §4. |
| Cost-model declaration | None — `agent_runs` cost columns + `iee_runs` cost columns are read site-by-site | **New.** Adapter exposes `readonly costModel: CostModel`. Defined in §4. Consumed by the cost ledger in Spec C and by future routing. |
| Per-org backend preference | None | **New column.** `organisations.preferred_backends jsonb` with default `{}`. Consulted by adapter resolution; absence means "use the default for this `executionMode`". Defined in §4. |

The `executionMode` column itself is **not** removed. It remains the persisted adapter selector — the contract is layered on top, not a replacement for the field. Long-term the column may be renamed to `backend_id`, but that rename is explicitly deferred (§19).

---

## 4. Contracts

### 4.1 `ExecutionBackend` interface

The contract every adapter implements. New file: `server/services/executionBackends/types.ts`.

```ts
import type { ZodSchema } from 'zod';
import type { IeeRun } from '../../db/schema/ieeRuns.js';
import type { AgentRun } from '../../db/schema/agentRuns.js';

/**
 * Capability declarations describe what an adapter supports beyond bare dispatch.
 * Routing, observability, and downstream specs read these tags rather than
 * introspecting the adapter's id. Closed set — adding a value is a spec amendment.
 */
export type ExecutionCapability =
  | 'in_process'          // Adapter executes synchronously in the main app process.
  | 'delegated'           // Adapter dispatches to a backend; parent parks in 'delegated'.
  | 'subprocess'          // Adapter spawns a local subprocess and waits for exit.
  | 'streaming'           // Adapter can emit mid-run progress events. Optional in V1.
  | 'cancellation'        // Adapter implements cancel(); cancellation is best-effort otherwise.
  | 'long_running'        // Adapter routinely runs > 5 minutes per task.
  | 'code_execution'      // Adapter executes LLM-derived code (Tier 4). Sandbox required.
  | 'browser_automation'  // Adapter drives a Playwright session (Tier 3).
  | 'terminal_repo'       // Adapter has filesystem + git access (Tier 5).
  | 'session_identity';   // Adapter consumes a session-based model identity (Spec C).

/**
 * How the adapter's execution maps to the cost ledger. Consumed by Spec C cost
 * surfaces; declared now so the schema does not need a backfill later.
 */
export type CostModel =
  | 'per_token'           // Native API; cost = sum(llm_requests cost).
  | 'subscription'        // Operator Session Identity; cost is prepaid out-of-band.
  | 'per_worker_second'   // Hosted sandbox; cost = vCPU-seconds.
  | 'per_session_hour'    // Long-running operator session; cost = wall-clock × rate.
  | 'mixed';              // Multiple components; the adapter writes its own ledger row.

/**
 * What environment primitive the adapter requires at runtime. Validated at
 * boot by the registry so missing dependencies surface as a startup failure
 * rather than a per-run crash. Consumed by Spec B (Sandbox).
 */
export type SandboxRequirement =
  | 'none'
  | 'code_execution'
  | 'browser'
  | 'terminal_repo';

export interface BackendDispatchInput {
  /** Parent agent_run row id. Always set. */
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  /** Resolved system prompt, tools, budget — the same shape today's runAgenticLoop receives. */
  promptAssembly: PromptAssembly;
  tokenBudget: TokenBudget;
  maxToolCalls: number;
  timeoutMs: number;
  /** Backend-specific options (e.g. ieeTask for IEE; future: sandboxOptions). Discriminated union per adapter. */
  backendOptions: BackendOptions;
}

export interface BackendDispatchResult {
  /** Lifecycle classification. Drives whether finalisation is inline or via the delegated path. */
  lifecycle: 'in_process' | 'delegated' | 'subprocess';
  /**
   * For delegated backends: the backend-side task identifier (e.g. ieeRunId).
   * Persisted on agent_runs.backendTaskId. Null for in-process and subprocess
   * adapters that finalise synchronously.
   */
  backendTaskId: string | null;
  /**
   * For in-process / subprocess adapters: the loop result that the existing
   * post-completion finalisation block consumes. Null for delegated backends —
   * finalisation happens later via the event handler.
   */
  loopResult: LoopResult | null;
  /** True when an idempotent enqueue collapsed onto a pre-existing in-flight task. */
  deduplicated: boolean;
}

export interface BackendFinalisationInput {
  /** The backend's terminal-state row, however the adapter persists it. */
  terminalState: BackendTerminalState;
  /** Re-loaded from DB at finaliser entry; not trusted from event payload. */
  parentRun: AgentRun;
}

export interface BackendFinalisationResult {
  finalised: boolean;
  /** Mapped agent_runs.status. Idempotent — caller may have already written this. */
  parentTerminalStatus: AgentRunTerminalStatus;
}

export interface ExecutionBackend {
  // === Identity ===
  readonly id: ExecutionMode;
  readonly capabilities: readonly ExecutionCapability[];
  readonly costModel: CostModel;
  readonly sandboxRequirement: SandboxRequirement;

  // === Dispatch (mandatory) ===
  /**
   * Dispatch a run to this backend. Returns immediately. For delegated
   * lifecycles the parent agent_run is transitioned to 'delegated' inside
   * dispatch; finalisation happens via the event handler later.
   */
  dispatch(input: BackendDispatchInput): Promise<BackendDispatchResult>;

  // === Delegated lifecycle (mandatory iff capabilities includes 'delegated') ===

  /**
   * Pg-boss queue name on which this adapter expects its terminal event.
   * Null for non-delegated adapters.
   */
  readonly completedEventQueue: string | null;
  /** Zod schema for the terminal event payload. Used by the handler to validate. */
  readonly completedEventPayload: ZodSchema | null;
  /**
   * Map a backend-side terminal state to the agent_runs terminal status.
   * Called by finaliseAgentRunFromBackend. Pure — must not touch DB.
   */
  finalise?(input: BackendFinalisationInput): Promise<BackendFinalisationResult>;
  /**
   * Reconciliation entry point. Returns count transitioned. Called once per
   * cron tick (every 2 minutes). Must be idempotent and finite (LIMIT 100).
   */
  reconcile?(): Promise<number>;

  // === Optional — Phase 3+ ===

  /** Cancellation. Best-effort; no-op for adapters without native cancel. */
  cancel?(input: { runId: string; backendTaskId: string | null }): Promise<void>;
  /** Health probe. Reserved for future routing. Not called in V1. */
  healthCheck?(): Promise<{ healthy: boolean; details?: string }>;
  /** Mid-run progress subscription. Reserved for streaming. Not called in V1. */
  onProgress?(handler: (event: BackendProgressEvent) => void): UnsubscribeFn;
}
```

#### Why a single `ExecutionBackend` interface (not per-lifecycle interfaces)

Three lifecycles (in-process, subprocess, delegated) could be three interfaces with a discriminated union. We chose one interface with optional fields gated by `capabilities` because:

- The registry resolves by `executionMode`, not by lifecycle. A union forces the registry consumer to narrow before calling — verbose at every call site.
- Future capabilities (streaming, cancellation, session identity) are orthogonal to lifecycle. A union balloons the interface count.
- Optional methods documented as "mandatory iff capabilities includes X" is the existing convention in this codebase (e.g., `tools[].invoke` is optional for declarative tools).

Capability gating is enforced at registry-build time (§ 8.2): a backend declaring `'delegated'` without `completedEventQueue` + `finalise` + `reconcile` fails registration with a typed error.

### 4.2 `BackendOptions` discriminated union

Each adapter's `backendOptions` is a typed slot in a closed union. Closed-set so that adding a backend forces a TypeScript-level update at every dispatch caller. New file: `server/services/executionBackends/options.ts`.

```ts
export type BackendOptions =
  | { backendId: 'api'; runSource: 'manual' | 'scheduled' | 'handoff' | 'sub_agent'; allowedToolSlugs?: string[]; }
  | { backendId: 'headless'; runSource: 'manual' | 'scheduled' | 'handoff' | 'sub_agent'; allowedToolSlugs?: string[]; }
  | { backendId: 'claude-code'; cwd?: string; }
  | { backendId: 'iee_browser'; ieeTask: IeeBrowserTaskInput; }
  | { backendId: 'iee_dev';     ieeTask: IeeDevTaskInput; };
```

Future adapters extend the union; the contract has no implicit "any" path.

### 4.3 Source-of-truth precedence

For a delegated backend, the same logical fact (terminal state) lives in three places: the backend's terminal-state row (e.g., `iee_runs`), the parent `agent_runs` row, and any pg-boss event payload. Per `docs/spec-authoring-checklist.md` § 3, the precedence is declared explicitly:

1. **Backend's terminal-state row (canonical source).** The IEE adapter's source-of-truth row is `iee_runs`. Future adapters declare their own (e.g., `openclaw_runs` for OpenClaw). Always re-loaded at finaliser entry.
2. **Parent `agent_runs` row (derived).** Status, cost rollup, summary derived from #1 by `finaliseAgentRunFromBackend`. Treated as cached projection.
3. **Pg-boss event payload (hint only).** Used for routing the event to the correct adapter; never trusted as data. Contains only `{ backendId, backendTaskId }` plus the queue's required envelope.

The handler always re-loads the canonical row before calling the finaliser. Existing IEE handler already does this (`server/jobs/ieeRunCompletedHandler.ts:78–86`); the pattern continues.

### 4.4 New columns

`agent_runs` (existing table; one migration adds two columns):

| Column | Type | Notes |
|---|---|---|
| `backend_id` | `text NULL` | Generic adapter identifier. Equals `executionMode` value at write time today. Future adapters with internal variants can diverge. Indexed via partial index `(backend_id) WHERE backend_id IS NOT NULL`. |
| `backend_task_id` | `text NULL` | Generic delegated-task reference. Equals `iee_run_id::text` for IEE rows; null for in-process / subprocess. Partial index `(backend_id, backend_task_id) WHERE backend_task_id IS NOT NULL`. |

The existing `agent_runs.iee_run_id` (uuid) stays for index continuity. The IEE adapter writes both columns during V1 (denormalised); a future cleanup may drop `iee_run_id` once all queries route through `backend_task_id`. That cleanup is **§19 deferred**.

`organisations` (existing table; one migration adds one column):

| Column | Type | Notes |
|---|---|---|
| `preferred_backends` | `jsonb NOT NULL DEFAULT '{}'` | Map of `{ executionMode: backendId }` overrides. V1 uses identity mapping (each `executionMode` resolves to one adapter), so the column is unused at dispatch time but present at the schema level. Adapter resolution function reads it; future adapters with internal variants (e.g., `openclaw_managed` vs `openclaw_external`) gain a routing seam without further migrations. |

Both migrations are additive, nullable / defaulted, and reversible. No data backfill.

### 4.5 Worked example — IEE adapter shape

Concrete instance (illustrative; field bodies move into the implementation):

```ts
export const ieeBrowserBackend: ExecutionBackend = {
  id: 'iee_browser',
  capabilities: ['delegated', 'browser_automation', 'cancellation'],
  costModel: 'per_token',
  sandboxRequirement: 'browser',
  completedEventQueue: 'iee-run-completed',
  completedEventPayload: ieeRunCompletedPayloadSchema, // existing zod
  async dispatch(input) {
    // Body = current lines 1413–1473 of agentExecutionService.ts, lifted unchanged.
    // Returns { lifecycle: 'delegated', backendTaskId: enqueueResult.ieeRunId, loopResult: null, deduplicated }.
  },
  async finalise(input) {
    // Body = current finaliseAgentRunFromIeeRun, with the row-loading + tx envelope
    // moved into the shared finaliseAgentRunFromBackend caller.
  },
  async reconcile() {
    // Body = current reconcileStuckDelegatedRuns filtered to ieeRuns; identical SQL.
  },
  async cancel({ runId, backendTaskId }) {
    // Body = existing cancelIeeRun call.
  },
};
```

The `iee_dev`, `claude-code`, `api`, and `headless` adapters follow the same pattern with empty / no-op `finalise`/`reconcile` for non-delegated lifecycles.

---

## 5. State model (unchanged)

`agent_runs.status` is unchanged. The values introduced by PR #279 (`delegated`, `cancelling`) cover every lifecycle this spec touches.

The mapping table from `docs/iee-delegation-lifecycle-spec.md` Appendix A continues to govern delegated-backend terminal mapping. The mapping function moves from a private helper inside `agentRunFinalizationService.ts` into a per-adapter `finalise()` method, but the actual cell-by-cell mapping is identical for the IEE adapter.

Future adapters (OpenClaw, future internal backend) define their own mapping in their `finalise()` method. The mapping is closed per adapter — adding a new `iee_runs.failureReason` value still requires a TS-union extension and a corresponding mapping cell, exactly as today.

---

## 6. Execution model

Per `docs/spec-authoring-checklist.md` § 5, the execution model is declared explicitly:

| Adapter lifecycle | Execution model | Notes |
|---|---|---|
| In-process (`api`, `headless`) | **Inline / synchronous** | Caller blocks on `runAgenticLoop`. Loop result returned by `dispatch()` and consumed by the existing post-completion finalisation block. No queue row. |
| Subprocess (`claude-code`) | **Inline / synchronous** | Caller blocks on `claudeCodeRunner.execute()`. Otherwise identical to in-process. |
| Delegated (`iee_browser`, `iee_dev`, future OpenClaw) | **Queued / asynchronous (pg-boss)** | `dispatch()` returns immediately with `lifecycle: 'delegated'`. Parent agent_run parks in `'delegated'`. Backend's terminal event triggers the shared finaliser. |

This matches today's behaviour precisely. The dispatch ladder is replaced with a registry call; the lifecycle classifications are existing, not new.

The reconciliation cron (`maintenance:backend-reconciliation`) is **queued / scheduled**; it runs every 2 minutes via `boss.schedule()`. Same cadence as today's `maintenance:iee-main-app-reconciliation`.

---

## 7. Refactor mapping — existing modes → adapters

Each existing dispatch branch becomes one adapter. **No behaviour change.**

| `executionMode` | Adapter file | `capabilities` | `costModel` | `sandboxRequirement` | Lifecycle | Source today |
|---|---|---|---|---|---|---|
| `api` | `server/services/executionBackends/apiBackend.ts` | `['in_process']` | `'per_token'` | `'none'` | in_process | `agentExecutionService.ts:1522–1632` (default branch) |
| `headless` | `server/services/executionBackends/headlessBackend.ts` | `['in_process']` | `'per_token'` | `'none'` | in_process | Same default branch — `headless` is a config variant of `api` today; the two adapters share their dispatch implementation via an internal helper, but register as distinct ids |
| `claude-code` | `server/services/executionBackends/claudeCodeBackend.ts` | `['subprocess', 'terminal_repo']` | `'subscription'` | `'terminal_repo'` | subprocess | `agentExecutionService.ts:1474–1521` |
| `iee_browser` | `server/services/executionBackends/ieeBrowserBackend.ts` | `['delegated', 'browser_automation', 'cancellation']` | `'per_token'` | `'browser'` | delegated | `agentExecutionService.ts:1413–1473` (browser branch of IEE) + `finaliseAgentRunFromIeeRun` |
| `iee_dev` | `server/services/executionBackends/ieeDevBackend.ts` | `['delegated', 'code_execution', 'cancellation']` | `'per_token'` | `'code_execution'` | delegated | Same IEE branch (dev variant) + same finaliser. Sandbox requirement upgrades from collapsed-with-worker to `'code_execution'` once Spec B lands; today the requirement is declared but not enforced. |

#### `api` and `headless` shared body — note

The two existing modes share the same physical dispatch path today. The refactor keeps them distinct adapter ids (so `executionMode = 'headless'` resolves correctly) but factors the shared body into an internal helper consumed by both adapter files. This is the only case in V1 where two adapters share code; future adapters get their own files.

#### Migration order (within Phase 2, see § 14)

1. Author the contract types + registry (no consumer yet).
2. Land contract tests against an in-memory mock adapter to lock the contract semantics independently of any real adapter.
3. Refactor the IEE adapter first (proven path — the existing finaliser + cron + handler are already on the contract's shape).
4. Refactor `claude-code` and `api`/`headless` adapters together (one PR — they touch the same file).
5. Switch `agentExecutionService.ts` dispatch from `if/else` to registry call. This is the single cutover commit.

Step 2 (contract tests first) is a hard ordering requirement, not a preference — see § 17 risk #1.

---

## 8. Adapter registry

### 8.1 Shape

New file: `server/services/executionBackends/registry.ts`.

```ts
class ExecutionBackendRegistry {
  private readonly backends = new Map<ExecutionMode, ExecutionBackend>();

  register(backend: ExecutionBackend): void;
  resolve(mode: ExecutionMode, organisationId: string): ExecutionBackend;
  forEach(callback: (backend: ExecutionBackend) => void): void;
  forDelegated(): ExecutionBackend[]; // backends declaring 'delegated' capability
}

export const executionBackendRegistry = new ExecutionBackendRegistry();
```

`resolve()` takes `organisationId` so future internal-variant routing (e.g., `openclaw_managed` vs `openclaw_external`) can read `organisations.preferred_backends`. V1 uses identity mapping; the parameter is plumbed through but the lookup is `this.backends.get(mode)` plus the preferred-backends override.

### 8.2 Boot-time validation

The registry validates each adapter at registration:

- `id` is a valid `ExecutionMode` value (TypeScript enforces this at the type level).
- If `capabilities` includes `'delegated'`, then `completedEventQueue`, `completedEventPayload`, `finalise`, and `reconcile` are all defined. Missing any throws `BackendCapabilityViolation`.
- If `capabilities` includes `'cancellation'`, then `cancel` is defined.
- `sandboxRequirement` is one of the known values.

Validation runs at boot in `server/index.ts` after registering each adapter; failure is a fatal startup error with a specific log line. Adapters that fail validation never reach dispatch.

### 8.3 Boot-time registration

Adapter registration happens in `server/index.ts`, immediately after the existing IEE handler registration block (lines 648–659). Registration is sync; no I/O. The five V1 adapters import their factories and call `register()` in deterministic order: `api`, `headless`, `claude-code`, `iee_browser`, `iee_dev`. Order matters only for log output; the registry is a map.

---

## 9. Generalised finalisation and reconciliation

### 9.1 `finaliseAgentRunFromBackend`

Renamed and generalised from the existing `finaliseAgentRunFromIeeRun`. New file location stays: `server/services/agentRunFinalizationService.ts`.

```ts
export async function finaliseAgentRunFromBackend(args: {
  backendId: ExecutionMode;
  backendTaskId: string;
}): Promise<boolean> {
  const backend = executionBackendRegistry.resolve(args.backendId, /* org context */);
  if (!backend.finalise) {
    throw new Error(`backend ${args.backendId} declared 'delegated' but provides no finalise()`);
  }

  // Re-load the adapter's terminal-state row + parent agent_run, transactionally.
  // The adapter exposes a loadTerminalState() helper — see §9.3.
  return await db.transaction(async (tx) => {
    const terminalState = await backend.loadTerminalState(tx, args.backendTaskId);
    if (!terminalState) return false;
    const parentRun = await loadParentRun(tx, terminalState.agentRunId);
    if (!parentRun) return false;
    const result = await backend.finalise!({ terminalState, parentRun });
    return result.finalised;
  });
}
```

The IEE adapter's `finalise()` body is the existing `finaliseAgentRunFromIeeRun` body, lifted unchanged minus the row-loading code (which moves into the shared caller).

The existing exported name `finaliseAgentRunFromIeeRun` is kept as a thin alias for one phase to avoid a big-bang rename across callers. Aliases are removed in the final cutover step.

### 9.2 `reconcileBackends` (replaces `reconcileStuckDelegatedRuns`)

```ts
export async function reconcileBackends(): Promise<{ total: number; perBackend: Record<ExecutionMode, number> }> {
  const perBackend: Record<string, number> = {};
  for (const backend of executionBackendRegistry.forDelegated()) {
    if (!backend.reconcile) continue; // capability mismatch — should not happen post-validation
    try {
      perBackend[backend.id] = await backend.reconcile();
    } catch (err) {
      logger.error('backend.reconcile_failed', { backendId: backend.id, error: errToMsg(err) });
      perBackend[backend.id] = 0;
    }
  }
  const total = Object.values(perBackend).reduce((a, b) => a + b, 0);
  if (total > 0) logger.warn('backend.reconciled_total', { total, perBackend });
  return { total, perBackend };
}
```

Cron renamed: `maintenance:iee-main-app-reconciliation` → `maintenance:backend-reconciliation`. Schedule unchanged: `*/2 * * * *`.

The cron registration in `server/services/queueService.ts:1160` switches to call `reconcileBackends()` instead of `reconcileStuckDelegatedRuns()`. The old cron name is unregistered cleanly via pg-boss (one-off boot step the first time the new code runs — see § 14).

### 9.3 `loadTerminalState` per-adapter helper

The shared finaliser needs to load the adapter's terminal-state row inside the transaction without knowing the adapter's table name. Each delegated adapter exposes:

```ts
loadTerminalState(tx: Transaction, backendTaskId: string): Promise<BackendTerminalState | null>;
```

For the IEE adapter, this is `tx.select().from(ieeRuns).where(eq(ieeRuns.id, backendTaskId)).for('update')`. Future adapters point at their own canonical table.

The return type `BackendTerminalState` is a small structural interface (`agentRunId`, `status`, `failureReason?`, `completedAt`, `resultSummary?`, plus an opaque `raw` slot for the adapter's own row); the IEE adapter's `finalise()` casts `raw` to `IeeRun` to access cost columns and summary.

---

## 10. Optional-now metadata (build, do not act on)

These three pieces are explicitly cheap to add now and expensive to retrofit; brief Decision 2 § 3.6 flagged them. None drives V1 dispatch behaviour; all three are consumed in Spec B, Spec C, or Phase 3.5+ routing.

### 10.1 Capability tags — see §4.1

Every adapter declares `capabilities`. V1 reads them only for boot-time validation and for the `forDelegated()` registry helper. Phase 3.5+ routing reads them; Spec C reads `'session_identity'`.

### 10.2 Cost-model declaration — see §4.1

Every adapter declares `costModel`. V1 does not read it. Spec C cost surfaces and Phase 3.5+ cost-aware routing read it. Declared now so the adapters are self-describing for those specs without amendment.

### 10.3 Per-org backend preference — see §4.4

`organisations.preferred_backends jsonb DEFAULT '{}'`. V1 reads it during `registry.resolve()` but identity-resolves every value (the JSON shape is `{ executionMode: backendId }`; in V1 these are equal). Spec C / Phase 3.5+ adapter-variant routing reads non-trivial entries.

### Why include these in V1

Per `docs/spec-authoring-checklist.md` § 1, each is justified as an extension of an existing primitive (`agent_runs` table, organisation config, adapter registry) rather than a new primitive. Building them later means rewriting every adapter file, every cost-ledger consumer, and an organisation-level config migration in a future spec — versus three lines in each adapter file and one nullable column today.

---

## 11. Components affected

| Layer | File / module | Change |
|---|---|---|
| Types | `server/services/executionBackends/types.ts` (new) | Define `ExecutionBackend`, `ExecutionCapability`, `CostModel`, `SandboxRequirement`, `BackendDispatchInput`, `BackendDispatchResult`, `BackendFinalisationInput`, `BackendFinalisationResult`, `BackendTerminalState`. |
| Types | `server/services/executionBackends/options.ts` (new) | `BackendOptions` discriminated union. |
| Registry | `server/services/executionBackends/registry.ts` (new) | `ExecutionBackendRegistry` class + singleton export. |
| Adapter — api | `server/services/executionBackends/apiBackend.ts` (new) | Lifts `agentExecutionService.ts:1522–1632` body. |
| Adapter — headless | `server/services/executionBackends/headlessBackend.ts` (new) | Shares helper with api adapter. |
| Adapter — claude-code | `server/services/executionBackends/claudeCodeBackend.ts` (new) | Lifts `agentExecutionService.ts:1474–1521`. |
| Adapter — iee_browser | `server/services/executionBackends/ieeBrowserBackend.ts` (new) | Lifts `agentExecutionService.ts:1413–1473` (browser branch) + IEE `finalise`/`reconcile`. |
| Adapter — iee_dev | `server/services/executionBackends/ieeDevBackend.ts` (new) | Lifts the dev branch + shares finaliser logic with iee_browser. |
| Service — dispatch | `server/services/agentExecutionService.ts` | Replace lines 1408–1521 dispatch ladder with `executionBackendRegistry.resolve(effectiveMode, organisationId).dispatch(input)`. Post-completion block stays for in-process / subprocess lifecycles. |
| Service — finaliser | `server/services/agentRunFinalizationService.ts` | Add `finaliseAgentRunFromBackend`. Keep `finaliseAgentRunFromIeeRun` as thin alias during transition; remove in cutover. |
| Service — reconciliation | `server/services/agentRunFinalizationService.ts` | Add `reconcileBackends`; existing `reconcileStuckDelegatedRuns` becomes alias for one phase, removed in cutover. |
| Schema | `server/db/schema/agentRuns.ts` | Add `backendId text` and `backendTaskId text` columns. No status enum change. |
| Schema | `server/db/schema/organisations.ts` | Add `preferredBackends jsonb` column with `default '{}'`. |
| Migration | `server/db/migrations/0310_execution_backend_columns.sql` (new — number contingent on main) | Two columns on `agent_runs`, one on `organisations`. Two partial indexes on `agent_runs`. |
| Job handler | `server/jobs/ieeRunCompletedHandler.ts` | Internally delegate to `finaliseAgentRunFromBackend({ backendId: 'iee_browser' or 'iee_dev', backendTaskId })`. Behaviour unchanged. |
| Job handler | `server/jobs/index.ts` (or `server/index.ts` boot block) | Register adapters in registry post-boot. |
| Cron | `server/services/queueService.ts:1160` | Rename `maintenance:iee-main-app-reconciliation` → `maintenance:backend-reconciliation`. Call `reconcileBackends`. Add boot-time unregister of the old name. |
| Telemetry | `server/services/ieeUsageService.ts` | No change in V1 — reads continue against `iee_runs` and the `delegated` count. (A future generalisation to per-backend dashboards is § 19 deferred.) |
| Tests | `server/services/executionBackends/__tests__/contractPure.test.ts` (new) | Contract tests against an in-memory mock adapter; runs first per § 14. |
| Tests | `server/services/executionBackends/__tests__/registryPure.test.ts` (new) | Registry validation rules. |
| Tests | `server/services/__tests__/agentRunFinalizationServicePure.test.ts` (existing) | Update to call `finaliseAgentRunFromBackend` instead of `finaliseAgentRunFromIeeRun`. |
| Docs | `architecture.md` § Execution modes | Update to describe the registry pattern. The five `executionMode` values stay; the description shifts from "branches in agentExecutionService" to "adapter implementations registered in `executionBackendRegistry`". |
| Docs | `docs/openclaw-strategic-analysis.md` Phase 1 | Mark complete on landing. |

---

## 12. Permissions / RLS

No new tenant-scoped tables. No new routes. Per `docs/spec-authoring-checklist.md` § 4:

- `agent_runs` and `organisations` are existing tenant-scoped tables; their RLS policies remain in force. The two new columns on `agent_runs` and one on `organisations` add no new access surface.
- The adapter registry is a process-local singleton; adapters do not access the DB except via the existing services they wrap. No new principal-scoped contexts needed.
- `organisations.preferred_backends` is read by adapter resolution. The read is scoped by the organisation already loaded into the run context — no additional RLS work.
- `executionBackendRegistry.resolve()` does not bypass any guard. The dispatch site already checks `agent.allowedExecutionModes` and the policy envelope before calling resolve.

No opt-out documentation needed; no new tenant-scoped table.

---

## 13. Execution-safety contracts

Per `docs/spec-authoring-checklist.md` § 10:

### 13.1 Idempotency posture

| Operation | Posture | Mechanism |
|---|---|---|
| `dispatch()` for delegated backend (parent run → `'delegated'`) | **state-based** | Existing UPDATE predicate: `WHERE agent_runs.id = ? AND status IN ('pending', 'running')`. 0-rows-affected = caller already saw a terminal state, abort with diagnostic. Same predicate as today. |
| `finaliseAgentRunFromBackend()` | **state-based + key-based** | Existing IEE pattern preserved: parent row loaded `FOR UPDATE`; finaliser exits without writes if `parent.status !== 'delegated' && terminalState.eventEmittedAt`. Plus key on `iee_runs.id` (or future adapter's id). |
| `reconcile()` per adapter | **safe (read-only filter + idempotent finalisation)** | Reconciliation reads candidate rows then calls the same finaliser. Each call is state-based-idempotent. Re-running the cron is safe. |
| `cancel()` | **state-based** | Existing IEE pattern: writes `agent_runs.status = 'cancelling'`, then `iee_runs.status = 'cancelled'`. Worker's per-step check sees the cancel and exits. Re-cancel is no-op. |

### 13.2 Retry classification

| Operation | Class | Boundary |
|---|---|---|
| `dispatch()` in-process (`api`, `headless`) | **safe** | Loop result returned directly; no external state mutation between caller and callee. |
| `dispatch()` subprocess (`claude-code`) | **safe** | Subprocess invocation has no external side effect persistence (no DB write before exit). |
| `dispatch()` delegated | **guarded** | `enqueueIEETask` (and future adapter equivalents) carries an idempotency key; deduplicates on the existing `iee_runs.idempotency_key` unique constraint. |
| `finaliseAgentRunFromBackend()` | **safe** | State-based-idempotent. The pg-boss handler retries on failure; reconciliation provides the second-line backstop. |
| `reconcile()` cron | **safe** | Pure read-then-finalise. Self-bounded by `LIMIT 100`. |

### 13.3 Concurrency guard

Two callers can race on:

- **Same `dispatch()` for the same `runId`.** Today: the route handler holds the run id; double-dispatch is impossible at the route boundary. The dispatch path does not add a guard. Existing behaviour preserved.
- **`finaliseAgentRunFromBackend()` from the event handler racing the cron.** Guard: parent agent_run loaded `FOR UPDATE` inside the transaction. First commit wins; second sees `parent.status !== 'delegated'` and exits no-op. Existing IEE behaviour preserved.
- **Two reconciliation cron ticks overlap.** Guard: pg-boss's `teamSize: 1, teamConcurrency: 1` on the `maintenance:backend-reconciliation` queue (same as current IEE cron). At most one tick at a time per process; multi-process safety is by way of the per-row `FOR UPDATE` lock inside finalisation.

Loser response in every case: silent no-op, with a `logger.debug` line for observability. No HTTP status involved (the conflicting flows are internal).

### 13.4 Terminal event guarantee

Each delegated adapter has exactly one terminal pg-boss event per backend task:

- `iee_browser` → `iee-run-completed`
- `iee_dev` → `iee-run-completed` (shared queue with `iee_browser` — see note)
- Future: `openclaw_managed` → `openclaw-run-completed`

**Shared-queue note (IEE):** the two IEE adapters share `iee-run-completed` because they share `iee_runs` storage. The handler routes by reading `iee_runs.task_type` from the loaded row. Future adapters that share storage may share queues; the rule is one queue per terminal-state table, not per adapter id. Documented at the registry validation step so a future adapter that violates the rule fails registration.

Post-terminal prohibition: the worker's `finalizeRun()` writes `iee_runs.eventEmittedAt = now()` after the event; the cleanup-orphan reconciliation never re-fires for rows where `eventEmittedAt IS NOT NULL && parent.status` is terminal. Existing behaviour.

### 13.5 No-silent-partial-success

Adapters return an explicit `BackendDispatchResult.lifecycle` value. A delegated adapter that fails to enqueue propagates the error up through `dispatch()`; it never returns `{ lifecycle: 'delegated', backendTaskId: null, ... }`. The post-completion finaliser's `BackendFinalisationResult.finalised` is true only if both rows wrote their terminal updates. Caller cannot mistake a partial-finalise for success.

### 13.6 Unique-constraint mapping

The migration adds two partial indexes on `agent_runs`:

- `agent_runs_backend_id_idx` — `(backend_id) WHERE backend_id IS NOT NULL`. Non-unique. No HTTP mapping needed.
- `agent_runs_backend_task_id_idx` — `(backend_id, backend_task_id) WHERE backend_task_id IS NOT NULL`. Non-unique. No HTTP mapping needed.

The existing `iee_runs` unique constraints (idempotency key, primary key) are unchanged. No new unique constraints introduced; no `23505` mapping required.

### 13.7 State machine closure

`agent_runs.status` enum is unchanged from PR #279 — see `docs/iee-delegation-lifecycle-spec.md` Appendix A. This spec introduces no new transitions and forbids none; the adapter contract is layered above the state machine.

The adapter's *internal* state machine (in-process loop result, subprocess exit code, delegated terminal state) is each adapter's concern. The contract pins the boundary: `BackendDispatchResult.lifecycle` ∈ `{'in_process', 'delegated', 'subprocess'}` (closed set) determines which post-dispatch path runs.

---

## 14. Phase plan

One spec, one Phase 2 build slug. Five chunks, in this order. Each chunk is independently shippable and reviewable; the cutover is the last chunk.

### Chunk 1 — Contract + types + registry (no consumers)

- Author `types.ts`, `options.ts`, `registry.ts`.
- Pure tests in `__tests__/contractPure.test.ts` and `__tests__/registryPure.test.ts`.
- No `agentExecutionService.ts` change.
- No migration.

**Verifier:** lint + typecheck pass; new pure tests pass; no behaviour change anywhere in the app.

### Chunk 2 — Migration + schema columns

- Migration `0310_execution_backend_columns.sql` (number determined at land time).
- Schema updates on `agentRuns.ts` and `organisations.ts`.
- Both columns nullable / defaulted; no backfill.

**Verifier:** `npm run db:generate` produces a clean diff for these columns; no other diff. RLS policies on both tables unaffected (verified by `verify-rls-coverage.sh`).

### Chunk 3 — IEE adapter

- Author `ieeBrowserBackend.ts` and `ieeDevBackend.ts`.
- Move `finaliseAgentRunFromIeeRun` body into the IEE adapters' `finalise()` method.
- Add `finaliseAgentRunFromBackend` shared caller.
- Keep the existing exported function name `finaliseAgentRunFromIeeRun` as a thin alias delegating to the new shared caller. Both names export.
- Add `reconcileBackends` calling `forDelegated()`.
- Keep the existing `reconcileStuckDelegatedRuns` as alias for the new `reconcileBackends` filtered to IEE.
- Register adapters at boot.
- Cron name unchanged in this chunk (`maintenance:iee-main-app-reconciliation` continues to call the new function via the alias).

**Verifier:** existing IEE integration tests in `agentRunDelegationFlow.test.ts` continue to pass without modification. The dispatch site in `agentExecutionService.ts` is untouched (still uses the if/else); the IEE adapter is registered but not yet called from dispatch.

### Chunk 4 — Native + claude-code adapters

- Author `apiBackend.ts`, `headlessBackend.ts`, `claudeCodeBackend.ts`.
- Each lifts its existing dispatch body into `dispatch()`.
- Register at boot.

**Verifier:** adapters are registered but still not called from dispatch — the dispatch ladder remains. Existing API / headless / claude-code paths still take the old code path. Tests unchanged.

### Chunk 5 — Cutover

- Replace `agentExecutionService.ts` lines 1408–1521 with:

  ```ts
  const backend = executionBackendRegistry.resolve(effectiveMode, request.organisationId);
  const dispatchResult = await backend.dispatch({ /* mapped from request */ });
  if (dispatchResult.lifecycle === 'delegated') {
    return { runId: run.id, status: 'delegated', ... };
  }
  loopResult = dispatchResult.loopResult!;
  // ... existing post-completion finalisation block continues unchanged for in_process/subprocess.
  ```

- Rename cron `maintenance:iee-main-app-reconciliation` → `maintenance:backend-reconciliation`. Add boot-time `boss.unschedule('maintenance:iee-main-app-reconciliation')` for one release cycle to clean up the old schedule entry.
- Remove the alias exports (`finaliseAgentRunFromIeeRun`, `reconcileStuckDelegatedRuns`) and update remaining callers.

**Verifier:** all five existing modes run end-to-end; integration tests pass; cron-rename does not double-fire (asserted by inspecting pg-boss `schedule` table post-deploy).

### Chunk dependency graph

```
Chunk 1 (types) ──► Chunk 2 (migration) ──► Chunk 3 (IEE adapter) ──► Chunk 5 (cutover)
                                       └─► Chunk 4 (native + claude-code) ──┘
```

Chunks 3 and 4 are independent and can be reviewed in parallel; both must land before Chunk 5.

---

## 15. Testing posture

Per `docs/spec-context.md` and `docs/spec-authoring-checklist.md` § 9: pure-function tests primary, runtime tests for IEE / delegation paths only because they predate the static-gates posture and are the high-risk surface.

### Pure tests (new)

- `executionBackends/__tests__/contractPure.test.ts` — capability-validation rules, dispatch-result shape exhaustiveness, options union closure. Uses an in-memory mock adapter implementing every capability shape.
- `executionBackends/__tests__/registryPure.test.ts` — registration accepts valid adapters, rejects malformed, resolves correctly with and without `preferredBackends` overrides.
- `agentRunFinalizationServicePure.test.ts` (existing) — mapping table coverage stays; calls renamed to `finaliseAgentRunFromBackend`.

### Integration tests (existing, kept)

- `agentRunDelegationFlow.test.ts` — full IEE lifecycle. Continues to pass without modification through Chunks 3 and 5. After Chunk 5, the dispatch path inside the test is the registry-resolved adapter; the assertion surface is identical.

### Manual smoke (operator)

- Run one IEE browser task end-to-end on Replit dev after Chunk 5 lands.
- Run one `api` task and one `claude-code` task in dev.
- Confirm cron schedules: `maintenance:backend-reconciliation` present, `maintenance:iee-main-app-reconciliation` absent.

### Framing alignment

Test plan aligns with `docs/spec-context.md`:

- `runtime_tests: pure_function_only` — pure tests dominate.
- IEE integration tests remain because they covered a known historical failure (synthetic-completion bug, PR #279); regression-protection is a documented exception in the IEE spec, not a deviation from the framing.
- No new frontend tests, no new API contract tests, no E2E.

### Verification commands

After each chunk, run only the relevant checks per `CLAUDE.md § Verification Commands`:

- All chunks: `npm run lint`, `npm run typecheck`.
- Chunks 1–4: targeted `npx vitest run server/services/executionBackends/__tests__/`.
- Chunk 2: `npm run db:generate` + verify migration lint passes.
- Chunk 3 + 5: targeted `npx vitest run server/services/__tests__/agentRunFinalizationServicePure` and the existing IEE integration test (CI runs the integration suite — locally, run only if Docker is up).

---

## 16. Acceptance criteria

The work is complete when:

1. `grep -n "if (effectiveMode === 'iee_browser'" server/services/agentExecutionService.ts` returns zero matches.
2. `grep -n "if (effectiveMode === 'claude-code')" server/services/agentExecutionService.ts` returns zero matches.
3. The five `executionMode` values each resolve to a registered `ExecutionBackend` instance via `executionBackendRegistry.resolve()`.
4. Existing IEE integration test (`agentRunDelegationFlow.test.ts`) passes unchanged.
5. Existing finalisation pure test (`agentRunFinalizationServicePure.test.ts`) passes after the rename to `finaliseAgentRunFromBackend`.
6. New contract pure tests pass (`contractPure.test.ts`, `registryPure.test.ts`).
7. Boot-time validation rejects an adapter declaring `'delegated'` without `finalise` / `reconcile` / `completedEventQueue` (asserted by registry pure test).
8. Cron `maintenance:backend-reconciliation` is registered post-deploy; cron `maintenance:iee-main-app-reconciliation` is unregistered.
9. `agent_runs.backend_id` and `agent_runs.backend_task_id` columns exist with the partial indexes; `organisations.preferred_backends` exists with default `'{}'`.
10. `architecture.md § Execution modes` describes the registry pattern; `docs/openclaw-strategic-analysis.md` Phase 1 marker updated.
11. No regression on existing API / headless / claude-code execution paths (verified by integration tests + manual smoke).

---

## 17. Risks

1. **Refactoring the four existing modes into adapters is a "no behaviour change" claim — but each mode has subtle quirks.** *Mitigation:* Chunk 1 lands contract tests against an in-memory mock adapter *before* any real adapter ships. Chunk 3 lands the IEE adapter behind the existing dispatch (registered but not called from dispatch) so the IEE integration test continues to exercise the old path during the transition. Cutover (Chunk 5) is the only commit where behaviour can diverge; it is reviewed end-to-end against every existing test plus operator manual smoke.

2. **Cron rename causes duplicate scheduling.** *Mitigation:* Chunk 5 includes a boot-time `boss.unschedule('maintenance:iee-main-app-reconciliation')` call to clean up the old schedule entry. After one release cycle, the unschedule call is removed. Documented in Chunk 5 verifier.

3. **Per-org `preferred_backends` adds a JSONB column with implicit shape.** *Mitigation:* the column is documented in `architecture.md` as `Map<ExecutionMode, string>` with V1 identity-mapping. Phase 3.5+ routing introduces a Zod schema for the value; today the column is unused at runtime so a missing schema is not a blocker.

4. **Two adapters (`iee_browser`, `iee_dev`) share `iee-run-completed` queue.** *Mitigation:* registry validation rejects adapters that share a queue without sharing storage; the rule is documented in §13.4. The existing IEE handler reads `iee_runs.task_type` to discriminate; this preserves today's behaviour.

5. **Spec scope creep — pull in routing now.** *Mitigation:* §19 routes routing policy + cost-aware dispatch to deferred items with explicit Phase 3.5+ reference. Reviewer is asked to flag any chunk that introduces routing-policy code as out of scope.

---

## 18. File inventory

**Modified:**
- `server/services/agentExecutionService.ts` (Chunk 5 — replaces dispatch ladder)
- `server/services/agentRunFinalizationService.ts` (Chunk 3 — adds `finaliseAgentRunFromBackend`, `reconcileBackends`)
- `server/db/schema/agentRuns.ts` (Chunk 2 — `backendId`, `backendTaskId` columns)
- `server/db/schema/organisations.ts` (Chunk 2 — `preferredBackends` column)
- `server/services/queueService.ts` (Chunk 5 — cron rename + unschedule)
- `server/jobs/ieeRunCompletedHandler.ts` (Chunk 3 — delegate to `finaliseAgentRunFromBackend`)
- `server/index.ts` (Chunks 3 + 4 — adapter registration block)
- `architecture.md` (Chunk 5 — § Execution modes update)
- `docs/openclaw-strategic-analysis.md` (Chunk 5 — Phase 1 complete marker)
- `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` (Chunk 5 — mark Decision 2 implemented)

**Created:**
- `server/services/executionBackends/types.ts`
- `server/services/executionBackends/options.ts`
- `server/services/executionBackends/registry.ts`
- `server/services/executionBackends/apiBackend.ts`
- `server/services/executionBackends/headlessBackend.ts`
- `server/services/executionBackends/claudeCodeBackend.ts`
- `server/services/executionBackends/ieeBrowserBackend.ts`
- `server/services/executionBackends/ieeDevBackend.ts`
- `server/services/executionBackends/__tests__/contractPure.test.ts`
- `server/services/executionBackends/__tests__/registryPure.test.ts`
- `server/db/migrations/0310_execution_backend_columns.sql` (number subject to main; same migration carries down-script with `IF EXISTS`)

**Deleted:** none in V1. Alias exports of `finaliseAgentRunFromIeeRun` and `reconcileStuckDelegatedRuns` are removed in Chunk 5; their underlying logic moves into the IEE adapter and the shared caller.

**Migrations:** one — `0310_execution_backend_columns.sql`. Additive, nullable / defaulted, fully reversible.

---

## 19. Deferred Items

- **Routing policy / cost-aware dispatch.** Phase 3.5+. V1 has identity mapping; routing arrives when ≥2 backends produce a real choice (i.e., once OpenClaw lands and Operator Session Identity is selectable).
- **Health-check / fallback chain.** Same. The `healthCheck()` slot is reserved on the contract; no V1 caller invokes it.
- **Streaming / `onProgress` capability.** Phase 3.5+. The IEE polling endpoint stays as the visibility primitive in V1.
- **`executionMode` column rename to `backend_id`.** Long-term cleanup once all reads route through the adapter id. V1 keeps `executionMode` as the persisted selector.
- **Drop `agent_runs.iee_run_id` column.** Once all queries route through `backend_task_id`, the IEE-specific column can be dropped. Phase 3.5+ when there is enough cross-adapter usage to justify the cleanup.
- **OpenClaw `openclaw_managed` adapter.** Phase 3 spec; depends on this contract being locked.
- **Operator Session Identity (`auth_type: 'operator_session'`) implementation.** Spec C; the contract has the `'session_identity'` capability slot reserved.
- **Sandbox primitive consumed by `iee_dev` adapter.** Spec B; the adapter's `sandboxRequirement` is `'code_execution'` from V1 but enforcement happens once Spec B lands.
- **Per-backend dashboards in `ieeUsageService`.** Generalisation of the current IEE-specific surface to "backend-aware metrics." Useful for Phase 3 ops; not blocking V1.
- **Unified trace view across backends.** Brief Decision 2 § 4 flagged this. The contract makes it possible (every adapter writes through the same finaliser); the trace UI is a separate Phase 3+ piece.

---

## 20. Out of scope

- Operator Session Identity policy / disclosure UX (Spec C).
- Sandbox vendor selection or `SandboxExecutionService` interface (Spec B).
- OpenClaw worker mode (Phase 3).
- Any change to `agent_runs.status` enum or transition rules.
- Any change to `executionMode` column persistence shape — the column remains the persisted selector.
- Migration of historical agent runs.
- Customer-facing UX changes — there are none in V1.

---

## End of spec

This spec is **draft**. Next steps per `CLAUDE.md`:

1. Operator review.
2. Run `spec-reviewer` (Codex loop, max 5 iterations) — `tasks/builds/execution-backend-adapter-contract/spec.md`.
3. (Optional) `chatgpt-spec-review` — manual ChatGPT-web rounds.
4. Lock as `accepted` and hand to `feature-coordinator` for Phase 2 plan + build.
