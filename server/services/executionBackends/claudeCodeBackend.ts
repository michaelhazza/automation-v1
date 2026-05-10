/**
 * claudeCodeBackend — subprocess invocation of the Claude Code CLI runner.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 7
 *       (claude-code row), § 11 (Adapter rows), § 14 Chunk 4 (registration),
 *       § 14 Chunk 5 (real dispatch wiring).
 *
 * Tier 5 terminal-repo adapter. Spawns `claude -p` against the host's
 * Claude Max plan — zero API cost. The runner module
 * (`claudeCodeRunner.execute`) already encapsulates the subprocess
 * lifecycle, so the adapter dispatch body is a thin shim that builds the
 * runner input from `BackendDispatchInput` + the cwd / task-prompt carried
 * by `ClaudeCodeBackendOptions`.
 *
 * Cycle prevention — does NOT import from `agentExecutionService.ts`. The
 * `claudeCodeRunner` and `devContextService` modules are siblings that
 * have no path back into the dispatch site; importing them directly is
 * safe.
 */

import { claudeCodeRunner } from '../claudeCodeRunner.js';
import { devContextService } from '../devContextService.js';
import { emitAgentRunUpdate } from '../../websocket/emitters.js';

import {
  BackendOptionsMismatch,
  type ExecutionBackend,
} from './types.js';

export const claudeCodeBackend: ExecutionBackend = {
  // === Identity ===
  id: 'claude-code',
  capabilities: ['subprocess', 'terminal_repo'],
  costModel: 'subscription',
  sandboxRequirement: 'terminal_repo',
  // No delegated lifecycle slots — subprocess dispatch finalises inline
  // via the existing post-completion block in `agentExecutionService.ts`.

  async dispatch(input) {
    if (input.backendOptions.backendId !== 'claude-code') {
      throw new BackendOptionsMismatch('claude-code', input.backendOptions.backendId);
    }
    const opts = input.backendOptions;
    const ctx = opts.loopContext;

    // Resolve the project root for the subprocess cwd. Order:
    //   1. explicit `opts.cwd` from the dispatch site,
    //   2. dev-execution-context lookup (subaccount-scoped projectRoot),
    //   3. fallback to '.'.
    let projectRoot = opts.cwd ?? '.';
    if (!opts.cwd && ctx.request.subaccountId) {
      try {
        const { context: dec } = await devContextService.getContext(
          ctx.request.subaccountId,
        );
        projectRoot = dec.projectRoot;
      } catch {
        // DEC not configured — keep '.'.
      }
    }

    emitAgentRunUpdate(input.runId, 'agent:run:progress', {
      type: 'execution_mode',
      mode: 'claude-code',
      message: 'Spawning Claude Code CLI...',
    });

    // claudeCodeRunner.systemPrompt is a flat string; flatten the union
    // exactly like the pre-Chunk-5 inline branch (which passed
    // `fullSystemPrompt = stablePrefix + dynamicSuffix`).
    const systemPromptString =
      typeof input.promptAssembly === 'string'
        ? input.promptAssembly
        : input.promptAssembly.stablePrefix + input.promptAssembly.dynamicSuffix;

    const ccResult = await claudeCodeRunner.execute({
      systemPrompt: systemPromptString,
      taskPrompt: ctx.taskPrompt,
      cwd: projectRoot,
      maxTurns: input.maxToolCalls,
      timeoutMs: input.timeoutMs,
      runId: input.runId,
    });

    return {
      lifecycle: 'subprocess',
      // Intentional improvement over the plan spec (which specified
      // `backendTaskId: null`): claudeCodeRunner surfaces the subprocess
      // sessionId, so we record it as `backend_task_id` in `agent_runs`
      // for observability. No code reads this value yet, but it provides
      // a stable handle when debugging subprocess runs in production.
      backendTaskId: ccResult.sessionId ?? null,
      loopResult: {
        summary: ccResult.result,
        toolCallsLog: [
          {
            type: 'claude_code_execution',
            sessionId: ccResult.sessionId,
            success: ccResult.success,
            durationMs: ccResult.durationMs,
            numTurns: ccResult.numTurns,
            timedOut: ccResult.timedOut,
          },
        ],
        totalToolCalls: ccResult.numTurns,
        inputTokens: ccResult.inputTokens,
        outputTokens: ccResult.outputTokens,
        totalTokens: ccResult.totalTokens,
        tasksCreated: 0,
        tasksUpdated: 0,
        deliverablesCreated: 0,
        finalStatus: ccResult.timedOut
          ? 'timeout'
          : ccResult.success
          ? 'completed'
          : 'failed',
      },
      deduplicated: false,
    };
  },
};
