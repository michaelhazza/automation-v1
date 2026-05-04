import type { AskField } from '../../../../shared/types/askForm';

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>; // fieldKey → error message
}

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
