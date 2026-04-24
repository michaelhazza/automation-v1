/**
 * v6 bug-fix round — tests for new pure functions.
 * Runnable via: npx tsx server/services/__tests__/skillAnalyzerServicePureV6.test.ts
 */

import {
  classifyDemotedFields,
  parseDemotedFieldStatuses,
  adjustClassifierConfidence,
  validateMergeOutput,
  buildClassifyPromptWithMerge,
  buildClassificationPrompt,
} from '../skillAnalyzerServicePure.js';
import type { MergeWarning } from '../skillAnalyzerServicePure.js';
import type { ParsedSkill } from '../skillParserServicePure.js';

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
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertNear(actual: number, expected: number, delta: number, label: string) {
  if (Math.abs(actual - expected) > delta) {
    throw new Error(`${label}: expected ~${expected}, got ${actual}`);
  }
}

// ---------------------------------------------------------------------------
// classifyDemotedFields — Fix 3 field-status classification
// ---------------------------------------------------------------------------

test('classifyDemotedFields: made_optional when field still in properties', () => {
  const merged = {
    input_schema: {
      required: ['brief'],
      properties: {
        brief: { type: 'string' },
        campaign_name: { type: 'string' },
      },
    },
  };
  const result = classifyDemotedFields(['campaign_name'], merged);
  assertEq(result.campaign_name?.status, 'made_optional', 'status');
});

test('classifyDemotedFields: replaced_by for pluralised rename', () => {
  const merged = {
    input_schema: {
      required: ['competitor_urls'],
      properties: {
        competitor_urls: { type: 'array' },
        competitor_context: { type: 'string' },
      },
    },
  };
  const result = classifyDemotedFields(['competitor_name'], merged);
  assertEq(result.competitor_name?.status, 'replaced_by', 'status');
  if (result.competitor_name?.status === 'replaced_by') {
    assertEq(result.competitor_name.replacement, 'competitor_urls', 'replacement');
  }
});

test('classifyDemotedFields: removed_entirely when no similar field exists', () => {
  const merged = {
    input_schema: {
      required: ['brief'],
      properties: {
        brief: { type: 'string' },
        platform: { type: 'string' },
      },
    },
  };
  const result = classifyDemotedFields(['customer_segment'], merged);
  assertEq(result.customer_segment?.status, 'removed_entirely', 'status');
});

test('classifyDemotedFields: token-aware avoids spurious user_name → user_agent match', () => {
  const merged = {
    input_schema: {
      required: ['brief'],
      properties: {
        brief: { type: 'string' },
        user_agent: { type: 'string' },
      },
    },
  };
  // user_name → user_agent shares only one token ("user") and is not same-family,
  // so the replacement should be rejected; falls through to removed_entirely.
  const result = classifyDemotedFields(['user_name'], merged);
  assertEq(result.user_name?.status, 'removed_entirely', 'should not match user_agent');
});

test('classifyDemotedFields: prefers multi-token shared match over short weak match', () => {
  const merged = {
    input_schema: {
      required: ['brief'],
      properties: {
        brief: { type: 'string' },
        target_audience_segment: { type: 'string' },
        audience_notes: { type: 'string' },
      },
    },
  };
  // "audience_segment" shares 2 tokens with "target_audience_segment" (strong)
  // and 1 token with "audience_notes" (weak). Should pick the strong match.
  const result = classifyDemotedFields(['audience_segment'], merged);
  assertEq(result.audience_segment?.status, 'replaced_by', 'status');
  if (result.audience_segment?.status === 'replaced_by') {
    assertEq(result.audience_segment.replacement, 'target_audience_segment', 'prefers strong match');
  }
});

// ---------------------------------------------------------------------------
// parseDemotedFieldStatuses — round-trip the detail JSON
// ---------------------------------------------------------------------------

test('parseDemotedFieldStatuses: empty for legacy comma-delimited detail', () => {
  const result = parseDemotedFieldStatuses('field_a, field_b');
  assertEq(Object.keys(result).length, 0, 'legacy → empty');
});

test('parseDemotedFieldStatuses: round-trip structured detail', () => {
  const detail = JSON.stringify({
    demotedFields: ['a', 'b', 'c'],
    fieldStatus: {
      a: { status: 'made_optional' },
      b: { status: 'replaced_by', replacement: 'b_new' },
      c: { status: 'removed_entirely' },
    },
  });
  const result = parseDemotedFieldStatuses(detail);
  assertEq(result.a?.status, 'made_optional', 'a');
  assertEq(result.b?.status, 'replaced_by', 'b status');
  if (result.b?.status === 'replaced_by') {
    assertEq(result.b.replacement, 'b_new', 'b replacement');
  }
  assertEq(result.c?.status, 'removed_entirely', 'c');
});

test('parseDemotedFieldStatuses: discards malformed entries', () => {
  const detail = JSON.stringify({
    fieldStatus: {
      good: { status: 'made_optional' },
      bogus: { status: 'invalid_value' },
      replaced_missing_replacement: { status: 'replaced_by' }, // no `replacement` key
    },
  });
  const result = parseDemotedFieldStatuses(detail);
  assertEq(result.good?.status, 'made_optional', 'good survives');
  assertEq(result.bogus, undefined, 'bogus rejected');
  assertEq(result.replaced_missing_replacement, undefined, 'incomplete replaced_by rejected');
});

// ---------------------------------------------------------------------------
// adjustClassifierConfidence — Fix 4 structural deductions
// ---------------------------------------------------------------------------

test('adjustClassifierConfidence: no warnings + no instructions → unchanged', () => {
  const adjusted = adjustClassifierConfidence(0.90, [], {
    mergedInstructions: null,
    mergedName: 'x',
    candidateSlug: 'x',
    librarySlug: 'x',
  });
  assertEq(adjusted, 0.90, 'unchanged');
});

test('adjustClassifierConfidence: NaN input → 0.5 safe default', () => {
  const adjusted = adjustClassifierConfidence(NaN, [{
    code: 'NAME_MISMATCH', severity: 'warning', message: 'x',
  }], { mergedInstructions: 'x', mergedName: 'x', candidateSlug: 'x', librarySlug: 'x' });
  assertEq(adjusted, 0.5, 'NaN → 0.5');
});

test('adjustClassifierConfidence: REQUIRED_FIELD_DEMOTED weights status', () => {
  const detail = JSON.stringify({
    demotedFields: ['opt_a', 'rep_b', 'rem_c'],
    fieldStatus: {
      opt_a: { status: 'made_optional' },
      rep_b: { status: 'replaced_by', replacement: 'other' },
      rem_c: { status: 'removed_entirely' },
    },
  });
  const adjusted = adjustClassifierConfidence(0.90, [{
    code: 'REQUIRED_FIELD_DEMOTED', severity: 'critical', message: 'x', detail,
  }], { mergedInstructions: '', mergedName: 'x', candidateSlug: 'x', librarySlug: 'x' });
  // 0.01 (optional) + 0.03 (replaced) + 0.05 (removed) = 0.09 deduction.
  assertNear(adjusted, 0.90 - 0.09, 0.001, 'weighted deduction');
});

test('adjustClassifierConfidence: REQUIRED_FIELD_DEMOTED caps at 0.15', () => {
  const detail = JSON.stringify({
    demotedFields: ['a', 'b', 'c', 'd', 'e', 'f'],
    fieldStatus: Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f'].map(f => [f, { status: 'removed_entirely' } as const]),
    ),
  });
  const adjusted = adjustClassifierConfidence(0.90, [{
    code: 'REQUIRED_FIELD_DEMOTED', severity: 'critical', message: 'x', detail,
  }], { mergedInstructions: '', mergedName: 'x', candidateSlug: 'x', librarySlug: 'x' });
  // 6 × 0.05 = 0.30 raw, capped at 0.15.
  assertNear(adjusted, 0.90 - 0.15, 0.001, '0.15 cap');
});

test('adjustClassifierConfidence: skips restructured TABLE_ROWS_DROPPED', () => {
  const warnings: MergeWarning[] = [
    { code: 'TABLE_ROWS_DROPPED', severity: 'warning', message: 'x',
      detail: JSON.stringify({ restructured: true, matchedRows: 5, totalRows: 5 }) },
    { code: 'TABLE_ROWS_DROPPED', severity: 'warning', message: 'y',
      detail: 'legacy-string-detail' },
  ];
  const adjusted = adjustClassifierConfidence(0.90, warnings, {
    mergedInstructions: '', mergedName: 'x', candidateSlug: 'x', librarySlug: 'x',
  });
  // Only the legacy-string warning counts — 1 × 0.02 = 0.02.
  assertNear(adjusted, 0.90 - 0.02, 0.001, 'restructured skipped');
});

test('adjustClassifierConfidence: floor at 0.20', () => {
  const warnings: MergeWarning[] = [
    { code: 'NAME_MISMATCH', severity: 'warning', message: 'x' },
    { code: 'SCOPE_EXPANSION_CRITICAL', severity: 'critical', message: 'x' },
    { code: 'SOURCE_FORK', severity: 'warning', message: 'x' },
  ];
  const adjusted = adjustClassifierConfidence(0.25, warnings, {
    mergedInstructions: '', mergedName: 'x', candidateSlug: 'x', librarySlug: 'x',
  });
  // 0.25 - 0.03 - 0.05 - 0.05 = 0.12, floored at 0.20.
  assertEq(adjusted, 0.20, 'floor');
});

test('adjustClassifierConfidence: Related Skills self-reference deducts', () => {
  const instructions = '## Related Skills\n\n- **free-tool-strategy**: For tool evaluation\n- **other-skill**: blah';
  const adjusted = adjustClassifierConfidence(0.90, [], {
    mergedInstructions: instructions,
    mergedName: 'free-tool-strategy',
    candidateSlug: 'free-tool-strategy',
    librarySlug: 'create-lead-magnet',
  });
  assertNear(adjusted, 0.90 - 0.10, 0.001, 'self-ref -0.10');
});

test('adjustClassifierConfidence: does NOT self-ref when only library is referenced', () => {
  const instructions = '## Related Skills\n\n- **create-lead-magnet**: For assets\n- **other**: blah';
  const adjusted = adjustClassifierConfidence(0.90, [], {
    mergedInstructions: instructions,
    mergedName: 'free-tool-strategy',
    candidateSlug: 'free-tool-strategy',
    librarySlug: 'create-lead-magnet',
  });
  assertEq(adjusted, 0.90, 'no self-ref deduction');
});

test('adjustClassifierConfidence: short slug (<5) skipped for self-ref', () => {
  // 3-char slug "ads" would falsely match inside "Google Ads" etc.
  const instructions = '## Related Skills\n\nSee the Google Ads documentation for ad strategy.';
  const adjusted = adjustClassifierConfidence(0.90, [], {
    mergedInstructions: instructions,
    mergedName: 'ads',
    candidateSlug: 'ads',
    librarySlug: 'paid-search',
  });
  assertEq(adjusted, 0.90, 'short slug skipped');
});

test('adjustClassifierConfidence: word-boundary avoids substring false positive', () => {
  // "Google Adsense" contains "adsense" as a single token, not our slug.
  const instructions = '## Related Skills\n\nSee Google Adsense for context.';
  const adjusted = adjustClassifierConfidence(0.90, [], {
    mergedInstructions: instructions,
    mergedName: 'adsense-v2',
    candidateSlug: 'adsense-v2',
    librarySlug: 'paid-search',
  });
  // Slug "adsense-v2" does not appear as a whole word in the text.
  assertEq(adjusted, 0.90, 'word-boundary guard');
});

// ---------------------------------------------------------------------------
// validateMergeOutput — Fix 1 table restructure detection
// ---------------------------------------------------------------------------

test('validateMergeOutput: marks TABLE_ROWS_DROPPED as restructured when data is present', () => {
  // Source has a single table; merged has the same data split into two sub-tables.
  const base = {
    definition: null,
    instructions: `## Platform Copy Specs

| Format | Field | Limit |
|---|---|---|
| responsive_search_ad | Headlines | 30 chars each, up to 15 |
| responsive_search_ad | Descriptions | 90 chars each, up to 4 |
| social_feed_ad | Primary text | 125 chars preview, 500 max |
| social_feed_ad | Headline | 40 chars |
`,
    invocationBlock: null,
  };
  const nonBase = { definition: null, instructions: null, invocationBlock: null };
  const merged = {
    name: 'test',
    description: 'x',
    definition: {},
    instructions: `## Platforms

### Google Ads (responsive search ad)

| Element | Limit |
|---|---|
| Headline | 30 characters |
| Description | 90 characters |

### Meta (social feed ad)

| Element | Limit |
|---|---|
| Primary text | 125 chars preview, 500 max |
| Headline | 40 chars |
`,
  };

  const warnings = validateMergeOutput(
    base,
    nonBase,
    merged,
    new Set<string>(),
    new Set<string>(),
    [],
    null,
  );

  const tableDrop = warnings.find(w => w.code === 'TABLE_ROWS_DROPPED');
  assert(tableDrop !== undefined, 'should emit a TABLE_ROWS_DROPPED warning');
  assert(/restructured/i.test(tableDrop!.message), 'message should mention restructured');
  if (tableDrop!.detail) {
    try {
      const parsed = JSON.parse(tableDrop!.detail) as { restructured?: boolean };
      assert(parsed.restructured === true, 'detail.restructured should be true');
    } catch {
      throw new Error('detail should parse as JSON when restructured');
    }
  }
});

test('validateMergeOutput: still emits full TABLE_ROWS_DROPPED when data is genuinely missing', () => {
  const base = {
    definition: null,
    instructions: `## Platform Copy Specs

| Format | Field | Limit |
|---|---|---|
| search | Headlines | 30 chars each |
| search | Descriptions | 90 chars each |
| display | Banner | 300x250 |
| video | Intro | 15s max |
`,
    invocationBlock: null,
  };
  const nonBase = { definition: null, instructions: null, invocationBlock: null };
  const merged = {
    name: 'test',
    description: 'x',
    definition: {},
    // Merged output has completely unrelated content — no rows should match.
    instructions: `## Overview

This skill handles customer support tickets and routes them to agents based on urgency.
`,
  };

  const warnings = validateMergeOutput(
    base,
    nonBase,
    merged,
    new Set<string>(),
    new Set<string>(),
    [],
    null,
  );

  const tableDrop = warnings.find(w => w.code === 'TABLE_ROWS_DROPPED');
  assert(tableDrop !== undefined, 'should emit a TABLE_ROWS_DROPPED warning');
  assert(!/restructured/i.test(tableDrop!.message), 'message should NOT mention restructured');
});

// ---------------------------------------------------------------------------
// v7-A prompt edits — Rule 6/7 + cross-reference user-message hint
// ---------------------------------------------------------------------------

const SAMPLE_LIBRARY = {
  id: 'lib-1',
  slug: 'create-lead-magnet',
  name: 'Create Lead Magnet',
  description: 'Produces downloadable lead-magnet assets.',
  definition: null,
  instructions: null,
  isSystem: true as const,
};

function makeCandidate(description: string): ParsedSkill {
  return {
    name: 'free-tool-strategy',
    slug: 'free-tool-strategy',
    description,
    definition: null,
    instructions: null,
    rawSource: '',
  };
}

test('system prompt includes Rule 6 (artifact-type divergence)', () => {
  const { system } = buildClassifyPromptWithMerge(
    makeCandidate('A sample skill description.'),
    SAMPLE_LIBRARY,
    'ambiguous',
  );
  assert(/Artifact-type divergence/i.test(system), 'Rule 6 missing from system prompt');
  assert(/prefer DISTINCT/i.test(system), 'Rule 6 should direct toward DISTINCT');
});

test('system prompt includes Rule 7 (author cross-reference)', () => {
  const { system } = buildClassifyPromptWithMerge(
    makeCandidate('A sample skill description.'),
    SAMPLE_LIBRARY,
    'ambiguous',
  );
  assert(/Author cross-reference is intent/i.test(system), 'Rule 7 missing from system prompt');
});

test('system prompt includes Example 5 (DISTINCT despite vocabulary overlap)', () => {
  const { system } = buildClassifyPromptWithMerge(
    makeCandidate('A sample skill description.'),
    SAMPLE_LIBRARY,
    'ambiguous',
  );
  assert(/Example 5: DISTINCT despite high vocabulary overlap/i.test(system), 'Example 5 missing');
});

test('buildClassifyPromptWithMerge: appends cross-ref hint when description references library by name', () => {
  const candidate = makeCandidate(
    'Strategy for free interactive tools. For downloadable content lead magnets, see Create Lead Magnet.',
  );
  const { userMessage } = buildClassifyPromptWithMerge(candidate, SAMPLE_LIBRARY, 'ambiguous');
  assert(/Author-intent signal/i.test(userMessage), 'cross-ref hint missing');
  assert(/Create Lead Magnet/.test(userMessage), 'library name should appear in hint');
  assert(/strongly prefer DISTINCT/i.test(userMessage), 'hint should push toward DISTINCT');
});

test('buildClassifyPromptWithMerge: appends cross-ref hint when description references library by slug (hyphenated)', () => {
  // Library slug is "create-lead-magnet" (hyphenated form via underscore-to-hyphen
  // conversion in crossReferencesLibrarySkill).
  const candidate = makeCandidate(
    'Free-tool playbook. For ebook/checklist work, use create-lead-magnet.',
  );
  const { userMessage } = buildClassifyPromptWithMerge(candidate, SAMPLE_LIBRARY, 'ambiguous');
  assert(/Author-intent signal/i.test(userMessage), 'cross-ref hint missing for slug match');
});

test('buildClassifyPromptWithMerge: NO cross-ref hint when description does not reference the library', () => {
  const candidate = makeCandidate('Strategy for free interactive tools as growth levers.');
  const { userMessage } = buildClassifyPromptWithMerge(candidate, SAMPLE_LIBRARY, 'ambiguous');
  assert(!/Author-intent signal/i.test(userMessage), 'should not surface hint without cross-ref');
});

test('buildClassificationPrompt (legacy path) also surfaces cross-ref hint', () => {
  const candidate = makeCandidate('For downloadable content lead magnets, see Create Lead Magnet.');
  const { userMessage } = buildClassificationPrompt(candidate, SAMPLE_LIBRARY, 'ambiguous');
  assert(/Author-intent signal/i.test(userMessage), 'legacy path should mirror the hint');
});

// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
