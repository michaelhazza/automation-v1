/**
 * Pure-function dispatcher for invoke_automation Workflow steps. §5.3 / §5.4a / §5.7 / §5.8.
 *
 * No database, no HTTP, no I/O. All side-effectful operations are injected as
 * functions so this module is fully unit-testable. The stateful wrapper
 * (invokeAutomationStepService.ts) owns I/O and calls into this module.
 *
 * Spec §11.2 Part 2 unit-test surface.
 */

import type { Automation } from '../db/schema/automations.js';
import type { InvokeAutomationStep, AutomationStepError } from '../lib/workflow/types.js';
import { validateInput, validateOutput, type SchemaValidationResult } from '../lib/workflow/invokeAutomationSchemaValidator.js';

// F15 — named export for the pure-test surface (same implementation as the
// internal validateInput; exposed here so callers don't reach into the lib
// directly).
export function validateInputAgainstSchema(
  data: unknown,
  schemaText: string | null | undefined,
): SchemaValidationResult {
  return validateInput(data, schemaText);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunScope {
  organisationId: string;
  subaccountId: string | null;
}

export type TemplateCtx = Record<string, unknown>;

export type DispatchOutcome =
  | { kind: 'dispatch'; webhookUrl: string; body: Record<string, unknown> }
  | { kind: 'skip'; reason: string }
  | { kind: 'error'; error: AutomationStepError };

export interface DispatchInput {
  step: InvokeAutomationStep;
  run: RunScope;
  automation: Automation;
  /** Base URL of the automation engine this automation belongs to. */
  engineBaseUrl: string;
  /** Injected template renderer — keeps this module pure. */
  renderTemplate: (expr: string, ctx: TemplateCtx) => unknown;
  templateCtx: TemplateCtx;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_RETRY_ATTEMPTS = 3;

// ── Gate resolution (§5.4a rule 1) ───────────────────────────────────────────

export function resolveGateLevel(
  step: InvokeAutomationStep,
  automation: Automation,
): 'auto' | 'review' {
  if (step.gateLevel) return step.gateLevel;
  return automation.sideEffects === 'read_only' ? 'auto' : 'review';
}

// ── Scope matching (§5.8) ─────────────────────────────────────────────────────

export function checkScope(run: RunScope, automation: Automation): boolean {
  // System-scoped automations (organisationId = null) are accessible from any run
  if (automation.organisationId === null) return true;
  // Org-scoped and subaccount-scoped automations must match the run's org
  if (automation.organisationId !== run.organisationId) return false;
  // Org-scope automation (subaccountId = null): accessible from any run in the org
  if (automation.subaccountId === null) return true;
  // Subaccount-native automation: must match run's subaccount
  return automation.subaccountId === run.subaccountId;
}

// ── Retry guard (§5.4a rule 3) ────────────────────────────────────────────────

export function shouldBlock_nonIdempotentGuard(
  automation: Automation,
  step: InvokeAutomationStep,
  attempt: number,
): boolean {
  if (attempt <= 1) return false; // first attempt is always allowed
  if (automation.idempotent) return false; // idempotent — retries allowed
  if (step.automationRetryPolicy?.overrideNonIdempotentGuard) return false;
  return true; // non-idempotent, no override → block retry
}

export function clampMaxAttempts(authored: number | undefined): number {
  if (authored === undefined) return MAX_RETRY_ATTEMPTS;
  return Math.min(authored, MAX_RETRY_ATTEMPTS);
}

// ── Input mapping resolution (§5.4) ──────────────────────────────────────────

export function resolveInputMapping(
  mapping: Record<string, string>,
  renderTemplate: (expr: string, ctx: TemplateCtx) => unknown,
  ctx: TemplateCtx,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(mapping)) {
    resolved[key] = renderTemplate(expr, ctx);
  }
  return resolved;
}

// ── Output mapping projection (§5.5) ─────────────────────────────────────────

export function projectOutputMapping(
  responseBody: unknown,
  outputMapping: Record<string, string> | undefined,
  renderTemplate: (expr: string, ctx: TemplateCtx) => unknown,
  ctx: TemplateCtx,
): Record<string, unknown> {
  if (!outputMapping) return { response: responseBody };
  // Merge responseBody into context so expressions like {{ response.id }} resolve correctly.
  const ctxWithResponse = { ...ctx, response: responseBody };
  const projected: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(outputMapping)) {
    projected[key] = renderTemplate(expr, ctxWithResponse);
  }
  return projected;
}

// ── Error helpers (§5.7) ──────────────────────────────────────────────────────

function makeError(
  code: string,
  type: AutomationStepError['type'],
  message: string,
  retryable: boolean,
): AutomationStepError {
  return { code, type, message, retryable };
}

// ── Main dispatch resolver (§5.3) ─────────────────────────────────────────────

export function resolveDispatch(input: DispatchInput): DispatchOutcome {
  const { step, run, automation, engineBaseUrl, renderTemplate, templateCtx } = input;

  // §5.8 scope check
  if (!checkScope(run, automation)) {
    return {
      kind: 'error',
      error: makeError(
        'automation_scope_mismatch',
        'execution',
        `Automation '${automation.id}' is not accessible from this run's scope.`,
        false,
      ),
    };
  }

  // §5.10a rule 4 — defence-in-depth: reject any webhookPath that would produce more than
  // one outbound webhook for the step (e.g. a comma-separated list of targets) or is empty.
  // Multi-segment paths like "/webhook/abc" are the normal shape and remain valid.
  const webhookPath = automation.webhookPath ?? '';
  if (!webhookPath || webhookPath.includes(',')) {
    return {
      kind: 'error',
      error: makeError(
        'automation_composition_invalid',
        'validation',
        `Automation '${automation.id}' has an invalid webhookPath: multi-webhook or empty paths are not supported.`,
        false,
      ),
    };
  }

  // Resolve input mapping
  let resolvedInput: Record<string, unknown>;
  try {
    resolvedInput = resolveInputMapping(step.inputMapping, renderTemplate, templateCtx);
  } catch (err) {
    return {
      kind: 'error',
      error: makeError(
        'automation_input_validation_failed',
        'validation',
        `Input mapping resolution failed: ${err instanceof Error ? err.message : String(err)}`,
        false,
      ),
    };
  }

  // Best-effort input schema validation (§5.4)
  const inputValidation = validateInput(resolvedInput, automation.inputSchema);
  if (!inputValidation.ok) {
    return {
      kind: 'error',
      error: makeError(
        'automation_input_validation_failed',
        'validation',
        `Input validation failed: ${inputValidation.errors.join('; ')}`,
        false,
      ),
    };
  }

  const normalizedPath = webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`;
  const webhookUrl = `${engineBaseUrl}${normalizedPath}`;

  return { kind: 'dispatch', webhookUrl, body: resolvedInput };
}

// ── Post-dispatch output validator (§5.5) ─────────────────────────────────────

export function validateDispatchOutput(
  responseBody: unknown,
  automation: Automation,
): { ok: true } | { ok: false; error: AutomationStepError } {
  const result = validateOutput(responseBody, automation.outputSchema);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    error: makeError(
      'automation_output_validation_failed',
      'validation',
      `Output validation failed: ${result.errors.join('; ')}`,
      false,
    ),
  };
}
