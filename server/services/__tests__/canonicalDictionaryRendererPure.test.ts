/**
 * canonicalDictionaryRendererPure.test.ts — Pure function tests for the
 * canonical data dictionary renderer.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/canonicalDictionaryRendererPure.test.ts
 */

import { renderDictionary } from '../canonicalDictionary/canonicalDictionaryRendererPure.js';
import type { CanonicalTableEntry } from '../canonicalDictionary/canonicalDictionaryRegistry.js';

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

const FIXTURE: CanonicalTableEntry = {
  tableName: 'canonical_test',
  humanName: 'Test Table',
  purpose: 'A test table for unit tests.',
  principalSemantics: 'Org-scoped.',
  visibilityFields: { ownerUserId: true, visibilityScope: true, sharedTeamIds: false },
  columns: [
    { name: 'id', type: 'uuid', purpose: 'Primary key' },
    { name: 'name', type: 'text', purpose: 'Display name' },
  ],
  foreignKeys: [{ column: 'org_id', referencesTable: 'organisations', referencesColumn: 'id' }],
  freshnessPeriod: '15 minutes',
  cardinality: '1:1',
  skillReferences: ['read_test'],
  exampleQueries: ['SELECT * FROM canonical_test'],
  commonJoins: ['canonical_accounts via account_id'],
  antiPatterns: ['Do not use for X'],
};

console.log('renderDictionary');

test('renders a single table', () => {
  const result = renderDictionary([FIXTURE]);
  assert(result.includes('Test Table'), 'should contain human name');
  assert(result.includes('canonical_test'), 'should contain table name');
  assert(result.includes('Primary key'), 'should contain column purpose');
});

test('filters by table name', () => {
  const result = renderDictionary([FIXTURE], { tableFilter: ['nonexistent'] });
  assert(result === 'No canonical tables match the filter.', 'should return empty message');
});

test('includes examples when requested', () => {
  const result = renderDictionary([FIXTURE], { includeExamples: true });
  assert(result.includes('SELECT * FROM canonical_test'), 'should contain example query');
});

test('excludes examples by default', () => {
  const result = renderDictionary([FIXTURE]);
  assert(!result.includes('Example Queries'), 'should not contain Example Queries heading');
});

test('includes anti-patterns when requested', () => {
  const result = renderDictionary([FIXTURE], { includeAntiPatterns: true });
  assert(result.includes('Do not use for X'), 'should contain anti-pattern text');
});

test('renders multiple tables separated by hr', () => {
  const result = renderDictionary([FIXTURE, { ...FIXTURE, tableName: 'canonical_other', humanName: 'Other' }]);
  assert(result.includes('---'), 'should contain hr separator');
  assert(result.includes('Other'), 'should contain second table name');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
