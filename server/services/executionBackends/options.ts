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
 */

import type { ExecutionMode } from '../../../shared/types/executionEnvironment.js';
import type {
  BrowserTaskPayload,
  DevTaskPayload,
} from '../../../shared/iee/jobPayload.js';

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
}

/** `backendId: 'headless'` — headless config variant of the api path. */
export interface HeadlessBackendOptions {
  backendId: Extract<ExecutionMode, 'headless'>;
  runSource: RunSource;
  allowedToolSlugs?: string[];
}

/** `backendId: 'claude-code'` — subprocess invocation of the Claude Code runner. */
export interface ClaudeCodeBackendOptions {
  backendId: Extract<ExecutionMode, 'claude-code'>;
  /**
   * Working directory the Claude Code subprocess executes in. Optional —
   * defaults to the dispatch site's resolved cwd when omitted.
   */
  cwd?: string;
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
  | IeeDevBackendOptions;
