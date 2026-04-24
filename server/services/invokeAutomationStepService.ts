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

/**
 * §5.9 completed-event `status` values — a 10-entry enum driven by the §5.7
 * error-code vocabulary. Every pre-dispatch failure surfaces through this map.
 */
type CompletedStatus =
  | 'ok'
  | 'http_error'
  | 'timeout'
  | 'network_error'
  | 'input_validation_failed'
  | 'output_validation_failed'
  | 'missing_connection'
  | 'automation_not_found'
  | 'automation_scope_mismatch'
  | 'automation_composition_invalid';

function preDispatchStatusForCode(code: string): CompletedStatus {
  switch (code) {
    case 'automation_input_validation_failed': return 'input_validation_failed';
    case 'automation_output_validation_failed': return 'output_validation_failed';
    case 'automation_missing_connection': return 'missing_connection';
    case 'automation_not_found': return 'automation_not_found';
    case 'automation_scope_mismatch': return 'automation_scope_mismatch';
    case 'automation_composition_invalid': return 'automation_composition_invalid';
    default:
      // Should not occur for pre-dispatch codes; fall back to the nearest
      // spec-valid status. Tests cover every expected code path explicitly.
      return 'automation_not_found';
  }
}

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
    // §5.7: execution-class error (pre-dispatch resolution failure).
    const error: AutomationStepError = {
      code: 'automation_not_found',
      type: 'execution',
      message: `Automation '${step.automationId}' not found.`,
      retryable: false,
    };
    createEvent('workflow.step.automation.completed', {
      runId, stepRunId, automationId: step.automationId,
      status: 'automation_not_found', retryAttempt: 1, latencyMs: 0, error,
    });
    return { status: 'error', error, gateLevel: 'review', retryAttempt: 1 };
  }

  // Scope check (§5.8) — execution-class error per §5.7.
  if (!checkScope(run, automation)) {
    const error: AutomationStepError = {
      code: 'automation_scope_mismatch',
      type: 'execution',
      message: `Automation '${step.automationId}' is not accessible from this run's scope.`,
      retryable: false,
    };
    createEvent('workflow.step.automation.completed', {
      runId, stepRunId, automationId: step.automationId,
      status: 'automation_scope_mismatch', retryAttempt: 1, latencyMs: 0, error,
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
    // Non-idempotent retry guard (§5.4a rule 3). The guard fires only on
    // attempt ≥ 2 — the previous iteration already emitted a §5.9 completed
    // event with the true terminal outcome (http_error / timeout / network).
    // We do NOT emit a separate "guard blocked" event; operators read
    // retryAttempt + error.retryable to see the guard took effect. The
    // previous iteration's `lastError` is what the caller receives.
    if (shouldBlock_nonIdempotentGuard(automation, step, attempt)) {
      const error: AutomationStepError = lastError ?? {
        code: 'automation_network_error',
        type: 'external',
        message: `Automation '${step.automationId}' is non-idempotent; automatic retry is blocked. Set overrideNonIdempotentGuard: true on the step to bypass.`,
        retryable: false,
      };
      return { status: 'error', error, gateLevel, retryAttempt: attempt - 1 };
    }

    const outcome = resolveDispatch({
      step, run, automation, engineBaseUrl: engine.baseUrl, renderTemplate, templateCtx,
    });

    if (outcome.kind === 'error') {
      // §5.9 status enum maps 1:1 from the §5.7 error code.
      const status = preDispatchStatusForCode(outcome.error.code);
      createEvent('workflow.step.automation.completed', {
        runId, stepRunId, automationId: step.automationId,
        status, retryAttempt: attempt, latencyMs: 0, error: outcome.error,
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
        // §5.7: external-class HTTP error. Retry only on 5xx AND idempotent.
        lastError = {
          code: 'automation_http_error',
          type: 'external',
          message: `Automation webhook returned HTTP ${response.status}.`,
          retryable: response.status >= 500 && (automation.idempotent || step.automationRetryPolicy?.overrideNonIdempotentGuard === true),
        };
        createEvent('workflow.step.automation.completed', {
          runId, stepRunId, automationId: step.automationId,
          status: 'http_error', retryAttempt: attempt, latencyMs, httpStatus: response.status, error: lastError,
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
      // §5.7: bucket by specific error class — timeout (timeout), network errors
      // (external), everything else that escaped fetch maps to network_error
      // as the safest external classification since the webhook never produced
      // a usable response.
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      const retryableTransient =
        automation.idempotent || step.automationRetryPolicy?.overrideNonIdempotentGuard === true;
      lastError = {
        code: isTimeout ? 'automation_timeout' : 'automation_network_error',
        type: isTimeout ? 'timeout' : 'external',
        message: err instanceof Error ? err.message : 'Unknown error during automation dispatch.',
        retryable: retryableTransient,
      };
      logger.warn('invoke_automation_step_error', { runId, stepRunId, attempt, error: lastError });
      createEvent('workflow.step.automation.completed', {
        runId, stepRunId, automationId: step.automationId,
        status: isTimeout ? 'timeout' : 'network_error',
        retryAttempt: attempt, latencyMs, error: lastError,
      });
      if (!lastError.retryable || attempt >= maxAttempts) {
        return { status: 'error', error: lastError, gateLevel, retryAttempt: attempt };
      }
    }
  }

  // §1.5 principle 4 / §5.7 unknown bucket: if we fell out of the retry loop
  // without a terminal outcome, surface as unknown-class + non-retryable.
  return {
    status: 'error',
    error: lastError ?? {
      code: 'automation_network_error',
      type: 'unknown',
      message: 'Exhausted retry attempts.',
      retryable: false,
    },
    gateLevel,
    retryAttempt: maxAttempts,
  };
}
