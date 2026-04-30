/**
 * rlsPredicateSqlBuilderPure.test.ts — Pure function tests for the RLS
 * predicate SQL builder used by the canonical data platform.
 *
 * Tests buildReadPolicy and buildWriterBypassPolicy against the
 * TableScopingDescriptor interface.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/rlsPredicateSqlBuilderPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  buildReadPolicy,
  buildWriterBypassPolicy,
  type TableScopingDescriptor,
} from '../principal/rlsPredicateSqlBuilderPure.js';

function assertIncludes(haystack: string, needle: string, label: string) {
  if (!haystack.includes(needle))
    throw new Error(`${label} — expected output to include "${needle}"`);
}

function assertNotIncludes(haystack: string, needle: string, label: string) {
  if (haystack.includes(needle))
    throw new Error(`${label} — expected output NOT to include "${needle}"`);
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

const orgOnly: TableScopingDescriptor = {
  tableName: 'canonical_settings',
  shape: 'org_only',
  hasSubaccountId: false,
};

const oneToOneWithSub: TableScopingDescriptor = {
  tableName: 'canonical_accounts',
  shape: 'one_to_one',
  hasSubaccountId: true,
};

const oneToOneNoSub: TableScopingDescriptor = {
  tableName: 'canonical_audit_log',
  shape: 'one_to_one',
  hasSubaccountId: false,
};

const multiScopedWithSub: TableScopingDescriptor = {
  tableName: 'canonical_contacts',
  shape: 'multi_scoped',
  hasSubaccountId: true,
};

const multiScopedNoSub: TableScopingDescriptor = {
  tableName: 'canonical_metrics',
  shape: 'multi_scoped',
  hasSubaccountId: false,
};

// ---------------------------------------------------------------------------
// buildReadPolicy — org_only shape
// ---------------------------------------------------------------------------

console.log('buildReadPolicy — org_only');

test('org_only produces policy containing organisation_id', () => {
  const sql = buildReadPolicy(orgOnly);
  assertIncludes(sql, 'organisation_id', 'should reference org column');
});

test('org_only does not reference subaccount_id', () => {
  const sql = buildReadPolicy(orgOnly);
  assertNotIncludes(sql, 'subaccount_id', 'should omit subaccount column');
});

test('org_only contains correct table name', () => {
  const sql = buildReadPolicy(orgOnly);
  assertIncludes(sql, 'canonical_settings', 'should reference table name');
});

test('org_only does not contain team_ids CASE expression', () => {
  const sql = buildReadPolicy(orgOnly);
  assertNotIncludes(sql, 'team_ids', 'org_only should not reference team_ids');
});

// ---------------------------------------------------------------------------
// buildReadPolicy — one_to_one with subaccount
// ---------------------------------------------------------------------------

console.log('');
console.log('buildReadPolicy — one_to_one with subaccount');

test('one_to_one with subaccount includes subaccount clauses', () => {
  const sql = buildReadPolicy(oneToOneWithSub);
  assertIncludes(sql, 'subaccount_id', 'should include subaccount clause');
});

test('one_to_one with subaccount includes organisation_id', () => {
  const sql = buildReadPolicy(oneToOneWithSub);
  assertIncludes(sql, 'organisation_id', 'should reference org column');
});

test('one_to_one with subaccount contains correct table name', () => {
  const sql = buildReadPolicy(oneToOneWithSub);
  assertIncludes(sql, 'canonical_accounts', 'should reference table name');
});

test('one_to_one with subaccount contains team_ids CASE expression', () => {
  const sql = buildReadPolicy(oneToOneWithSub);
  assertIncludes(sql, 'team_ids', 'should contain team_ids for one_to_one');
});

// ---------------------------------------------------------------------------
// buildReadPolicy — one_to_one without subaccount
// ---------------------------------------------------------------------------

console.log('');
console.log('buildReadPolicy — one_to_one without subaccount');

test('one_to_one without subaccount omits subaccount clauses', () => {
  const sql = buildReadPolicy(oneToOneNoSub);
  assertNotIncludes(sql, 'subaccount_id', 'should omit subaccount clause');
});

test('one_to_one without subaccount includes organisation_id', () => {
  const sql = buildReadPolicy(oneToOneNoSub);
  assertIncludes(sql, 'organisation_id', 'should reference org column');
});

test('one_to_one without subaccount contains correct table name', () => {
  const sql = buildReadPolicy(oneToOneNoSub);
  assertIncludes(sql, 'canonical_audit_log', 'should reference table name');
});

// ---------------------------------------------------------------------------
// buildReadPolicy — multi_scoped shape
// ---------------------------------------------------------------------------

console.log('');
console.log('buildReadPolicy — multi_scoped');

test('multi_scoped with subaccount includes subaccount clauses', () => {
  const sql = buildReadPolicy(multiScopedWithSub);
  assertIncludes(sql, 'subaccount_id', 'should include subaccount clause');
});

test('multi_scoped without subaccount omits subaccount clauses', () => {
  const sql = buildReadPolicy(multiScopedNoSub);
  assertNotIncludes(sql, 'subaccount_id', 'should omit subaccount clause');
});

test('multi_scoped contains correct table name', () => {
  const sql = buildReadPolicy(multiScopedWithSub);
  assertIncludes(sql, 'canonical_contacts', 'should reference table name');
});

test('multi_scoped includes organisation_id', () => {
  const sql = buildReadPolicy(multiScopedWithSub);
  assertIncludes(sql, 'organisation_id', 'should reference org column');
});

// ---------------------------------------------------------------------------
// buildWriterBypassPolicy
// ---------------------------------------------------------------------------

console.log('');
console.log('buildWriterBypassPolicy');

test('writer bypass includes TO canonical_writer', () => {
  const sql = buildWriterBypassPolicy('canonical_accounts');
  assertIncludes(sql, 'canonical_writer', 'should grant to canonical_writer role');
});

test('writer bypass includes WITH CHECK', () => {
  const sql = buildWriterBypassPolicy('canonical_accounts');
  assertIncludes(sql, 'WITH CHECK', 'should have WITH CHECK clause');
});

test('writer bypass contains correct table name', () => {
  const sql = buildWriterBypassPolicy('canonical_accounts');
  assertIncludes(sql, 'canonical_accounts', 'should reference table name');
});

test('writer bypass for different table uses that table name', () => {
  const sql = buildWriterBypassPolicy('canonical_contacts');
  assertIncludes(sql, 'canonical_contacts', 'should reference correct table');
  assertNotIncludes(sql, 'canonical_accounts', 'should not reference other tables');
});

// ---------------------------------------------------------------------------
// General SQL safety
// ---------------------------------------------------------------------------

console.log('');
console.log('SQL output structure');

test('buildReadPolicy returns non-empty string', () => {
  const sql = buildReadPolicy(oneToOneWithSub);
  expect(sql.length > 0, 'should produce non-empty SQL').toBeTruthy();
});

test('buildWriterBypassPolicy returns non-empty string', () => {
  const sql = buildWriterBypassPolicy('canonical_accounts');
  expect(sql.length > 0, 'should produce non-empty SQL').toBeTruthy();
});

test('buildReadPolicy output is deterministic', () => {
  const a = buildReadPolicy(oneToOneWithSub);
  const b = buildReadPolicy(oneToOneWithSub);
  expect(a === b, 'same input should produce identical output').toBeTruthy();
});

test('buildWriterBypassPolicy output is deterministic', () => {
  const a = buildWriterBypassPolicy('canonical_accounts');
  const b = buildWriterBypassPolicy('canonical_accounts');
  expect(a === b, 'same input should produce identical output').toBeTruthy();
});

console.log('');
