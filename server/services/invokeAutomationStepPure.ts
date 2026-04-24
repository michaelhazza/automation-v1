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
import { validateInput, validateOutput } from '../lib/workflow/invokeAutomationSchemaValidator.js';

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
  if (automation.organisationId !== run.organisationId) return false;
  // Org-scope automation: accessible from any run in the org
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
  const projected: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(outputMapping)) {
    projected[key] = renderTemplate(expr, ctx);
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
        'validation',
        `Automation '${automation.id}' is not accessible from this run's scope.`,
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

  const webhookUrl = `${engineBaseUrl}${automation.webhookPath}`;

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
