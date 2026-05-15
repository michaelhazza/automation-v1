import type { BackendOptions } from '../executionBackends/types.js';
import type { ExecutionMode } from '../../../shared/types/executionEnvironment.js';
import type { AgentRunRequest } from './types.js';
import type { ExecutionClosureContext } from './types.js';

/**
 * Project the closure-context bundle onto the per-adapter
 * `BackendOptions` discriminated-union variant. Exhaustive switch on
 * `ExecutionMode` with a `never` exhaustiveness check on the default
 * branch — adding a new mode breaks compilation here until the new
 * variant is wired.
 *
 * Pure: no DB / I/O / closure mutations; only assembles the discriminated
 * shape from the inputs. `ctx` is pass-through closure data — the function
 * neither mutates `ctx` nor performs any I/O — so it is still pure in the
 * functional sense despite receiving three parameters.
 */
export function buildBackendOptionsForMode(
  mode: ExecutionMode,
  request: AgentRunRequest,
  ctx: ExecutionClosureContext,
): BackendOptions {
  // Derive the spec.options.RunSource from the request's runSource +
  // runType. Mirrors the pre-Chunk-5 trace-metadata derivation.
  const runSource: 'manual' | 'scheduled' | 'handoff' | 'sub_agent' =
    request.runSource === 'handoff' ? 'handoff'
    : request.runSource === 'sub_agent' ? 'sub_agent'
    : request.runType === 'scheduled' ? 'scheduled'
    : 'manual';

  switch (mode) {
    case 'api':
      return {
        backendId: 'api',
        runSource,
        allowedToolSlugs: request.allowedToolSlugs,
        loopContext: {
          agent: ctx.agent,
          routerCtx: ctx.routerCtx,
          tools: ctx.effectiveTools,
          maxLoopIterations: ctx.maxLoopIterations,
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
        },
      };
    case 'headless':
      return {
        backendId: 'headless',
        runSource,
        allowedToolSlugs: request.allowedToolSlugs,
        loopContext: {
          agent: ctx.agent,
          routerCtx: ctx.routerCtx,
          tools: ctx.effectiveTools,
          maxLoopIterations: ctx.maxLoopIterations,
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
        },
      };
    case 'claude-code':
      return {
        backendId: 'claude-code',
        loopContext: {
          taskPrompt: ctx.taskPrompt,
          request: ctx.request,
        },
      };
    case 'iee_browser':
      // Validation of ieeTask presence/type happens adapter-side in
      // _ieeShared.ts::ieeDispatch; the cast is safe because mismatches
      // are caught and thrown before any DB writes.
      return {
        backendId: 'iee_browser',
        ieeTask: request.ieeTask as never,
      };
    case 'iee_dev':
      return {
        backendId: 'iee_dev',
        ieeTask: request.ieeTask as never,
      };
    case 'operator_managed':
      // operator_managed runs are dispatched by the operator backend service,
      // not through this function. Reaching here is a programming error.
      throw new Error(`buildBackendOptionsForMode: 'operator_managed' runs must be dispatched via operatorRunService, not agentExecutionService`);
    default: {
      const _exhaustive: never = mode;
      void _exhaustive;
      throw new Error(`buildBackendOptionsForMode: unknown executionMode '${mode}'`);
    }
  }
}
