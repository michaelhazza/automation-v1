/**
 * canonicalDictionaryRendererPure.test.ts — Pure function tests for the
 * canonical data dictionary renderer.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/canonicalDictionaryRendererPure.test.ts
 */

import { expect, test } from 'vitest';
import { renderDictionary } from '../canonicalDictionary/canonicalDictionaryRendererPure.js';
import type { CanonicalTableEntry } from '../canonicalDictionary/canonicalDictionaryRegistry.js';

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
  expect(result.includes('Test Table'), 'should contain human name').toBeTruthy();
  expect(result.includes('canonical_test'), 'should contain table name').toBeTruthy();
  expect(result.includes('Primary key'), 'should contain column purpose').toBeTruthy();
});

test('filters by table name', () => {
  const result = renderDictionary([FIXTURE], { tableFilter: ['nonexistent'] });
  expect(result === 'No canonical tables match the filter.', 'should return empty message').toBeTruthy();
});

test('includes examples when requested', () => {
  const result = renderDictionary([FIXTURE], { includeExamples: true });
  expect(result.includes('SELECT * FROM canonical_test'), 'should contain example query').toBeTruthy();
});

test('excludes examples by default', () => {
  const result = renderDictionary([FIXTURE]);
  expect(!result.includes('Example Queries'), 'should not contain Example Queries heading').toBeTruthy();
});

test('includes anti-patterns when requested', () => {
  const result = renderDictionary([FIXTURE], { includeAntiPatterns: true });
  expect(result.includes('Do not use for X'), 'should contain anti-pattern text').toBeTruthy();
});

test('renders multiple tables separated by hr', () => {
  const result = renderDictionary([FIXTURE, { ...FIXTURE, tableName: 'canonical_other', humanName: 'Other' }]);
  expect(result.includes('---'), 'should contain hr separator').toBeTruthy();
  expect(result.includes('Other'), 'should contain second table name').toBeTruthy();
});

console.log('');
