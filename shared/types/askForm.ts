/**
 * askForm.ts — Ask form schema and submission types.
 *
 * Spec: docs/workflows-dev-spec.md §3.2, §11.
 */

export type AskFormFieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multi_select'
  | 'date';

export interface AskFormFieldDef {
  key: string;
  label: string;
  type: AskFormFieldType;
  required: boolean;
  description?: string;
  placeholder?: string;
  /** For select / multi_select */
  options?: Array<{ value: string; label: string }>;
  /** For number */
  min?: number;
  /** For number */
  max?: number;
}

export interface AskFormSchema {
  prompt: string;
  fields: AskFormFieldDef[];
  allowSkip: boolean;
}

export type AskFormValues = Record<string, string | number | boolean | string[] | null>;

export interface AskFormSubmissionOutputs {
  submitted_by: string;
  submitted_at: string;
  values: AskFormValues;
  skipped: boolean;
}
