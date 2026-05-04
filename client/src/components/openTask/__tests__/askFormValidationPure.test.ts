import { describe, expect, it } from 'vitest';
import { validateAskForm } from '../askFormValidationPure.js';
import type { AskField } from '../../../../../shared/types/askForm.js';

function makeField(overrides: Partial<AskField> & { key: string; type: AskField['type'] }): AskField {
  return {
    label: overrides.key,
    required: false,
    ...overrides,
  };
}

describe('validateAskForm', () => {
  it('required text field empty returns error', () => {
    const fields = [makeField({ key: 'name', type: 'text', required: true })];
    const result = validateAskForm(fields, {});
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBeTruthy();
  });

  it('required text field with value returns no error', () => {
    const fields = [makeField({ key: 'name', type: 'text', required: true })];
    const result = validateAskForm(fields, { name: 'Alice' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('number field with non-numeric value returns error', () => {
    const fields = [makeField({ key: 'age', type: 'number', required: false })];
    const result = validateAskForm(fields, { age: 'abc' });
    expect(result.valid).toBe(false);
    expect(result.errors.age).toBeTruthy();
  });

  it('date field with invalid date returns error', () => {
    const fields = [makeField({ key: 'dob', type: 'date', required: false })];
    const result = validateAskForm(fields, { dob: 'not-a-date' });
    expect(result.valid).toBe(false);
    expect(result.errors.dob).toBeTruthy();
  });

  it('required multi-select with empty array returns error', () => {
    const fields = [makeField({ key: 'tags', type: 'multi-select', required: true })];
    const result = validateAskForm(fields, { tags: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.tags).toBeTruthy();
  });

  it('all fields valid returns valid true and empty errors', () => {
    const fields = [
      makeField({ key: 'name', type: 'text', required: true }),
      makeField({ key: 'age', type: 'number', required: false }),
    ];
    const result = validateAskForm(fields, { name: 'Bob', age: '30' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('optional field missing returns no error', () => {
    const fields = [makeField({ key: 'notes', type: 'textarea', required: false })];
    const result = validateAskForm(fields, {});
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });
});
