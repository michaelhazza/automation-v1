import type { AskField } from './askForm';

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>; // fieldKey → error message
}

/**
 * Pure validator for ask-form submissions. Used by:
 *
 *   - client (`client/src/components/openTask/AskFormCard.tsx`) for inline UX
 *   - server (`server/services/askFormSubmissionService.ts`) as the contract
 *     enforcement boundary
 *
 * Both call sites import from this single source so the client UX cannot
 * accept inputs the server will then reject (or vice versa). Add new field
 * shapes here once and both ends pick them up.
 */
export function validateAskForm(
  fields: AskField[],
  values: Record<string, unknown>,
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = values[field.key];

    if (field.required) {
      if (
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      ) {
        errors[field.key] = field.error_message ?? 'This field is required';
        continue;
      }
    }

    if (value !== undefined && value !== null && value !== '') {
      if (field.type === 'number' && isNaN(Number(value))) {
        errors[field.key] = field.error_message ?? 'Enter a valid number';
      }
      if (field.type === 'date' && isNaN(Date.parse(String(value)))) {
        errors[field.key] = field.error_message ?? 'Enter a valid date';
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
