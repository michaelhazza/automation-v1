/**
 * Unit tests for v2 Fix 1 (buildRuleBasedMerge) and Fix 4 (remediateTables).
 * Runnable via:
 *   npx tsx server/services/__tests__/skillAnalyzerServicePureFallbackAndTables.test.ts
 */

import {
  buildRuleBasedMerge,
  remediateTables,
  detectNameMismatch,
  detectSkillGraphCollision,
  evaluateApprovalState,
  DEFAULT_WARNING_TIER_MAP,
} from '../skillAnalyzerServicePure.js';
import type { ProposedMerge, MergeWarning } from '../skillAnalyzerServicePure.js';

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

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fix 1: buildRuleBasedMerge
// ---------------------------------------------------------------------------

test('buildRuleBasedMerge: library wins when only library has a definition', () => {
  const { merge } = buildRuleBasedMerge({
    candidate: { name: 'cand', description: 'cand desc', definition: null, instructions: 'candidate body' },
    library:   { name: 'lib',  description: 'lib desc',  definition: { name: 'lib', description: 'x', input_schema: { type: 'object', properties: {}, required: [] } }, instructions: 'library body' },
  });
  const def = merge.definition as Record<string, unknown>;
  assertEq(def.name, 'lib', 'schema name stays library');
});

test('buildRuleBasedMerge: defaults to library name for DB slug stability', () => {
  const { merge } = buildRuleBasedMerge({
    candidate: { name: 'new-incoming', description: 'desc', definition: null, instructions: 'x' },
    library:   { name: 'old-library',  description: 'desc', definition: null, instructions: 'y' },
  });
  assertEq(merge.name, 'old-library', 'name defaults to library');
});

test('buildRuleBasedMerge: merges unique H2 headings from non-dominant', () => {
  const dominantInstr = '## Section A\nbody a\n\n## Section B\nbody b';
  const secondaryInstr = '## Section A\nduplicate\n\n## Section C\nbody c';
  const { merge } = buildRuleBasedMerge({
    candidate: { name: 'c', description: '', definition: null, instructions: dominantInstr },
    library:   { name: 'l', description: '', definition: null, instructions: secondaryInstr },
  });
  assert(merge.instructions!.includes('Section A'), 'preserves Section A');
  assert(merge.instructions!.includes('Section B'), 'preserves Section B');
  assert(merge.instructions!.includes('Section C'), 'appends Section C from secondary');
});

// ---------------------------------------------------------------------------
// Fix 4: remediateTables
// ---------------------------------------------------------------------------

test('remediateTables: recovers missing row with [SOURCE: library] marker', () => {
  const source = `## Specs\n\n| platform | limit |\n|---|---|\n| google | 30 |\n| meta | 40 |\n`;
  const merged = `## Specs\n\n| platform | limit |\n|---|---|\n| google | 30 |\n`;
  const out = remediateTables({
    mergedInstructions: merged,
    baseInstructions: source,
    incomingInstructions: null,
  });
  assertEq(out.autoRecoveredRows, 1, 'should recover 1 row');
  assert(out.instructions.includes('[SOURCE: library]'), 'should mark recovered row');
});

test('remediateTables: does not match tables with different headers', () => {
  const source = `## X\n\n| a | b |\n|---|---|\n| 1 | 2 |\n`;
  const merged = `## X\n\n| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n`;
  const out = remediateTables({
    mergedInstructions: merged,
    baseInstructions: source,
    incomingInstructions: null,
  });
  assertEq(out.autoRecoveredRows, 0, 'different headers → no auto-recovery');
});

test('remediateTables: skips cross-source key conflict', () => {
  const base = `## X\n\n| key | v |\n|---|---|\n| foo | base-val |\n`;
  const inc  = `## X\n\n| key | v |\n|---|---|\n| foo | incoming-val |\n`;
  const merged = `## X\n\n| key | v |\n|---|---|\n`;
  const out = remediateTables({
    mergedInstructions: merged,
    baseInstructions: base,
    incomingInstructions: inc,
  });
  // First source wins (library); the second is rejected as a conflict.
  assertEq(out.autoRecoveredRows, 1, 'should recover 1 row (first source)');
  assertEq(out.skippedDueToKeyConflict, 1, 'should count conflict');
});

test('remediateTables: aborts when growth ratio exceeded on large inputs', () => {
  // Merged has 150+ words so the growth-cap min-words floor doesn't apply.
  const boilerplate = 'Lorem ipsum dolor sit amet '.repeat(30);
  const big = '| k | v |\n|---|---|\n' + Array.from({length: 200}, (_, i) => `| r${i} | v${i} |`).join('\n') + '\n';
  const source = `## T\n\n${big}`;
  const merged = `${boilerplate}\n\n## T\n\n| k | v |\n|---|---|\n| r0 | v0 |\n`;
  const out = remediateTables({
    mergedInstructions: merged,
    baseInstructions: source,
    incomingInstructions: null,
    maxGrowthRatio: 1.5,
  });
  assert(out.growthRatioExceeded, 'should flag growth');
  assertEq(out.autoRecoveredRows, 0, 'should NOT mutate instructions on abort');
});

// ---------------------------------------------------------------------------
// Fix 7: detectNameMismatch
// ---------------------------------------------------------------------------

test('detectNameMismatch: top-level != schema emits mismatch', () => {
  const merged: ProposedMerge = {
    name: 'incoming-name',
    description: 'd',
    definition: { name: 'library_name' },
    instructions: null,
  };
  const mm = detectNameMismatch(merged);
  assert(mm !== null, 'should detect mismatch');
  assertEq(mm!.schemaName, 'library_name', 'schemaName extracted');
});

test('detectNameMismatch: aligned names return null', () => {
  const merged: ProposedMerge = {
    name: 'same_name',
    description: 'd',
    definition: { name: 'same_name' },
    instructions: null,
  };
  assertEq(detectNameMismatch(merged), null, 'no mismatch');
});

// ---------------------------------------------------------------------------
// Approval evaluator
// ---------------------------------------------------------------------------

test('evaluateApprovalState: blocks on unresolved REQUIRED_FIELD_DEMOTED', () => {
  const warnings: MergeWarning[] = [
    {
      code: 'REQUIRED_FIELD_DEMOTED',
      severity: 'critical',
      message: 'dropped',
      detail: JSON.stringify({ demotedFields: ['voc_data'] }),
    },
  ];
  const state = evaluateApprovalState(warnings, [], DEFAULT_WARNING_TIER_MAP);
  assertEq(state.blocked, true, 'blocked');
  assertEq(state.reasons[0].field, 'voc_data', 'per-field blocker');
});

test('evaluateApprovalState: unblocks after accept_removal resolution', () => {
  const warnings: MergeWarning[] = [
    {
      code: 'REQUIRED_FIELD_DEMOTED',
      severity: 'critical',
      message: 'dropped',
      detail: JSON.stringify({ demotedFields: ['voc_data'] }),
    },
  ];
  const state = evaluateApprovalState(
    warnings,
    [{ warningCode: 'REQUIRED_FIELD_DEMOTED', resolution: 'accept_removal', resolvedAt: 'now', resolvedBy: 'u', details: { field: 'voc_data' } }],
    DEFAULT_WARNING_TIER_MAP,
  );
  assertEq(state.blocked, false, 'unblocked');
});

test('evaluateApprovalState: NAME_MISMATCH blocks until resolved', () => {
  const warnings: MergeWarning[] = [
    { code: 'NAME_MISMATCH', severity: 'critical', message: 'mismatch' },
  ];
  const state = evaluateApprovalState(warnings, [], DEFAULT_WARNING_TIER_MAP);
  assertEq(state.blocked, true, 'blocked without resolution');

  const resolved = evaluateApprovalState(
    warnings,
    [{ warningCode: 'NAME_MISMATCH', resolution: 'use_library_name', resolvedAt: 'now', resolvedBy: 'u' }],
    DEFAULT_WARNING_TIER_MAP,
  );
  assertEq(resolved.blocked, false, 'unblocked after use_library_name');
});

test('evaluateApprovalState: TABLE_ROWS_DROPPED is informational, never blocks', () => {
  const warnings: MergeWarning[] = [
    { code: 'TABLE_ROWS_DROPPED', severity: 'warning', message: 'dropped' },
  ];
  const state = evaluateApprovalState(warnings, [], DEFAULT_WARNING_TIER_MAP);
  assertEq(state.blocked, false, 'never blocks on informational');
});

// ---------------------------------------------------------------------------
// Fix 3: detectSkillGraphCollision
// ---------------------------------------------------------------------------

test('detectSkillGraphCollision: flags library overlap', () => {
  const merged: ProposedMerge = {
    name: 'merged-skill',
    description: 'about email sequences and lifecycle emails and cold outreach prospects',
    definition: {},
    instructions: `## Cold Outreach
Send cold emails to prospects. Use enrichment data for personalisation.
Follow up after three days if no reply. Send break-up email after five touches.

## Follow-up Strategy
Second email uses soft close. Third email is break-up.
Use templates for consistency across the sequence.`,
  };
  const library = [
    {
      id: 'existing-1',
      slug: 'draft-sequence',
      name: 'Draft Sequence',
      instructions: `## Cold Outreach
Send cold emails to prospects. Use enrichment data for personalisation.
Follow up after three days if no reply. Send break-up email after five touches.

## Token System
Replace {{first_name}} with contact data.`,
    },
    {
      id: 'unrelated',
      slug: 'unrelated-skill',
      name: 'Unrelated',
      instructions: '## Something Else\nno overlap here at all.',
    },
  ];
  const result = detectSkillGraphCollision({
    merged,
    libraryCatalog: library,
    excludedId: null,
    threshold: 0.30,
  });
  assert(result.some(c => c.collidingSlug === 'draft-sequence'), 'should flag draft-sequence');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
