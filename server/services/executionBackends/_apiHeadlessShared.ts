/**
 * _apiHeadlessShared — internal helper consumed by `apiBackend.ts` and
 * `headlessBackend.ts`.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 7
 *       *api/headless shared body*; plan.md Chunk 4 (file inventory).
 *
 * The two existing modes share the same physical dispatch path today.
 * `headless` is a configuration variant of the in-process agentic loop, not
 * a separate runtime — both register as distinct adapter ids so
 * `executionMode = 'headless'` resolves correctly, but they wrap the same
 * shared body parameterised by mode (today the only per-adapter delta is
 * the trace-metadata `executionMode` value).
 *
 * Cycle prevention — same rule as `executionBackends/types.ts`: this file
 * MUST NOT import from `agentExecutionService.ts`. The agentic loop entry
 * point lives in `agentExecutionLoop.ts`, the neutral sibling extracted in
 * Chunk 4 specifically to break the future
 * `agentExecutionService → registry → apiBackend → agentExecutionService`
 * cycle.
 *
 * Status — Chunk 4 (this commit):
 *   The dispatch ladder in `agentExecutionService.ts` is **not yet routed
 *   through the registry** (Chunk 5 does that). For now, this helper holds
 *   the in-process / api-headless dispatch contract surface, and the
 *   adapter wrappers register at boot. The actual body wiring — building
 *   the full `LoopParams` from `BackendDispatchInput` plus the
 *   dispatch-site context (`agent`, `pipeline`, `mcpClients`, etc.) — is
 *   the work of Chunk 5, which restructures the dispatch site so the
 *   adapter has access to everything `runAgenticLoop` needs.
 *
 *   In Chunk 4 the helper throws an explicit "not yet wired" error if
 *   reached at runtime. The dispatch ladder still routes api / headless /
 *   claude-code to the inline branches in `agentExecutionService.ts`, so
 *   this throw is unreachable in production until Chunk 5 lands.
 */

import type { ExecutionMode } from '../../../shared/types/executionEnvironment.js';
import type {
  BackendDispatchInput,
  BackendDispatchResult,
} from './types.js';

type ApiHeadlessMode = Extract<ExecutionMode, 'api' | 'headless'>;

interface SharedDispatchArgs {
  /** The adapter's own id; used in trace metadata + for the not-yet-wired diagnostic. */
  mode: ApiHeadlessMode;
  input: BackendDispatchInput;
}

/**
 * Shared in-process agentic-loop dispatch body.
 *
 * Lifted from `agentExecutionService.ts:1522–1632` (the default branch
 * that wraps `runAgenticLoop` with langfuse tracing and finalises the
 * trace inline).
 *
 * **Chunk 4 placeholder.** The real body needs more context than
 * `BackendDispatchInput` carries today (`agent`, `effectiveTools`,
 * `pipeline`, `mcpClients`, `runContextData`, …). Chunk 5 restructures
 * the dispatch site so the adapter can rebuild that context from the
 * runId and the resolved request, and replaces this throw with the real
 * `runAgenticLoop` invocation.
 *
 * Until Chunk 5 lands the dispatch ladder still routes `api` / `headless`
 * to the inline branch in `agentExecutionService.ts`, so this function
 * is unreachable in production. The throw is the contract: callers that
 * stumble onto this path before Chunk 5 wiring is complete fail loudly
 * rather than silently no-op.
 */
export async function apiHeadlessDispatch(
  args: SharedDispatchArgs,
): Promise<BackendDispatchResult> {
  const { mode, input } = args;

  // Defensive: this helper is only callable through `apiBackend` /
  // `headlessBackend`, both of which already pin the mismatch check
  // before reaching here. The redundant assertion is intentional — if a
  // future caller misses the per-adapter check we still surface the
  // diagnostic loudly rather than silently advance to the not-yet-wired
  // throw.
  if (input.backendOptions.backendId !== mode) {
    throw new Error(
      `apiHeadlessDispatch: mode '${mode}' received backendOptions ` +
        `for '${input.backendOptions.backendId}'. The adapter's per-mode ` +
        `mismatch guard should have rejected this before dispatch.`,
    );
  }

  // The real `runAgenticLoop` invocation lands in Chunk 5 alongside the
  // dispatch-site cutover. Until then, throwing keeps the contract honest:
  // every dispatch path reaches a defined code path, and any caller
  // accidentally racing ahead of Chunk 5 fails loudly. Spec § 14 Chunk 5
  // is the locus for the actual wiring.
  throw new Error(
    `${mode}Backend.dispatch is not yet wired — Chunk 5 of the ` +
      `ExecutionBackend Adapter Contract refactor cuts over the ` +
      `dispatch ladder. Until then, in-process dispatch continues ` +
      `through the inline branch in agentExecutionService.ts.`,
  );
}
