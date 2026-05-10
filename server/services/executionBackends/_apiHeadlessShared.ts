/**
 * _apiHeadlessShared — internal helper consumed by `apiBackend.ts` and
 * `headlessBackend.ts`.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 7
 *       *api/headless shared body*; plan.md Chunk 4 (file inventory),
 *       Chunk 5 (cutover wiring).
 *
 * The two existing modes share the same physical dispatch path today.
 * `headless` is a configuration variant of the in-process agentic loop, not
 * a separate runtime — both register as distinct adapter ids so
 * `executionMode = 'headless'` resolves correctly, but they wrap the same
 * shared body parameterised by mode (the per-adapter delta is the
 * trace-metadata `executionMode` value).
 *
 * Cycle prevention — same rule as `executionBackends/types.ts`: this file
 * MUST NOT import from `agentExecutionService.ts`. The agentic loop entry
 * point lives in `agentExecutionLoop.ts`, the neutral sibling extracted in
 * Chunk 4 specifically to break the
 * `agentExecutionService → registry → apiBackend → agentExecutionService`
 * cycle that would otherwise form once the dispatch ladder routes through
 * the registry.
 *
 * Status — Chunk 5 (this commit):
 *   The dispatch ladder in `agentExecutionService.ts` now resolves the
 *   adapter from `executionBackendRegistry` and calls
 *   `backend.dispatch(input)`. The shared body lifts the in-process /
 *   api-headless block (langfuse trace setup → `runAgenticLoop` →
 *   `finalizeTrace` → `langfuse.flushAsync`) verbatim from the inline
 *   branch and returns a `BackendDispatchResult` with
 *   `lifecycle: 'in_process'`. The post-completion finalisation block
 *   stays in `agentExecutionService.ts` so the caller consumes
 *   `dispatchResult.loopResult` exactly as the inline branch produced it
 *   today.
 */

import { langfuse, withTrace } from '../../instrumentation.js';
import {
  createSpan,
  createEvent,
  finalizeTrace,
  generateRunFingerprint,
  type FinalStatus,
  type ErrorType,
} from '../../lib/tracing.js';
import { runAgenticLoop } from '../agentExecutionLoop.js';

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
 * Lifted from the default branch of the dispatch ladder in
 * `agentExecutionService.ts` (the `else` branch that wrapped
 * `runAgenticLoop` with langfuse tracing and finalised the trace inline).
 * Closure-context fields (`agent`, `effectiveTools`, `pipeline`,
 * `mcpClients`, `runContextData`, …) arrive on
 * `input.backendOptions.loopContext` — see `options.ts:ApiHeadlessLoopContext`
 * for the full list and Chunk 5 of the plan for the rationale.
 */
export async function apiHeadlessDispatch(
  args: SharedDispatchArgs,
): Promise<BackendDispatchResult> {
  const { mode, input } = args;

  // Defensive: this helper is only callable through `apiBackend` /
  // `headlessBackend`, both of which already pin the mismatch check
  // before reaching here. The redundant assertion is intentional — if a
  // future caller misses the per-adapter check we still surface the
  // diagnostic loudly rather than silently advance into the loop.
  if (input.backendOptions.backendId !== mode) {
    throw new Error(
      `apiHeadlessDispatch: mode '${mode}' received backendOptions ` +
        `for '${input.backendOptions.backendId}'. The adapter's per-mode ` +
        `mismatch guard should have rejected this before dispatch.`,
    );
  }

  // After the mismatch check the union narrows so `loopContext` is
  // reachable without a cast. Both api/headless variants carry the same
  // `ApiHeadlessLoopContext` shape; the per-mode delta lives in trace
  // metadata only (see the langfuse trace below).
  const opts = input.backendOptions;
  const ctx = opts.loopContext;

  // Session linking (Section WS2): group related runs. Mirrors the
  // pre-Chunk-5 derivation from `request.runSource` / `request.runType` /
  // `request.parentSpawnRunId`. The dispatch site does not pass an
  // explicit traceSessionId — it is recomputed here so the adapter is
  // self-sufficient.
  const request = ctx.request;
  let traceSessionId: string;
  if (request.runSource === 'handoff' && request.parentRunId) {
    traceSessionId = `handoff-chain-${request.parentRunId}`;
  } else if (request.runType === 'scheduled') {
    const dateStr = new Date().toISOString().slice(0, 10);
    traceSessionId = `schedule-${request.agentId}-${dateStr}`;
  } else if (request.runSource === 'sub_agent' && request.parentSpawnRunId) {
    traceSessionId = `spawn-${request.parentSpawnRunId}`;
  } else {
    traceSessionId = input.runId;
  }

  // Run fingerprint (Section 8.3) — derived from the resolved tool set,
  // so call this AFTER the dispatch site narrowed `effectiveTools`.
  const skillSlugs = ctx.tools.map((t) => t.name);
  const runFingerprint = generateRunFingerprint(
    request.agentId,
    'development',
    skillSlugs,
  );

  const trace = langfuse.trace({
    name: 'agent-run',
    userId: request.subaccountId ?? undefined,
    sessionId: traceSessionId,
    metadata: {
      agentId: request.agentId,
      runType: request.runType,
      orgId: request.organisationId,
      subaccountId: request.subaccountId,
      executionMode: mode,
      traceSchemaVersion: 'v1',
      instrumentationVersion: '1.0',
      startedAt: new Date().toISOString(),
      runFingerprint,
      handoffDepth: request.handoffDepth ?? 0,
      parentRunId: request.parentRunId ?? null,
      isSubAgent: request.isSubAgent ?? false,
      parentSpawnRunId: request.parentSpawnRunId ?? null,
    },
  });

  const loopResult = await withTrace(
    trace,
    {
      runId: input.runId,
      orgId: request.organisationId,
      subaccountId: request.subaccountId ?? undefined,
      agentId: request.agentId ?? undefined,
      executionMode: mode,
    },
    async () => {
      const result = await runAgenticLoop({
        runId: input.runId,
        agent: ctx.agent,
        routerCtx: ctx.routerCtx,
        systemPrompt: input.promptAssembly,
        tools: ctx.tools,
        tokenBudget: input.tokenBudget,
        maxToolCalls: input.maxToolCalls,
        maxLoopIterations: ctx.maxLoopIterations,
        timeoutMs: input.timeoutMs,
        startTime: ctx.startTime,
        request: ctx.request,
        orgProcesses: ctx.orgProcesses,
        saLink: ctx.saLink,
        pipeline: ctx.pipeline,
        mcpClients: ctx.mcpClients,
        mcpLazyRegistry: ctx.mcpLazyRegistry,
        runContextData: ctx.runContextData,
        isOrgSubaccountRun: ctx.isOrgSubaccountRun,
        agentDomain: ctx.agentDomain,
        hierarchyContext: ctx.hierarchyContext,
        configVersion: ctx.configVersion,
      });

      // ── Finalize Langfuse trace (inside withTrace so context is available) ──
      const loopDurationMs = Date.now() - ctx.startTime;
      const loopFinalStatus = (result.finalStatus ?? 'completed') as string;

      const traceFinalStatus: FinalStatus =
        loopFinalStatus === 'timeout' ? 'timeout'
        : loopFinalStatus === 'budget_exceeded' ? 'budget_exceeded'
        : loopFinalStatus === 'loop_detected' ? 'loop_detected'
        : loopFinalStatus === 'failed' ? 'failed'
        : 'completed';

      const traceErrorType: ErrorType | null =
        loopFinalStatus === 'timeout' ? 'timeout'
        : loopFinalStatus === 'budget_exceeded' ? 'budget_exceeded'
        : loopFinalStatus === 'loop_detected' ? 'loop_detected'
        : loopFinalStatus === 'failed' ? 'internal_error'
        : null;

      const finalizationSpan = createSpan('agent.finalization.run');
      createEvent('run.status.changed', {
        fromStatus: 'running',
        toStatus: traceFinalStatus,
      });
      finalizationSpan.end();

      finalizeTrace({
        finalStatus: traceFinalStatus,
        totalTokensIn: result.inputTokens,
        totalTokensOut: result.outputTokens,
        iterationCount:
          result.toolCallsLog.length > 0
            ? Math.max(
                ...result.toolCallsLog.map(
                  (t) => (t as { iteration: number }).iteration,
                ),
              ) + 1
            : 0,
        toolCallCount: result.totalToolCalls,
        durationMs: loopDurationMs,
        errorType: traceErrorType,
        startedAt: new Date(ctx.startTime).toISOString(),
      });

      // guard-ignore: no-silent-failures reason="fire-and-forget telemetry flush"
      langfuse.flushAsync().catch(() => {});

      return result;
    },
  );

  return {
    lifecycle: 'in_process',
    backendTaskId: null,
    loopResult,
    deduplicated: false,
  };
}
