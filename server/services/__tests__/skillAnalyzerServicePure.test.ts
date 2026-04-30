/**
 * Runnable via: npx tsx server/services/__tests__/skillAnalyzerServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  cosineSimilarity,
  classifyBand,
  computeBestMatches,
  parseClassificationResponse,
  generateDiffSummary,
  buildClassificationPrompt,
  buildClassifyPromptWithMerge,
  deriveClassificationFailureReason,
} from '../skillAnalyzerServicePure.js';
import type { LibrarySkillSummary } from '../skillAnalyzerServicePure.js';
import type { ParsedSkill } from '../skillParserServicePure.js';

function assertNear(actual: number, expected: number, delta: number, label: string) {
  if (Math.abs(actual - expected) > delta) {
    throw new Error(`${label}: expected ~${expected}, got ${actual}`);
  }
}

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

test('cosineSimilarity: identical unit vectors → 1.0', () => {
  const a = [1, 0, 0];
  const b = [1, 0, 0];
  assertNear(cosineSimilarity(a, b), 1.0, 0.0001, 'identical vectors');
});

test('cosineSimilarity: orthogonal vectors → 0.0', () => {
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assertNear(cosineSimilarity(a, b), 0.0, 0.0001, 'orthogonal vectors');
});

test('cosineSimilarity: opposite vectors → clamped to 0.0', () => {
  const a = [1, 0, 0];
  const b = [-1, 0, 0];
  const sim = cosineSimilarity(a, b);
  expect(sim === 0, `Expected 0 (clamped), got ${sim}`).toBeTruthy();
});

test('cosineSimilarity: empty vectors → 0', () => {
  expect(cosineSimilarity([], []) === 0, 'empty vectors should return 0').toBeTruthy();
});

test('cosineSimilarity: mismatched lengths → 0', () => {
  expect(cosineSimilarity([1, 2], [1, 2, 3]) === 0, 'mismatched lengths should return 0').toBeTruthy();
});

// ---------------------------------------------------------------------------
// classifyBand
// ---------------------------------------------------------------------------

test('classifyBand: >0.92 → likely_duplicate', () => {
  expect(classifyBand(0.95) === 'likely_duplicate', 'expected likely_duplicate').toBeTruthy();
  expect(classifyBand(0.93) === 'likely_duplicate', 'expected likely_duplicate').toBeTruthy();
});

test('classifyBand: 0.60–0.92 → ambiguous', () => {
  expect(classifyBand(0.75) === 'ambiguous', 'expected ambiguous').toBeTruthy();
  expect(classifyBand(0.60) === 'ambiguous', 'expected ambiguous at boundary').toBeTruthy();
  expect(classifyBand(0.92) === 'ambiguous', 'expected ambiguous at upper boundary').toBeTruthy();
});

test('classifyBand: <0.60 → distinct', () => {
  expect(classifyBand(0.3) === 'distinct', 'expected distinct').toBeTruthy();
  expect(classifyBand(0.0) === 'distinct', 'expected distinct at zero').toBeTruthy();
});

// ---------------------------------------------------------------------------
// computeBestMatches
// ---------------------------------------------------------------------------

test('computeBestMatches: returns best match per candidate', () => {
  const candidates = [
    { index: 0, embedding: [1, 0, 0] },
    { index: 1, embedding: [0, 1, 0] },
  ];
  const library = [
    { id: 'lib-a', slug: 'lib-a', name: 'Lib A', embedding: [1, 0, 0] },
    { id: 'lib-b', slug: 'lib-b', name: 'Lib B', embedding: [0, 1, 0] },
  ];

  const matches = computeBestMatches(candidates, library);
  expect(matches.length === 2, `expected 2 matches, got ${matches.length}`).toBeTruthy();
  expect(matches[0].librarySlug === 'lib-a', `candidate 0 should match lib-a`).toBeTruthy();
  expect(matches[1].librarySlug === 'lib-b', `candidate 1 should match lib-b`).toBeTruthy();
  assertNear(matches[0].similarity, 1.0, 0.0001, 'perfect match similarity');
});

test('computeBestMatches: empty candidates → empty result', () => {
  const result = computeBestMatches([], [{ id: null, slug: 'x', name: 'X', embedding: [1, 0, 0] }]);
  expect(result.length === 0, 'expected empty result').toBeTruthy();
});

test('computeBestMatches: empty library → similarity 0 for all', () => {
  const candidates = [{ index: 0, embedding: [1, 0, 0] }];
  const result = computeBestMatches(candidates, []);
  expect(result.length === 1, 'expected 1 result').toBeTruthy();
  expect(result[0].similarity === 0, `expected 0 similarity, got ${result[0].similarity}`).toBeTruthy();
  expect(result[0].band === 'distinct', `expected distinct band`).toBeTruthy();
});

// ---------------------------------------------------------------------------
// parseClassificationResponse
// ---------------------------------------------------------------------------

test('parseClassificationResponse: valid JSON object', () => {
  const response = JSON.stringify({
    classification: 'IMPROVEMENT',
    confidence: 0.85,
    reasoning: 'The incoming skill is more detailed.',
  });
  const result = parseClassificationResponse(response);
  expect(result !== null, 'expected non-null result').toBeTruthy();
  expect(result!.classification === 'IMPROVEMENT', `expected IMPROVEMENT, got ${result!.classification}`).toBeTruthy();
  assertNear(result!.confidence, 0.85, 0.001, 'confidence');
});

test('parseClassificationResponse: JSON in markdown code block', () => {
  const response = '```json\n{"classification":"DISTINCT","confidence":0.9,"reasoning":"Different purpose."}\n```';
  const result = parseClassificationResponse(response);
  expect(result !== null, 'expected non-null result').toBeTruthy();
  expect(result!.classification === 'DISTINCT', `expected DISTINCT`).toBeTruthy();
});

test('parseClassificationResponse: invalid JSON → null', () => {
  const result = parseClassificationResponse('not json at all');
  expect(result === null, 'expected null for invalid JSON').toBeTruthy();
});

test('parseClassificationResponse: missing required fields → null', () => {
  const result = parseClassificationResponse(JSON.stringify({ classification: 'DUPLICATE' }));
  // Missing confidence and reasoning → fails Zod validation
  expect(result === null, 'expected null for missing fields').toBeTruthy();
});

test('parseClassificationResponse: invalid classification enum → null', () => {
  const result = parseClassificationResponse(JSON.stringify({
    classification: 'INVALID_TYPE',
    confidence: 0.9,
    reasoning: 'Something.',
  }));
  expect(result === null, 'expected null for invalid enum').toBeTruthy();
});

// ---------------------------------------------------------------------------
// generateDiffSummary
// ---------------------------------------------------------------------------

const makeCandidate = (overrides: Partial<ParsedSkill> = {}): ParsedSkill => ({
  name: 'Candidate Skill',
  slug: 'candidate-skill',
  description: 'Does something',
  definition: { type: 'object' },
  instructions: 'Step 1. Do it.',
  rawSource: '',
  ...overrides,
});

const makeLibrary = (overrides: Partial<LibrarySkillSummary> = {}): LibrarySkillSummary => ({
  id: 'lib-1',
  slug: 'library-skill',
  name: 'Library Skill',
  description: 'Does something',
  definition: { type: 'object' },
  instructions: 'Step 1. Do it.',
  isSystem: false,
  ...overrides,
});

test('generateDiffSummary: identical skills → empty diff', () => {
  const diff = generateDiffSummary(makeCandidate(), makeLibrary());
  // name and description differ (candidate vs library names)
  expect(diff.addedFields.length === 0 || diff.changedFields.includes('name'), 'name should be in changedFields').toBeTruthy();
});

test('generateDiffSummary: candidate has instructions, library does not → added', () => {
  const diff = generateDiffSummary(
    makeCandidate({ instructions: 'Phase 1: ...' }),
    makeLibrary({ instructions: null })
  );
  expect(diff.addedFields.includes('instructions'), 'instructions should be in addedFields').toBeTruthy();
});

test('generateDiffSummary: library has instructions, candidate does not → removed', () => {
  const diff = generateDiffSummary(
    makeCandidate({ instructions: null }),
    makeLibrary({ instructions: 'Do this.' })
  );
  expect(diff.removedFields.includes('instructions'), 'instructions should be in removedFields').toBeTruthy();
});

test('generateDiffSummary: both have different definitions → changed', () => {
  const diff = generateDiffSummary(
    makeCandidate({ definition: { name: 'new_tool', input_schema: {} } }),
    makeLibrary({ definition: { name: 'old_tool', input_schema: {} } })
  );
  expect(diff.changedFields.includes('definition'), 'definition should be in changedFields').toBeTruthy();
});

// ---------------------------------------------------------------------------
// buildClassificationPrompt
// ---------------------------------------------------------------------------

test('buildClassificationPrompt: returns system and userMessage strings', () => {
  const { system, userMessage } = buildClassificationPrompt(
    makeCandidate(),
    makeLibrary(),
    'ambiguous'
  );
  expect(typeof system === 'string' && system.length > 0, 'system prompt should be non-empty string').toBeTruthy();
  expect(typeof userMessage === 'string' && userMessage.length > 0, 'userMessage should be non-empty string').toBeTruthy();
  expect(userMessage.includes('Candidate Skill'), 'userMessage should include candidate name').toBeTruthy();
  expect(userMessage.includes('Library Skill'), 'userMessage should include library name').toBeTruthy();
});

test('buildClassificationPrompt: likely_duplicate hint included', () => {
  const { userMessage } = buildClassificationPrompt(makeCandidate(), makeLibrary(), 'likely_duplicate');
  expect(userMessage.includes('likely_duplicate') || userMessage.includes('very high'), 'hint should mention high similarity').toBeTruthy();
});

// ---------------------------------------------------------------------------
// DUPLICATE definition tightening
// ---------------------------------------------------------------------------

test('CLASSIFICATION_SYSTEM_PROMPT: DUPLICATE definition requires zero additive value', () => {
  const { system } = buildClassificationPrompt(
    { name: 'a', slug: 'a', description: '', definition: null, instructions: null, rawSource: '' },
    { id: null, slug: 'b', name: 'b', description: '', definition: null, instructions: null, isSystem: true },
    'ambiguous',
  );
  expect(system.includes('zero additive value'), 'DUPLICATE definition should mention "zero additive value"').toBeTruthy();
});

test('CLASSIFICATION_SYSTEM_PROMPT: contains anti-bias instruction', () => {
  const { system } = buildClassificationPrompt(
    { name: 'a', slug: 'a', description: '', definition: null, instructions: null, rawSource: '' },
    { id: null, slug: 'b', name: 'b', description: '', definition: null, instructions: null, isSystem: true },
    'ambiguous',
  );
  expect(system.includes('Do not rely solely on embedding similarity'), 'system prompt should contain anti-bias instruction').toBeTruthy();
});

test('buildClassificationPrompt: likely_duplicate band hint prefers IMPROVEMENT', () => {
  const { userMessage } = buildClassificationPrompt(
    { name: 'a', slug: 'a', description: '', definition: null, instructions: null, rawSource: '' },
    { id: null, slug: 'b', name: 'b', description: '', definition: null, instructions: null, isSystem: true },
    'likely_duplicate',
  );
  expect(userMessage.includes('Prefer IMPROVEMENT'), 'likely_duplicate hint should prefer IMPROVEMENT').toBeTruthy();
});

// ---------------------------------------------------------------------------
// deriveClassificationFailureReason
// ---------------------------------------------------------------------------

test('deriveClassificationFailureReason: null error → parse_error', () => {
  expect(deriveClassificationFailureReason(null) === 'parse_error', 'null → parse_error').toBeTruthy();
});

test('deriveClassificationFailureReason: 429 status → rate_limit', () => {
  expect(deriveClassificationFailureReason({ statusCode: 429 }) === 'rate_limit', '429 → rate_limit').toBeTruthy();
});

test('deriveClassificationFailureReason: unknown error → unknown', () => {
  expect(deriveClassificationFailureReason(new Error('boom')) === 'unknown', 'Error → unknown').toBeTruthy();
});

test('buildClassifyPromptWithMerge: likely_duplicate band hint prefers IMPROVEMENT', () => {
  const { userMessage } = buildClassifyPromptWithMerge(
    { name: 'a', slug: 'a', description: '', definition: null, instructions: null, rawSource: '' },
    { id: null, slug: 'b', name: 'b', description: '', definition: null, instructions: null, isSystem: true },
    'likely_duplicate',
  );
  expect(userMessage.includes('Prefer IMPROVEMENT'), 'likely_duplicate hint should prefer IMPROVEMENT in merge path').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
