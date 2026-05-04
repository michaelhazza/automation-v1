/**
 * Pure logic tests for the auto-fill key-filtering behaviour.
 *
 * The full askFormAutoFillService is DB-dependent; these tests exercise the
 * key-matching logic directly using the filtering pattern from the service.
 */
import { describe, expect, it } from 'vitest';
import type { AskField } from '../../../shared/types/askForm.js';

function filterAutoFillValues(
  priorValues: Record<string, unknown>,
  currentFields: AskField[],
): Record<string, unknown> {
  const currentFieldKeys = new Set(currentFields.map((f) => f.key));
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(priorValues)) {
    if (currentFieldKeys.has(key)) {
      result[key] = priorValues[key];
    }
  }
  return result;
}

function makeField(key: string, type: AskField['type'] = 'text'): AskField {
  return { key, label: key, type, required: false };
}

describe('askFormAutoFill filtering logic', () => {
  it('returns empty object when prior values is empty', () => {
    const result = filterAutoFillValues({}, [makeField('name')]);
    expect(result).toEqual({});
  });

  it('includes keys that exist in current schema', () => {
    const prior = { name: 'Alice', audience: 'High-fit accounts' };
    const fields = [makeField('name'), makeField('audience')];
    const result = filterAutoFillValues(prior, fields);
    expect(result).toEqual({ name: 'Alice', audience: 'High-fit accounts' });
  });

  it('excludes keys not in current schema', () => {
    const prior = { name: 'Alice', removed_field: 'old value' };
    const fields = [makeField('name')];
    const result = filterAutoFillValues(prior, fields);
    expect(result).toEqual({ name: 'Alice' });
    expect(result).not.toHaveProperty('removed_field');
  });

  it('returns empty when no keys match current schema', () => {
    const prior = { old_key: 'value' };
    const fields = [makeField('new_key')];
    const result = filterAutoFillValues(prior, fields);
    expect(result).toEqual({});
  });
});
