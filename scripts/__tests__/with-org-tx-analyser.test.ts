/**
 * with-org-tx-analyser.test.ts
 *
 * Vitest unit tests for analyseWithOrgTxScope in
 * scripts/lib/with-org-tx-analyser.mjs.
 *
 * Uses synthetic fixtures under scripts/__fixtures__/with-org-tx/:
 *   - passing.ts   — db.select() called via withOrgTx → no violation
 *   - failing.ts   — db.select() called directly → violation
 *   - suppressed.ts — db.select() suppressed with guard-ignore → no violation
 *
 * Run via: npx vitest run scripts/__tests__/with-org-tx-analyser.test.ts
 */

import { describe, expect, test } from 'vitest';
import { analyseWithOrgTxScope } from '../lib/with-org-tx-analyser.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.join(__dirname, '../__fixtures__/with-org-tx');

const PASSING_FILE = path.join(FIXTURES_DIR, 'passing.ts');
const FAILING_FILE = path.join(FIXTURES_DIR, 'failing.ts');
const SUPPRESSED_FILE = path.join(FIXTURES_DIR, 'suppressed.ts');
const NAME_COLLISION_UNSAFE = path.join(FIXTURES_DIR, 'name-collision-unsafe.ts');
const NAME_COLLISION_SAFE = path.join(FIXTURES_DIR, 'name-collision-safe.ts');
const SUBSTRING_COLLISION = path.join(FIXTURES_DIR, 'substring-collision.ts');

describe('analyseWithOrgTxScope — passing fixture', () => {
  test('returns no violations when db.select is called via withOrgTx', () => {
    const violations = analyseWithOrgTxScope(REPO_ROOT, [PASSING_FILE]);
    expect(violations).toHaveLength(0);
  });
});

describe('analyseWithOrgTxScope — failing fixture', () => {
  test('returns a violation when db.select is called without withOrgTx scope', () => {
    const violations = analyseWithOrgTxScope(REPO_ROOT, [FAILING_FILE]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].file).toContain('failing.ts');
    expect(violations[0].message).toContain('db.select()');
    expect(violations[0].message).toContain('not reached via withOrgTx/getOrgScopedDb');
  });
});

describe('analyseWithOrgTxScope — suppressed fixture', () => {
  test('returns no violations when guard-ignore suppression is present', () => {
    const violations = analyseWithOrgTxScope(REPO_ROOT, [SUPPRESSED_FILE]);
    expect(violations).toHaveLength(0);
  });
});

describe('analyseWithOrgTxScope — empty input', () => {
  test('returns empty array for empty file list', () => {
    const violations = analyseWithOrgTxScope(REPO_ROOT, []);
    expect(violations).toHaveLength(0);
  });
});

describe('analyseWithOrgTxScope — multiple files', () => {
  test('detects violations only from failing fixture when scanning all three', () => {
    const violations = analyseWithOrgTxScope(REPO_ROOT, [PASSING_FILE, FAILING_FILE, SUPPRESSED_FILE]);
    const failingViolations = violations.filter(v => v.file.includes('failing.ts'));
    const passingViolations = violations.filter(v => v.file.includes('passing.ts'));
    const suppressedViolations = violations.filter(v => v.file.includes('suppressed.ts'));
    expect(failingViolations.length).toBeGreaterThan(0);
    expect(passingViolations).toHaveLength(0);
    expect(suppressedViolations).toHaveLength(0);
  });
});

describe('analyseWithOrgTxScope — same-name function in another file does NOT mask unsafe call (F1 regression)', () => {
  test('unsafe fetchAll in one file is flagged even when a wrapped fetchAll exists in another file', () => {
    const violations = analyseWithOrgTxScope(REPO_ROOT, [NAME_COLLISION_UNSAFE, NAME_COLLISION_SAFE]);
    const unsafeViolations = violations.filter(v => v.file.includes('name-collision-unsafe.ts'));
    const safeViolations = violations.filter(v => v.file.includes('name-collision-safe.ts'));
    expect(unsafeViolations.length).toBeGreaterThan(0);
    expect(unsafeViolations[0].message).toContain("fetchAll");
    expect(safeViolations).toHaveLength(0);
  });
});

describe('analyseWithOrgTxScope — substring collisions and comment mentions do NOT mark unsafe call as safe (T5 regression)', () => {
  test('unsafe load() is flagged even when withOrgTx wraps loadAll() and a comment mentions load', () => {
    const violations = analyseWithOrgTxScope(REPO_ROOT, [SUBSTRING_COLLISION]);
    const loadViolations = violations.filter(v => v.message.includes("'load'"));
    expect(loadViolations.length).toBeGreaterThan(0);
    // loadAll IS wrapped, so it should NOT be flagged.
    const loadAllViolations = violations.filter(v => v.message.includes("'loadAll'"));
    expect(loadAllViolations).toHaveLength(0);
  });
});
