/**
 * executionBackends/options — closed discriminated union of per-adapter
 * dispatch options.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 4.2.
 *
 * Each adapter's `BackendDispatchInput.backendOptions` is a typed slot in
 * a closed union. Closed-set so that adding a backend forces a
 * TypeScript-level update at every dispatch caller. The contract has no
 * implicit "any" path.
 *
 * The discriminant `backendId` MUST equal the resolving adapter's
 * `ExecutionBackend.id`. Mismatch is rejected by every adapter's
 * `dispatch()` first statement with `BackendOptionsMismatch` (spec § 4.1
 * invariant). In V1 every adapter id is also a current `ExecutionMode`
 * value so the discriminant is typed as `ExecutionMode`; future adapters
 * whose id diverges from `executionMode` (per spec § 4.3 *Adapter selector
 * precedence*) extend this union and the discriminant type widens
 * accordingly.
 *
 * Imports allowed:
 *   - `import type` from `shared/types/executionEnvironment` (`ExecutionMode`)
 *   - `import type` from `shared/iee/jobPayload` (`BrowserTaskPayload` /
 *     `DevTaskPayload`) — the canonical source of the IEE task contract,
 *     also re-imported by `server/services/ieeExecutionService.ts`.
 *   - `import type` from `../agentExecutionLoop.js` (`LoopParams`) — the
 *     in-process / subprocess closure-context fields that the api / headless
 *     adapters need but `BackendDispatchInput` does not carry. Type-only —
 *     erased by the TypeScript compiler so no runtime import cycle is
 *     introduced. See spec § 14 Chunk 5 *Cutover* for the rationale.
 */

import type { ExecutionMode } from '../../../shared/types/executionEnvironment.js';
import type {
  BrowserTaskPayload,
  DevTaskPayload,
} from '../../../shared/iee/jobPayload.js';
import type { LoopParams } from '../agentExecutionLoop.js';
import type { AgentRunRequest } from '../agentExecutionService.js';

/**
 * Source of the run as recorded on `agent_runs.run_source`. The api /
 * headless dispatch paths thread this through to attribution / analytics;
 * other adapters do not require it.
 */
export type RunSource =
  | 'manual'
  | 'scheduled'
  | 'handoff'
  | 'sub_agent';

/**
 * Closure-context fields the api / headless adapters need beyond what
 * `BackendDispatchInput` carries. Lifted from the `executeRun` outer scope
 * in `agentExecutionService.ts` and threaded through the adapter so the
 * adapter can rebuild the full `LoopParams` for `runAgenticLoop`.
 *
 * Type-only: this entire bundle is erased at runtime by the call site,
 * which builds the object inline from its own closure variables. The shape
 * is derived from `LoopParams` so any change to the loop's parameter list
 * propagates here automatically (TypeScript will error at the dispatch
 * site if a field is missing).
 *
 * Carried on `ApiBackendOptions.loopContext` and
 * `HeadlessBackendOptions.loopContext`. Spec § 14 Chunk 5.
 */
export type ApiHeadlessLoopContext = Pick<
  LoopParams,
  | 'agent'
  | 'routerCtx'
  | 'tools'
  | 'maxLoopIterations'
  | 'startTime'
  | 'request'
  | 'orgProcesses'
  | 'saLink'
  | 'pipeline'
  | 'mcpClients'
  | 'mcpLazyRegistry'
  | 'runContextData'
  | 'isOrgSubaccountRun'
  | 'agentDomain'
  | 'hierarchyContext'
  | 'configVersion'
>;

/** `backendId: 'api'` — in-process agentic loop, default path. */
export interface ApiBackendOptions {
  backendId: Extract<ExecutionMode, 'api'>;
  runSource: RunSource;
  /**
   * Optional explicit subset of tool slugs the dispatch path is allowed
   * to expose for this run. Mirrors the existing api-branch behaviour;
   * undefined means "use the resolved set as-is".
   */
  allowedToolSlugs?: string[];
  /**
   * Loop-runtime context the dispatch site forwards to the adapter. See
   * `ApiHeadlessLoopContext` for the field list. Spec § 14 Chunk 5.
   */
  loopContext: ApiHeadlessLoopContext;
}

/** `backendId: 'headless'` — headless config variant of the api path. */
export interface HeadlessBackendOptions {
  backendId: Extract<ExecutionMode, 'headless'>;
  runSource: RunSource;
  allowedToolSlugs?: string[];
  /**
   * Loop-runtime context the dispatch site forwards to the adapter. See
   * `ApiHeadlessLoopContext` for the field list. Spec § 14 Chunk 5.
   */
  loopContext: ApiHeadlessLoopContext;
}

/**
 * Closure-context fields the claude-code adapter needs beyond what
 * `BackendDispatchInput` carries. The runner invocation requires the
 * resolved task prompt (the existing inline branch derives it from the
 * workspace context) and the parent run id is already on
 * `BackendDispatchInput.runId`.
 *
 * Spec § 14 Chunk 5.
 */
export interface ClaudeCodeLoopContext {
  /**
   * Task prompt forwarded to the Claude Code runner. Today the dispatch
   * site builds this from `workspaceContext` with a default fallback when
   * the workspace is empty — the adapter consumes the resolved string.
   */
  taskPrompt: string;
  /**
   * Parent `AgentRunRequest`. Carried so the adapter can read the
   * subaccount id when it needs to resolve the dev-execution context for
   * the cwd default. Stays alongside the prompt rather than re-deriving
   * the request from the runId.
   */
  request: AgentRunRequest;
}

/** `backendId: 'claude-code'` — subprocess invocation of the Claude Code runner. */
export interface ClaudeCodeBackendOptions {
  backendId: Extract<ExecutionMode, 'claude-code'>;
  /**
   * Working directory the Claude Code subprocess executes in. Optional —
   * defaults to the dispatch site's resolved cwd when omitted.
   */
  cwd?: string;
  /**
   * Loop-runtime context the dispatch site forwards to the adapter. See
   * `ClaudeCodeLoopContext` for the field list. Spec § 14 Chunk 5.
   */
  loopContext: ClaudeCodeLoopContext;
}

/** `backendId: 'iee_browser'` — delegated browser task to the IEE worker. */
export interface IeeBrowserBackendOptions {
  backendId: Extract<ExecutionMode, 'iee_browser'>;
  /** Validated `BrowserTaskPayload` — see shared/iee/jobPayload.ts § 6.7.1. */
  ieeTask: BrowserTaskPayload;
}

/** `backendId: 'iee_dev'` — delegated dev task to the IEE worker. */
export interface IeeDevBackendOptions {
  backendId: Extract<ExecutionMode, 'iee_dev'>;
  /** Validated `DevTaskPayload` — see shared/iee/jobPayload.ts. */
  ieeTask: DevTaskPayload;
}

/** `backendId: 'operator_managed'` — delegated operator-session chain link. */
export interface OperatorManagedBackendOptions {
  backendId: Extract<ExecutionMode, 'operator_managed'>;
}

/**
 * Closed discriminated union of per-adapter dispatch options.
 *
 * Adding a new backend MUST extend this union AND update every dispatch
 * caller's switch / `if` ladder — the closed shape is intentional so that
 * the TypeScript checker enforces the update.
 */
export type BackendOptions =
  | ApiBackendOptions
  | HeadlessBackendOptions
  | ClaudeCodeBackendOptions
  | IeeBrowserBackendOptions
  | IeeDevBackendOptions
  | OperatorManagedBackendOptions;
