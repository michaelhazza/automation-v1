/**
 * canonicalDictionaryValidatorPure.test.ts — Pure function tests for the
 * canonical data dictionary drift validator.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/canonicalDictionaryValidatorPure.test.ts
 */

import { validateDictionary } from '../canonicalDictionary/canonicalDictionaryValidatorPure.js';
import type { CanonicalTableEntry } from '../canonicalDictionary/canonicalDictionaryRegistry.js';
import type { SchemaTable } from '../canonicalDictionary/canonicalDictionaryValidatorPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

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
  assertEqual(validateDictionary([ENTRY], [SCHEMA]), [], 'should be empty');
});

test('detects missing entry', () => {
  const findings = validateDictionary([], [SCHEMA]);
  assertEqual(findings.length, 1, 'should have one finding');
  assertEqual(findings[0].type, 'missing_entry', 'should be missing_entry');
});

test('detects orphan entry', () => {
  const findings = validateDictionary([ENTRY], []);
  assertEqual(findings.length, 1, 'should have one finding');
  assertEqual(findings[0].type, 'orphan_entry', 'should be orphan_entry');
});

test('detects column in registry but not schema', () => {
  const sparse: SchemaTable = { tableName: 'canonical_test', columns: [{ name: 'id', type: 'uuid' }] };
  const findings = validateDictionary([ENTRY], [sparse]);
  assert(
    findings.some((f) => f.type === 'column_mismatch' && f.detail.includes('name')),
    'should flag missing column "name"',
  );
});

test('detects column in schema but not registry', () => {
  const rich: SchemaTable = {
    tableName: 'canonical_test',
    columns: [...SCHEMA.columns, { name: 'extra', type: 'text' }],
  };
  const findings = validateDictionary([ENTRY], [rich]);
  assert(
    findings.some((f) => f.type === 'column_mismatch' && f.detail.includes('extra')),
    'should flag extra column "extra"',
  );
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
