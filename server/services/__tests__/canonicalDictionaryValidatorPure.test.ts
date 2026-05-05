/**
 * canonicalDictionaryValidatorPure.test.ts — Pure function tests for the
 * canonical data dictionary drift validator.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/canonicalDictionaryValidatorPure.test.ts
 */

import { expect, test } from 'vitest';
import { validateDictionary } from '../canonicalDictionary/canonicalDictionaryValidatorPure.js';
import type { CanonicalTableEntry } from '../canonicalDictionary/canonicalDictionaryRegistry.js';
import type { SchemaTable } from '../canonicalDictionary/canonicalDictionaryValidatorPure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ENTRY: CanonicalTableEntry = {
  tableName: 'canonical_test',
  humanName: 'Test',
  purpose: 'Test',
  principalSemantics: 'Org-scoped',
  visibilityFields: {},
  columns: [
    { name: 'id', type: 'uuid', purpose: 'PK' },
    { name: 'name', type: 'text', purpose: 'Name' },
  ],
  foreignKeys: [],
  freshnessPeriod: '15m',
  cardinality: '1:1',
  skillReferences: [],
  exampleQueries: [],
  commonJoins: [],
  antiPatterns: [],
};

const SCHEMA: SchemaTable = {
  tableName: 'canonical_test',
  columns: [
    { name: 'id', type: 'uuid' },
    { name: 'name', type: 'text' },
  ],
};

console.log('validateDictionary');

test('returns no findings when registry matches schema', () => {
  expect(validateDictionary([ENTRY], [SCHEMA]), 'should be empty').toEqual([]);
});

test('detects missing entry', () => {
  const findings = validateDictionary([], [SCHEMA]);
  expect(findings.length, 'should have one finding').toBe(1);
  expect(findings[0].type, 'should be missing_entry').toBe('missing_entry');
});

test('detects orphan entry', () => {
  const findings = validateDictionary([ENTRY], []);
  expect(findings.length, 'should have one finding').toBe(1);
  expect(findings[0].type, 'should be orphan_entry').toBe('orphan_entry');
});

test('detects column in registry but not schema', () => {
  const sparse: SchemaTable = { tableName: 'canonical_test', columns: [{ name: 'id', type: 'uuid' }] };
  const findings = validateDictionary([ENTRY], [sparse]);
  expect(findings.some((f) => f.type === 'column_mismatch' && f.detail.includes('name')), 'should flag missing column "name"').toBeTruthy();
});

test('detects column in schema but not registry', () => {
  const rich: SchemaTable = {
    tableName: 'canonical_test',
    columns: [...SCHEMA.columns, { name: 'extra', type: 'text' }],
  };
  const findings = validateDictionary([ENTRY], [rich]);
  expect(findings.some((f) => f.type === 'column_mismatch' && f.detail.includes('extra')), 'should flag extra column "extra"').toBeTruthy();
});

console.log('');
