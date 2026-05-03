/**
 * askFormAutoFillServicePure.ts — pure helpers for auto-fill key+type matching.
 *
 * Rule: only pre-fill a field when BOTH the key AND the type match the prior
 * submission. Type change means a schema evolution — treat as a new field.
 *
 * Spec: docs/workflows-dev-spec.md §11 (auto-fill on re-run).
 */

import type { AskFormFieldDef, AskFormValues } from '../../../shared/types/askForm.js';

/**
 * Filter prior values so that only keys where the current field type matches
 * the inferred prior type are returned.
 *
 * Type inference from prior value:
 *   - boolean → 'boolean'
 *   - number  → 'number'
 *   - string[] / array → 'multi_select'
 *   - string  → 'short_text' | 'long_text' | 'select' | 'date'
 *              (we cannot distinguish between these from value alone,
 *               so for string-valued field types we allow pre-fill when
 *               the current field type is one of those string types)
 *   - null    → no pre-fill
 */
export function filterByKeyTypeMatch(
  currentFields: AskFormFieldDef[],
  priorValues: AskFormValues,
): AskFormValues {
  const result: AskFormValues = {};

  for (const field of currentFields) {
    if (!Object.prototype.hasOwnProperty.call(priorValues, field.key)) continue;
    const prior = priorValues[field.key];
    if (prior === null || prior === undefined) continue;

    const priorType = inferValueType(prior);
    if (typesCompatible(priorType, field.type)) {
      result[field.key] = prior;
    }
  }

  return result;
}

type InferredType = 'boolean' | 'number' | 'string' | 'array' | 'unknown';

function inferValueType(value: unknown): InferredType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'array';
  return 'unknown';
}

const STRING_FIELD_TYPES = new Set<string>([
  'short_text',
  'long_text',
  'select',
  'date',
]);

function typesCompatible(inferred: InferredType, currentType: string): boolean {
  switch (inferred) {
    case 'boolean': return currentType === 'boolean';
    case 'number':  return currentType === 'number';
    case 'array':   return currentType === 'multi_select';
    case 'string':  return STRING_FIELD_TYPES.has(currentType);
    default:        return false;
  }
}
