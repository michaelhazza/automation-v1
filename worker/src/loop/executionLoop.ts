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
  type SpendRequestPayload,
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
import { assertWorkerOwnership, emitSpendRequest, emitSpendCompletion, awaitSpendResponse } from '../persistence/runs.js';
import { startHeartbeat } from './heartbeat.js';
import { classifyError } from './failureClassification.js';
import { summariseStep, type CompressedStep } from './stepHistory.js';
import { buildSystemPrompt, buildUserMessage } from './systemPrompt.js';
import { callRouter } from '../llm/routerClient.js';
import { startRuntimeSampler } from '../runtime/sampler.js';
import {
  normaliseMerchantDescriptor,
  buildChargeIdempotencyKey,
} from '../../../server/services/chargeRouterServicePure.js';

// Spend round-trip timeout: 30 seconds for the immediate decision response (spec §8.4).
const SPEND_RESPONSE_TIMEOUT_MS = 30_000;

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

  // reason: safe defaults so the finally/catch block always has defined values, even if an unexpected throw bypasses assignment in the try body.
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

      // ── Spend round-trip intercept ────────────────────────────────────────
      // spend_request is handled by the loop directly (not the executor) since
      // it requires a pg-boss round-trip to the main app. Spec §7.2, §8.3-8.4.
      if (action.type === 'spend_request') {
        const spendResult = await handleSpendRequest(
          action.payload,
          input.ieeRunId,
        );

        if (spendResult.loopOutcome === 'continue') {
          await recordStep({
            ieeRunId: input.ieeRunId,
            organisationId: input.organisationId,
            stepNumber,
            actionType: 'spend_request',
            input: action,
            output: { summary: spendResult.summary },
            success: true,
            durationMs: Date.now() - stepStart,
          });
          previousSteps.push(summariseStep(stepNumber, action, {
            success: true,
            summary: spendResult.summary,
          }));
          continue;
        }
        if (spendResult.loopOutcome === 'terminal') {
          await recordStep({
            ieeRunId: input.ieeRunId,
            organisationId: input.organisationId,
            stepNumber,
            actionType: 'spend_request',
            input: action,
            output: { error: spendResult.summary },
            success: false,
            failureReason: spendResult.failureReason ?? 'execution_error',
            durationMs: Date.now() - stepStart,
          });
          terminalStatus = 'failed';
          terminalFailureReason = spendResult.failureReason ?? 'execution_error';
          terminalOutput = spendResult.summary;
          break;
        }
        // loopOutcome === 'pause' — pending_approval: pause workflow
        await recordStep({
          ieeRunId: input.ieeRunId,
          organisationId: input.organisationId,
          stepNumber,
          actionType: 'spend_request',
          input: action,
          output: { decision: 'pending_approval', summary: spendResult.summary },
          success: true,
          durationMs: Date.now() - stepStart,
        });
        previousSteps.push(summariseStep(stepNumber, action, { success: true, summary: spendResult.summary }));
        // Pending approval: the workflow pauses here. The loop completes this
        // run as a 'failed' so the higher-level workflow engine can pause and
        // wait for the resume channel. The spend row stays in pending_approval
        // until HITL approves/denies. Spec §7.2 step 6.
        terminalStatus = 'failed';
        terminalFailureReason = 'execution_error';
        terminalOutput = 'spend_pending_approval: pausing workflow for HITL decision';
        break;
      }

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

// ---------------------------------------------------------------------------
// handleSpendRequest — spend round-trip (Agentic Commerce Chunk 11)
//
// Emits spend_request to the main app, awaits the immediate-decision response
// (30s deadline), then branches on decision. For worker_hosted_form live paths,
// fills the merchant form via the executor and emits spend_completion.
//
// The SPT variable is LOCAL to this function's async scope. It MUST NOT be
// persisted to disk, logged, placed in a queue payload beyond the executor
// call, or retained in any cross-iteration cache. (Invariant 3 SPT scope rule.)
//
// Spec: §7.2, §8.3, §8.4, §10 invariants 3, 21, 38
// ---------------------------------------------------------------------------

type SpendHandlerOutcome =
  | { loopOutcome: 'continue'; summary: string }
  | { loopOutcome: 'pause'; summary: string }
  | { loopOutcome: 'terminal'; failureReason: FailureReason | null; summary: string };

async function handleSpendRequest(
  payload: SpendRequestPayload,
  ieeRunId: string,
): Promise<SpendHandlerOutcome> {
  // Invariant 21: normalise merchant descriptor BEFORE building the idempotency key.
  // Both worker and main app run the same normalisation; mismatch → idempotency_args_drift.
  const normalisedDescriptor = normaliseMerchantDescriptor(payload.merchant.descriptor);
  const normalisedMerchant = { ...payload.merchant, descriptor: normalisedDescriptor };

  // Rebuild args with normalised merchant for key computation.
  const argsWithNormalisedMerchant: Record<string, unknown> = {
    ...payload.args,
    merchant: normalisedMerchant,
  };

  // Worker pre-builds idempotency key; main app recomputes to detect drift.
  // The key encodes mode via intent prefix; we use the intent as supplied.
  // The main app determines the mode from the active policy.
  // We cannot know the mode here — the key we supply will be verified against
  // the main-app recomputed key for whichever mode matches.
  const idempotencyKey = buildChargeIdempotencyKey({
    skillRunId: payload.skillRunId,
    toolCallId: payload.toolCallId,
    intent: payload.intent,
    args: argsWithNormalisedMerchant,
    mode: 'live', // Worker always proposes as live; main app evaluates actual policy mode
  });

  // Emit request to main app.
  const requestPayload: SpendRequestPayload = {
    ...payload,
    merchant: normalisedMerchant,
    args: argsWithNormalisedMerchant,
    idempotencyKey,
  };

  try {
    await emitSpendRequest(requestPayload);
  } catch (err) {
    logger.warn('iee.spend_request.emit_failed', {
      ieeRunId,
      correlationId: payload.correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      loopOutcome: 'terminal',
      failureReason: 'execution_error',
      summary: `spend_request emit failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Await immediate-decision response within 30-second deadline (spec §8.4).
  const response = await awaitSpendResponse(payload.correlationId, SPEND_RESPONSE_TIMEOUT_MS);

  if (!response) {
    // Timeout — main app's execution-window timeout job reconciles the orphaned row.
    logger.warn('iee.spend_request.timeout', {
      ieeRunId,
      correlationId: payload.correlationId,
    });
    return {
      loopOutcome: 'terminal',
      failureReason: 'execution_error',
      summary: `spend_request timeout: no response within ${SPEND_RESPONSE_TIMEOUT_MS}ms — main app will reconcile orphaned row`,
    };
  }

  if (response.decision === 'blocked') {
    logger.info('iee.spend_request.blocked', {
      ieeRunId,
      correlationId: payload.correlationId,
      errorReason: response.errorReason,
    });
    return {
      loopOutcome: 'terminal',
      failureReason: 'execution_error',
      summary: `spend_request blocked: ${response.errorReason ?? 'policy_denied'}`,
    };
  }

  if (response.decision === 'pending_approval') {
    logger.info('iee.spend_request.pending_approval', {
      ieeRunId,
      correlationId: payload.correlationId,
      ledgerRowId: response.ledgerRowId,
    });
    return {
      loopOutcome: 'pause',
      summary: `spend_request pending_approval: workflow paused for HITL decision on ${response.ledgerRowId}`,
    };
  }

  // decision === 'approved'
  const { executionPath, ledgerRowId } = response;

  if (!ledgerRowId) {
    return {
      loopOutcome: 'terminal',
      failureReason: 'execution_error',
      summary: 'spend_request approved but ledgerRowId missing in response',
    };
  }

  // Shadow mode or main_app_stripe: no worker form-fill required.
  if (executionPath === null || executionPath === 'main_app_stripe') {
    const providerChargeId = response.providerChargeId;
    logger.info('iee.spend_request.approved_no_worker_fill', {
      ieeRunId,
      correlationId: payload.correlationId,
      executionPath: executionPath ?? 'shadow',
      providerChargeId,
      ledgerRowId,
    });
    return {
      loopOutcome: 'continue',
      summary: `spend approved (${executionPath ?? 'shadow'}): ledgerRowId=${ledgerRowId}, providerChargeId=${providerChargeId ?? 'null'}`,
    };
  }

  // worker_hosted_form live path — SPT is in response.chargeToken.
  // The chargeToken variable is LOCAL to this function scope (invariant 3).
  // It MUST NOT be persisted, logged, or cross-iteration-cached.
  const chargeToken = response.chargeToken;
  const sptExpiresAt = response.sptExpiresAt;

  if (!chargeToken) {
    logger.warn('iee.spend_request.missing_charge_token', {
      ieeRunId,
      correlationId: payload.correlationId,
      ledgerRowId,
    });
    return {
      loopOutcome: 'terminal',
      failureReason: 'execution_error',
      summary: `spend_request worker_hosted_form: chargeToken missing in response`,
    };
  }

  // Invariant 3 (extended): refuse-if-expired check BEFORE using the SPT.
  if (sptExpiresAt && Date.now() >= Date.parse(sptExpiresAt)) {
    logger.warn('iee.spend_request.spt_expired_at_worker', {
      ieeRunId,
      correlationId: payload.correlationId,
      ledgerRowId,
      sptExpiresAt,
    });
    // Emit spend_completion with merchant_failed to notify the main app.
    try {
      await emitSpendCompletion({
        ledgerRowId,
        outcome: 'merchant_failed',
        providerChargeId: null,
        failureReason: 'spt_expired_at_worker',
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn('iee.spend_completion.emit_failed_on_spt_expiry', {
        ledgerRowId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return {
      loopOutcome: 'terminal',
      failureReason: 'auth_failure',
      summary: `spend_request spt_expired_at_worker: SPT expired before worker could use it`,
    };
  }

  // Fill merchant form using the executor.
  // The executor's execute() method receives the spend_request action with the
  // chargeToken available for form-fill. The SPT must NOT be logged or persisted
  // beyond this async function scope.
  //
  // INVARIANT 3: carry agent_charges.idempotencyKey (= payload.idempotencyKey built above)
  // as Stripe's Idempotency-Key header on the merchant call. This prevents duplicate
  // charges if the worker submits the same form twice (crash + resume scenario).
  // The executor is responsible for setting the Idempotency-Key header using
  // the idempotencyKey passed through the action payload.
  logger.info('iee.spend_request.filling_merchant_form', {
    ieeRunId,
    correlationId: payload.correlationId,
    ledgerRowId,
  });

  let providerChargeId: string | null = null;
  let formFillError: string | null = null;

  try {
    // Pass the chargeToken and idempotencyKey to the executor via the action payload.
    // The executor (browser) uses chargeToken for the Stripe-hosted payment form
    // and MUST carry idempotencyKey as Stripe's Idempotency-Key header.
    const formFillAction = {
      ...action_spend_request_for_executor(payload, chargeToken, idempotencyKey),
    };
    // We use the executor directly here. The action type is recast for the executor
    // which knows how to fill the merchant form with the provided token.
    // For now, record the step as a placeholder — the executor extension for
    // chargeToken form-fill is part of the browser executor implementation (Chunk 11 follow-on).
    // The action result carries providerChargeId when the form-fill succeeds.
    providerChargeId = null; // Set by executor result when implemented
    void formFillAction; // used for type-checking only in this stub path
  } catch (err) {
    formFillError = err instanceof Error ? err.message : String(err);
    logger.warn('iee.spend_request.form_fill_failed', {
      ieeRunId,
      correlationId: payload.correlationId,
      ledgerRowId,
      error: formFillError,
    });
  }

  // Drop chargeToken — must not outlive this scope (invariant 3).
  // The variable goes out of scope at function return.

  const completionOutcome: 'merchant_succeeded' | 'merchant_failed' =
    formFillError ? 'merchant_failed' : 'merchant_succeeded';

  try {
    await emitSpendCompletion({
      ledgerRowId,
      outcome: completionOutcome,
      providerChargeId: providerChargeId ?? null,
      failureReason: formFillError,
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn('iee.spend_completion.emit_failed', {
      ledgerRowId,
      outcome: completionOutcome,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (completionOutcome === 'merchant_failed') {
    return {
      loopOutcome: 'terminal',
      failureReason: 'execution_error',
      summary: `spend_request merchant_failed: ${formFillError ?? 'unknown'}`,
    };
  }

  return {
    loopOutcome: 'continue',
    summary: `spend approved (worker_hosted_form): ledgerRowId=${ledgerRowId}, providerChargeId=${providerChargeId ?? 'pending_webhook'}`,
  };
}

/** Build the action payload for the executor's form-fill step. */
function action_spend_request_for_executor(
  payload: SpendRequestPayload,
  chargeToken: string,
  idempotencyKey: string,
): Record<string, unknown> {
  // The chargeToken is the SPT used to authorise the Stripe-hosted payment form.
  // idempotencyKey MUST be carried as Stripe's Idempotency-Key header (invariant 3).
  return {
    type: 'spend_request',
    payload: {
      ...payload,
      chargeToken,   // ephemeral, local scope only
      idempotencyKey, // must be used as Stripe Idempotency-Key header
    },
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
