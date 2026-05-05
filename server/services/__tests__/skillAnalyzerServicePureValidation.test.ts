/**
 * Unit tests for merge validation helpers and validateMergeOutput.
 * Runnable via: npx tsx server/services/__tests__/skillAnalyzerServicePureValidation.test.ts
 */

import { expect, test } from 'vitest';
import {
  validateMergeOutput,
  extractTables,
  extractInvocationBlock,
  containsHitlGate,
  containsApprovalIntent,
  hasOutputFormatBlock,
  richnessScore,
} from '../skillAnalyzerServicePure.js';
import type { MergeWarningCode } from '../skillAnalyzerServicePure.js';
import type { ProposedMerge } from '../skillAnalyzerServicePure.js';

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function hasCode(warnings: { code: MergeWarningCode }[], code: MergeWarningCode): boolean {
  return warnings.some(w => w.code === code);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseDef = (required: string[], name: string = 'merged_skill') => ({
  name,
  description: 'desc',
  input_schema: { type: 'object', properties: {}, required },
});

const cleanMerge = (overrides: Partial<ProposedMerge> = {}): ProposedMerge => ({
  // Top-level name matches definition.name so the v2 NAME_MISMATCH
  // detector doesn't fire on "clean" baselines.
  name: 'merged_skill',
  description: 'a focused merged skill description',
  definition: baseDef(['prompt']),
  instructions: 'Do the thing.',
  ...overrides,
});

const emptyLibrary = {
  names: new Set<string>(),
  slugs: new Set<string>(),
  skills: [] as { id: string | null; name: string; description: string }[],
};

// ---------------------------------------------------------------------------
// validateMergeOutput — no warnings path
// ---------------------------------------------------------------------------

test('no warnings when merge is clean', () => {
  const base = { definition: baseDef(['prompt']), instructions: 'Do the thing.' };
  const nonBase = { definition: baseDef([]), instructions: 'Also do this.' };
  const merged = cleanMerge({ definition: baseDef(['prompt']) });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  assertEq(result.length, 0, 'warning count');
});

// ---------------------------------------------------------------------------
// Bug 1: Required field demotion
// ---------------------------------------------------------------------------

test('REQUIRED_FIELD_DEMOTED: base field dropped from merged required array', () => {
  const base = { definition: baseDef(['prompt', 'tone']), instructions: 'Do.' };
  const nonBase = { definition: baseDef([]), instructions: 'Also.' };
  const merged = cleanMerge({ definition: baseDef(['prompt']) });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(hasCode(result, 'REQUIRED_FIELD_DEMOTED'), 'should have REQUIRED_FIELD_DEMOTED').toBeTruthy();
  const w = result.find(w => w.code === 'REQUIRED_FIELD_DEMOTED')!;
  expect(w.detail?.includes('tone'), 'detail should mention dropped field').toBeTruthy();
});

test('REQUIRED_FIELD_DEMOTED: non-base field dropped', () => {
  const base = { definition: baseDef(['prompt']), instructions: 'Do.' };
  const nonBase = { definition: baseDef(['platform']), instructions: 'Also.' };
  const merged = cleanMerge({ definition: baseDef(['prompt']) });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(hasCode(result, 'REQUIRED_FIELD_DEMOTED'), 'should have REQUIRED_FIELD_DEMOTED for non-base field').toBeTruthy();
});

test('no REQUIRED_FIELD_DEMOTED when all required fields preserved', () => {
  const base = { definition: baseDef(['prompt']), instructions: 'Do.' };
  const nonBase = { definition: baseDef(['platform']), instructions: 'Also.' };
  const merged = cleanMerge({ definition: baseDef(['prompt', 'platform']) });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(!hasCode(result, 'REQUIRED_FIELD_DEMOTED'), 'should have no demotion warning').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Bug 2: Capability overlap
// ---------------------------------------------------------------------------

test('CAPABILITY_OVERLAP critical: merged name matches library name', () => {
  const base = { definition: null, instructions: 'Do.' };
  const nonBase = { definition: null, instructions: 'Also.' };
  const merged = cleanMerge({ name: 'existing-skill' });
  const names = new Set(['existing-skill']);
  const result = validateMergeOutput(base, nonBase, merged, names, new Set(), emptyLibrary.skills, null);
  const w = result.find(w => w.code === 'CAPABILITY_OVERLAP');
  expect(w !== undefined, 'should have CAPABILITY_OVERLAP').toBeTruthy();
  assertEq(w!.severity, 'critical', 'severity should be critical for name collision');
});

test('CAPABILITY_OVERLAP warning: significant description bigram overlap', () => {
  const base = { definition: null, instructions: 'Do.' };
  const nonBase = { definition: null, instructions: 'Also.' };
  const merged = cleanMerge({ description: 'facebook ads specialist campaign manager' });
  const librarySkills = [
    { id: 'other-id', name: 'FB Ads Manager', description: 'facebook ads specialist campaign targeting manager' },
  ];
  const result = validateMergeOutput(base, nonBase, merged, new Set(), new Set(), librarySkills, null);
  expect(hasCode(result, 'CAPABILITY_OVERLAP'), 'should detect bigram overlap').toBeTruthy();
});

test('no CAPABILITY_OVERLAP when only generic bigrams overlap', () => {
  const base = { definition: null, instructions: 'Do.' };
  const nonBase = { definition: null, instructions: 'Also.' };
  const merged = cleanMerge({ description: 'email marketing strategy for growth' });
  const librarySkills = [
    { id: 'other-id', name: 'Email Tool', description: 'email marketing content strategy automation' },
  ];
  const result = validateMergeOutput(base, nonBase, merged, new Set(), new Set(), librarySkills, null);
  expect(!hasCode(result, 'CAPABILITY_OVERLAP'), 'should not flag generic bigrams as overlap').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Bug 8: Scope expansion
// ---------------------------------------------------------------------------

test('SCOPE_EXPANSION (amber): merged 45% longer than richer source', () => {
  const base = { definition: null, instructions: 'word '.repeat(100).trim() };
  const nonBase = { definition: null, instructions: 'word '.repeat(50).trim() };
  const merged = cleanMerge({ instructions: 'word '.repeat(145).trim() });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(hasCode(result, 'SCOPE_EXPANSION'), 'should have amber scope warning').toBeTruthy();
  expect(!hasCode(result, 'SCOPE_EXPANSION_CRITICAL'), 'should not have critical scope warning').toBeTruthy();
});

test('SCOPE_EXPANSION_CRITICAL (red): merged 100% longer than richer source', () => {
  const base = { definition: null, instructions: 'word '.repeat(100).trim() };
  const nonBase = { definition: null, instructions: 'word '.repeat(50).trim() };
  const merged = cleanMerge({ instructions: 'word '.repeat(200).trim() });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(hasCode(result, 'SCOPE_EXPANSION_CRITICAL'), 'should have critical scope warning').toBeTruthy();
  expect(!hasCode(result, 'SCOPE_EXPANSION'), 'should not also have amber warning').toBeTruthy();
});

test('no scope warning when merged within 30% of richer source', () => {
  const base = { definition: null, instructions: 'word '.repeat(100).trim() };
  const nonBase = { definition: null, instructions: 'word '.repeat(50).trim() };
  const merged = cleanMerge({ instructions: 'word '.repeat(125).trim() });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(!hasCode(result, 'SCOPE_EXPANSION'), 'should have no scope warning').toBeTruthy();
  expect(!hasCode(result, 'SCOPE_EXPANSION_CRITICAL'), 'should have no critical scope warning').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Bug 10: Table completeness
// ---------------------------------------------------------------------------

test('TABLE_ROWS_DROPPED: source table has 4 rows, merged has 2', () => {
  const tableWith4Rows = '| col1 | col2 |\n| --- | --- |\n| a | b |\n| c | d |\n| e | f |\n| g | h |';
  const tableWith2Rows = '| col1 | col2 |\n| --- | --- |\n| a | b |\n| c | d |';
  const base = { definition: null, instructions: tableWith4Rows };
  const nonBase = { definition: null, instructions: null };
  const merged = cleanMerge({ instructions: tableWith2Rows });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(hasCode(result, 'TABLE_ROWS_DROPPED'), 'should detect dropped rows').toBeTruthy();
});

test('no TABLE_ROWS_DROPPED when merged has same or more rows', () => {
  const table3 = '| col1 | col2 |\n| --- | --- |\n| a | b |\n| c | d |\n| e | f |';
  const table4 = '| col1 | col2 |\n| --- | --- |\n| a | b |\n| c | d |\n| e | f |\n| g | h |';
  const base = { definition: null, instructions: table3 };
  const nonBase = { definition: null, instructions: null };
  const merged = cleanMerge({ instructions: table4 });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(!hasCode(result, 'TABLE_ROWS_DROPPED'), 'should not warn when rows are preserved or added').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Bug 3: Invocation block preservation
// ---------------------------------------------------------------------------

test('INVOCATION_LOST: source has invocation block, merged does not', () => {
  const invocationBlock = 'Invoke this skill when the user asks about email campaigns.';
  const base = { definition: null, instructions: invocationBlock + '\n\nDo the thing.', invocationBlock };
  const nonBase = { definition: null, instructions: 'Do something else.' };
  const merged = cleanMerge({ instructions: 'Do the thing merged.' });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(hasCode(result, 'INVOCATION_LOST'), 'should detect missing invocation block').toBeTruthy();
});

test('no INVOCATION_LOST when neither source has invocation block', () => {
  const base = { definition: null, instructions: 'Do the thing.', invocationBlock: null };
  const nonBase = { definition: null, instructions: 'Do something else.', invocationBlock: null };
  const merged = cleanMerge({ instructions: 'Do the thing merged.' });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(!hasCode(result, 'INVOCATION_LOST'), 'should not warn when no source had invocation block').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Bug 4: HITL gate preservation
// ---------------------------------------------------------------------------

test('HITL_LOST: source has HITL phrase, merged has neither phrase nor intent', () => {
  const base = { definition: null, instructions: 'Do not send this email directly. Review before sending.' };
  const nonBase = { definition: null, instructions: 'Help write emails.' };
  const merged = cleanMerge({ instructions: 'Write and send the email.' });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(hasCode(result, 'HITL_LOST'), 'should detect missing HITL gate').toBeTruthy();
});

test('no HITL_LOST when merged contains approval intent fallback', () => {
  const base = { definition: null, instructions: 'Do not send directly. Requires human approval.' };
  const nonBase = { definition: null, instructions: 'Help write.' };
  const merged = cleanMerge({ instructions: 'Write the email and await user confirmation before sending.' });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(!hasCode(result, 'HITL_LOST'), 'should not warn when approval intent is present').toBeTruthy();
});

// ---------------------------------------------------------------------------
// extractTables
// ---------------------------------------------------------------------------

test('extractTables: no tables returns empty array', () => {
  assertEq(extractTables(null)?.length, 0, 'null input');
  assertEq(extractTables('no tables here')?.length, 0, 'plain text');
});

test('extractTables: single 2-data-row table', () => {
  const text = '| col1 | col2 |\n| --- | --- |\n| a | b |\n| c | d |';
  const tables = extractTables(text);
  assertEq(tables.length, 1, 'table count');
  assertEq(tables[0].rowCount, 2, 'data row count');
});

test('extractTables: two tables with distinct headers', () => {
  const text = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| x | y |\n| --- | --- |\n| 3 | 4 |\n| 5 | 6 |';
  const tables = extractTables(text);
  assertEq(tables.length, 2, 'table count');
  assertEq(tables[0].rowCount, 1, 'first table rows');
  assertEq(tables[1].rowCount, 2, 'second table rows');
});

// ---------------------------------------------------------------------------
// extractInvocationBlock
// ---------------------------------------------------------------------------

test('extractInvocationBlock: returns block when present at top', () => {
  const text = 'Invoke this skill when the user needs email help.\n\nDo the other things.';
  const block = extractInvocationBlock(text);
  expect(block !== null, 'should return non-null block').toBeTruthy();
  expect(block!.startsWith('Invoke this skill'), 'should start with invocation keyword').toBeTruthy();
});

test('extractInvocationBlock: returns null when no trigger block', () => {
  const block = extractInvocationBlock('Just a regular skill body.');
  expect(block === null, 'should return null when no trigger block').toBeTruthy();
});

test('extractInvocationBlock: matches when block is not followed by blank line', () => {
  const text = 'Invoke this skill when the user asks for a report.\nStep 1: Gather data.';
  const block = extractInvocationBlock(text);
  expect(block !== null, 'should return non-null block even without trailing blank line').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Bug 7: Output format preservation
// ---------------------------------------------------------------------------

test('OUTPUT_FORMAT_LOST: source has output format heading, merged omits it', () => {
  const base = { definition: null, instructions: '## Output Format\n\nUse JSON like this: `{ "result": "..." }`' };
  const nonBase = { definition: null, instructions: 'Do the thing.' };
  const merged = cleanMerge({ instructions: 'Do the thing.' });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(hasCode(result, 'OUTPUT_FORMAT_LOST'), 'should detect missing output format section').toBeTruthy();
  const w = result.find(w => w.code === 'OUTPUT_FORMAT_LOST');
  assertEq(w!.severity, 'warning', 'OUTPUT_FORMAT_LOST should be warning severity');
});

test('no OUTPUT_FORMAT_LOST when merged preserves output format heading', () => {
  const base = { definition: null, instructions: 'Do the thing.\n\n## Output Format\n\nReturn JSON.' };
  const nonBase = { definition: null, instructions: 'Also help.' };
  const merged = cleanMerge({ instructions: 'Do the thing.\n\n## Output Format\n\nReturn JSON.' });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(!hasCode(result, 'OUTPUT_FORMAT_LOST'), 'should not warn when output format is preserved').toBeTruthy();
});

test('no OUTPUT_FORMAT_LOST when neither source has output format block', () => {
  const base = { definition: null, instructions: 'Do the thing.' };
  const nonBase = { definition: null, instructions: 'Also help.' };
  const merged = cleanMerge({ instructions: 'Do the thing merged.' });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(!hasCode(result, 'OUTPUT_FORMAT_LOST'), 'should not warn when no source had output format').toBeTruthy();
});

// ---------------------------------------------------------------------------
// richnessScore
// ---------------------------------------------------------------------------

test('richnessScore: null input returns 0', () => {
  assertEq(richnessScore(null), 0, 'null');
});

test('richnessScore: headings boost score above word count', () => {
  const withHeadings = '## Section\nword word word\n## Section 2\nword word word';
  const withoutHeadings = 'word word word word word word';
  expect(richnessScore(withHeadings) > richnessScore(withoutHeadings), 'headings should boost score').toBeTruthy();
});

// ---------------------------------------------------------------------------
// v2 Fix 7: NAME_MISMATCH
// ---------------------------------------------------------------------------

test('NAME_MISMATCH: top-level name differs from definition.name', () => {
  const base = { definition: baseDef([]), instructions: 'Do.' };
  const nonBase = { definition: baseDef([]), instructions: 'Also.' };
  const merged = cleanMerge({
    name: 'incoming_name',
    definition: baseDef([], 'library_name'),
  });
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(hasCode(result, 'NAME_MISMATCH'), 'should emit NAME_MISMATCH').toBeTruthy();
});

test('no NAME_MISMATCH when names align', () => {
  const base = { definition: baseDef([]), instructions: 'Do.' };
  const nonBase = { definition: baseDef([]), instructions: 'Also.' };
  const merged = cleanMerge();
  const result = validateMergeOutput(base, nonBase, merged, emptyLibrary.names, emptyLibrary.slugs, emptyLibrary.skills, null);
  expect(!hasCode(result, 'NAME_MISMATCH'), 'should not emit NAME_MISMATCH on aligned names').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
