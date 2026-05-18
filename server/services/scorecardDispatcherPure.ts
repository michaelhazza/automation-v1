// server/services/scorecardDispatcherPure.ts
// Pure routing helper for the deterministic-validator dispatcher.
// No side effects — fully unit-testable without a DB or network.
// Deterministic-validators spec §7, §11 Step 3.

import type { QualityCheck } from '../db/schema/scorecards.js';
import type { Validator } from '../lib/scorecardValidators/types.js';

// ---------------------------------------------------------------------------
// DispatchPlan — tagged union representing the routing decision
// ---------------------------------------------------------------------------

export type DispatchPlan =
  | { kind: 'deterministic'; validator: Validator }
  | { kind: 'deterministic_external'; validator: Validator }
  | { kind: 'hybrid'; preconditions: Validator[]; preconditionParams: Array<Record<string, unknown>> }
  | { kind: 'semantic' }
  | { kind: 'inconclusive'; reason: 'catalogue_miss' | 'parameter_mismatch' | 'excluded_validator'; detail: string };

// ---------------------------------------------------------------------------
// Parameter schema validation helpers
// ---------------------------------------------------------------------------

function validateParameters(
  validator: Validator,
  parameters: Record<string, unknown>,
): { valid: true } | { valid: false; detail: string } {
  for (const field of validator.parameterSchema) {
    if (field.required && !(field.name in parameters)) {
      return { valid: false, detail: `missing required parameter "${field.name}" for validator "${validator.slug}"` };
    }
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// planDispatch — pure routing decision
// Invariant #1: unknown slug → inconclusive, never semantic fallback.
// ---------------------------------------------------------------------------

export function planDispatch(
  qc: QualityCheck,
  getValidator: (slug: string) => Validator | undefined,
): DispatchPlan {
  const kind = qc.kind ?? 'semantic';

  if (kind === 'semantic') {
    return { kind: 'semantic' };
  }

  if (kind === 'deterministic') {
    const slug = qc.validatorSlug;
    if (!slug) {
      return {
        kind: 'inconclusive',
        reason: 'catalogue_miss',
        detail: 'quality check kind is "deterministic" but no validatorSlug is set',
      };
    }
    const validator = getValidator(slug);
    if (!validator) {
      return {
        kind: 'inconclusive',
        reason: 'catalogue_miss',
        detail: `validator slug "${slug}" is not registered or its tests are failing`,
      };
    }
    const params = qc.validatorParameters ?? {};
    const check = validateParameters(validator, params);
    if (!check.valid) {
      return { kind: 'inconclusive', reason: 'parameter_mismatch', detail: check.detail };
    }
    if (validator.kind === 'deterministic') {
      return { kind: 'deterministic', validator };
    }
    if (validator.kind === 'deterministic_external') {
      return { kind: 'deterministic_external', validator };
    }
    // hybrid_precondition validator used as top-level deterministic check — not allowed
    return {
      kind: 'inconclusive',
      reason: 'catalogue_miss',
      detail: `validator "${slug}" has kind "hybrid_precondition" and cannot be used as a top-level deterministic check`,
    };
  }

  if (kind === 'hybrid') {
    const slugs = qc.preconditionSlugs ?? [];
    const paramsList = qc.preconditionParameters ?? [];

    if (slugs.length === 0) {
      // No preconditions — degenerate hybrid, fall through to semantic
      return { kind: 'semantic' };
    }

    const preconditions: Validator[] = [];
    const preconditionParams: Array<Record<string, unknown>> = [];

    for (let i = 0; i < slugs.length; i++) {
      const slug = slugs[i]!;
      const validator = getValidator(slug);
      if (!validator) {
        return {
          kind: 'inconclusive',
          reason: 'catalogue_miss',
          detail: `precondition validator slug "${slug}" is not registered or its tests are failing`,
        };
      }
      if (validator.kind === 'hybrid_precondition') {
        return {
          kind: 'inconclusive',
          reason: 'catalogue_miss',
          detail: `precondition validator "${slug}" has kind "hybrid_precondition" which cannot itself be used as a precondition (composition cycle prevention)`,
        };
      }
      const params = paramsList[i] ?? {};
      const check = validateParameters(validator, params);
      if (!check.valid) {
        return { kind: 'inconclusive', reason: 'parameter_mismatch', detail: check.detail };
      }
      preconditions.push(validator);
      preconditionParams.push(params);
    }

    return { kind: 'hybrid', preconditions, preconditionParams };
  }

  // Exhaustive fallback — should never reach here with valid QualityCheck.kind values
  return { kind: 'semantic' };
}
