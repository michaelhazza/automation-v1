/**
 * askInspectorPure.test.ts
 *
 * Pure-logic tests for AskInspector state-machine helpers.
 * No DOM or React required.
 *
 * Run via:
 *   npx vitest run client/src/components/studio/inspectors/__tests__/askInspectorPure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  decideAskSubState,
  validateAskFieldDef,
  buildEmptyFieldDef,
  extractExistingKeys,
} from '../askInspectorPure.js';
import type { AskFormFieldDef } from '../../../../../../shared/types/askForm.js';

// ─── decideAskSubState ────────────────────────────────────────────────────────

describe('decideAskSubState — default transitions', () => {
  test('open_who_can_submit → who_can_submit', () => {
    expect(decideAskSubState('default', 'open_who_can_submit')).toBe('who_can_submit');
  });

  test('open_auto_fill → auto_fill', () => {
    expect(decideAskSubState('default', 'open_auto_fill')).toBe('auto_fill');
  });

  test('open_add_field → add_field', () => {
    expect(decideAskSubState('default', 'open_add_field')).toBe('add_field');
  });

  test('open_edit_field → edit_field', () => {
    expect(decideAskSubState('default', 'open_edit_field')).toBe('edit_field');
  });

  test('unknown action stays in default', () => {
    // 'back' from default is a no-op
    expect(decideAskSubState('default', 'back')).toBe('default');
  });
});

describe('decideAskSubState — who_can_submit transitions', () => {
  test('back → default', () => {
    expect(decideAskSubState('who_can_submit', 'back')).toBe('default');
  });

  test('done → default', () => {
    expect(decideAskSubState('who_can_submit', 'done')).toBe('default');
  });

  test('open_who_can_submit stays (no transition defined)', () => {
    expect(decideAskSubState('who_can_submit', 'open_who_can_submit')).toBe('who_can_submit');
  });
});

describe('decideAskSubState — auto_fill transitions', () => {
  test('back → default', () => {
    expect(decideAskSubState('auto_fill', 'back')).toBe('default');
  });

  test('done → default', () => {
    expect(decideAskSubState('auto_fill', 'done')).toBe('default');
  });
});

describe('decideAskSubState — add_field transitions', () => {
  test('back → default', () => {
    expect(decideAskSubState('add_field', 'back')).toBe('default');
  });

  test('done → default', () => {
    expect(decideAskSubState('add_field', 'done')).toBe('default');
  });

  test('open_edit_field → edit_field (after selecting a type)', () => {
    expect(decideAskSubState('add_field', 'open_edit_field')).toBe('edit_field');
  });
});

describe('decideAskSubState — edit_field transitions', () => {
  test('done → default', () => {
    expect(decideAskSubState('edit_field', 'done')).toBe('default');
  });

  test('back without fromAddField → default (editing existing field)', () => {
    expect(decideAskSubState('edit_field', 'back', { fromAddField: false })).toBe('default');
  });

  test('back with fromAddField=true → add_field (adding new field)', () => {
    expect(decideAskSubState('edit_field', 'back', { fromAddField: true })).toBe('add_field');
  });

  test('back without opts defaults to default', () => {
    expect(decideAskSubState('edit_field', 'back')).toBe('default');
  });
});

// ─── validateAskFieldDef ──────────────────────────────────────────────────────

describe('validateAskFieldDef — key validation', () => {
  test('valid key + label: valid = true, no errors', () => {
    const result = validateAskFieldDef({ key: 'customer_name', label: 'Customer name', type: 'short_text', required: false });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  test('empty key: error', () => {
    const result = validateAskFieldDef({ key: '', label: 'Name', type: 'short_text', required: false });
    expect(result.valid).toBe(false);
    expect(result.errors.key).toBeDefined();
  });

  test('whitespace-only key: error', () => {
    const result = validateAskFieldDef({ key: '  ', label: 'Name', type: 'short_text', required: false });
    expect(result.valid).toBe(false);
    expect(result.errors.key).toBeDefined();
  });

  test('key with uppercase: error', () => {
    const result = validateAskFieldDef({ key: 'CustomerName', label: 'Name', type: 'short_text', required: false });
    expect(result.valid).toBe(false);
    expect(result.errors.key).toContain('lowercase');
  });

  test('key with hyphens: error', () => {
    const result = validateAskFieldDef({ key: 'my-key', label: 'Name', type: 'short_text', required: false });
    expect(result.valid).toBe(false);
    expect(result.errors.key).toBeDefined();
  });

  test('key with spaces: error', () => {
    const result = validateAskFieldDef({ key: 'my key', label: 'Name', type: 'short_text', required: false });
    expect(result.valid).toBe(false);
  });

  test('key that duplicates an existing key: error', () => {
    const result = validateAskFieldDef(
      { key: 'email', label: 'Email', type: 'short_text', required: false },
      ['email', 'name']
    );
    expect(result.valid).toBe(false);
    expect(result.errors.key).toContain('already used');
  });

  test('key unique in context: no key error', () => {
    const result = validateAskFieldDef(
      { key: 'phone', label: 'Phone', type: 'short_text', required: false },
      ['email', 'name']
    );
    expect(result.errors.key).toBeUndefined();
  });
});

describe('validateAskFieldDef — label validation', () => {
  test('empty label: error', () => {
    const result = validateAskFieldDef({ key: 'foo', label: '', type: 'short_text', required: false });
    expect(result.valid).toBe(false);
    expect(result.errors.label).toBeDefined();
  });

  test('whitespace-only label: error', () => {
    const result = validateAskFieldDef({ key: 'foo', label: '   ', type: 'short_text', required: false });
    expect(result.valid).toBe(false);
    expect(result.errors.label).toBeDefined();
  });
});

describe('validateAskFieldDef — select options', () => {
  test('select without options: error', () => {
    const result = validateAskFieldDef({
      key: 'status',
      label: 'Status',
      type: 'select',
      required: false,
      options: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.options).toBeDefined();
  });

  test('select with undefined options: error', () => {
    const result = validateAskFieldDef({
      key: 'status',
      label: 'Status',
      type: 'select',
      required: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.options).toBeDefined();
  });

  test('select with options: valid', () => {
    const result = validateAskFieldDef({
      key: 'status',
      label: 'Status',
      type: 'select',
      required: false,
      options: [{ value: 'active', label: 'Active' }],
    });
    expect(result.errors.options).toBeUndefined();
  });

  test('multi_select without options: error', () => {
    const result = validateAskFieldDef({
      key: 'tags',
      label: 'Tags',
      type: 'multi_select',
      required: false,
      options: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.options).toBeDefined();
  });

  test('short_text ignores options check', () => {
    const result = validateAskFieldDef({
      key: 'note',
      label: 'Note',
      type: 'short_text',
      required: false,
    });
    expect(result.errors.options).toBeUndefined();
  });
});

describe('validateAskFieldDef — number min/max', () => {
  test('min > max: error on min', () => {
    const result = validateAskFieldDef({
      key: 'age',
      label: 'Age',
      type: 'number',
      required: false,
      min: 100,
      max: 50,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.min).toBeDefined();
  });

  test('min === max: valid', () => {
    const result = validateAskFieldDef({
      key: 'age',
      label: 'Age',
      type: 'number',
      required: false,
      min: 50,
      max: 50,
    });
    expect(result.errors.min).toBeUndefined();
  });

  test('min < max: valid', () => {
    const result = validateAskFieldDef({
      key: 'age',
      label: 'Age',
      type: 'number',
      required: false,
      min: 0,
      max: 120,
    });
    expect(result.errors.min).toBeUndefined();
  });

  test('only min defined: no min/max error', () => {
    const result = validateAskFieldDef({
      key: 'age',
      label: 'Age',
      type: 'number',
      required: false,
      min: 0,
    });
    expect(result.errors.min).toBeUndefined();
  });

  test('only max defined: no min/max error', () => {
    const result = validateAskFieldDef({
      key: 'age',
      label: 'Age',
      type: 'number',
      required: false,
      max: 200,
    });
    expect(result.errors.min).toBeUndefined();
  });
});

// ─── buildEmptyFieldDef ───────────────────────────────────────────────────────

describe('buildEmptyFieldDef', () => {
  test('short_text: no options', () => {
    const f = buildEmptyFieldDef('short_text');
    expect(f.type).toBe('short_text');
    expect(f.options).toBeUndefined();
    expect(f.key).toBe('');
    expect(f.required).toBe(false);
  });

  test('select: options is empty array', () => {
    const f = buildEmptyFieldDef('select');
    expect(f.options).toEqual([]);
  });

  test('multi_select: options is empty array', () => {
    const f = buildEmptyFieldDef('multi_select');
    expect(f.options).toEqual([]);
  });

  test('number: min and max undefined', () => {
    const f = buildEmptyFieldDef('number');
    expect(f.min).toBeUndefined();
    expect(f.max).toBeUndefined();
  });
});

// ─── extractExistingKeys ──────────────────────────────────────────────────────

describe('extractExistingKeys', () => {
  const fields: AskFormFieldDef[] = [
    { key: 'name', label: 'Name', type: 'short_text', required: true },
    { key: 'email', label: 'Email', type: 'short_text', required: true },
    { key: 'age', label: 'Age', type: 'number', required: false },
  ];

  test('no exclude: returns all keys', () => {
    expect(extractExistingKeys(fields)).toEqual(['name', 'email', 'age']);
  });

  test('excludeIndex=0: excludes name', () => {
    expect(extractExistingKeys(fields, 0)).toEqual(['email', 'age']);
  });

  test('excludeIndex=1: excludes email', () => {
    expect(extractExistingKeys(fields, 1)).toEqual(['name', 'age']);
  });

  test('empty fields: empty array', () => {
    expect(extractExistingKeys([])).toEqual([]);
  });

  test('fields with empty keys are filtered out', () => {
    const withEmpty: AskFormFieldDef[] = [
      { key: '', label: 'Empty', type: 'short_text', required: false },
      { key: 'real', label: 'Real', type: 'short_text', required: false },
    ];
    expect(extractExistingKeys(withEmpty)).toEqual(['real']);
  });
});
