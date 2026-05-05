/**
 * memoryCitationDetectorPure.test.ts — tokenization + Jaccard + tool-call matcher
 *
 * Spec: docs/memory-and-briefings-spec.md §4.4 (S12)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryCitationDetectorPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  normaliseText,
  tokenize,
  ngramSet,
  jaccard,
  extractArgStrings,
  computeToolCallScore,
  computeTextMatch,
  computeFinalCitation,
} from '../memoryCitationDetectorPure.js';

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

console.log('');
console.log('memoryCitationDetectorPure — citation math (§4.4 S12)');
console.log('');

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

console.log('normaliseText:');

test('lowercases', () => expect(normaliseText('HELLO World'), 'case').toBe('hello world'));
test('collapses whitespace', () => expect(normaliseText('a   b\nc'), 'ws').toBe('a b c'));
test('strips punctuation', () => expect(normaliseText('a, b! c.'), 'punct').toBe('a b c'));
test('empty → empty', () => expect(normaliseText('   '), 'empty').toBe(''));

console.log('tokenize:');

test('empty → []', () => expect(tokenize('').length, 'empty').toBe(0));
test('3 tokens', () => expect(tokenize('foo bar baz').length, '3').toBe(3));

console.log('ngramSet:');

test('4 tokens → 2 trigrams', () => {
  const grams = ngramSet('a b c d', 3);
  expect(grams.size, '2 trigrams').toBe(2);
  expect(grams.has('a b c'), 'first gram').toBe(true);
  expect(grams.has('b c d'), 'second gram').toBe(true);
});

test('2 tokens < n → single partial gram', () => {
  const grams = ngramSet('a b', 3);
  expect(grams.size, 'one partial').toBe(1);
  expect(grams.has('a b'), 'partial gram').toBe(true);
});

test('empty → empty set', () => {
  const grams = ngramSet('', 3);
  expect(grams.size, 'empty').toBe(0);
});

// ---------------------------------------------------------------------------
// Jaccard
// ---------------------------------------------------------------------------

console.log('jaccard:');

test('identical sets → 1', () => {
  const s = new Set(['a', 'b', 'c']);
  expect(jaccard(s, s), 'identical').toBe(1);
});

test('disjoint sets → 0', () => {
  expect(jaccard(new Set(['a']), new Set(['b'])), 'disjoint').toBe(0);
});

test('half overlap: {a,b} vs {a,c} → 1/3', () => {
  const r = jaccard(new Set(['a', 'b']), new Set(['a', 'c']));
  // |{a}| / |{a,b,c}| = 1/3
  if (Math.abs(r - 1 / 3) > 1e-9) throw new Error(`expected 1/3, got ${r}`);
});

test('empty + empty → 0', () => expect(jaccard(new Set(), new Set()), 'empty empty').toBe(0));

// ---------------------------------------------------------------------------
// Tool-call arg extraction
// ---------------------------------------------------------------------------

console.log('extractArgStrings:');

test('string arg', () => {
  const s = extractArgStrings('hello');
  expect(s.has('hello'), 'hello').toBe(true);
});

test('nested object', () => {
  const s = extractArgStrings({ name: 'alice', meta: { id: '123' } });
  expect(s.has('alice'), 'alice').toBe(true);
  expect(s.has('123'), '123').toBe(true);
});

test('array of strings', () => {
  const s = extractArgStrings(['a', 'b', { c: 'd' }]);
  expect(s.has('a'), 'a').toBe(true);
  expect(s.has('d'), 'd nested').toBe(true);
});

test('null → empty set', () => expect(extractArgStrings(null).size, 'null').toBe(0));

test('numbers coerced', () => {
  const s = extractArgStrings(42);
  expect(s.has('42'), '42').toBe(true);
});

// ---------------------------------------------------------------------------
// Tool-call score
// ---------------------------------------------------------------------------

console.log('computeToolCallScore:');

test('exact phrase match → 1.0', () => {
  const score = computeToolCallScore(['alice@acme.com'], [{ to: 'alice@acme.com' }]);
  expect(score, 'exact match').toBe(1.0);
});

test('substring match → 1.0', () => {
  const score = computeToolCallScore(['acme'], [{ to: 'alice@acme.com' }]);
  expect(score, 'substring').toBe(1.0);
});

test('no match → 0', () => {
  const score = computeToolCallScore(['bob'], [{ to: 'alice@acme.com' }]);
  expect(score, 'no match').toBe(0);
});

test('empty phrases → 0', () => {
  const score = computeToolCallScore([], [{ to: 'a' }]);
  expect(score, 'empty phrases').toBe(0);
});

test('empty args → 0', () => {
  const score = computeToolCallScore(['a'], []);
  expect(score, 'empty args').toBe(0);
});

test('case-insensitive', () => {
  const score = computeToolCallScore(['ACME'], [{ to: 'alice@acme.com' }]);
  expect(score, 'case-insensitive').toBe(1.0);
});

// ---------------------------------------------------------------------------
// Text match
// ---------------------------------------------------------------------------

console.log('computeTextMatch:');

test('verbatim → high ratio + cited=true', () => {
  const longText = 'the brand voice is warm friendly professional and approachable with clear calls to action';
  const result = computeTextMatch({
    entryContent: longText,
    generatedText: longText,
    overlapMin: 0.35,
    tokenMin: 8,
  });
  expect(result.ratio, 'identical ratio').toBe(1);
  expect(result.cited, 'cited').toBe(true);
});

test('disjoint → ratio 0 + cited=false', () => {
  const result = computeTextMatch({
    entryContent: 'alpha beta gamma delta epsilon zeta eta theta',
    generatedText: 'one two three four five six seven eight',
    overlapMin: 0.35,
    tokenMin: 8,
  });
  expect(result.ratio, 'disjoint').toBe(0);
  expect(result.cited, 'not cited').toBe(false);
});

test('high ratio but low token count → cited=false (dual-floor)', () => {
  // Short text with high proportional overlap but fewer than tokenMin=8 overlapping trigrams
  const short = 'quick brown fox';
  const result = computeTextMatch({
    entryContent: short,
    generatedText: short,
    overlapMin: 0.35,
    tokenMin: 8,
  });
  expect(result.ratio >= 0.35, 'ratio passes').toBe(true);
  expect(result.cited, 'token floor blocks short-snippet citation').toBe(false);
});

test('ratio below floor but many overlapping tokens → cited=false', () => {
  // If ratio < overlapMin, cited=false regardless of overlap count
  const entry = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].join(' ');
  // Pad generated with many unique tokens so ratio drops
  const generated = entry + ' ' + Array.from({ length: 100 }, (_, i) => `u${i}`).join(' ');
  const result = computeTextMatch({
    entryContent: entry,
    generatedText: generated,
    overlapMin: 0.5,
    tokenMin: 1,
  });
  expect(result.cited, 'ratio floor blocks').toBe(false);
});

// ---------------------------------------------------------------------------
// Final citation aggregation
// ---------------------------------------------------------------------------

console.log('computeFinalCitation:');

test('tool-call 1.0 + text miss → cited via tool-call path', () => {
  const result = computeFinalCitation({
    toolCallScore: 1.0,
    textMatch: { ratio: 0, overlap: 0, entrySize: 0, generatedSize: 0, cited: false },
    threshold: 0.7,
  });
  expect(result.cited, 'cited via tool-call').toBe(true);
  expect(result.finalScore, 'max(1,0)=1').toBe(1.0);
});

test('tool-call 0 + text match cited → cited via text path', () => {
  const result = computeFinalCitation({
    toolCallScore: 0,
    textMatch: { ratio: 0.9, overlap: 50, entrySize: 60, generatedSize: 60, cited: true },
    threshold: 0.7,
  });
  expect(result.cited, 'cited via text').toBe(true);
  if (Math.abs(result.finalScore - 0.9) > 1e-9) throw new Error('finalScore=0.9');
});

test('tool-call 0 + text match not cited → not cited', () => {
  const result = computeFinalCitation({
    toolCallScore: 0,
    textMatch: { ratio: 0.3, overlap: 5, entrySize: 20, generatedSize: 20, cited: false },
    threshold: 0.7,
  });
  expect(result.cited, 'neither path').toBe(false);
});

test('final_score = max(toolCall, textScore) independent of cited flag', () => {
  const result = computeFinalCitation({
    toolCallScore: 0.2,
    textMatch: { ratio: 0.9, overlap: 50, entrySize: 60, generatedSize: 60, cited: true },
    threshold: 0.7,
  });
  if (Math.abs(result.finalScore - 0.9) > 1e-9) throw new Error('final=0.9');
});

console.log('');
console.log('');
