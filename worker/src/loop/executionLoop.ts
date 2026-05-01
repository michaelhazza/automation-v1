// ---------------------------------------------------------------------------
// IEE execution loop. Spec §5.1, §12.1, §12.7, §13.3.
//
// Exactly four exit paths (§12.1):
//   1. action.type === 'done'        → success terminal
//   2. action.type === 'failed'      → voluntary failure terminal
//   3. step count exceeds limit      → step_limit_reached
//   4. wall-clock exceeds limit      → timeout
//
// The loop is wrapped in try/finally so the heartbeat is always cleared and
// the run is always written to a terminal status (§12.10).
// ---------------------------------------------------------------------------


import type { Observation } from '../../../shared/iee/observation.js';
import {
  ExecutionAction,
  type ExecutionAction as ExecutionActionT,
  type ExecutionActionType,
} from '../../../shared/iee/actionSchema.js';
import type { ResultSummary } from '../../../shared/iee/jobPayload.js';
import {
  TimeoutError,
  StepLimitError,
  SchemaValidationError,
  type FailureReason,
} from '../../../shared/iee/failureReason.js';
import { env } from '../config/env.js';
import { logger, truncate } from '../logger.js';
import { recordStep } from '../persistence/steps.js';
import { assertWorkerOwnership } from '../persistence/runs.js';
import { startHeartbeat } from './heartbeat.js';
import { classifyError } from './failureClassification.js';
import { summariseStep, type CompressedStep } from './stepHistory.js';
import { buildSystemPrompt, buildUserMessage } from './systemPrompt.js';
import { callRouter } from '../llm/routerClient.js';
import { startRuntimeSampler } from '../runtime/sampler.js';

export interface StepExecutorContext {
  ieeRunId: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  agentRunId: string | null;
  correlationId: string;
}

export interface ActionResult {
  output: unknown;
  /** Optional human summary the executor wants the LLM to see next turn. */
  summary?: string;
  /** Optional artifact paths emitted by this action (for the result summary). */
  artifacts?: string[];
}

export interface StepExecutor {
  mode: 'browser' | 'dev';
  availableActions: readonly ExecutionActionType[];
  observe(): Promise<Observation>;
  execute(action: ExecutionActionT): Promise<ActionResult>;
  dispose(): Promise<void>;
}

export interface ExecutionLoopInput {
  ieeRunId: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  agentRunId: string | null;
  correlationId: string;
  goal: string;
  executor: StepExecutor;
  /** Reviewer round 3 #3 — passed in by the handler so each step can verify
   *  this worker still owns the row before doing anything destructive. */
  workerInstanceId: string;
}

export interface ExecutionLoopResult {
  status: 'completed' | 'failed';
  failureReason: FailureReason | null;
  resultSummary: ResultSummary;
  stepCount: number;
  llmCallCount: number;
  llmCostCents: number;       // populated by caller after sumLlmCostForRun
  runtime: {
    wallMs: number;
    cpuMs: number;
    peakRssBytes: number;
  };
}

export async function runExecutionLoop(input: ExecutionLoopInput): Promise<ExecutionLoopResult> {
  const start = Date.now();
  const deadline = start + env.MAX_EXECUTION_TIME_MS;
  const heartbeat = startHeartbeat(input.ieeRunId);
  const sampler = startRuntimeSampler();

  let stepNumber = 0;
  let llmCallCount = 0;
  const previousSteps: CompressedStep[] = [];
  const artifacts: string[] = [];

  // eslint-disable-next-line no-useless-assignment
  let terminalStatus: 'completed' | 'failed' = 'failed';
  // eslint-disable-next-line no-useless-assignment
  let terminalFailureReason: FailureReason | null = 'unknown';
  // eslint-disable-next-line no-useless-assignment
  let terminalOutput: unknown = undefined;
  let terminalConfidence: number | undefined;

  try {
    while (true) {
      stepNumber++;

      // ── Exit path 3: step limit ──────────────────────────────────────────
      if (stepNumber > env.MAX_STEPS_PER_EXECUTION) {
        throw new StepLimitError(`Step limit ${env.MAX_STEPS_PER_EXECUTION} exceeded`);
      }
      // ── Exit path 4: timeout ─────────────────────────────────────────────
      if (Date.now() > deadline) {
        throw new TimeoutError(`Execution time ${env.MAX_EXECUTION_TIME_MS}ms exceeded`);
      }

      // ── Ownership check (reviewer round 3 #3) ────────────────────────────
      // Cheap PK read. Aborts the loop cleanly if another worker has
      // reclaimed the row (e.g. boot reconciliation flipped it to failed
      // during a long Playwright operation). Without this check the loop
      // would keep writing steps into a row it no longer owns.
      const stillOwned = await assertWorkerOwnership(input.ieeRunId, input.workerInstanceId);
      if (!stillOwned) {
        logger.warn('iee.execution.ownership_lost', {
          ieeRunId: input.ieeRunId,
          workerInstanceId: input.workerInstanceId,
          stepNumber,
        });
        terminalStatus = 'failed';
        terminalFailureReason = 'environment_error';
        terminalOutput = 'Worker ownership lost — another worker reclaimed this run';
        break;
      }

      // Observe ────────────────────────────────────────────────────────────
      const observation = await input.executor.observe();

      // Decide ─────────────────────────────────────────────────────────────
      const stepBudgetRemaining = env.MAX_STEPS_PER_EXECUTION - stepNumber + 1;
      const timeBudgetMs = Math.max(0, deadline - Date.now());

      const action = await decideAction({
        ieeRunId: input.ieeRunId,
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        agentId: input.agentId,
        agentRunId: input.agentRunId,
        correlationId: input.correlationId,
        goal: input.goal,
        availableActions: input.executor.availableActions,
        stepBudgetRemaining,
        timeBudgetMs,
        observation,
        previousSteps,
      });
      llmCallCount++;

      // Schema-restrict to mode
      if (!input.executor.availableActions.includes(action.type)) {
        await recordStep({
          ieeRunId: input.ieeRunId,
          organisationId: input.organisationId,
          stepNumber,
          actionType: action.type,
          input: action,
          output: { error: 'action_type_not_available_for_mode' },
          success: false,
          failureReason: 'execution_error',
          durationMs: 0,
        });
        terminalStatus = 'failed';
        terminalFailureReason = 'execution_error';
        terminalOutput = `LLM returned action type "${action.type}" which is not available in ${input.executor.mode} mode`;
        break;
      }

      // Act ────────────────────────────────────────────────────────────────
      const stepStart = Date.now();
      let result: ActionResult;
      try {
        result = await input.executor.execute(action);
      } catch (err) {
        const reason = classifyError(err);
        const message = err instanceof Error ? err.message : String(err);
        await recordStep({
          ieeRunId: input.ieeRunId,
          organisationId: input.organisationId,
          stepNumber,
          actionType: action.type,
          input: action,
          output: { error: truncate(message, 500) },
          success: false,
          failureReason: reason,
          durationMs: Date.now() - stepStart,
        });
        logger.warn('iee.step.failed', {
          ieeRunId: input.ieeRunId,
          stepNumber,
          actionType: action.type,
          failureReason: reason,
          errorMessage: truncate(message, 500),
        });
        previousSteps.push(summariseStep(stepNumber, action, { success: false, summary: `error: ${truncate(message, 100)}` }));
        // Recoverable: keep looping unless this was a hard failure class
        if (reason === 'environment_error' || reason === 'auth_failure' || reason === 'budget_exceeded') {
          terminalStatus = 'failed';
          terminalFailureReason = reason;
          terminalOutput = truncate(message, 500);
          break;
        }
        continue;
      }

      // Capture ────────────────────────────────────────────────────────────
      if (result.artifacts && result.artifacts.length > 0) {
        artifacts.push(...result.artifacts);
      }
      await recordStep({
        ieeRunId: input.ieeRunId,
        organisationId: input.organisationId,
        stepNumber,
        actionType: action.type,
        input: action,
        output: result.output,
        success: true,
        durationMs: Date.now() - stepStart,
      });
      logger.info('iee.step.complete', {
        ieeRunId: input.ieeRunId,
        stepNumber,
        actionType: action.type,
        durationMs: Date.now() - stepStart,
      });
      previousSteps.push(summariseStep(stepNumber, action, { success: true, summary: result.summary }));

      // ── Exit paths 1 & 2: terminal actions ───────────────────────────────
      if (action.type === 'done') {
        terminalStatus = 'completed';
        terminalFailureReason = null;
        terminalOutput = action.summary;
        terminalConfidence = action.confidence;
        break;
      }
      if (action.type === 'failed') {
        terminalStatus = 'failed';
        terminalFailureReason = 'execution_error';
        terminalOutput = action.reason;
        break;
      }
    }
  } catch (err) {
    const reason = classifyError(err);
    terminalStatus = 'failed';
    terminalFailureReason = reason;
    terminalOutput = err instanceof Error ? truncate(err.message, 500) : String(err);
    logger.warn('iee.execution.failed', {
      ieeRunId: input.ieeRunId,
      failureReason: reason,
      lastStepNumber: stepNumber,
    });
  } finally {
    heartbeat.stop();
    try { await input.executor.dispose(); } catch (err) {
      logger.warn('iee.executor.dispose_failed', {
        ieeRunId: input.ieeRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const wallMs = Date.now() - start;
  const runtime = sampler.finish();

  const resultSummary: ResultSummary = {
    success: terminalStatus === 'completed',
    output: terminalOutput,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    stepCount: stepNumber,
    durationMs: wallMs,
    confidence: terminalConfidence,
  };

  return {
    status: terminalStatus,
    failureReason: terminalFailureReason,
    resultSummary,
    stepCount: stepNumber,
    llmCallCount,
    llmCostCents: 0, // caller fills in via sumLlmCostForRun after the loop returns
    runtime: {
      wallMs,
      cpuMs: runtime.cpuMs,
      peakRssBytes: runtime.peakRssBytes,
    },
  };
}

// ---------------------------------------------------------------------------
// LLM call + parse with one repair retry. Spec §5.5 + §12.1.
// On second failure, synthesise a `failed` action so the loop terminates
// cleanly via the normal exit path.
// ---------------------------------------------------------------------------

interface DecideInput {
  ieeRunId: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  agentRunId: string | null;
  correlationId: string;
  goal: string;
  availableActions: readonly ExecutionActionType[];
  stepBudgetRemaining: number;
  timeBudgetMs: number;
  observation: Observation;
  previousSteps: CompressedStep[];
}

async function decideAction(input: DecideInput): Promise<ExecutionActionT> {
  const systemPrompt = buildSystemPrompt({
    goal: input.goal,
    availableActions: input.availableActions,
    stepBudgetRemaining: input.stepBudgetRemaining,
    timeBudgetMs: input.timeBudgetMs,
  });

  const baseUserMessage = buildUserMessage(
    JSON.stringify(input.observation),
    JSON.stringify(input.previousSteps.slice(-20)),
  );

  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userMessage = attempt === 1
      ? baseUserMessage
      : `${baseUserMessage}\n\nYour previous response was not valid JSON matching the action schema. Error: ${lastError}\nReturn ONLY a valid JSON object for the next action.`;

    const response = await callRouter({
      systemPrompt,
      userMessage,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      agentRunId: input.agentRunId,
      ieeRunId: input.ieeRunId,
      correlationId: input.correlationId,
    });

    try {
      const parsed = parseAction(response);
      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn('iee.llm.invalid_action', {
        ieeRunId: input.ieeRunId,
        attempt,
        error: truncate(lastError, 300),
      });
    }
  }

  // Spec §13.1 — synthesise a clean terminal failure rather than looping
  return {
    type: 'failed',
    reason: 'llm_invalid_json: LLM failed to produce a valid action after 2 attempts',
  };
}

function parseAction(rawContent: string): ExecutionActionT {
  // Strip optional markdown fences and surrounding whitespace
  let s = rawContent.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  }
  // Some models prepend prose; try to find the first {...} JSON object
  if (!s.startsWith('{')) {
    const match = s.match(/\{[\s\S]*\}/);
    if (match) s = match[0];
  }
  let json: unknown;
  try {
    json = JSON.parse(s);
  } catch (err) {
    throw new SchemaValidationError(`JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = ExecutionAction.safeParse(json);
  if (!result.success) {
    throw new SchemaValidationError(`Schema validation failed: ${result.error.issues.map(i => i.message).join('; ')}`);
  }
  return result.data;
}
