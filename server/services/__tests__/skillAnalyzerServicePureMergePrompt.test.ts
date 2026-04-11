/**
 * skillAnalyzerServicePureMergePrompt.test.ts — Phase 3 of skill-analyzer-v2.
 *
 * Pure unit tests for buildClassifyPromptWithMerge and
 * parseClassificationResponseWithMerge. Covers: prompt structure,
 * happy-path parsing for each classification, missing/malformed
 * proposedMerge fallback, definition-as-string rejection, DUPLICATE/DISTINCT
 * proposedMerge stripping.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/skillAnalyzerServicePureMergePrompt.test.ts
 */

import {
  buildClassifyPromptWithMerge,
  parseClassificationResponseWithMerge,
  type LibrarySkillSummary,
} from '../skillAnalyzerServicePure.js';
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

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const candidate: ParsedSkill = {
  name: 'Web Search V2',
  slug: 'web_search',
  description: 'Search the web with multiple providers and structured citations',
  definition: { name: 'web_search', description: 'desc', input_schema: { type: 'object', properties: {}, required: [] } },
  instructions: 'Use multiple providers; deduplicate; cite sources.',
  rawSource: '',
};

const librarySkill: LibrarySkillSummary = {
  id: 'skill-uuid-1',
  slug: 'web_search',
  name: 'Web Search',
  description: 'Search the web for current information',
  definition: { name: 'web_search', description: 'old desc', input_schema: { type: 'object', properties: {}, required: [] } },
  instructions: 'Use this tool to find current information on the web.',
  isSystem: true,
};

const validMerge = {
  name: 'Web Search',
  description: 'Search the web with multiple providers and structured citations',
  definition: {
    name: 'web_search',
    description: 'Search the web for current information',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  instructions: 'Use multiple providers; deduplicate; cite sources.',
};

// ---------------------------------------------------------------------------
// buildClassifyPromptWithMerge
// ---------------------------------------------------------------------------

test('buildClassifyPromptWithMerge: returns system + user message', () => {
  const { system, userMessage } = buildClassifyPromptWithMerge(candidate, librarySkill, 'ambiguous');
  if (typeof system !== 'string' || system.length === 0) throw new Error('system');
  if (typeof userMessage !== 'string' || userMessage.length === 0) throw new Error('userMessage');
});

test('buildClassifyPromptWithMerge: system prompt mentions proposedMerge', () => {
  const { system } = buildClassifyPromptWithMerge(candidate, librarySkill, 'ambiguous');
  if (!system.includes('proposedMerge')) throw new Error('system prompt missing proposedMerge');
  if (!system.includes('PARTIAL_OVERLAP')) throw new Error('system prompt missing PARTIAL_OVERLAP');
});

test('buildClassifyPromptWithMerge: user message includes both skills + band hint', () => {
  const { userMessage } = buildClassifyPromptWithMerge(candidate, librarySkill, 'likely_duplicate');
  if (!userMessage.includes('CANDIDATE')) throw new Error('user message missing CANDIDATE');
  if (!userMessage.includes('LIBRARY')) throw new Error('user message missing LIBRARY');
  if (!userMessage.includes('Web Search V2')) throw new Error('user message missing candidate name');
  if (!userMessage.includes('very high embedding similarity')) throw new Error('user message missing band hint');
});

// ---------------------------------------------------------------------------
// parseClassificationResponseWithMerge — happy paths
// ---------------------------------------------------------------------------

test('parseClassificationResponseWithMerge: PARTIAL_OVERLAP with valid merge', () => {
  const response = JSON.stringify({
    classification: 'PARTIAL_OVERLAP',
    confidence: 0.8,
    reasoning: 'Both have value.',
    proposedMerge: validMerge,
  });
  const result = parseClassificationResponseWithMerge(response);
  if (!result) throw new Error('expected non-null result');
  assertEq(result.classification, 'PARTIAL_OVERLAP', 'classification');
  assertEq(result.confidence, 0.8, 'confidence');
  if (!result.proposedMerge) throw new Error('expected proposedMerge');
  assertEq(result.proposedMerge.name, 'Web Search', 'merge.name');
});

test('parseClassificationResponseWithMerge: IMPROVEMENT with valid merge', () => {
  const response = JSON.stringify({
    classification: 'IMPROVEMENT',
    confidence: 0.9,
    reasoning: 'Cleaner.',
    proposedMerge: validMerge,
  });
  const result = parseClassificationResponseWithMerge(response);
  if (!result) throw new Error('expected non-null result');
  assertEq(result.classification, 'IMPROVEMENT', 'classification');
  if (!result.proposedMerge) throw new Error('expected proposedMerge');
});

test('parseClassificationResponseWithMerge: DUPLICATE → proposedMerge stripped', () => {
  // Even if the LLM returns proposedMerge on a DUPLICATE classification
  // (which it shouldn't per the prompt), the parser strips it because
  // there is nothing to merge.
  const response = JSON.stringify({
    classification: 'DUPLICATE',
    confidence: 0.95,
    reasoning: 'Same.',
    proposedMerge: validMerge,
  });
  const result = parseClassificationResponseWithMerge(response);
  if (!result) throw new Error('expected non-null result');
  assertEq(result.classification, 'DUPLICATE', 'classification');
  assertEq(result.proposedMerge, null, 'proposedMerge stripped');
});

test('parseClassificationResponseWithMerge: DISTINCT → proposedMerge stripped', () => {
  const response = JSON.stringify({
    classification: 'DISTINCT',
    confidence: 0.97,
    reasoning: 'Unrelated.',
  });
  const result = parseClassificationResponseWithMerge(response);
  if (!result) throw new Error('expected non-null result');
  assertEq(result.classification, 'DISTINCT', 'classification');
  assertEq(result.proposedMerge, null, 'proposedMerge null');
});

// ---------------------------------------------------------------------------
// parseClassificationResponseWithMerge — fallback paths
// ---------------------------------------------------------------------------

test('parseClassificationResponseWithMerge: PARTIAL_OVERLAP with NO proposedMerge → null merge', () => {
  const response = JSON.stringify({
    classification: 'PARTIAL_OVERLAP',
    confidence: 0.7,
    reasoning: 'Both have value.',
  });
  const result = parseClassificationResponseWithMerge(response);
  if (!result) throw new Error('expected non-null result');
  assertEq(result.proposedMerge, null, 'proposedMerge null when missing');
});

test('parseClassificationResponseWithMerge: PARTIAL_OVERLAP with malformed merge (missing name) → null merge', () => {
  const response = JSON.stringify({
    classification: 'PARTIAL_OVERLAP',
    confidence: 0.7,
    reasoning: 'Both have value.',
    proposedMerge: { description: 'no name', definition: {}, instructions: null },
  });
  const result = parseClassificationResponseWithMerge(response);
  if (!result) throw new Error('expected non-null result');
  assertEq(result.proposedMerge, null, 'proposedMerge null when malformed');
});

test('parseClassificationResponseWithMerge: definition as STRING is rejected → null merge', () => {
  // The whole point of the iteration-7 mechanical fix: definition is a
  // JSON object on the wire, never a string.
  const response = JSON.stringify({
    classification: 'PARTIAL_OVERLAP',
    confidence: 0.7,
    reasoning: 'Both have value.',
    proposedMerge: {
      name: 'Web Search',
      description: 'desc',
      definition: '{"name":"web_search"}', // STRING — invalid
      instructions: 'instructions',
    },
  });
  const result = parseClassificationResponseWithMerge(response);
  if (!result) throw new Error('expected non-null result');
  assertEq(result.proposedMerge, null, 'proposedMerge null when definition is a string');
});

test('parseClassificationResponseWithMerge: instructions can be null', () => {
  const response = JSON.stringify({
    classification: 'IMPROVEMENT',
    confidence: 0.85,
    reasoning: 'Better.',
    proposedMerge: {
      name: 'Skill',
      description: 'desc',
      definition: { name: 'skill', description: 'd', input_schema: { type: 'object', properties: {} } },
      instructions: null,
    },
  });
  const result = parseClassificationResponseWithMerge(response);
  if (!result) throw new Error('expected non-null result');
  if (!result.proposedMerge) throw new Error('expected proposedMerge');
  assertEq(result.proposedMerge.instructions, null, 'instructions null');
});

test('parseClassificationResponseWithMerge: unparseable JSON → null result', () => {
  const result = parseClassificationResponseWithMerge('{ this is not valid json');
  assertEq(result, null, 'expected null result');
});

test('parseClassificationResponseWithMerge: bad classification → null result', () => {
  const response = JSON.stringify({ classification: 'WAT', confidence: 0.5, reasoning: '...' });
  const result = parseClassificationResponseWithMerge(response);
  assertEq(result, null, 'expected null result');
});

test('parseClassificationResponseWithMerge: confidence out of range → null result', () => {
  const response = JSON.stringify({ classification: 'DUPLICATE', confidence: 1.5, reasoning: '...' });
  const result = parseClassificationResponseWithMerge(response);
  assertEq(result, null, 'expected null result');
});

test('parseClassificationResponseWithMerge: extracts JSON from markdown code block', () => {
  const response = '```json\n' + JSON.stringify({
    classification: 'DUPLICATE',
    confidence: 0.95,
    reasoning: 'Same.',
  }) + '\n```';
  const result = parseClassificationResponseWithMerge(response);
  if (!result) throw new Error('expected non-null result');
  assertEq(result.classification, 'DUPLICATE', 'classification from markdown block');
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log('');
console.log(`skillAnalyzerServicePureMergePrompt: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
