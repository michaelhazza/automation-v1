/**
 * Processor hooks — per-tool input/output processing pipeline.
 *
 * Unlike the run-level MiddlewarePipeline (which fires once per loop iteration),
 * ProcessorHooks attach to individual tool definitions and fire around each
 * individual tool dispatch.
 *
 * Phases:
 *   processInput      — fires before gate evaluation; can transform or reject input
 *   processInputStep  — fires after gate approval, just before execution
 *   processOutputStep — fires after execution; can sanitise or augment output
 *
 * Any phase can throw a TripWire to abort execution (fatal or soft).
 */

export interface ProcessorContext {
  toolSlug: string;
  input: unknown;
  subaccountId: string;
  organisationId: string;
  agentRunId: string;
  actionId?: string;
}

export interface ProcessorHooks {
  /**
   * Phase 1 — runs before gate evaluation.
   * Return (potentially modified) input to continue, or throw TripWire to abort.
   */
  processInput?: (ctx: ProcessorContext) => Promise<unknown>;

  /**
   * Phase 2 — runs after gate approval, immediately before the executor.
   * Can inject dynamic context (e.g. resolved OAuth tokens, enriched args).
   */
  processInputStep?: (ctx: ProcessorContext) => Promise<unknown>;

  /**
   * Phase 3 — runs on every execution result before returning to the agent.
   * Can sanitise, truncate, or augment. Cost tracking lives here.
   */
  processOutputStep?: (
    ctx: ProcessorContext,
    result: unknown,
  ) => Promise<unknown>;
}
