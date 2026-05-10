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
2. Refactor the five existing `executionMode` values (`api`, `headless`, `claude-code`, `iee_browser`, `iee_dev`) — which share three physical dispatch branches today (`api`/`headless` share the default branch, `claude-code` is its own, IEE is the third) — into adapter implementations that satisfy the contract. **No behaviour change.**
3. Generalise `finaliseAgentRunFromIeeRun` → `finaliseAgentRunFromBackend` so any delegated backend can finalise via one shared code path.
4. Generalise the existing `maintenance:iee-main-app-reconciliation` cron into a backend-iterating reconciliation that walks every registered adapter declaring a delegated lifecycle.
5. Declare `capabilities`, `costModel`, and `sandboxRequirement` metadata on every adapter so downstream specs (Sandbox, Operator Session Identity, future routing) consume metadata rather than introspecting `executionMode` strings.
6. Add a per-organisation backend preference field (`organisations.preferredBackends`) as **schema-only forward-compat metadata** so customer-pinning is possible *without* a router once routing lands. **V1 does not read this column at runtime** — `executionBackendRegistry.resolve()` ignores it; identity mapping is hard-coded. The schema lands now so Phase 3.5+ routing does not need a fresh migration.
7. Forward-compat the contract for `auth_type: 'operator_session'` (Spec C) and `sandboxRequirement: 'code_execution'` (Spec B) without naming either explicitly in V1 dispatch logic.

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
| Per-org backend preference | None | **New column (schema-only V1).** `organisations.preferred_backends jsonb` with default `{}`. Lands now as forward-compat metadata for Phase 3.5+ routing; V1 adapter resolution does not read it. Defined in §4 / §10.3. |

The `executionMode` column itself is **not** removed. It remains the persisted adapter selector — the contract is layered on top, not a replacement for the field. Long-term the column may be renamed to `backend_id`, but that rename is explicitly deferred (§19).

---

## 4. Contracts

### 4.1 `ExecutionBackend` interface

The contract every adapter implements. New file: `server/services/executionBackends/types.ts`.

#### Type origins

The interface signature below references several types — explicit citations so implementers do not re-invent them:

| Type | Origin | New / existing |
|---|---|---|
| `ExecutionMode` | `shared/types/executionEnvironment.ts` (existing closed union: `'api' \| 'headless' \| 'claude-code' \| 'iee_browser' \| 'iee_dev'`) | existing |
| `ExecutionBackendId` | `server/services/executionBackends/types.ts` (new file authored in Chunk 1). Defined as `ExecutionMode \| 'openclaw_managed' \| 'openclaw_external'`. **In V1 the registry only ever holds `ExecutionMode` keys** — the OpenClaw values are forward-compat type slots (their adapters land in Phase 3). The wider type is the seam OpenClaw-spec and Phase 3.5+ routing plug into without a downstream rename. | **new** |
| `PromptAssembly` | `server/services/agentRunPromptService.ts` (existing — same shape `runAgenticLoop` consumes today) | existing |
| `TokenBudget` | `server/services/agentExecutionTypes.ts` (extracted in Chunk 1 from `agentExecutionService.ts` — see "Neutral type file" note below) | **relocated** |
| `AgentRunTerminalStatus` | `shared/runStatus.ts` (existing — `TERMINAL_RUN_STATUSES` set) | existing |
| `LoopResult` | `server/services/agentExecutionTypes.ts` (extracted in Chunk 1 from `agentExecutionService.ts` — see "Neutral type file" note below) | **relocated** |
| `Transaction` | `server/db/index.ts` (existing — Drizzle transaction handle) | existing |
| `BackendDispatchInput` / `BackendDispatchResult` / `BackendFinalisationInput` / `BackendFinalisationResult` / `BackendTerminalState` / `BackendOptions` / `ExecutionCapability` / `CostModel` / `SandboxRequirement` / `BackendOptionsMismatch` / `ParentRunNotDispatchable` / `BackendNotRegistered` / `BackendCapabilityViolation` / `BackendQueueOwnershipViolation` / `BackendTaskAlreadyClaimed` | `server/services/executionBackends/types.ts` (new file authored in Chunk 1) | **new** |
| `BackendProgressEvent` / `UnsubscribeFn` | reserved type aliases for the deferred `onProgress` capability — declared as `unknown` placeholders in `types.ts` and refined when streaming lands (§19) | **new (placeholder)** |

#### Neutral type file (`agentExecutionTypes.ts`)

`TokenBudget` and `LoopResult` (today private to `agentExecutionService.ts`) are extracted into a new neutral file `server/services/agentExecutionTypes.ts` in Chunk 1. The motivation is purely module-graph hygiene: `executionBackends/types.ts` depends on these shapes, and `agentExecutionService.ts` will depend on `executionBackends/registry.ts` after Chunk 5. Without the extraction, the import graph is `executionBackends/types.ts → agentExecutionService.ts → executionBackends/registry.ts → executionBackends/types.ts` — a cycle. With the extraction, both `agentExecutionService.ts` and `executionBackends/types.ts` import from `agentExecutionTypes.ts`, breaking the cycle.

The extracted file contains type aliases only (no runtime code). `agentExecutionService.ts` re-exports `TokenBudget` / `LoopResult` from the neutral file for backwards compatibility with current consumers; new consumers import directly from `agentExecutionTypes.ts`. **Rule:** `executionBackends/types.ts` MUST NOT import from `agentExecutionService.ts` — enforced by §16 acceptance criterion.

```ts
import type { ZodSchema } from 'zod';
import type { IeeRun } from '../../db/schema/ieeRuns.js';
import type { AgentRun } from '../../db/schema/agentRuns.js';
import type { Transaction } from '../../db/index.js';

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
 * What environment primitive the adapter requires at runtime. Consumed by
 * Spec B (Sandbox). Validation is intentionally two-level so V1 preserves
 * the "build now, do not act on" posture:
 *
 *   - V1 registry validation (this spec): validates only that the value is
 *     a known enum member. An adapter declaring `'code_execution'` registers
 *     cleanly even though no Sandbox executor primitive is wired up yet.
 *
 *   - Spec B validation (when the Sandbox spec lands): extends boot-time
 *     validation to confirm the declared primitive's executor is registered.
 *     An adapter requiring `'code_execution'` then fails boot if no Sandbox
 *     primitive is available.
 *
 * Until Spec B lands, the IEE adapter's `iee_dev` declaration of
 * `'code_execution'` is metadata only — runtime behaviour is unchanged.
 */
export type SandboxRequirement =
  | 'none'
  | 'code_execution'
  | 'browser'
  | 'terminal_repo';

/**
 * Adapter-agnostic view of the backend's canonical terminal-state row.
 * `loadTerminalState` returns this shape; `finalise` consumes it.
 *
 * Mandatory fields drive shared idempotency / orchestration; the adapter is
 * free to populate optional fields and is required to populate `raw` so its
 * own `finalise()` can read columns the structural type does not name (e.g.,
 * IEE adapter reads cost columns and `type` from `raw`).
 */
export interface BackendTerminalState {
  /** Foreign key to the parent `agent_runs.id`. Mandatory. */
  agentRunId: string;
  /** The backend's own row id (same as `backendTaskId`). Mandatory. */
  backendTaskId: string;
  /**
   * Closed-set adapter-side status. Adapter maps this to `agent_runs.status`
   * inside `finalise()`. Strings are adapter-specific (e.g., IEE: `'pending'
   * | 'running' | 'completed' | 'failed' | 'cancelled'`). The shared finaliser
   * does NOT read this directly; it is documentation for the adapter.
   */
  status: string;
  /** Adapter-side failure reason (closed set per adapter). Null on success. */
  failureReason: string | null;
  /** Wall-clock terminal time on the backend side. Null if the row is not yet terminal. */
  completedAt: Date | null;
  /**
   * Set non-null by the adapter once the terminal pg-boss event has been
   * emitted (or by the reconciler when it discovers a row whose event was
   * missed). Used by the shared idempotency check in § 13.1: if `parentRun.status`
   * is already terminal AND `eventEmittedAt !== null`, finalise() returns the
   * race-loser shape without writing.
   */
  eventEmittedAt: Date | null;
  /** Optional human-readable summary; populated for completed runs. */
  resultSummary: string | null;
  /**
   * Opaque slot for the adapter's own row. The adapter's `finalise()` casts
   * this to its real row type (e.g., IEE adapter casts to `IeeRun` to access
   * `type`, cost columns, etc.). Other consumers MUST NOT reach into `raw`.
   */
  raw: unknown;
}

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
  /**
   * Caller-owned transaction. The adapter MUST use this transaction for any DB
   * writes; it MUST NOT open its own transaction. The caller (finaliseAgentRunFromBackend)
   * commits or rolls back atomically across the adapter writes and the parent-run
   * terminal update.
   */
  tx: Transaction;
}

export interface BackendFinalisationResult {
  /**
   * True if `finalise()` issued the parent + adapter writes through `input.tx`.
   * False on the race-loser path (parent already terminal AND `eventEmittedAt`
   * already set) — the caller commits an empty tx.
   */
  finalised: boolean;
  /**
   * The parent terminal status the adapter wrote (or observed already-set on
   * the race-loser path). Returned for observability only — the adapter has
   * already issued the UPDATE through `input.tx`.
   */
  parentTerminalStatus: AgentRunTerminalStatus;
}

export interface ExecutionBackend {
  // === Identity ===
  /**
   * Adapter id. Typed as `ExecutionBackendId` (a superset of `ExecutionMode`)
   * so future internal-variant adapters (e.g. `openclaw_managed` vs
   * `openclaw_external`) can register without forcing a contract-wide rename.
   * **V1 invariant:** every registered `id` is also a valid `ExecutionMode`
   * value — the OpenClaw values are forward-compat type slots only.
   */
  readonly id: ExecutionBackendId;
  readonly capabilities: readonly ExecutionCapability[];
  readonly costModel: CostModel;
  readonly sandboxRequirement: SandboxRequirement;

  // === Dispatch (mandatory) ===
  /**
   * Dispatch a run to this backend. The adapter owns ALL writes for its
   * lifecycle:
   *   - in-process / subprocess: runs the loop / subprocess, returns the
   *     LoopResult; the dispatch-site post-completion block writes the parent
   *     terminal UPDATE (existing behaviour).
   *   - delegated: enqueues the backend task AND updates the parent
   *     agent_run to 'delegated' inside the same `dispatch()` call, in the
   *     order described in § 13.1.1. Finalisation happens later via the event
   *     handler → `finaliseAgentRunFromBackend` → adapter's `finalise()`.
   * Returns immediately for delegated; blocks for in-process / subprocess.
   *
   * Invariant: `dispatch()` MUST throw `BackendOptionsMismatch` when
   * `input.backendOptions.backendId !== this.id`. A mismatch indicates the
   * caller resolved one adapter and built options for another — a programming
   * error that must fail loudly, not silently. The check runs as the first
   * statement of every adapter's `dispatch()` body and is asserted by the
   * registry pure test against an in-memory mock adapter.
   */
  dispatch(input: BackendDispatchInput): Promise<BackendDispatchResult>;

  // === Delegated lifecycle (mandatory iff capabilities includes 'delegated') ===

  /**
   * Pg-boss queue name on which this adapter expects its terminal event.
   * Null for non-delegated adapters.
   */
  readonly completedEventQueue: string | null;
  /**
   * Name of the canonical terminal-state table this adapter owns. Used by
   * registry validation to enforce the rule "adapters sharing a queue MUST
   * share storage" (§13.4). Null for non-delegated adapters.
   */
  readonly terminalStateTable: string | null;
  /** Zod schema for the terminal event payload. Used by the handler to validate. */
  readonly completedEventPayload: ZodSchema | null;
  /**
   * Load the adapter's canonical terminal-state row inside the caller-owned
   * transaction. Must take a row-level lock (`FOR UPDATE`) so the shared
   * finaliser can serialise concurrent handler+cron entry on the same row.
   * Returns null when the row does not exist (treated as no-op terminal).
   */
  loadTerminalState?(tx: Transaction, backendTaskId: string): Promise<BackendTerminalState | null>;
  /**
   * Apply the adapter's backend-specific terminal mapping AND write the parent
   * `agent_runs` terminal UPDATE — both inside the caller-owned transaction
   * (`input.tx`). MUST NOT open its own transaction. MUST NOT trust event-payload
   * data — the caller has already re-loaded the canonical row via
   * `loadTerminalState` (which took `FOR UPDATE`) and the parent run via
   * `loadParentRun(tx, ...)` (also `FOR UPDATE`). The adapter:
   *   1. Maps `terminalState` to the parent terminal status (cell-by-cell —
   *      see Appendix A of `docs/iee-delegation-lifecycle-spec.md` for the IEE
   *      adapter's mapping table; future adapters define their own).
   *   2. Writes adapter-owned columns (e.g., `iee_runs.eventEmittedAt = now()`).
   *   3. Writes the parent `agent_runs` terminal UPDATE through `input.tx`.
   *   4. Returns `{ finalised: true, parentTerminalStatus }` for observability.
   * The caller's job is purely orchestration (load + lock + commit).
   *
   * Idempotency: if the loaded `parentRun.status` is already terminal AND
   * `terminalState.eventEmittedAt` is non-null, the adapter MUST return
   * `{ finalised: false, parentTerminalStatus: parentRun.status }` without
   * writing — this is the duplicate-event / race-loser path.
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

**`backendOptions.backendId` semantics.** The discriminant value MUST equal the resolved adapter's `ExecutionBackend.id` field. In V1 every adapter id is also a valid `ExecutionMode` value, so the discriminant is effectively typed as `ExecutionMode` for V1; a future adapter whose `id` diverges from `executionMode` (per § 4.3 *Adapter selector precedence*) carries that future id as its discriminant and the union expands accordingly. Mismatch (`input.backendOptions.backendId !== backend.id`) is rejected by `dispatch()` per the § 4.1 invariant.

### 4.3 Source-of-truth precedence

For a delegated backend, the same logical fact (terminal state) lives in three places: the backend's terminal-state row (e.g., `iee_runs`), the parent `agent_runs` row, and any pg-boss event payload. Per `docs/spec-authoring-checklist.md` § 3, the precedence is declared explicitly:

1. **Backend's terminal-state row (canonical source).** The IEE adapter's source-of-truth row is `iee_runs`. Future adapters declare their own (e.g., `openclaw_runs` for OpenClaw). Always re-loaded at finaliser entry via the adapter's `loadTerminalState()`.
2. **Parent `agent_runs` row (derived).** Status, cost rollup, summary derived from #1 by `finaliseAgentRunFromBackend`. Treated as cached projection.
3. **Pg-boss event payload (hint only).** Used for routing the event to the correct adapter; never trusted as data. New delegated backends authored after this spec emit `{ backendId, backendTaskId }` plus the queue's required envelope. **The existing IEE queue (`iee-run-completed`) keeps its current `{ ieeRunId, ... }` payload shape unchanged in V1**; `ieeRunCompletedHandler` loads `iee_runs`, derives `backendId` from `iee_runs.type` (`'browser' → 'iee_browser'`, `'dev' → 'iee_dev'`), and calls `finaliseAgentRunFromBackend({ backendId, backendTaskId: ieeRunId })`. This preserves the no-behaviour-change claim for V1; future generic delegated backends adopt the new payload shape from day one.

The handler always re-loads the canonical row before calling the finaliser. Existing IEE handler already does this (`server/jobs/ieeRunCompletedHandler.ts:78–86`); the pattern continues.

#### Adapter selector precedence (executionMode vs backend_id vs adapter id)

Three adjacent identifiers exist:

- `agent_runs.executionMode` (existing column) — the persisted adapter selector. Canonical at dispatch time. Type: `ExecutionMode` (closed five-value union).
- `agent_runs.backend_id` (new column, §4.4) — a derived snapshot written at dispatch time for delegated reconciliation and trace joins. In V1, **always equal to `executionMode`**. The column is `text` so it can carry future `ExecutionBackendId` values that diverge from `executionMode` (e.g., `openclaw_managed` vs `openclaw_external` could share an `executionMode = 'openclaw'` while `backend_id` distinguishes them); that divergence does not exist in V1, but the type contract is forward-compat by construction.
- `ExecutionBackend.id` (new contract field, §4.1) — the in-memory key the registry resolves on. Type: `ExecutionBackendId` (`ExecutionMode | 'openclaw_managed' | 'openclaw_external'`). In V1 every registered `id` is also a valid `ExecutionMode` value; the wider type is forward-compat for OpenClaw. Equals `backend_id` once a delegated row is in flight; equals `executionMode` at dispatch time.

V1 precedence rule:

1. **Dispatch path:** `request.executionMode` → `registry.resolve(executionMode)`. The dispatch site never reads `backend_id` (the parent row does not have a `backend_id` value yet).
2. **Finalisation / reconciliation path:** `agent_runs.backend_id` → `registry.resolve(backend_id)` for delegated rows created **after Chunk 5 cutover only**. For pre-cutover in-flight rows, see "Legacy in-flight rows" below.
3. **Divergence between `executionMode` and `backend_id` on a single row is invalid in V1.** Adapter dispatch writes both columns to the same value in the same UPDATE that transitions the parent run to `'delegated'`. A reconciliation query that observes a mismatch logs `backend.selector_mismatch` and skips the row (the operator can repair manually). No automated repair in V1.

#### Legacy in-flight rows — no-backfill fallback

The migration adds `backend_id` and `backend_task_id` as nullable columns with no backfill (§ 4.4, § 2 Non-goals). At deploy time, in-flight delegated `agent_runs` rows have `backend_id IS NULL` and `backend_task_id IS NULL`. They MUST continue to finalise correctly without retrofit:

1. **IEE event handler path (`server/jobs/ieeRunCompletedHandler.ts`).** The handler loads the `iee_runs` row, derives `backendId` from `iee_runs.type` (`'browser' → 'iee_browser'`, `'dev' → 'iee_dev'`), and calls `finaliseAgentRunFromBackend({ backendId, backendTaskId: ieeRunId })`. The handler does NOT read `agent_runs.backend_id`, so a NULL value is never observed on this path.
2. **IEE adapter `reconcile()`.** Per § 4.5, the IEE adapters' reconciliation queries `iee_runs` directly (filtered by `iee_runs.type`), then joins to `agent_runs` only to skip rows whose parent is already terminal (§ 13.1.1 step 4). Reconciliation never reads `agent_runs.backend_id` either.
3. **Required-population rule.** `agent_runs.backend_id` and `agent_runs.backend_task_id` are required to be non-null only for **delegated rows created after Chunk 5 cutover**. Adapter dispatch writes both columns at parent-UPDATE time (§ 13.1.1 step 2). Pre-cutover in-flight rows remain NULL forever; this is correct and intended.

**Acceptance test:** § 15 Pure tests adds a case asserting that a pre-cutover IEE run with `agent_runs.backend_id IS NULL` finalises correctly via the IEE handler path. Implementation: construct the IEE handler call with a `backendId` derived from `iee_runs.type` and verify the parent UPDATE writes the terminal status; do NOT seed `agent_runs.backend_id` in the test fixture.

### 4.4 New columns

`agent_runs` (existing table; one migration adds two columns):

| Column | Type | Notes |
|---|---|---|
| `backend_id` | `text NULL` | Generic adapter identifier. Equals `executionMode` value at write time today. Future adapters with internal variants can diverge. Indexed via partial index `(backend_id) WHERE backend_id IS NOT NULL` (non-unique — multiple parent runs may share an adapter). |
| `backend_task_id` | `text NULL` | Generic delegated-task reference. Equals `iee_run_id::text` for IEE rows; null for in-process / subprocess. **Unique** partial index `(backend_id, backend_task_id) WHERE backend_task_id IS NOT NULL` — see § 13.6. |

The existing `agent_runs.iee_run_id` (uuid) stays for index continuity. The IEE adapter writes both columns during V1 (denormalised); a future cleanup may drop `iee_run_id` once all queries route through `backend_task_id`. That cleanup is **§19 deferred**.

`organisations` (existing table; one migration adds one column):

| Column | Type | Notes |
|---|---|---|
| `preferred_backends` | `jsonb NOT NULL DEFAULT '{}'` | Map of `{ executionMode: backendId }` overrides. **Schema-only in V1** — adapter resolution does NOT read this column at dispatch time (V1 uses pure identity mapping). Column lands now so Phase 3.5+ routing — when adapters with internal variants such as `openclaw_managed` vs `openclaw_external` arrive — has a populated migration to read against without a fresh schema change. |

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
  terminalStateTable: 'iee_runs',
  completedEventPayload: ieeRunCompletedPayloadSchema, // existing zod
  async dispatch(input) {
    // Body = current lines 1413–1473 of agentExecutionService.ts, lifted unchanged.
    // Returns { lifecycle: 'delegated', backendTaskId: enqueueResult.ieeRunId, loopResult: null, deduplicated }.
  },
  async loadTerminalState(tx, backendTaskId) {
    // tx.select().from(ieeRuns).where(eq(ieeRuns.id, backendTaskId)).for('update')
    // → mapped into BackendTerminalState shape. Returns null if no row.
  },
  async finalise(input) {
    // Body = current finaliseAgentRunFromIeeRun mapping logic, lifted into here.
    // Receives input.tx — uses it for any iee_runs writes (e.g. eventEmittedAt).
    // Does NOT open its own transaction.
  },
  async reconcile() {
    // Body = current reconcileStuckDelegatedRuns filtered to ieeRuns AND scoped
    // by `iee_runs.type = 'browser'` (the iee_dev adapter's reconcile() applies
    // `iee_runs.type = 'dev'`). Each adapter reconciles only its own slice of
    // shared storage so reconcileBackends does not double-process rows. See § 9.2.
  },
  async cancel({ runId, backendTaskId }) {
    // Body = existing cancelIeeRun call.
  },
};
```

**Adapter-shape rules:**

- `iee_dev` is delegated (capabilities include `'delegated'`). It follows the exact same `loadTerminalState`/`finalise`/`reconcile` shape as `iee_browser`, sharing both `iee_runs` storage and the `iee-run-completed` queue per § 13.4. Its `reconcile()` filters by `iee_runs.type = 'dev'` to avoid double-processing rows the `iee_browser` adapter also scans (§ 9.2).
- `api`, `headless`, `claude-code` are non-delegated. They MUST set `completedEventQueue`, `terminalStateTable`, and `completedEventPayload` to `null`, and SHOULD omit `loadTerminalState`, `finalise`, and `reconcile` entirely (the methods are optional on `ExecutionBackend`; "omit" is preferred over "no-op stub" because registry validation in § 8.2 only enforces presence-when-`'delegated'`-is-declared, not absence-when-not-declared, but a stub adds noise without value).
- `cancellation` is independent of the delegation lifecycle: the IEE adapters declare `'cancellation'` and implement `cancel()`; the in-process / subprocess adapters do not.

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
  private readonly backends = new Map<ExecutionBackendId, ExecutionBackend>();

  register(backend: ExecutionBackend): void;
  /**
   * Resolve an adapter by id. Accepts `ExecutionBackendId` (the wider type)
   * so finalisation/reconciliation paths reading `agent_runs.backend_id` —
   * which is `text` and may carry an OpenClaw variant id in Phase 3+ — type-check
   * cleanly. Dispatch callers pass an `ExecutionMode` value; this is type-compatible
   * because `ExecutionMode` is a subtype of `ExecutionBackendId`.
   */
  resolve(id: ExecutionBackendId): ExecutionBackend;
  forEach(callback: (backend: ExecutionBackend) => void): void;
  forDelegated(): ExecutionBackend[]; // backends declaring 'delegated' capability
}

export const executionBackendRegistry = new ExecutionBackendRegistry();
```

`resolve()` is **synchronous and parameterless beyond the id** in V1. The lookup is `this.backends.get(id)`. Throws `BackendNotRegistered` if the id has no registered adapter — this is per-call lazy validation, not a boot-time enumeration. (Boot-time validation is per-adapter — see § 8.2 — and runs only against adapters that have been registered. Chunks 3 and 4 each register a subset of adapters; the dispatch-site caller still uses the if/else ladder until Chunk 5, so no Chunk-3-or-4 path calls `resolve()` against an unregistered mode. After Chunk 5 cutover, every `ExecutionMode` value resolves because every adapter has been registered. **OpenClaw `ExecutionBackendId` values (`'openclaw_managed'`, `'openclaw_external'`) have no registered adapter in V1; calling `resolve('openclaw_managed')` throws `BackendNotRegistered`.** Phase 3 OpenClaw spec lands the registration.)

Phase 3.5+ routing (§19) will extend `resolve()` to accept a preloaded `PreferredBackends` shape (read once per request from `organisations.preferred_backends` and threaded through the dispatch context). That extension is deliberately out of scope for V1; adding the parameter now would force every dispatch caller to plumb an unused value through. The extension point is named here so the future signature change is anticipated.

### 8.2 Boot-time validation

The registry validates each adapter at registration:

- `id` is a valid `ExecutionBackendId` value (TypeScript enforces this at the type level). **In V1 the runtime register-call is additionally restricted to `ExecutionMode` ids only** — registering an OpenClaw `ExecutionBackendId` value (`'openclaw_managed'` / `'openclaw_external'`) is explicitly rejected at boot in V1 because the OpenClaw adapter has not been authored yet (Phase 3 spec). The runtime check is `!isExecutionMode(backend.id) → throw BackendCapabilityViolation('OpenClaw backend ids reserved for Phase 3')`. Removed when the OpenClaw adapter lands.
- If `capabilities` includes `'delegated'`, then `completedEventQueue`, `completedEventPayload`, `loadTerminalState`, `finalise`, and `reconcile` are all defined. Missing any throws `BackendCapabilityViolation`.
- If `capabilities` includes `'cancellation'`, then `cancel` is defined.
- `sandboxRequirement` is one of the known values (V1 enum-only check; no executor-availability check until Spec B — see § 4.1 `SandboxRequirement` JSDoc).
- Two adapters MAY share `completedEventQueue` if and only if they share their underlying terminal-state storage (e.g., `iee_browser` and `iee_dev` both share `iee_runs`). Two adapters declaring the same queue but different storage tables fail registration with `BackendQueueOwnershipViolation`. The rule is enforced declaratively via an optional `terminalStateTable: string` field on each delegated adapter; same-queue adapters MUST share the same `terminalStateTable` value.

Validation runs at boot in `server/index.ts` after registering each adapter; failure is a fatal startup error with a specific log line. Adapters that fail validation never reach dispatch.

### 8.3 Boot-time registration

Adapter registration happens in `server/index.ts`, immediately after the existing IEE handler registration block (lines 648–659). Registration is sync; no I/O. The five V1 adapters import their factories and call `register()` in deterministic order: `api`, `headless`, `claude-code`, `iee_browser`, `iee_dev`. Order between adapters matters only for log output; the registry is a map.

#### Boot invariant — adapters registered before any pg-boss worker

**All adapters MUST be registered before any pg-boss worker starts consuming a terminal event or reconciliation job.** Otherwise an early `iee-run-completed` payload (or a reconciliation cron tick) reaches `finaliseAgentRunFromBackend()` before the IEE adapter is in the registry, and the call throws `BackendNotRegistered`. Concretely:

1. The adapter-registration block runs synchronously inside `server/index.ts` boot.
2. The pg-boss `boss.start()` call AND every queue's `boss.work()` worker registration MUST come strictly after the adapter-registration block. Today the queue service is initialised after the IEE handler block in `server/index.ts` (around line ~700+) — adapter registration is inserted at the existing handler block (lines 648–659), so the ordering is preserved by construction.
3. The `maintenance:backend-reconciliation` cron is scheduled inside `queueService.ts` once `boss.start()` has returned; this remains after adapter registration.

Violation surfaces as a fatal startup error if registration is removed or moved; there is no per-call fallback. The pure registry test asserts that `resolve()` on an unregistered adapter throws `BackendNotRegistered` — the boot ordering itself is not unit-tested (it is a code-structure invariant; see § 16 acceptance criteria).

---

## 9. Generalised finalisation and reconciliation

### 9.1 `finaliseAgentRunFromBackend`

Renamed and generalised from the existing `finaliseAgentRunFromIeeRun`. New file location stays: `server/services/agentRunFinalizationService.ts`.

```ts
export async function finaliseAgentRunFromBackend(args: {
  backendId: ExecutionBackendId;
  backendTaskId: string;
}): Promise<boolean> {
  const backend = executionBackendRegistry.resolve(args.backendId);
  if (!backend.loadTerminalState || !backend.finalise) {
    throw new Error(`backend ${args.backendId} declared 'delegated' but missing loadTerminalState/finalise`);
  }

  // Orchestration only: load + lock + hand off to the adapter. The adapter's
  // finalise() owns ALL writes (adapter-owned columns AND the parent agent_runs
  // terminal UPDATE) — see § 4.1 for the contract. This keeps mapping +
  // adapter-side columns + parent terminal UPDATE atomic in one tx.
  return await db.transaction(async (tx) => {
    const terminalState = await backend.loadTerminalState!(tx, args.backendTaskId);
    if (!terminalState) return false;
    const parentRun = await loadParentRun(tx, terminalState.agentRunId);  // FOR UPDATE
    if (!parentRun) return false;
    const result = await backend.finalise!({ terminalState, parentRun, tx });
    return result.finalised;
  });
}
```

**Why adapter owns the parent UPDATE.** The existing `finaliseAgentRunFromIeeRun` body (PR #279) already does this — the IEE-specific mapping table (`iee_runs.failureReason` → `agent_runs.status`) and the parent UPDATE live in the same function. Lifting that body unchanged into the IEE adapter's `finalise()` preserves the no-behaviour-change claim. The shared caller cannot write the parent UPDATE generically because it does not know the adapter's per-row mapping cells. Returning a "full parent terminal projection" from `finalise()` for the caller to write is the alternative — rejected because it forces every adapter to round-trip its mapping through a structural type, doubling the surface for no execution gain.

The IEE adapter's `finalise()` body is the existing `finaliseAgentRunFromIeeRun` body, lifted unchanged minus the row-loading code (which moves into the shared caller).

The existing exported name `finaliseAgentRunFromIeeRun` is kept as a thin alias for one phase to avoid a big-bang rename across callers. Aliases are removed in the final cutover step.

### 9.2 `reconcileBackends` (replaces `reconcileStuckDelegatedRuns`)

```ts
export async function reconcileBackends(): Promise<{ total: number; perBackend: Record<ExecutionBackendId, number> }> {
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

#### Shared-storage adapters and reconciliation scoping

When two adapters share a `terminalStateTable` (the IEE adapters share `iee_runs`), each adapter's `reconcile()` MUST filter to its own slice of the shared table — otherwise `reconcileBackends()` would double-process every row (once per adapter sharing the storage). For the IEE adapters this is `WHERE iee_runs.type = 'browser'` (for `iee_browser.reconcile`) and `WHERE iee_runs.type = 'dev'` (for `iee_dev.reconcile`). The discriminator column is the same one the event handler uses to derive `backendId` (§ 4.3 / § 13.4); the per-adapter filter is asserted by `registryPure.test.ts` against an in-memory mock that registers two adapters with the same `terminalStateTable` and verifies their reconcile counts are disjoint.

Adapters that own their own `terminalStateTable` (no sibling) have no constraint — the table-wide scan is the per-adapter scope.

### 9.3 `loadTerminalState` per-adapter helper

The shared finaliser needs to load the adapter's terminal-state row inside the transaction without knowing the adapter's table name. Each delegated adapter exposes:

```ts
loadTerminalState(tx: Transaction, backendTaskId: string): Promise<BackendTerminalState | null>;
```

For the IEE adapter, this is `tx.select().from(ieeRuns).where(eq(ieeRuns.id, backendTaskId)).for('update')`, mapped into the `BackendTerminalState` shape (see § 4.1 for the full structural interface). Future adapters point at their own canonical table and emit the same shape.

The IEE adapter's `finalise()` casts `BackendTerminalState.raw` to `IeeRun` to access cost columns and summary fields not named in the structural type.

---

## 10. Optional-now metadata (build, do not act on)

These three pieces are explicitly cheap to add now and expensive to retrofit; brief Decision 2 § 3.6 flagged them. None drives V1 dispatch behaviour; all three are consumed in Spec B, Spec C, or Phase 3.5+ routing.

### 10.1 Capability tags — see §4.1

Every adapter declares `capabilities`. V1 reads them only for boot-time validation and for the `forDelegated()` registry helper. Phase 3.5+ routing reads them; Spec C reads `'session_identity'`.

### 10.2 Cost-model declaration — see §4.1

Every adapter declares `costModel`. V1 does not read it. Spec C cost surfaces and Phase 3.5+ cost-aware routing read it. Declared now so the adapters are self-describing for those specs without amendment.

### 10.3 Per-org backend preference — see §4.4

`organisations.preferred_backends jsonb DEFAULT '{}'`. **Schema-only in V1** — `executionBackendRegistry.resolve()` does not read it. The column exists so Phase 3.5+ adapter-variant routing has a populated migration to read against (spec C / future routing). The intended JSON shape is `{ executionMode: backendId }`; V1 always identity-resolves at the registry level so no consumer needs to read this column yet.

### Why include these in V1

Per `docs/spec-authoring-checklist.md` § 1, each is justified as an extension of an existing primitive (`agent_runs` table, organisation config, adapter registry) rather than a new primitive. Building them later means rewriting every adapter file, every cost-ledger consumer, and an organisation-level config migration in a future spec — versus three lines in each adapter file and one nullable column today.

---

## 11. Components affected

| Layer | File / module | Change |
|---|---|---|
| Types | `server/services/agentExecutionTypes.ts` (new) | Extract `TokenBudget` and `LoopResult` from `agentExecutionService.ts` (re-exported from there for backwards compatibility). Breaks the circular-import path between adapter types and the executor service — see § 4.1 *Neutral type file*. |
| Types | `server/services/executionBackends/types.ts` (new) | Define `ExecutionBackendId`, `ExecutionBackend`, `ExecutionCapability`, `CostModel`, `SandboxRequirement`, `BackendDispatchInput`, `BackendDispatchResult`, `BackendFinalisationInput`, `BackendFinalisationResult`, `BackendTerminalState`, plus typed errors `BackendOptionsMismatch`, `ParentRunNotDispatchable`, `BackendNotRegistered`, `BackendCapabilityViolation`, `BackendQueueOwnershipViolation`, `BackendTaskAlreadyClaimed`. **MUST NOT import from `agentExecutionService.ts`** — enforced by § 16 acceptance criterion. |
| Types | `server/services/executionBackends/options.ts` (new) | `BackendOptions` discriminated union. |
| Registry | `server/services/executionBackends/registry.ts` (new) | `ExecutionBackendRegistry` class + singleton export. |
| Adapter — api | `server/services/executionBackends/apiBackend.ts` (new) | Lifts `agentExecutionService.ts:1522–1632` body. |
| Adapter — headless | `server/services/executionBackends/headlessBackend.ts` (new) | Shares helper with api adapter. |
| Adapter — claude-code | `server/services/executionBackends/claudeCodeBackend.ts` (new) | Lifts `agentExecutionService.ts:1474–1521`. |
| Adapter — iee_browser | `server/services/executionBackends/ieeBrowserBackend.ts` (new) | Lifts `agentExecutionService.ts:1413–1473` (browser branch) + IEE `finalise`/`reconcile`. |
| Adapter — iee_dev | `server/services/executionBackends/ieeDevBackend.ts` (new) | Lifts the dev branch + shares finaliser logic with iee_browser. |
| Service — dispatch | `server/services/agentExecutionService.ts` | Replace lines 1408–1521 dispatch ladder with `executionBackendRegistry.resolve(effectiveMode).dispatch(input)`. Post-completion block stays for in-process / subprocess lifecycles. Delegated adapters' `dispatch()` writes `backend_id` + `backend_task_id` on the parent run as part of the same UPDATE that sets `status = 'delegated'` (see § 13.1.1). |
| Service — finaliser | `server/services/agentRunFinalizationService.ts` | Add `finaliseAgentRunFromBackend`. Keep `finaliseAgentRunFromIeeRun` as thin alias during transition; remove in cutover. |
| Service — reconciliation | `server/services/agentRunFinalizationService.ts` | Add `reconcileBackends`; existing `reconcileStuckDelegatedRuns` becomes alias for one phase, removed in cutover. |
| Schema | `server/db/schema/agentRuns.ts` | Add `backendId text` and `backendTaskId text` columns. No status enum change. |
| Schema | `server/db/schema/ieeRuns.ts` | Extend `iee_runs.failureReason` TS union to include `'parent_orphaned'` (§ 13.1.1). No SQL migration — text column. |
| Schema | `server/db/schema/organisations.ts` | Add `preferredBackends jsonb` column with `default '{}'`. |
| Migration | `migrations/<NNNN>_execution_backend_columns.sql` (new — number determined at land time per §18) | Two columns on `agent_runs`, one on `organisations`. Two partial indexes on `agent_runs` (one non-unique on `(backend_id)`, one unique on `(backend_id, backend_task_id)` per § 13.6). |
| Migration | `migrations/<NNNN>_execution_backend_columns.down.sql` (new — sibling file per repo convention) | Drops both indexes, drops the three columns. `IF EXISTS` guards on every statement. |
| Job handler | `server/jobs/ieeRunCompletedHandler.ts` | Internally delegate to `finaliseAgentRunFromBackend({ backendId: 'iee_browser' or 'iee_dev', backendTaskId })`. Behaviour unchanged. |
| Boot registration | `server/index.ts` | Register adapters in `executionBackendRegistry` immediately after the existing IEE handler registration block (lines 648–659). Sync, no I/O — see § 8.3. |
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
- `organisations.preferred_backends` is **not read by V1 code** (schema-only metadata; see § 4.4 / § 10.3). When Phase 3.5+ routing reads it, the read will be scoped by the organisation already loaded into the run context — no additional RLS work needed at that point either.
- `executionBackendRegistry.resolve()` does not bypass any guard. The dispatch site already checks `agent.allowedExecutionModes` and the policy envelope before calling resolve.

No opt-out documentation needed; no new tenant-scoped table.

---

## 13. Execution-safety contracts

Per `docs/spec-authoring-checklist.md` § 10:

### 13.1 Idempotency posture

| Operation | Posture | Mechanism |
|---|---|---|
| `dispatch()` for delegated backend (parent run → `'delegated'`) | **state-based + key-based** | Two-step contract — see § 13.1.1 for the exact ordering. (1) Backend task created/enqueued first with the adapter's idempotency key; existing IEE pattern uses `iee_runs.idempotency_key` UNIQUE — re-dispatch deduplicates onto the existing in-flight task. (2) Parent UPDATE: `WHERE agent_runs.id = ? AND status IN ('pending', 'running')`. 0-rows-affected on step 2 → adapter writes the orphan-cancellation row in step 3 (see below). |
| `finaliseAgentRunFromBackend()` | **state-based + key-based** | Existing IEE pattern preserved: parent row loaded `FOR UPDATE` via `loadParentRun(tx, ...)`; canonical row loaded `FOR UPDATE` via `loadTerminalState(tx, ...)`. The adapter's `finalise()` exits without writes only when BOTH `parentRun.status` is already terminal (∈ `TERMINAL_RUN_STATUSES` from `shared/runStatus.ts`) AND `terminalState.eventEmittedAt !== null` — see § 4.1 for the exact predicate. Any other state (parent in `'delegated'` / `'cancelling'`, eventEmittedAt null, etc.) is a normal first-completion path and the adapter writes through. Plus key on `iee_runs.id` (or future adapter's id). |
| `reconcile()` per adapter | **safe (read-only filter + idempotent finalisation)** | Reconciliation reads candidate rows then calls the same finaliser. Each call is state-based-idempotent. Re-running the cron is safe. Reconciliation MUST also filter out orphaned backend tasks (terminal-state row exists but parent is already terminal) — see § 13.1.1. |
| `cancel()` | **state-based** | Existing IEE pattern: writes `agent_runs.status = 'cancelling'`, then `iee_runs.status = 'cancelled'`. Worker's per-step check sees the cancel and exits. Re-cancel is no-op. |

#### 13.1.1 Delegated dispatch sequence — orphan-task contract

Two writes are needed to dispatch a delegated run: create the backend task and update the parent. They cannot happen atomically across the two storage systems (pg-boss + adapter table vs `agent_runs`). The adapter owns BOTH writes inside its `dispatch()` body — the dispatch-site caller (`agentExecutionService`) does not write to `agent_runs` for delegated lifecycles. The contract names the order and the orphan-cleanup behaviour:

1. **Step 1 — adapter creates / enqueues backend task.** The adapter's idempotency key is the existing per-adapter key (IEE: `iee_runs.idempotency_key` UNIQUE; future adapters declare their own). Re-dispatch with the same key dedupes onto the in-flight task and returns `{ deduplicated: true }` — see § 4.1 `BackendDispatchResult.deduplicated`. Step 1 happens BEFORE the parent UPDATE so a duplicate dispatch does not transiently widen the parent's `'running' → 'delegated'` window.
2. **Step 2 — adapter updates parent run** with `WHERE id = ? AND status IN ('pending', 'running') ... SET status = 'delegated', backend_id = ?, backend_task_id = ?` (and `iee_run_id` for the IEE adapter, which dual-writes — see § 3). The UPDATE happens inside the adapter's `dispatch()`, not in the caller. If 0 rows affected, the parent has already moved past the delegation window (terminal via cancellation race, etc.) and Step 3 fires.
3. **Step 3 (only on 0-rows Step 2) — adapter orphan cleanup, same `dispatch()` call.** The adapter writes the just-created backend task as orphaned in adapter storage (IEE: write `iee_runs.status = 'cancelled', failureReason = 'parent_orphaned'`). The adapter then either:
    - re-throws a `ParentRunNotDispatchable` typed error, OR
    - returns a `BackendDispatchResult` with `lifecycle: 'in_process'` and a `loopResult` indicating the run is already terminal (so the dispatch-site post-completion block is a no-op).
   The contract permits either; the IEE adapter throws (existing behaviour). The dispatch-site caller treats `ParentRunNotDispatchable` as a recoverable diagnostic — log + return — never a 5xx.
4. **Reconciliation rule.** `reconcile()` for any delegated adapter MUST skip backend-task rows whose parent `agent_runs.status` is already terminal. Filter via `WHERE NOT EXISTS (SELECT 1 FROM agent_runs WHERE agent_runs.id = backend_task.agent_run_id AND agent_runs.status IN ('completed', 'failed', 'cancelled', 'timeout', 'budget_exceeded'))`. Existing IEE reconciliation already filters this way.

The `'parent_orphaned'` failure reason is added to the IEE adapter's `failureReason` TS union as part of Chunk 3. No SQL migration needed (text column).

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
- **`finaliseAgentRunFromBackend()` from the event handler racing the cron.** Guard: parent agent_run loaded `FOR UPDATE` inside the transaction; canonical adapter-state row also loaded `FOR UPDATE`. First commit wins. The second commit's adapter `finalise()` then observes `parentRun.status` is already terminal AND `terminalState.eventEmittedAt !== null` (the first commit set both) — it returns the race-loser shape without writing per the § 4.1 predicate. Existing IEE behaviour preserved.
- **Two reconciliation cron ticks overlap.** Guard: pg-boss's `teamSize: 1, teamConcurrency: 1` on the `maintenance:backend-reconciliation` queue (same as current IEE cron). At most one tick at a time per process; multi-process safety is by way of the per-row `FOR UPDATE` lock inside finalisation.

Loser response in every case: silent no-op, with a `logger.debug` line for observability. No HTTP status involved (the conflicting flows are internal).

### 13.4 Terminal event guarantee

Each delegated adapter has exactly one terminal pg-boss event per backend task:

- `iee_browser` → `iee-run-completed`
- `iee_dev` → `iee-run-completed` (shared queue with `iee_browser` — see note)
- Future: `openclaw_managed` → `openclaw-run-completed`

**Shared-queue note (IEE):** the two IEE adapters share `iee-run-completed` because they share `iee_runs` storage. The handler routes by reading `iee_runs.type` from the loaded row, then derives `backendId` (`'browser' → 'iee_browser'`, `'dev' → 'iee_dev'`) before calling `finaliseAgentRunFromBackend`. Future adapters that share storage may share queues; the rule — *one queue per terminal-state table, not per adapter id* — is enforced declaratively via the `terminalStateTable` field on each delegated adapter (§ 4.1, § 8.2). A future adapter declaring `completedEventQueue: 'iee-run-completed'` with a different `terminalStateTable` value fails registration with `BackendQueueOwnershipViolation`.

**Reconciliation scoping for shared storage** — see § 9.2 *Shared-storage adapters and reconciliation scoping*. Each shared-storage adapter's `reconcile()` filters by the same discriminator used here for event-routing (`iee_runs.type`).

Post-terminal prohibition: the worker's `finalizeRun()` writes `iee_runs.eventEmittedAt = now()` after the event; the cleanup-orphan reconciliation never re-fires for rows where `eventEmittedAt IS NOT NULL && parent.status` is terminal. Existing behaviour.

### 13.5 No-silent-partial-success

Adapters return an explicit `BackendDispatchResult.lifecycle` value. A delegated adapter that fails to enqueue propagates the error up through `dispatch()`; it never returns `{ lifecycle: 'delegated', backendTaskId: null, ... }`. The adapter's `finalise()` writes both adapter-owned columns AND the parent `agent_runs` terminal UPDATE in the same transaction (see § 4.1); `BackendFinalisationResult.finalised` is true only after both writes have been issued through `input.tx`. Either both writes commit (caller commits the tx) or both roll back (caller rolls back). Caller cannot mistake a partial-finalise for success — there is no path where one row writes and the other does not.

### 13.6 Unique-constraint mapping

The migration adds two partial indexes on `agent_runs`:

- `agent_runs_backend_id_idx` — `(backend_id) WHERE backend_id IS NOT NULL`. **Non-unique** (multiple parent runs share an adapter). No HTTP mapping needed.
- `agent_runs_backend_task_unique_idx` — `(backend_id, backend_task_id) WHERE backend_task_id IS NOT NULL`. **Unique.** One backend task maps to exactly one parent agent_run. The IEE adapter's idempotent enqueue dedupes onto an existing in-flight task with the same parent, so this constraint cannot be tripped by normal flow; a `23505` violation indicates a programming error (two parent runs accidentally claimed the same backend task) and is mapped to a typed `BackendTaskAlreadyClaimed` diagnostic in `dispatch()`. No customer-visible HTTP mapping (the failure path bubbles up as a 5xx server error with the diagnostic — no V1 endpoint surfaces this directly).

The existing `iee_runs` unique constraints (idempotency key, primary key) are unchanged.

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

- Migration up: `migrations/<NNNN>_execution_backend_columns.sql` (NNNN determined at land time).
- Migration down: `migrations/<NNNN>_execution_backend_columns.down.sql` (sibling file per repo convention; every statement guarded by `IF EXISTS`).
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
  const backend = executionBackendRegistry.resolve(effectiveMode);
  const dispatchResult = await backend.dispatch({ /* mapped from request */ });
  if (dispatchResult.lifecycle === 'delegated') {
    // Adapter has already updated parent: status='delegated', backend_id, backend_task_id.
    // (See §13.1.1 — adapter writes both columns in the same UPDATE that transitions status.)
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

- `executionBackends/__tests__/contractPure.test.ts` — capability-validation rules, dispatch-result shape exhaustiveness, options union closure. Uses an in-memory mock adapter implementing every capability shape. Adds: (a) F5 mismatch invariant — `dispatch()` throws `BackendOptionsMismatch` when `input.backendOptions.backendId !== this.id` (positive + negative cases); (b) F3 no-circular-import check — module-source assertion that `types.ts` does not import from `agentExecutionService.ts`.
- `executionBackends/__tests__/registryPure.test.ts` — registration accepts valid adapters; rejects adapters declaring `'delegated'` without `loadTerminalState` / `finalise` / `reconcile` / `completedEventQueue` / `terminalStateTable`; rejects same-queue + different-`terminalStateTable` pairs (`BackendQueueOwnershipViolation`); resolves every `ExecutionMode` value to its registered adapter; rejects unregistered ids with `BackendNotRegistered`; against an in-memory mock that registers two adapters sharing one `terminalStateTable`, asserts each adapter's `reconcile()` returns a disjoint count (no double-processing).
- `agentRunFinalizationServicePure.test.ts` (existing) — mapping table coverage stays; calls renamed to `finaliseAgentRunFromBackend`. **Adds F2 legacy-fallback case:** fixture with `agent_runs.backend_id IS NULL` (pre-cutover in-flight run); IEE handler-equivalent path derives `backendId` from `iee_runs.type` and finalises correctly.

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
7. Boot-time validation rejects an adapter declaring `'delegated'` without `loadTerminalState` / `finalise` / `reconcile` / `completedEventQueue` / `terminalStateTable`, and rejects same-queue + different-`terminalStateTable` pairs as `BackendQueueOwnershipViolation` (asserted by registry pure test).
8. Cron `maintenance:backend-reconciliation` is registered post-deploy; cron `maintenance:iee-main-app-reconciliation` is unregistered.
9. `agent_runs.backend_id` and `agent_runs.backend_task_id` columns exist with the two partial indexes — non-unique on `(backend_id)`, **unique** on `(backend_id, backend_task_id) WHERE backend_task_id IS NOT NULL` (§ 13.6); `organisations.preferred_backends` exists with default `'{}'`.
10. `architecture.md § Execution modes` describes the registry pattern; `docs/openclaw-strategic-analysis.md` Phase 1 marker updated.
11. No regression on existing API / headless / claude-code execution paths (verified by integration tests + manual smoke).
12. **No-circular-import rule (F3):** `executionBackends/types.ts` does not import any symbol from `agentExecutionService.ts`. Asserted by a pure import-graph check at the top of `contractPure.test.ts` (`expect(typesModuleSource).not.toMatch(/from .+agentExecutionService/)`) and reviewed manually at PR time.
13. **Mismatch invariant (F5):** every adapter's `dispatch()` throws `BackendOptionsMismatch` when `input.backendOptions.backendId !== this.id`. Asserted by `contractPure.test.ts` against an in-memory mock adapter — both the positive case (matching id passes) and the negative case (mismatched id throws) are tested.
14. **Legacy in-flight fallback (F2):** the IEE handler path finalises a pre-cutover run with `agent_runs.backend_id IS NULL` correctly. Asserted by `agentRunFinalizationServicePure.test.ts` — fixture seeds an `iee_runs` row and an `agent_runs` parent with `backend_id` left NULL, calls the handler-equivalent code path, and verifies the parent terminal UPDATE writes the expected status.

---

## 17. Risks

1. **Refactoring the four existing modes into adapters is a "no behaviour change" claim — but each mode has subtle quirks.** *Mitigation:* Chunk 1 lands contract tests against an in-memory mock adapter *before* any real adapter ships. Chunk 3 lands the IEE adapter behind the existing dispatch (registered but not called from dispatch) so the IEE integration test continues to exercise the old path during the transition. Cutover (Chunk 5) is the only commit where behaviour can diverge; it is reviewed end-to-end against every existing test plus operator manual smoke.

2. **Cron rename causes duplicate scheduling.** *Mitigation:* Chunk 5 includes a boot-time `boss.unschedule('maintenance:iee-main-app-reconciliation')` call to clean up the old schedule entry. After one release cycle, the unschedule call is removed. Documented in Chunk 5 verifier.

3. **Per-org `preferred_backends` adds a JSONB column with implicit shape.** *Mitigation:* the column is **schema-only in V1** — no V1 code path reads it (registry resolution uses identity mapping). The column is documented in `architecture.md` as the intended `Map<ExecutionMode, ExecutionBackendId>` shape (request-side `executionMode` → resolved adapter variant id, e.g. `iee_dev → iee_dev` today, `openclaw → openclaw_managed` once Phase 3 lands). Phase 3.5+ routing introduces the Zod schema for the value at the same time it introduces the read; until then the column accepts only the default `'{}'` and any non-default writes are rejected at the API layer (no V1 endpoint writes this column).

4. **Two adapters (`iee_browser`, `iee_dev`) share `iee-run-completed` queue.** *Mitigation:* registry validation rejects adapters that share a queue without sharing storage; the rule is documented in §13.4. The existing IEE handler reads `iee_runs.type` to discriminate; this preserves today's behaviour.

5. **Spec scope creep — pull in routing now.** *Mitigation:* §19 routes routing policy + cost-aware dispatch to deferred items with explicit Phase 3.5+ reference. Reviewer is asked to flag any chunk that introduces routing-policy code as out of scope.

---

## 18. File inventory

**Modified:**
- `server/services/agentExecutionService.ts` (Chunk 5 — replaces dispatch ladder)
- `server/services/agentRunFinalizationService.ts` (Chunk 3 — adds `finaliseAgentRunFromBackend`, `reconcileBackends`)
- `server/db/schema/agentRuns.ts` (Chunk 2 — `backendId`, `backendTaskId` columns)
- `server/db/schema/ieeRuns.ts` (Chunk 3 — extend `failureReason` TS union with `'parent_orphaned'`; no SQL migration)
- `server/db/schema/organisations.ts` (Chunk 2 — `preferredBackends` column)
- `server/services/queueService.ts` (Chunk 5 — cron rename + unschedule)
- `server/jobs/ieeRunCompletedHandler.ts` (Chunk 3 — delegate to `finaliseAgentRunFromBackend`)
- `server/index.ts` (Chunks 3 + 4 — adapter registration block)
- `architecture.md` (Chunk 5 — § Execution modes update)
- `docs/openclaw-strategic-analysis.md` (Chunk 5 — Phase 1 complete marker)
- `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` (Chunk 5 — mark Decision 2 implemented)

**Created:**
- `server/services/agentExecutionTypes.ts` (extract `TokenBudget`, `LoopResult` so adapter types can import without cycling through `agentExecutionService.ts`)
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
- `migrations/<NNNN>_execution_backend_columns.sql` (NNNN determined at land time — currently main is at 0312; this lands at the next free number)
- `migrations/<NNNN>_execution_backend_columns.down.sql` (sibling file per repo convention — verified against existing migrations; every statement guarded by `IF EXISTS`)

**Deleted:** none in V1. Alias exports of `finaliseAgentRunFromIeeRun` and `reconcileStuckDelegatedRuns` are removed in Chunk 5; their underlying logic moves into the IEE adapter and the shared caller.

**Migrations:** one pair — `<NNNN>_execution_backend_columns.sql` + sibling `<NNNN>_execution_backend_columns.down.sql`. NNNN is determined at land time (currently main is at 0312; this lands at the next free number). Additive, nullable / defaulted, fully reversible.

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
