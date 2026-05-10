/**
 * executionBackends/types — ExecutionBackend adapter contract surface.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 4.1
 * (interface), § 4.3 (source-of-truth precedence), § 8 (registry contract).
 *
 * Every per-run execution backend (api, headless, claude-code, iee_browser,
 * iee_dev today; OpenClaw and others later) implements the
 * `ExecutionBackend` shape declared here. Dispatch in
 * `agentExecutionService.ts` becomes a registry lookup against this contract
 * once Chunk 5 lands; in Chunk 1 the contract exists alongside the existing
 * if/else ladder and is exercised only by the pure tests.
 *
 * Cycle prevention — HARD RULE:
 *   This module MUST NOT import any symbol from
 *   `server/services/agentExecutionService.ts`. The neutral file
 *   `server/services/agentExecutionTypes.ts` is the dependency for
 *   `LoopResult` / `TokenBudget` / `PromptAssembly`. The rule is asserted
 *   by a module-source check at the top of `__tests__/contractPure.test.ts`
 *   and by acceptance criterion § 16 #12 of the spec.
 *
 * Imports allowed: zod (for `ZodSchema` typing) and `import type` from
 *   - `server/db/schema/agentRuns`
 *   - `server/db/schema/ieeRuns`
 *   - `server/db/index` (`Transaction`)
 *   - `server/services/agentExecutionTypes`
 */

import type { ZodSchema } from 'zod';

import type { Transaction } from '../../db/index.js';
import type {
  LoopResult,
  PromptAssembly,
  TokenBudget,
} from '../agentExecutionTypes.js';

/**
 * The full closed-union shape lives in `./options.ts`. Imported as a type
 * here (and re-exported) so consumers can import a single name from this
 * module without reaching for both files. Re-export is type-only — there
 * is no runtime symbol crossing the boundary.
 */
import type { BackendOptions } from './options.js';
export type { BackendOptions };

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * In-memory key the registry resolves on. Forward-compat superset of
 * `ExecutionMode` so that future internal-variant adapters
 * (`'openclaw_managed'`, `'openclaw_external'`, …) can register without
 * forcing a contract-wide rename of every dispatch caller.
 *
 * **V1 invariant:** every registered `id` is also a current `ExecutionMode`
 * value. The OpenClaw values are forward-compat type slots only; their
 * adapters land in Phase 3. Runtime registration of an OpenClaw id is
 * rejected by the registry in V1 with `BackendCapabilityViolation`.
 *
 * Typed as `string` rather than a closed union of literal strings so the
 * contract has a stable public surface that does not need to change every
 * time a new internal adapter id is reserved. Validity is enforced at
 * registration time (registry — § 8.2) and at dispatch time
 * (`backendOptions.backendId === backend.id` — § 4.1 invariant).
 */
export type ExecutionBackendId = string;

// ---------------------------------------------------------------------------
// Capability / cost / sandbox metadata declarations
// ---------------------------------------------------------------------------

/**
 * Capability declarations describe what an adapter supports beyond bare
 * dispatch. Routing, observability, and downstream specs read these tags
 * rather than introspecting the adapter's id. Closed set — adding a value
 * is a spec amendment.
 *
 * The seven values listed here are the ones the V1 contract names directly.
 * Future extensions (`'streaming'`, `'long_running'`, `'session_identity'`)
 * are listed in spec § 4.1 and can be added when the corresponding
 * downstream consumer lands; the registry's capability validation (§ 8.2)
 * only enforces presence-when-declared, never absence-when-undeclared.
 */
export type ExecutionCapability =
  | 'in_process'           // Adapter executes synchronously in the main app process.
  | 'delegated'            // Adapter dispatches to a backend; parent parks in 'delegated'.
  | 'subprocess'           // Adapter spawns a local subprocess and waits for exit.
  | 'browser_automation'   // Adapter drives a Playwright session (Tier 3).
  | 'code_execution'       // Adapter executes LLM-derived code (Tier 4). Sandbox required.
  | 'terminal_repo'        // Adapter has filesystem + git access (Tier 5).
  | 'cancellation';        // Adapter implements cancel(); cancellation is best-effort otherwise.

/**
 * How the adapter's execution maps to the cost ledger. Consumed by Spec C
 * cost surfaces; declared now so the schema does not need a backfill later.
 */
export type CostModel = 'per_token' | 'subscription' | 'none';

/**
 * What environment primitive the adapter requires at runtime. Consumed by
 * Spec B (Sandbox). V1 validation only checks the value is a known enum
 * member; an adapter declaring `'code_execution'` registers cleanly even
 * though no Sandbox executor primitive is wired up yet.
 */
export type SandboxRequirement =
  | 'none'
  | 'browser'
  | 'code_execution'
  | 'terminal_repo';

// ---------------------------------------------------------------------------
// Dispatch input / output
// ---------------------------------------------------------------------------

/**
 * Input shape every adapter's `dispatch()` receives. Identical fields to
 * the existing `runAgenticLoop` parameter list — the dispatch contract
 * does not invent new inputs, it just relocates them behind a stable
 * named seam.
 */
export interface BackendDispatchInput {
  /** Parent agent_run row id. Always set. */
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  /** Resolved system prompt — same shape today's runAgenticLoop receives. */
  promptAssembly: PromptAssembly;
  tokenBudget: TokenBudget;
  /** Hard cap; always populated by the dispatch site, which resolves defaults before calling dispatch. */
  maxToolCalls: number;
  /** Wall-clock cap in ms; always populated by the dispatch site, which resolves defaults before calling dispatch. */
  timeoutMs: number;
  /** Backend-specific options. Discriminated union per adapter. */
  backendOptions: BackendOptions;
}

/**
 * Result every adapter's `dispatch()` returns.
 *
 * Lifecycle classification drives whether finalisation is inline (the
 * existing post-completion block consumes `loopResult`) or via the
 * delegated path (the parent run parks in `'delegated'` and the terminal
 * pg-boss event triggers `finaliseAgentRunFromBackend` later).
 */
export interface BackendDispatchResult {
  lifecycle: 'in_process' | 'delegated' | 'subprocess';
  /**
   * Backend-side task identifier (e.g. `iee_runs.id`). Set for delegated
   * and subprocess adapters that produce a stable backend reference; null
   * for in-process adapters that finalise synchronously.
   */
  backendTaskId: string | null;
  /**
   * Loop result for in-process / subprocess adapters that finalise inline.
   * Null for delegated adapters — their finalisation happens later via
   * the event handler.
   */
  loopResult: LoopResult | null;
  /** True when an idempotent enqueue collapsed onto a pre-existing in-flight task. */
  deduplicated: boolean;
}

// ---------------------------------------------------------------------------
// Delegated lifecycle — terminal-state + finalisation contracts
// ---------------------------------------------------------------------------

/**
 * Adapter-agnostic view of the backend's canonical terminal-state row.
 * Returned by `loadTerminalState`; consumed by `finalise`.
 *
 * Mandatory fields drive shared idempotency / orchestration. The adapter
 * is required to populate `raw` so its own `finalise()` can read columns
 * the structural type does not name (e.g., the IEE adapter reads cost
 * columns and `type` from `raw`). Other consumers MUST NOT reach into
 * `raw` — it is opaque to everything except the owning adapter.
 */
export interface BackendTerminalState {
  /** Foreign key to the parent `agent_runs.id`. Mandatory. */
  agentRunId: string;
  /** The backend's own row id (same as `backendTaskId`). Mandatory. */
  backendTaskId: string;
  /**
   * Closed-set adapter-side status. The shared finaliser does NOT read
   * this directly; the adapter maps it to `agent_runs.status` inside
   * `finalise()`. Strings are adapter-specific (e.g., IEE: `'pending' |
   * 'running' | 'completed' | 'failed' | 'cancelled'`).
   */
  status: string;
  /** Adapter-side failure reason (closed set per adapter). Null on success. */
  failureReason: string | null;
  /** Wall-clock terminal time on the backend side. Null if not yet terminal. */
  completedAt: Date | null;
  /**
   * Set non-null by the adapter once the terminal pg-boss event has been
   * emitted (or by the reconciler when it discovers a row whose event was
   * missed). Used by the shared idempotency check (§ 13.1): if
   * `parentRun.status` is already terminal AND `eventEmittedAt !== null`,
   * `finalise()` returns the race-loser shape without writing.
   */
  eventEmittedAt: Date | null;
  /** Optional human-readable summary; populated for completed runs. */
  resultSummary: unknown;
  /**
   * Opaque slot for the adapter's own row. Adapters cast to their real row
   * type inside `finalise()`. Other consumers MUST NOT reach into `raw`.
   */
  raw: unknown;
}

/**
 * Input shape every delegated adapter's `finalise()` receives.
 *
 * `tx` is caller-owned. The adapter MUST use this transaction for any DB
 * writes; it MUST NOT open its own transaction. The caller (the shared
 * `finaliseAgentRunFromBackend` orchestrator) commits or rolls back
 * atomically across the adapter writes and the parent-run terminal
 * UPDATE.
 *
 * `parentRun` is loosely typed as `{ id, status, ... }` rather than the
 * full `agentRuns.$inferSelect` to keep this module decoupled from the
 * Drizzle schema's row type. The adapter's `finalise()` body knows the
 * exact shape (it lifts existing finaliser code) and reads what it needs.
 */
export interface BackendFinalisationInput {
  /** Caller-owned transaction; adapter writes through this handle. */
  tx: Transaction;
  /** The backend's terminal-state row, however the adapter persists it. */
  terminalState: BackendTerminalState;
  /**
   * Re-loaded from DB at finaliser entry under `FOR UPDATE`. NEVER trust
   * the event-payload data — the orchestrator has already loaded the
   * canonical row from `loadTerminalState` and the parent from
   * `loadParentRun`.
   */
  parentRun: { id: string; status: string; [key: string]: unknown };
}

/**
 * Result every delegated adapter's `finalise()` returns.
 *
 * `finalised: false` is the race-loser path (parent already terminal AND
 * `eventEmittedAt` already set). The orchestrator commits an empty tx in
 * that case.
 */
export interface BackendFinalisationResult {
  finalised: boolean;
  /**
   * The parent terminal status the adapter wrote (or observed already-set
   * on the race-loser path). Returned for observability only — the
   * adapter has already issued the UPDATE through `input.tx`.
   */
  parentTerminalStatus: string;
}

// ---------------------------------------------------------------------------
// Reserved (Phase 3+) — streaming-capability placeholder types
// ---------------------------------------------------------------------------

/**
 * Mid-run progress event shape. Reserved for the deferred `'streaming'`
 * capability (spec § 19). V1 implementations leave `subscribe` undefined;
 * the placeholder type is `unknown` until the streaming spec lands.
 */
export type BackendProgressEvent = unknown;

/**
 * Unsubscribe handle returned by the future streaming capability. Stable
 * placeholder so the contract surface does not change shape when streaming
 * lands — only the body of `BackendProgressEvent` refines.
 */
export type UnsubscribeFn = () => void;

// ---------------------------------------------------------------------------
// ExecutionBackend interface
// ---------------------------------------------------------------------------

/**
 * The contract every per-run execution backend implements. One interface
 * with optional methods gated by `capabilities` (rather than three
 * lifecycle interfaces with a discriminated union) — see spec § 4.1
 * "Why a single ExecutionBackend interface" for the rationale.
 *
 * Capability gating is enforced at registration time (§ 8.2):
 *   - `'delegated'` declared -> `completedEventQueue`, `terminalStateTable`,
 *     `completedEventPayload`, `loadTerminalState`, `finalise`, `reconcile`
 *     are all required.
 *   - `'cancellation'` declared -> `cancel` is required.
 *
 * Dispatch invariant — first statement of every adapter's `dispatch()`:
 *   if (input.backendOptions.backendId !== this.id) {
 *     throw new BackendOptionsMismatch(this.id, input.backendOptions.backendId);
 *   }
 *
 * The check exists because a mismatch indicates the caller resolved one
 * adapter and built options for another — a programming error that must
 * fail loudly, not silently.
 */
export interface ExecutionBackend {
  // === Identity ===
  readonly id: ExecutionBackendId;
  readonly capabilities: readonly ExecutionCapability[];
  readonly costModel: CostModel;
  readonly sandboxRequirement: SandboxRequirement;

  // === Dispatch (mandatory) ===
  dispatch(input: BackendDispatchInput): Promise<BackendDispatchResult>;

  // === Delegated lifecycle (mandatory iff capabilities includes 'delegated') ===

  /** Pg-boss queue for this adapter's terminal event. Null for non-delegated. */
  readonly completedEventQueue?: string;
  /**
   * Name of the canonical terminal-state table this adapter owns. Used by
   * registry validation to enforce "adapters sharing a queue MUST share
   * storage" (§ 13.4 / § 8.2).
   */
  readonly terminalStateTable?: string;
  /** Zod schema for the terminal event payload. Validated by the handler. */
  readonly completedEventPayload?: ZodSchema;
  /**
   * Load the adapter's canonical terminal-state row inside the
   * caller-owned transaction. MUST take a row-level lock (`FOR UPDATE`)
   * so the shared finaliser can serialise concurrent handler+cron entry
   * on the same row. Returns null when the row does not exist.
   */
  loadTerminalState?(
    tx: Transaction,
    backendTaskId: string,
  ): Promise<BackendTerminalState | null>;
  /**
   * Apply the adapter's backend-specific terminal mapping AND write the
   * parent `agent_runs` terminal UPDATE — both inside `input.tx`. MUST NOT
   * open its own transaction. Idempotency: if `parentRun.status` is
   * already terminal AND `terminalState.eventEmittedAt !== null`, MUST
   * return `{ finalised: false, ... }` without writing.
   */
  finalise?(
    input: BackendFinalisationInput,
  ): Promise<BackendFinalisationResult>;
  /**
   * Reconciliation entry point. Returns count transitioned. Called once
   * per cron tick. Must be idempotent and finite (LIMIT 100).
   */
  reconcile?(): Promise<number>;

  // === Optional — Phase 3+ ===

  /** Cancellation. Best-effort; no-op for adapters without native cancel. */
  cancel?(input: {
    runId: string;
    backendTaskId: string | null;
  }): Promise<void>;
  /**
   * Mid-run progress subscription. Reserved for streaming. Not called in
   * V1; placeholder shape only.
   */
  subscribe?(runId: string): {
    events: AsyncIterable<BackendProgressEvent>;
    unsubscribe: UnsubscribeFn;
  };
}

// ---------------------------------------------------------------------------
// Typed errors
//
// Throwing strings is forbidden — every registry / dispatch error path is
// a typed class so callers can `instanceof`-narrow without parsing
// messages.
// ---------------------------------------------------------------------------

/**
 * Thrown by every adapter's `dispatch()` when
 * `input.backendOptions.backendId !== this.id`. Indicates the caller
 * resolved one adapter and built options for another — a programming
 * error that must fail loudly.
 */
export class BackendOptionsMismatch extends Error {
  readonly expectedId: string;
  readonly actualId: string;
  constructor(expectedId: string, actualId: string) {
    super(
      `BackendOptionsMismatch: adapter '${expectedId}' received options for '${actualId}'. ` +
        `Caller resolved a different adapter than the one whose options were built.`,
    );
    this.name = 'BackendOptionsMismatch';
    this.expectedId = expectedId;
    this.actualId = actualId;
  }
}

/**
 * Thrown by an adapter's `dispatch()` when the parent agent_run row is
 * already terminal at the moment the parent UPDATE attempts to transition
 * it to `'delegated'` — see § 13.1.1 step 3 (orphan-cleanup path). The
 * adapter will have already written the orphan-cleanup row on its
 * backend-side table before throwing.
 */
export class ParentRunNotDispatchable extends Error {
  readonly runId: string;
  readonly reason: string;
  constructor(runId: string, reason: string) {
    super(`ParentRunNotDispatchable: run ${runId} — ${reason}`);
    this.name = 'ParentRunNotDispatchable';
    this.runId = runId;
    this.reason = reason;
  }
}

/**
 * Thrown by `executionBackendRegistry.resolve(id)` when no adapter has
 * been registered for the given id. Callers narrow on the throw, never on
 * a sentinel `undefined` return.
 */
export class BackendNotRegistered extends Error {
  readonly id: string;
  constructor(id: string) {
    super(
      `BackendNotRegistered: no adapter registered for id '${id}'. ` +
        `Boot-time registration in server/index.ts MUST run before any ` +
        `pg-boss worker consumes a terminal event or reconciliation tick.`,
    );
    this.name = 'BackendNotRegistered';
    this.id = id;
  }
}

/**
 * Thrown by the registry at registration time when an adapter declares a
 * capability without supplying the methods that capability requires
 * (e.g., `'delegated'` without `loadTerminalState`/`finalise`/`reconcile`).
 */
export class BackendCapabilityViolation extends Error {
  constructor(message: string) {
    super(`BackendCapabilityViolation: ${message}`);
    this.name = 'BackendCapabilityViolation';
  }
}

/**
 * Thrown by the registry when two adapters declare the same
 * `completedEventQueue` but different `terminalStateTable` values.
 *
 * Same-queue + different-storage is a contract violation: the queue's
 * single consumer (the shared event handler) cannot dispatch to two
 * disjoint tables without bespoke routing logic, which defeats the
 * abstraction. Same-queue + same-storage is the supported case (e.g.,
 * `iee_browser` and `iee_dev` both share `iee_runs`).
 */
export class BackendQueueOwnershipViolation extends Error {
  constructor(message: string) {
    super(`BackendQueueOwnershipViolation: ${message}`);
    this.name = 'BackendQueueOwnershipViolation';
  }
}

/**
 * Thrown by an adapter's `dispatch()` when the unique `(backend_id,
 * backend_task_id)` partial index rejects the parent UPDATE because
 * another in-flight run already claimed the same backend task. Surfaces
 * the underlying `23505` constraint violation as a typed error so callers
 * can treat it as a logical "already claimed" case rather than a generic
 * DB error.
 */
export class BackendTaskAlreadyClaimed extends Error {
  readonly backendId: string;
  readonly backendTaskId: string;
  constructor(backendId: string, backendTaskId: string) {
    super(
      `BackendTaskAlreadyClaimed: backend '${backendId}' task '${backendTaskId}' is already claimed by another in-flight agent_run.`,
    );
    this.name = 'BackendTaskAlreadyClaimed';
    this.backendId = backendId;
    this.backendTaskId = backendTaskId;
  }
}
