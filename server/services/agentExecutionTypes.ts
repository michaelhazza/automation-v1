/**
 * agentExecutionTypes — neutral type-only module.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 4.1
 * "Neutral type file (`agentExecutionTypes.ts`)".
 *
 * Pure type aliases lifted out of `agentExecutionService.ts` so that
 * `executionBackends/types.ts` can describe the dispatch / loop contract
 * without importing the impure service module. Without this extraction the
 * import graph cycles:
 *
 *   executionBackends/types.ts
 *      -> agentExecutionService.ts
 *      -> executionBackends/registry.ts (after Chunk 5)
 *      -> executionBackends/types.ts
 *
 * With the extraction both `agentExecutionService.ts` and
 * `executionBackends/types.ts` import from this neutral file, breaking the
 * cycle.
 *
 * Invariants:
 *   - Type aliases only; no runtime code, no values exported.
 *   - No imports from `services/`. Schema imports are permitted as
 *     `import type` from `server/db/schema/*` if a relocated alias requires
 *     them (none today).
 *   - Adding a value here is a spec amendment — the file must remain
 *     side-effect-free so contract code can depend on it without pulling in
 *     env / db / runtime services.
 */

/**
 * Token budget allocated to a single agent run loop. Today this is a plain
 * count of LLM tokens; the alias exists so the contract surface
 * (`BackendDispatchInput.tokenBudget`) can refer to a stable name and so
 * future refinement (e.g. `{ input: number; output: number }`) does not
 * cascade through every consumer.
 */
export type TokenBudget = number;

/**
 * Resolved system-prompt shape consumed by the agentic loop. Mirrors the
 * inline `string | { stablePrefix: string; dynamicSuffix: string }` shape
 * the loop accepts today (cache-aware split form for prompt-cache hit
 * rates, plain string for the simple path).
 */
export type PromptAssembly =
  | string
  | { stablePrefix: string; dynamicSuffix: string };

/**
 * Outcome of a single in-process / subprocess loop execution. Relocated
 * verbatim from `agentExecutionService.ts` so the dispatch contract
 * (`BackendDispatchResult.loopResult`) can reference the same shape that
 * post-completion finalisation already consumes.
 *
 * Field names are the source of truth; do NOT rename fields here without
 * also updating the corresponding consumer in `agentExecutionService.ts`.
 */
export interface LoopResult {
  summary: string | null;
  toolCallsLog: object[];
  totalToolCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tasksCreated: number;
  tasksUpdated: number;
  deliverablesCreated: number;
  finalStatus?: string;
}
