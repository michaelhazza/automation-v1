/**
 * askInspectorPure.ts — pure helpers for the AskInspector sub-state machine.
 *
 * Spec: tasks/Workflows-spec.md §10.3 (Ask inspector, 5 sub-states).
 *
 * All functions are pure (no side effects, no React state). Designed to be
 * testable in isolation without mounting a component.
 *
 * Tests: client/src/components/studio/inspectors/__tests__/askInspectorPure.test.ts
 */

import type { AskFormFieldDef, AskFormFieldType } from '../../../../../shared/types/askForm.js';

// ─── Sub-state FSM ────────────────────────────────────────────────────────────

export type AskSubState =
  | 'default'
  | 'who_can_submit'
  | 'auto_fill'
  | 'add_field'
  | 'edit_field';

export type AskSubStateAction =
  | 'open_who_can_submit'
  | 'open_auto_fill'
  | 'open_add_field'
  | 'open_edit_field'
  | 'back'
  | 'done';

/**
 * Pure FSM: decide the next sub-state given the current state and an action.
 *
 * Transitions:
 *   default + open_who_can_submit → who_can_submit
 *   default + open_auto_fill      → auto_fill
 *   default + open_add_field      → add_field
 *   default + open_edit_field     → edit_field
 *   who_can_submit + back         → default
 *   who_can_submit + done         → default
 *   auto_fill + back              → default
 *   auto_fill + done              → default
 *   add_field + back              → default
 *   add_field + open_edit_field   → edit_field   (after selecting a field type)
 *   edit_field + back             → add_field    (when adding new) or default (when editing existing)
 *   edit_field + done             → default
 *
 * The `fromAddField` flag differentiates whether edit_field was entered via
 * add_field (back → add_field) or directly from default (back → default).
 */
export function decideAskSubState(
  currentSubState: AskSubState,
  action: AskSubStateAction,
  opts: { fromAddField?: boolean } = {}
): AskSubState {
  switch (currentSubState) {
    case 'default':
      if (action === 'open_who_can_submit') return 'who_can_submit';
      if (action === 'open_auto_fill') return 'auto_fill';
      if (action === 'open_add_field') return 'add_field';
      if (action === 'open_edit_field') return 'edit_field';
      return 'default';

    case 'who_can_submit':
      if (action === 'back' || action === 'done') return 'default';
      return 'who_can_submit';

    case 'auto_fill':
      if (action === 'back' || action === 'done') return 'default';
      return 'auto_fill';

    case 'add_field':
      if (action === 'back' || action === 'done') return 'default';
      if (action === 'open_edit_field') return 'edit_field';
      return 'add_field';

    case 'edit_field':
      if (action === 'done') return 'default';
      if (action === 'back') return opts.fromAddField ? 'add_field' : 'default';
      return 'edit_field';

    default:
      return 'default';
  }
}

// ─── Field validation ─────────────────────────────────────────────────────────

export interface ValidateAskFieldDefResult {
  valid: boolean;
  errors: Record<string, string>;
}

/**
 * Validate a field definition.
 *
 * Rules:
 * - key: required, must match /^[a-z0-9_]+$/, must be unique within `existingKeys`
 * - label: required (non-empty after trim)
 * - options: required (at least one entry) for select and multi_select
 * - min <= max when both are defined for number fields
 */
export function validateAskFieldDef(
  fieldDef: AskFormFieldDef,
  existingKeys: string[] = []
): ValidateAskFieldDefResult {
  const errors: Record<string, string> = {};

  // Key validation
  const trimKey = fieldDef.key.trim();
  if (!trimKey) {
    errors.key = 'Field key is required.';
  } else if (!/^[a-z0-9_]+$/.test(trimKey)) {
    errors.key = 'Field key must be lowercase letters, digits, and underscores only.';
  } else if (existingKeys.includes(trimKey)) {
    errors.key = `Field key "${trimKey}" is already used by another field.`;
  }

  // Label validation
  if (!fieldDef.label.trim()) {
    errors.label = 'Label is required.';
  }

  // Options validation for select types
  if (
    (fieldDef.type === 'select' || fieldDef.type === 'multi_select') &&
    (!fieldDef.options || fieldDef.options.length === 0)
  ) {
    errors.options = 'At least one option is required for select fields.';
  }

  // Min/max coherence for number fields
  if (
    fieldDef.type === 'number' &&
    fieldDef.min !== undefined &&
    fieldDef.max !== undefined &&
    fieldDef.min > fieldDef.max
  ) {
    errors.min = 'Min must be less than or equal to max.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build an empty field definition for a given type.
 * Exported so both the component and tests use the same factory.
 */
export function buildEmptyFieldDef(type: AskFormFieldType): AskFormFieldDef {
  return {
    key: '',
    label: '',
    type,
    required: false,
    description: '',
    options: type === 'select' || type === 'multi_select' ? [] : undefined,
    min: undefined,
    max: undefined,
  };
}

/**
 * Extract the unique keys from a field list, optionally excluding one index
 * (useful when validating an edit where the field at `excludeIndex` is being
 * replaced — its own key should not count as a duplicate).
 */
export function extractExistingKeys(
  fields: AskFormFieldDef[],
  excludeIndex?: number
): string[] {
  return fields
    .filter((_, i) => i !== excludeIndex)
    .map((f) => f.key.trim())
    .filter(Boolean);
}
