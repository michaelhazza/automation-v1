/**
 * Runnable via: npx tsx server/services/__tests__/skillAnalyzerServicePure.test.ts
 */

import {
  cosineSimilarity,
  classifyBand,
  computeBestMatches,
  parseClassificationResponse,
  generateDiffSummary,
  buildClassificationPrompt,
} from '../skillAnalyzerServicePure.js';
import type { LibrarySkillSummary } from '../skillAnalyzerServicePure.js';
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
  assert(sim === 0, `Expected 0 (clamped), got ${sim}`);
});

test('cosineSimilarity: empty vectors → 0', () => {
  assert(cosineSimilarity([], []) === 0, 'empty vectors should return 0');
});

test('cosineSimilarity: mismatched lengths → 0', () => {
  assert(cosineSimilarity([1, 2], [1, 2, 3]) === 0, 'mismatched lengths should return 0');
});

// ---------------------------------------------------------------------------
// classifyBand
// ---------------------------------------------------------------------------

test('classifyBand: >0.92 → likely_duplicate', () => {
  assert(classifyBand(0.95) === 'likely_duplicate', 'expected likely_duplicate');
  assert(classifyBand(0.93) === 'likely_duplicate', 'expected likely_duplicate');
});

test('classifyBand: 0.60–0.92 → ambiguous', () => {
  assert(classifyBand(0.75) === 'ambiguous', 'expected ambiguous');
  assert(classifyBand(0.60) === 'ambiguous', 'expected ambiguous at boundary');
  assert(classifyBand(0.92) === 'ambiguous', 'expected ambiguous at upper boundary');
});

test('classifyBand: <0.60 → distinct', () => {
  assert(classifyBand(0.3) === 'distinct', 'expected distinct');
  assert(classifyBand(0.0) === 'distinct', 'expected distinct at zero');
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
  assert(matches.length === 2, `expected 2 matches, got ${matches.length}`);
  assert(matches[0].librarySlug === 'lib-a', `candidate 0 should match lib-a`);
  assert(matches[1].librarySlug === 'lib-b', `candidate 1 should match lib-b`);
  assertNear(matches[0].similarity, 1.0, 0.0001, 'perfect match similarity');
});

test('computeBestMatches: empty candidates → empty result', () => {
  const result = computeBestMatches([], [{ id: null, slug: 'x', name: 'X', embedding: [1, 0, 0] }]);
  assert(result.length === 0, 'expected empty result');
});

test('computeBestMatches: empty library → similarity 0 for all', () => {
  const candidates = [{ index: 0, embedding: [1, 0, 0] }];
  const result = computeBestMatches(candidates, []);
  assert(result.length === 1, 'expected 1 result');
  assert(result[0].similarity === 0, `expected 0 similarity, got ${result[0].similarity}`);
  assert(result[0].band === 'distinct', `expected distinct band`);
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
  assert(result !== null, 'expected non-null result');
  assert(result!.classification === 'IMPROVEMENT', `expected IMPROVEMENT, got ${result!.classification}`);
  assertNear(result!.confidence, 0.85, 0.001, 'confidence');
});

test('parseClassificationResponse: JSON in markdown code block', () => {
  const response = '```json\n{"classification":"DISTINCT","confidence":0.9,"reasoning":"Different purpose."}\n```';
  const result = parseClassificationResponse(response);
  assert(result !== null, 'expected non-null result');
  assert(result!.classification === 'DISTINCT', `expected DISTINCT`);
});

test('parseClassificationResponse: invalid JSON → null', () => {
  const result = parseClassificationResponse('not json at all');
  assert(result === null, 'expected null for invalid JSON');
});

test('parseClassificationResponse: missing required fields → null', () => {
  const result = parseClassificationResponse(JSON.stringify({ classification: 'DUPLICATE' }));
  // Missing confidence and reasoning → fails Zod validation
  assert(result === null, 'expected null for missing fields');
});

test('parseClassificationResponse: invalid classification enum → null', () => {
  const result = parseClassificationResponse(JSON.stringify({
    classification: 'INVALID_TYPE',
    confidence: 0.9,
    reasoning: 'Something.',
  }));
  assert(result === null, 'expected null for invalid enum');
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
  methodology: null,
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
  methodology: null,
  isSystem: false,
  ...overrides,
});

test('generateDiffSummary: identical skills → empty diff', () => {
  const diff = generateDiffSummary(makeCandidate(), makeLibrary());
  // name and description differ (candidate vs library names)
  assert(diff.addedFields.length === 0 || diff.changedFields.includes('name'), 'name should be in changedFields');
});

test('generateDiffSummary: candidate has methodology, library does not → added', () => {
  const diff = generateDiffSummary(
    makeCandidate({ methodology: 'Phase 1: ...' }),
    makeLibrary({ methodology: null })
  );
  assert(diff.addedFields.includes('methodology'), 'methodology should be in addedFields');
});

test('generateDiffSummary: library has instructions, candidate does not → removed', () => {
  const diff = generateDiffSummary(
    makeCandidate({ instructions: null }),
    makeLibrary({ instructions: 'Do this.' })
  );
  assert(diff.removedFields.includes('instructions'), 'instructions should be in removedFields');
});

test('generateDiffSummary: both have different definitions → changed', () => {
  const diff = generateDiffSummary(
    makeCandidate({ definition: { name: 'new_tool', input_schema: {} } }),
    makeLibrary({ definition: { name: 'old_tool', input_schema: {} } })
  );
  assert(diff.changedFields.includes('definition'), 'definition should be in changedFields');
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
  assert(typeof system === 'string' && system.length > 0, 'system prompt should be non-empty string');
  assert(typeof userMessage === 'string' && userMessage.length > 0, 'userMessage should be non-empty string');
  assert(userMessage.includes('Candidate Skill'), 'userMessage should include candidate name');
  assert(userMessage.includes('Library Skill'), 'userMessage should include library name');
});

test('buildClassificationPrompt: likely_duplicate hint included', () => {
  const { userMessage } = buildClassificationPrompt(makeCandidate(), makeLibrary(), 'likely_duplicate');
  assert(userMessage.includes('likely_duplicate') || userMessage.includes('very high'), 'hint should mention high similarity');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
