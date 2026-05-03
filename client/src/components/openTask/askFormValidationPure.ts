/**
 * askFormValidationPure.ts — pure client-side validation for Ask form fields.
 *
 * Spec: docs/workflows-dev-spec.md §11.3.
 * No side effects. No network calls. No React.
 */

import type { AskFormSchema, AskFormValues, AskFormFieldDef } from '../../../../shared/types/askForm.js';

export interface AskFormValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

const SHORT_TEXT_MAX = 256;
const LONG_TEXT_MAX = 8192;

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isValidIsoDate(value: string): boolean {
  // Accept YYYY-MM-DD format (the value from <input type="date">)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

function validateField(field: AskFormFieldDef, value: unknown): string | null {
  // Required check (runs for all types)
  if (field.required && isEmpty(value)) {
    return 'This field is required';
  }

  // Type-specific checks only when value is present
  if (isEmpty(value)) return null;

  switch (field.type) {
    case 'short_text': {
      if (typeof value !== 'string') return null;
      if (value.length > SHORT_TEXT_MAX) return `Must be ${SHORT_TEXT_MAX} characters or fewer`;
      return null;
    }
    case 'long_text': {
      if (typeof value !== 'string') return null;
      if (value.length > LONG_TEXT_MAX) return `Must be ${LONG_TEXT_MAX} characters or fewer`;
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || !isFinite(value)) return 'Must be a number';
      if (field.min !== undefined && value < field.min) return `Must be ${field.min} or greater`;
      if (field.max !== undefined && value > field.max) return `Must be ${field.max} or less`;
      return null;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return 'Must be true or false';
      return null;
    }
    case 'select': {
      const opts = field.options ?? [];
      if (!opts.some((o: { value: string; label: string }) => o.value === value)) return 'Invalid selection';
      return null;
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return 'Invalid selection';
      const opts = field.options ?? [];
      const invalid = (value as unknown[]).some(
        (v) => !opts.some((o: { value: string; label: string }) => o.value === v),
      );
      if (invalid) return 'Invalid selection';
      return null;
    }
    case 'date': {
      if (typeof value !== 'string') return 'Invalid date';
      if (!isValidIsoDate(value)) return 'Invalid date';
      return null;
    }
    default:
      return null;
  }
}

export function validateAskForm(
  schema: AskFormSchema,
  values: AskFormValues,
): AskFormValidationResult {
  const errors: Record<string, string> = {};

  for (const field of schema.fields) {
    const value = Object.prototype.hasOwnProperty.call(values, field.key)
      ? values[field.key]
      : null;
    const err = validateField(field, value);
    if (err) errors[field.key] = err;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
