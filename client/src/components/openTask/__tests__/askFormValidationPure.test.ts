/**
 * Tests for askFormValidationPure — exhaustive coverage of every field type.
 *
 * Spec: docs/workflows-dev-spec.md §11.3.
 */

import { describe, it, expect } from 'vitest';
import { validateAskForm } from '../askFormValidationPure.js';
import type { AskFormSchema, AskFormValues } from '../../../../../shared/types/askForm.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSchema(overrides: Partial<AskFormSchema> = {}): AskFormSchema {
  return {
    prompt: 'Fill in the form',
    fields: [],
    allowSkip: false,
    ...overrides,
  };
}

// ── Required check — all types ─────────────────────────────────────────────────

describe('required check', () => {
  const fieldTypes = [
    { type: 'short_text' as const, emptyValue: '' },
    { type: 'long_text' as const, emptyValue: '' },
    { type: 'number' as const, emptyValue: null },
    { type: 'boolean' as const, emptyValue: null },
    { type: 'select' as const, emptyValue: null },
    { type: 'multi_select' as const, emptyValue: [] },
    { type: 'date' as const, emptyValue: '' },
  ];

  for (const { type, emptyValue } of fieldTypes) {
    it(`${type}: required + empty value => error`, () => {
      const schema = makeSchema({
        fields: [{ key: 'f', label: 'F', type, required: true }],
      });
      const values: AskFormValues = { f: emptyValue as never };
      const result = validateAskForm(schema, values);
      expect(result.valid).toBe(false);
      expect(result.errors.f).toBe('This field is required');
    });

    it(`${type}: required + missing key => error`, () => {
      const schema = makeSchema({
        fields: [{ key: 'f', label: 'F', type, required: true }],
      });
      const values: AskFormValues = {};
      const result = validateAskForm(schema, values);
      expect(result.valid).toBe(false);
      expect(result.errors.f).toBe('This field is required');
    });

    it(`${type}: not required + empty value => no error`, () => {
      const schema = makeSchema({
        fields: [{ key: 'f', label: 'F', type, required: false }],
      });
      const values: AskFormValues = { f: emptyValue as never };
      const result = validateAskForm(schema, values);
      expect(result.valid).toBe(true);
    });
  }
});

// ── short_text ─────────────────────────────────────────────────────────────────

describe('short_text', () => {
  const schema = makeSchema({
    fields: [{ key: 'name', label: 'Name', type: 'short_text', required: false }],
  });

  it('valid: within max length', () => {
    const result = validateAskForm(schema, { name: 'hello' });
    expect(result.valid).toBe(true);
  });

  it('invalid: exceeds 256 chars', () => {
    const result = validateAskForm(schema, { name: 'a'.repeat(257) });
    expect(result.valid).toBe(false);
    expect(result.errors.name).toMatch(/256/);
  });

  it('valid: exactly 256 chars', () => {
    const result = validateAskForm(schema, { name: 'a'.repeat(256) });
    expect(result.valid).toBe(true);
  });
});

// ── long_text ──────────────────────────────────────────────────────────────────

describe('long_text', () => {
  const schema = makeSchema({
    fields: [{ key: 'body', label: 'Body', type: 'long_text', required: false }],
  });

  it('valid: within max length', () => {
    const result = validateAskForm(schema, { body: 'hello world' });
    expect(result.valid).toBe(true);
  });

  it('invalid: exceeds 8192 chars', () => {
    const result = validateAskForm(schema, { body: 'b'.repeat(8193) });
    expect(result.valid).toBe(false);
    expect(result.errors.body).toMatch(/8192/);
  });

  it('valid: exactly 8192 chars', () => {
    const result = validateAskForm(schema, { body: 'b'.repeat(8192) });
    expect(result.valid).toBe(true);
  });
});

// ── number ─────────────────────────────────────────────────────────────────────

describe('number', () => {
  it('valid: simple number', () => {
    const schema = makeSchema({
      fields: [{ key: 'qty', label: 'Qty', type: 'number', required: false }],
    });
    const result = validateAskForm(schema, { qty: 42 });
    expect(result.valid).toBe(true);
  });

  it('invalid: NaN', () => {
    const schema = makeSchema({
      fields: [{ key: 'qty', label: 'Qty', type: 'number', required: true }],
    });
    const result = validateAskForm(schema, { qty: 'abc' as unknown as number });
    expect(result.valid).toBe(false);
    expect(result.errors.qty).toBe('Must be a number');
  });

  it('invalid: Infinity', () => {
    const schema = makeSchema({
      fields: [{ key: 'qty', label: 'Qty', type: 'number', required: true }],
    });
    const result = validateAskForm(schema, { qty: Infinity });
    expect(result.valid).toBe(false);
    expect(result.errors.qty).toBe('Must be a number');
  });

  it('invalid: below min', () => {
    const schema = makeSchema({
      fields: [{ key: 'qty', label: 'Qty', type: 'number', required: true, min: 5 }],
    });
    const result = validateAskForm(schema, { qty: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors.qty).toMatch(/5/);
  });

  it('invalid: above max', () => {
    const schema = makeSchema({
      fields: [{ key: 'qty', label: 'Qty', type: 'number', required: true, max: 10 }],
    });
    const result = validateAskForm(schema, { qty: 20 });
    expect(result.valid).toBe(false);
    expect(result.errors.qty).toMatch(/10/);
  });

  it('valid: exactly at min', () => {
    const schema = makeSchema({
      fields: [{ key: 'qty', label: 'Qty', type: 'number', required: true, min: 5 }],
    });
    const result = validateAskForm(schema, { qty: 5 });
    expect(result.valid).toBe(true);
  });

  it('valid: exactly at max', () => {
    const schema = makeSchema({
      fields: [{ key: 'qty', label: 'Qty', type: 'number', required: true, max: 10 }],
    });
    const result = validateAskForm(schema, { qty: 10 });
    expect(result.valid).toBe(true);
  });
});

// ── boolean ────────────────────────────────────────────────────────────────────

describe('boolean', () => {
  const schema = makeSchema({
    fields: [{ key: 'agree', label: 'Agree', type: 'boolean', required: true }],
  });

  it('valid: true', () => {
    const result = validateAskForm(schema, { agree: true });
    expect(result.valid).toBe(true);
  });

  it('valid: false (not required-error because false is not empty)', () => {
    const schema2 = makeSchema({
      fields: [{ key: 'agree', label: 'Agree', type: 'boolean', required: false }],
    });
    const result = validateAskForm(schema2, { agree: false });
    expect(result.valid).toBe(true);
  });

  it('invalid: string "true"', () => {
    const schema2 = makeSchema({
      fields: [{ key: 'agree', label: 'Agree', type: 'boolean', required: false }],
    });
    const result = validateAskForm(schema2, { agree: 'true' as unknown as boolean });
    expect(result.valid).toBe(false);
    expect(result.errors.agree).toBe('Must be true or false');
  });
});

// ── select ─────────────────────────────────────────────────────────────────────

describe('select', () => {
  const schema = makeSchema({
    fields: [{
      key: 'color',
      label: 'Color',
      type: 'select',
      required: true,
      options: [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }],
    }],
  });

  it('valid: value in options', () => {
    const result = validateAskForm(schema, { color: 'red' });
    expect(result.valid).toBe(true);
  });

  it('invalid: value not in options', () => {
    const result = validateAskForm(schema, { color: 'green' });
    expect(result.valid).toBe(false);
    expect(result.errors.color).toBe('Invalid selection');
  });
});

// ── multi_select ───────────────────────────────────────────────────────────────

describe('multi_select', () => {
  const schema = makeSchema({
    fields: [{
      key: 'tags',
      label: 'Tags',
      type: 'multi_select',
      required: true,
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
    }],
  });

  it('valid: all values in options', () => {
    const result = validateAskForm(schema, { tags: ['a', 'b'] });
    expect(result.valid).toBe(true);
  });

  it('invalid: one value not in options', () => {
    const result = validateAskForm(schema, { tags: ['a', 'z'] });
    expect(result.valid).toBe(false);
    expect(result.errors.tags).toBe('Invalid selection');
  });

  it('required: empty array => error', () => {
    const result = validateAskForm(schema, { tags: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.tags).toBe('This field is required');
  });
});

// ── date ───────────────────────────────────────────────────────────────────────

describe('date', () => {
  const schema = makeSchema({
    fields: [{ key: 'dob', label: 'Date', type: 'date', required: false }],
  });

  it('valid: ISO date YYYY-MM-DD', () => {
    const result = validateAskForm(schema, { dob: '2024-06-15' });
    expect(result.valid).toBe(true);
  });

  it('invalid: non-ISO string', () => {
    const result = validateAskForm(schema, { dob: 'June 15 2024' });
    expect(result.valid).toBe(false);
    expect(result.errors.dob).toBe('Invalid date');
  });

  it('invalid: impossible date', () => {
    const result = validateAskForm(schema, { dob: '2024-13-99' });
    expect(result.valid).toBe(false);
    expect(result.errors.dob).toBe('Invalid date');
  });

  it('invalid: number instead of string', () => {
    const result = validateAskForm(schema, { dob: 20240615 as unknown as string });
    expect(result.valid).toBe(false);
    expect(result.errors.dob).toBe('Invalid date');
  });
});

// ── Multiple fields ────────────────────────────────────────────────────────────

describe('multiple fields', () => {
  it('returns errors for each invalid field independently', () => {
    const schema = makeSchema({
      fields: [
        { key: 'name', label: 'Name', type: 'short_text', required: true },
        { key: 'qty', label: 'Qty', type: 'number', required: true, min: 1 },
      ],
    });
    const result = validateAskForm(schema, { name: '', qty: null });
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBeTruthy();
    expect(result.errors.qty).toBeTruthy();
  });

  it('all valid => no errors', () => {
    const schema = makeSchema({
      fields: [
        { key: 'name', label: 'Name', type: 'short_text', required: true },
        { key: 'qty', label: 'Qty', type: 'number', required: true, min: 1 },
      ],
    });
    const result = validateAskForm(schema, { name: 'hello', qty: 5 });
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });
});
