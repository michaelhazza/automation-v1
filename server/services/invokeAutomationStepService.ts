/**
 * Stateful wrapper around the pure invoke_automation dispatcher. §5.3 / §5.9.
 * Owns: webhook fetch, retry loop, HMAC signing, tracing emission, engine/connection resolution.
 * All decision logic lives in invokeAutomationStepPure.ts.
 */

import { db } from '../db/index.js';
import { automations } from '../db/schema/automations.js';
import { automationEngines } from '../db/schema/automationEngines.js';
import { eq, and, isNull, or } from 'drizzle-orm';
import { automationConnectionMappingService } from './automationConnectionMappingService.js';
import { resolveRequiredConnections } from './resolveRequiredConnectionsPure.js';
import { buildEngineAuthHeaders } from '../lib/engineAuth.js';
import { logger } from '../lib/logger.js';
import { createEvent } from '../lib/tracing.js';
import { webhookService } from './webhookService.js';
import type { InvokeAutomationStep, AutomationStepError } from '../lib/workflow/types.js';
import { resolveInputs } from '../lib/workflow/templating.js';
import {
  resolveDispatch,
  resolveGateLevel,
  checkScope,
  shouldBlock_nonIdempotentGuard,
  clampMaxAttempts,
  validateDispatchOutput,
  projectOutputMapping,
  type RunScope,
  type TemplateCtx,
} from './invokeAutomationStepPure.js';

/** §5.9 completed-event `status` values — 10-entry enum per §5.7 vocabulary. */
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
      // Unknown pre-dispatch code — classify as composition-invalid so operators
      // investigate the step definition rather than the automation itself.
      logger.warn('invoke_automation_unknown_predispatch_code', { code });
      return 'automation_composition_invalid';
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
  /**
   * When true, the gate check is skipped. Set by `resumeInvokeAutomationStep`
   * after an `awaiting_approval` step has been explicitly approved — the
   * approval is the gate clearance, so re-running `resolveGateLevel` here
   * would incorrectly hold the step at `review_required` again. Default
   * false; the primary dispatch path keeps gate enforcement intact.
   */
  bypassGate?: boolean;
}

// W1-43: pure assertion — automation must have exactly one outbound webhook.
// Returns null when valid; returns an AutomationStepError when violated.
function assertSingleWebhook(automation: { id: string; webhookPath: string | null }): AutomationStepError | null {
  const webhookFields = [automation.webhookPath].filter((v) => v != null && v !== '');
  if (webhookFields.length !== 1) {
    return {
      code: 'automation_composition_invalid',
      type: 'execution',
      message: `Automation '${automation.id}' must have exactly one outbound webhook; found ${webhookFields.length}.`,
      retryable: false,
    };
  }
  return null;
}

export async function invokeAutomationStep(
  params: InvokeAutomationParams,
): Promise<InvokeAutomationResult> {
  const { step, runId, stepRunId, run, templateCtx, bypassGate } = params;

  const baseEventPayload = {
    runId,
    stepId: step.id,   // §5.9: DSL-level step identifier, not the step-run row id
    automationId: step.automationId,
    orgId: run.organisationId,
    subaccountId: run.subaccountId,
  };

  // Load automation row — include soft-delete guard (§5.10 edge 1)
  const [automation] = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.id, step.automationId),
        isNull(automations.deletedAt),
      ),
    );

  if (!automation) {
    const error: AutomationStepError = {
      code: 'automation_not_found',
      type: 'execution',
      message: `Automation '${step.automationId}' not found.`,
      retryable: false,
    };
    createEvent('workflow.step.automation.completed', {
      ...baseEventPayload, status: 'automation_not_found', retryAttempt: 1, latencyMs: 0, error,
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
      ...baseEventPayload, status: 'automation_scope_mismatch', retryAttempt: 1, latencyMs: 0, error,
    });
    return { status: 'error', error, gateLevel: resolveGateLevel(step, automation), retryAttempt: 1 };
  }

  // §1.2 REQ W1-44: pre-dispatch connection resolution — verify every required
  // connection slot is mapped for the calling subaccount BEFORE firing the webhook.
  // Only evaluated when the run is subaccount-scoped (org-level runs have no subaccount
  // connection mappings to check).
  // listMappings is called per-dispatch. This is intentionally non-cached — if this
  // becomes hot, introduce caching via a separate spec.
  if (run.subaccountId) {
    const requiredKeys = (automation.requiredConnections ?? [])
      .filter((c) => c.required)
      .map((c) => c.key);

    if (requiredKeys.length > 0) {
      const rawMappings = await automationConnectionMappingService.listMappings(
        run.organisationId,
        run.subaccountId,
        automation.id,
      );
      const resolution = resolveRequiredConnections({
        automation: { requiredConnections: requiredKeys },
        subaccountId: run.subaccountId,
        mappings: rawMappings.map((m) => ({
          connectionKey: m.connectionKey,
          connectionId: m.connectionId,
        })),
      });
      if (!resolution.ok) {
        const error: AutomationStepError = {
          code: 'automation_missing_connection',
          type: 'configuration',
          message: `Automation '${automation.id}' is missing required connections: ${resolution.missing.join(', ')}`,
          retryable: false,
          status: 'missing_connection',
          context: {
            automationId: automation.id,
            missingKeys: resolution.missing,
          },
        };
        createEvent('workflow.step.automation.completed', {
          ...baseEventPayload, status: 'missing_connection', retryAttempt: 1, latencyMs: 0, error,
        });
        return { status: 'error', error, gateLevel: resolveGateLevel(step, automation), retryAttempt: 1 };
      }
    }
  }

  // W1-43: defence-in-depth single-webhook assertion before engine load.
  // Schema enforces single-webhook via the webhookPath text column, but a
  // mutated or migrated row could violate the contract via a non-schema path.
  const webhookErr = assertSingleWebhook(automation);
  if (webhookErr) {
    createEvent('workflow.step.automation.completed', {
      ...baseEventPayload, status: 'automation_composition_invalid',
      retryAttempt: 1, latencyMs: 0, error: webhookErr,
    });
    return { status: 'error', error: webhookErr, gateLevel: resolveGateLevel(step, automation), retryAttempt: 1 };
  }

  // Load engine — scoped to automation's org (or system), soft-delete guarded
  const automationEngineId = automation.automationEngineId;
  if (!automationEngineId) {
    const error: AutomationStepError = {
      code: 'automation_composition_invalid',
      type: 'execution',
      message: `Automation '${step.automationId}' has no engine assigned.`,
      retryable: false,
    };
    createEvent('workflow.step.automation.completed', {
      ...baseEventPayload, status: 'automation_composition_invalid', retryAttempt: 1, latencyMs: 0, error,
    });
    return { status: 'error', error, gateLevel: resolveGateLevel(step, automation), retryAttempt: 1 };
  }

  const [engine] = await db
    .select()
    .from(automationEngines)
    .where(
      and(
        eq(automationEngines.id, automationEngineId),
        isNull(automationEngines.deletedAt),
        // Enforce org scope — engine must belong to the automation's org or be system-scoped.
        // System automations (organisationId=null) may only use system-scoped engines.
        automation.organisationId
          ? or(
              eq(automationEngines.organisationId, automation.organisationId),
              isNull(automationEngines.organisationId),
            )
          : isNull(automationEngines.organisationId),
      ),
    );

  if (!engine) {
    const error: AutomationStepError = {
      code: 'automation_composition_invalid',
      type: 'execution',
      message: `Automation engine for '${step.automationId}' could not be resolved.`,
      retryable: false,
    };
    createEvent('workflow.step.automation.completed', {
      ...baseEventPayload, status: 'automation_composition_invalid', retryAttempt: 1, latencyMs: 0, error,
    });
    return { status: 'error', error, gateLevel: resolveGateLevel(step, automation), retryAttempt: 1 };
  }

  const gateLevel = resolveGateLevel(step, automation);

  // Gate check — if review required, return without dispatching. Skipped when
  // bypassGate is set: the resume path enters here after explicit approval,
  // and re-running the gate would loop back to review_required forever.
  if (gateLevel === 'review' && !bypassGate) {
    return { status: 'review_required', gateLevel, retryAttempt: 1 };
  }

  // §5.4: use resolveInputs (not renderString) so native types (number, array,
  // object) are preserved in the webhook body. renderString always returns a
  // string, which breaks JSON-shaped webhooks.
  const renderTemplate = (expr: string, ctx: TemplateCtx) =>
    resolveInputs({ _v: expr }, ctx as unknown as Parameters<typeof resolveInputs>[1])._v as unknown;

  const maxAttempts = clampMaxAttempts(step.automationRetryPolicy?.maxAttempts);
  const authHeaders = buildEngineAuthHeaders(engine.engineType, engine.apiKey ?? undefined);
  const timeoutMs = (step.timeoutSeconds ?? 300) * 1000; // §5.3: default 300s

  let lastError: AutomationStepError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Non-idempotent retry guard (§5.4a rule 3).
    if (shouldBlock_nonIdempotentGuard(automation, step, attempt)) {
      const error: AutomationStepError = lastError ?? {
        code: 'automation_network_error',
        type: 'external',
        message: `Automation '${step.automationId}' is non-idempotent; retry blocked. Set overrideNonIdempotentGuard: true to bypass.`,
        retryable: false,
      };
      return { status: 'error', error, gateLevel, retryAttempt: attempt - 1 };
    }

    const outcome = resolveDispatch({
      step, run, automation,
      engineBaseUrl: engine.baseUrl.replace(/\/$/, ''),
      renderTemplate,
      templateCtx,
    });

    if (outcome.kind === 'error') {
      const status = preDispatchStatusForCode(outcome.error.code);
      createEvent('workflow.step.automation.completed', {
        ...baseEventPayload, status, retryAttempt: attempt, latencyMs: 0, error: outcome.error,
      });
      return { status: 'error', error: outcome.error, gateLevel, retryAttempt: attempt };
    }

    if (outcome.kind === 'skip') {
      return { status: 'ok', output: {}, gateLevel, retryAttempt: attempt };
    }

    // Dispatch — HMAC sign the outbound request (§5.8 re-uses existing per-engine signing)
    const start = Date.now();
    const hmacSignature = webhookService.signOutboundRequest(stepRunId, engine.hmacSecret);

    createEvent('workflow.step.automation.dispatched', {
      ...baseEventPayload,
      automationEngineId: engine.id,
      engineType: engine.engineType,
      retryAttempt: attempt,
    });

    try {
      const response = await fetch(outcome.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // §5.8: signed material must be recoverable by the receiver so HMAC is
          // verifiable; also serves as a stable idempotency key across retries
          // (hmacSignature is computed over stepRunId and stepRunId is stable
          // for the life of the step, so retries hit the same dedup key).
          'X-Webhook-Signature': hmacSignature,
          'X-Automation-Step-Run-Id': stepRunId,
          ...authHeaders,
        },
        body: JSON.stringify(outcome.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - start;

      let responseBody: unknown;
      try { responseBody = await response.json(); } catch { responseBody = {}; }
      const responseSizeBytes = JSON.stringify(responseBody).length;

      if (!response.ok) {
        lastError = {
          code: 'automation_http_error',
          type: 'external',
          message: `Automation webhook returned HTTP ${response.status}.`,
          retryable:
            response.status >= 500 &&
            (automation.idempotent || step.automationRetryPolicy?.overrideNonIdempotentGuard === true),
        };
        createEvent('workflow.step.automation.completed', {
          ...baseEventPayload,
          status: 'http_error', retryAttempt: attempt, latencyMs,
          httpStatus: response.status, responseSizeBytes, error: lastError,
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
          ...baseEventPayload,
          status: 'output_validation_failed', retryAttempt: attempt, latencyMs,
          responseSizeBytes, error: outputCheck.error,
        });
        return { status: 'error', error: outputCheck.error, gateLevel, retryAttempt: attempt };
      }

      const output = projectOutputMapping(responseBody, step.outputMapping, renderTemplate, templateCtx);

      createEvent('workflow.step.automation.completed', {
        ...baseEventPayload, status: 'ok', retryAttempt: attempt, latencyMs, responseSizeBytes,
      });
      return { status: 'ok', output, gateLevel, retryAttempt: attempt };

    } catch (err) {
      const latencyMs = Date.now() - start;
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      const retryableTransient =
        automation.idempotent || step.automationRetryPolicy?.overrideNonIdempotentGuard === true;
      lastError = {
        code: isTimeout ? 'automation_timeout' : 'automation_network_error',
        type: isTimeout ? 'timeout' : 'external',
        message: err instanceof Error ? err.message : 'Unknown error during automation dispatch.',
        retryable: retryableTransient,
      };
      logger.warn('invoke_automation_step_error', { runId, stepRunId: stepRunId, attempt, error: lastError });
      createEvent('workflow.step.automation.completed', {
        ...baseEventPayload,
        status: isTimeout ? 'timeout' : 'network_error',
        retryAttempt: attempt, latencyMs, error: lastError,
      });
      if (!lastError.retryable || attempt >= maxAttempts) {
        return { status: 'error', error: lastError, gateLevel, retryAttempt: attempt };
      }
    }
  }

  // Belt-and-braces fallthrough guard — should not be reached under normal control flow
  logger.warn('invoke_automation_unexpected_loop_exit', { runId, stepId: step.id });
  return {
    status: 'error',
    error: lastError ?? {
      code: 'automation_network_error',
      type: 'unknown',
      message: 'Exhausted retry attempts without a terminal outcome.',
      retryable: false,
    },
    gateLevel,
    retryAttempt: maxAttempts,
  };
}
