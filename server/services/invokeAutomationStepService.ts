/**
 * Stateful wrapper around the pure invoke_automation dispatcher. §5.3 / §5.9.
 * Owns: webhook fetch, retry loop, tracing emission, engine/connection resolution.
 * All decision logic lives in invokeAutomationStepPure.ts.
 */

import { db } from '../db/index.js';
import { automations } from '../db/schema/automations.js';
import { automationEngines } from '../db/schema/automationEngines.js';
import { eq } from 'drizzle-orm';
import { buildEngineAuthHeaders } from '../lib/engineAuth.js';
import { logger } from '../lib/logger.js';
import { createEvent } from '../lib/tracing.js';
import type { InvokeAutomationStep, AutomationStepError } from '../lib/workflow/types.js';
import { renderString } from '../lib/workflow/templating.js';
import {
  resolveDispatch,
  resolveGateLevel,
  checkScope,
  shouldBlock_nonIdempotentGuard,
  clampMaxAttempts,
  validateDispatchOutput,
  projectOutputMapping,
  MAX_RETRY_ATTEMPTS,
  type RunScope,
  type TemplateCtx,
} from './invokeAutomationStepPure.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface InvokeAutomationResult {
  status: 'ok' | 'error' | 'review_required';
  output?: Record<string, unknown>;
  error?: AutomationStepError;
  gateLevel: 'auto' | 'review';
  retryAttempt: number;
}

export interface InvokeAutomationParams {
  step: InvokeAutomationStep;
  runId: string;
  stepRunId: string;
  run: RunScope;
  templateCtx: TemplateCtx;
}

export async function invokeAutomationStep(
  params: InvokeAutomationParams,
): Promise<InvokeAutomationResult> {
  const { step, runId, stepRunId, run, templateCtx } = params;

  // Load automation row
  const [automation] = await db
    .select()
    .from(automations)
    .where(eq(automations.id, step.automationId));

  if (!automation) {
    const error: AutomationStepError = {
      code: 'automation_not_found',
      type: 'validation',
      message: `Automation '${step.automationId}' not found.`,
      retryable: false,
    };
    createEvent('workflow.step.automation.completed', {
      runId, stepRunId, automationId: step.automationId,
      status: 'not_found', retryAttempt: 1, latencyMs: 0, error,
    });
    return { status: 'error', error, gateLevel: 'review', retryAttempt: 1 };
  }

  // Scope check (§5.8)
  if (!checkScope(run, automation)) {
    const error: AutomationStepError = {
      code: 'automation_scope_mismatch',
      type: 'validation',
      message: `Automation '${step.automationId}' is not accessible from this run's scope.`,
      retryable: false,
    };
    createEvent('workflow.step.automation.completed', {
      runId, stepRunId, automationId: step.automationId,
      status: 'scope_mismatch', retryAttempt: 1, latencyMs: 0, error,
    });
    return { status: 'error', error, gateLevel: resolveGateLevel(step, automation), retryAttempt: 1 };
  }

  // Load engine for base URL
  const [engine] = await db
    .select()
    .from(automationEngines)
    .where(eq(automationEngines.id, automation.workflowEngineId!));

  if (!engine) {
    const error: AutomationStepError = {
      code: 'automation_execution_error',
      type: 'execution',
      message: `Automation engine for '${step.automationId}' could not be resolved.`,
      retryable: false,
    };
    return { status: 'error', error, gateLevel: resolveGateLevel(step, automation), retryAttempt: 1 };
  }

  const gateLevel = resolveGateLevel(step, automation);

  // Gate check — if review required, return without dispatching
  if (gateLevel === 'review') {
    return { status: 'review_required', gateLevel, retryAttempt: 1 };
  }

  const renderTemplate = (expr: string, ctx: TemplateCtx) =>
    renderString(expr, ctx as unknown as Parameters<typeof renderString>[1]);

  const maxAttempts = clampMaxAttempts(step.automationRetryPolicy?.maxAttempts);
  const authHeaders = buildEngineAuthHeaders(engine.engineType, engine.apiKey ?? undefined);

  let lastError: AutomationStepError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Non-idempotent retry guard (§5.4a rule 3)
    if (shouldBlock_nonIdempotentGuard(automation, step, attempt)) {
      const error: AutomationStepError = {
        code: 'automation_retry_guard_blocked',
        type: 'execution',
        message: `Automation '${step.automationId}' is non-idempotent; automatic retry is blocked. Set overrideNonIdempotentGuard: true on the step to bypass.`,
        retryable: false,
      };
      createEvent('workflow.step.automation.completed', {
        runId, stepRunId, automationId: step.automationId,
        status: 'retry_guard_blocked', retryAttempt: attempt, latencyMs: 0, error,
      });
      return { status: 'error', error, gateLevel, retryAttempt: attempt };
    }

    const outcome = resolveDispatch({
      step, run, automation, engineBaseUrl: engine.baseUrl, renderTemplate, templateCtx,
    });

    if (outcome.kind === 'error') {
      createEvent('workflow.step.automation.completed', {
        runId, stepRunId, automationId: step.automationId,
        status: 'pre_dispatch_error', retryAttempt: attempt, latencyMs: 0, error: outcome.error,
      });
      return { status: 'error', error: outcome.error, gateLevel, retryAttempt: attempt };
    }

    if (outcome.kind === 'skip') {
      return { status: 'ok', output: {}, gateLevel, retryAttempt: attempt };
    }

    // Dispatch
    const start = Date.now();
    createEvent('workflow.step.automation.dispatched', {
      runId, stepRunId, automationId: step.automationId, retryAttempt: attempt,
    });

    try {
      const response = await fetch(outcome.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(outcome.body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - start;

      // §5.10a rule 4: one step → one webhook. Dispatched, not multi-webhook.
      // If response indicates multi-webhook resolution, error.
      let responseBody: unknown;
      try { responseBody = await response.json(); } catch { responseBody = {}; }

      if (!response.ok) {
        lastError = {
          code: 'automation_webhook_error',
          type: 'external',
          message: `Automation webhook returned HTTP ${response.status}.`,
          retryable: response.status >= 500,
        };
        createEvent('workflow.step.automation.completed', {
          runId, stepRunId, automationId: step.automationId,
          status: 'webhook_error', retryAttempt: attempt, latencyMs, error: lastError,
        });
        if (!lastError.retryable || attempt >= maxAttempts) {
          return { status: 'error', error: lastError, gateLevel, retryAttempt: attempt };
        }
        continue;
      }

      // Output schema validation (§5.5 best-effort)
      const outputCheck = validateDispatchOutput(responseBody, automation);
      if (!outputCheck.ok) {
        createEvent('workflow.step.automation.completed', {
          runId, stepRunId, automationId: step.automationId,
          status: 'output_validation_failed', retryAttempt: attempt, latencyMs, error: outputCheck.error,
        });
        return { status: 'error', error: outputCheck.error, gateLevel, retryAttempt: attempt };
      }

      const output = projectOutputMapping(
        responseBody, step.outputMapping, renderTemplate, templateCtx,
      );

      createEvent('workflow.step.automation.completed', {
        runId, stepRunId, automationId: step.automationId,
        status: 'ok', retryAttempt: attempt, latencyMs,
      });
      return { status: 'ok', output, gateLevel, retryAttempt: attempt };

    } catch (err) {
      const latencyMs = Date.now() - start;
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      lastError = {
        code: isTimeout ? 'automation_timeout' : 'automation_execution_error',
        type: isTimeout ? 'timeout' : 'execution',
        message: err instanceof Error ? err.message : 'Unknown error during automation dispatch.',
        retryable: isTimeout || !automation.idempotent,
      };
      logger.warn('invoke_automation_step_error', { runId, stepRunId, attempt, error: lastError });
      createEvent('workflow.step.automation.completed', {
        runId, stepRunId, automationId: step.automationId,
        status: isTimeout ? 'timeout' : 'execution_error',
        retryAttempt: attempt, latencyMs, error: lastError,
      });
      if (!lastError.retryable || attempt >= maxAttempts) {
        return { status: 'error', error: lastError, gateLevel, retryAttempt: attempt };
      }
    }
  }

  return {
    status: 'error',
    error: lastError ?? {
      code: 'automation_execution_error',
      type: 'unknown',
      message: 'Exhausted retry attempts.',
      retryable: false,
    },
    gateLevel,
    retryAttempt: maxAttempts,
  };
}
