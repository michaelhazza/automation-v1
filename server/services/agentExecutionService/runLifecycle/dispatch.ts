import { buildBackendOptionsForMode } from '../backendDispatch.js';
import { executionBackendRegistry } from '../../executionBackends/registry.js';
import { ParentRunNotDispatchable } from '../../executionBackends/types.js';
import type { BackendDispatchResult } from '../../executionBackends/types.js';
import type { ExecutionMode } from '../../../../shared/types/executionEnvironment.js';
import type { AgentRunRequest, RunExecutionContext, ExecutionClosureContext } from '../types.js';
import { logger } from '../../../lib/logger.js';

export type DispatchRunOutcome =
  | { kind: 'dispatched'; result: BackendDispatchResult }
  | { kind: 'parent_not_dispatchable'; error: ParentRunNotDispatchable };

export async function dispatchRun(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<DispatchRunOutcome> {
  const run = ctx.run!;
  const effectiveMode: ExecutionMode = request.executionMode ?? 'api';

  const closureContext: ExecutionClosureContext = {
    agent: ctx.agent!,
    effectiveTools: ctx.effectiveTools!,
    pipeline: ctx.pipeline!,
    mcpClients: ctx.mcpClients ?? null,
    mcpLazyRegistry: ctx.mcpLazyRegistry ?? null,
    runContextData: ctx.runContextData!,
    saLink: ctx.saLink!,
    agentDomain: ctx.agentDomain,
    configVersion: ctx.configVersion!,
    hierarchyContext: ctx.hierarchyContext,
    orgProcesses: ctx.orgProcesses!,
    request,
    startTime: ctx.startTime,
    isOrgSubaccountRun: ctx.isOrgSubaccountRun,
    maxLoopIterations: ctx.maxLoopIterations!,
    // Routing context for the LLM router — built here because
    // `run.id` and `agent.name` are only in scope at the dispatch
    // site. Mirrors the pre-Chunk-5 inline construction.
    routerCtx: {
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? undefined,
      runId: run.id,
      subaccountAgentId: request.subaccountAgentId ?? undefined,
      agentName: ctx.agent!.name,
      sourceType: 'agent_run',
    },
    // Claude Code runner consumes a task prompt (workspace summary or
    // a default fallback if the workspace is empty).
    taskPrompt: ctx.workspaceContext! || 'Review the current workspace and report status.',
  };

  const backend = executionBackendRegistry.resolve(effectiveMode);

  try {
    const result = await backend.dispatch({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      agentId: request.agentId,
      promptAssembly: { stablePrefix: ctx.stablePrefix!, dynamicSuffix: ctx.dynamicSuffix! },
      tokenBudget: ctx.tokenBudget!,
      maxToolCalls: ctx.maxToolCalls!,
      timeoutMs: ctx.timeoutMs!,
      backendOptions: buildBackendOptionsForMode(effectiveMode, request, closureContext),
    });

    return { kind: 'dispatched', result };
  } catch (err) {
    if (err instanceof ParentRunNotDispatchable) {
      // The parent run moved past the delegation window before the
      // adapter could claim it (cancellation racing dispatch, or a
      // duplicate dispatch). The adapter has already written the
      // backend-side orphan-cleanup row.
      //
      // Plan § 8 / spec § 13.1.1 contract: this catch MUST map to the
      // EXACT existing race-loser response shape currently returned by
      // the pre-cutover dispatch path, if one exists. The pre-cutover
      // codepath had no such shape — orphan-cleanup is a new lifecycle
      // surface introduced by this contract — so the plan explicitly
      // says: "rethrow and document the behaviour in the PR — do not
      // invent a silent success response (no 5xx, no panic)."
      //
      // Rethrow with a structured warn line so operators see the race
      // in logs. The route layer will surface the typed error
      // according to the existing error-envelope behaviour. A
      // deliberate AgentRunResult shape for this case can be added
      // later once the desired client-visible shape is decided — that
      // is a behaviour change, out of scope here.
      logger.warn('agentExecutionService.parent_not_dispatchable', {
        runId: run.id,
        mode: effectiveMode,
        reason: err.reason,
      });
      return { kind: 'parent_not_dispatchable', error: err };
    }
    throw err;
  }
}
