/**
 * memoryCitationDetectorPure.test.ts — tokenization + Jaccard + tool-call matcher
 *
 * Spec: docs/memory-and-briefings-spec.md §4.4 (S12)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryCitationDetectorPure.test.ts
 */

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

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label} — expected true`);
}

function assertFalse(cond: boolean, label: string) {
  if (cond) throw new Error(`${label} — expected false`);
}

console.log('');
console.log('memoryCitationDetectorPure — citation math (§4.4 S12)');
console.log('');

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

console.log('normaliseText:');

test('lowercases', () => assertEqual(normaliseText('HELLO World'), 'hello world', 'case'));
test('collapses whitespace', () => assertEqual(normaliseText('a   b\nc'), 'a b c', 'ws'));
test('strips punctuation', () => assertEqual(normaliseText('a, b! c.'), 'a b c', 'punct'));
test('empty → empty', () => assertEqual(normaliseText('   '), '', 'empty'));

console.log('tokenize:');

test('empty → []', () => assertEqual(tokenize('').length, 0, 'empty'));
test('3 tokens', () => assertEqual(tokenize('foo bar baz').length, 3, '3'));

console.log('ngramSet:');

test('4 tokens → 2 trigrams', () => {
  const grams = ngramSet('a b c d', 3);
  assertEqual(grams.size, 2, '2 trigrams');
  assertTrue(grams.has('a b c'), 'first gram');
  assertTrue(grams.has('b c d'), 'second gram');
});

test('2 tokens < n → single partial gram', () => {
  const grams = ngramSet('a b', 3);
  assertEqual(grams.size, 1, 'one partial');
  assertTrue(grams.has('a b'), 'partial gram');
});

test('empty → empty set', () => {
  const grams = ngramSet('', 3);
  assertEqual(grams.size, 0, 'empty');
});

// ---------------------------------------------------------------------------
// Jaccard
// ---------------------------------------------------------------------------

console.log('jaccard:');

test('identical sets → 1', () => {
  const s = new Set(['a', 'b', 'c']);
  assertEqual(jaccard(s, s), 1, 'identical');
});

test('disjoint sets → 0', () => {
  assertEqual(jaccard(new Set(['a']), new Set(['b'])), 0, 'disjoint');
});

test('half overlap: {a,b} vs {a,c} → 1/3', () => {
  const r = jaccard(new Set(['a', 'b']), new Set(['a', 'c']));
  // |{a}| / |{a,b,c}| = 1/3
  if (Math.abs(r - 1 / 3) > 1e-9) throw new Error(`expected 1/3, got ${r}`);
});

test('empty + empty → 0', () => assertEqual(jaccard(new Set(), new Set()), 0, 'empty empty'));

// ---------------------------------------------------------------------------
// Tool-call arg extraction
// ---------------------------------------------------------------------------

console.log('extractArgStrings:');

test('string arg', () => {
  const s = extractArgStrings('hello');
  assertTrue(s.has('hello'), 'hello');
});

test('nested object', () => {
  const s = extractArgStrings({ name: 'alice', meta: { id: '123' } });
  assertTrue(s.has('alice'), 'alice');
  assertTrue(s.has('123'), '123');
});

test('array of strings', () => {
  const s = extractArgStrings(['a', 'b', { c: 'd' }]);
  assertTrue(s.has('a'), 'a');
  assertTrue(s.has('d'), 'd nested');
});

test('null → empty set', () => assertEqual(extractArgStrings(null).size, 0, 'null'));

test('numbers coerced', () => {
  const s = extractArgStrings(42);
  assertTrue(s.has('42'), '42');
});

// ---------------------------------------------------------------------------
// Tool-call score
// ---------------------------------------------------------------------------

console.log('computeToolCallScore:');

test('exact phrase match → 1.0', () => {
  const score = computeToolCallScore(['alice@acme.com'], [{ to: 'alice@acme.com' }]);
  assertEqual(score, 1.0, 'exact match');
});

test('substring match → 1.0', () => {
  const score = computeToolCallScore(['acme'], [{ to: 'alice@acme.com' }]);
  assertEqual(score, 1.0, 'substring');
});

test('no match → 0', () => {
  const score = computeToolCallScore(['bob'], [{ to: 'alice@acme.com' }]);
  assertEqual(score, 0, 'no match');
});

test('empty phrases → 0', () => {
  const score = computeToolCallScore([], [{ to: 'a' }]);
  assertEqual(score, 0, 'empty phrases');
});

test('empty args → 0', () => {
  const score = computeToolCallScore(['a'], []);
  assertEqual(score, 0, 'empty args');
});

test('case-insensitive', () => {
  const score = computeToolCallScore(['ACME'], [{ to: 'alice@acme.com' }]);
  assertEqual(score, 1.0, 'case-insensitive');
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
  assertEqual(result.ratio, 1, 'identical ratio');
  assertTrue(result.cited, 'cited');
});

test('disjoint → ratio 0 + cited=false', () => {
  const result = computeTextMatch({
    entryContent: 'alpha beta gamma delta epsilon zeta eta theta',
    generatedText: 'one two three four five six seven eight',
    overlapMin: 0.35,
    tokenMin: 8,
  });
  assertEqual(result.ratio, 0, 'disjoint');
  assertFalse(result.cited, 'not cited');
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
  assertTrue(result.ratio >= 0.35, 'ratio passes');
  assertFalse(result.cited, 'token floor blocks short-snippet citation');
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
  assertFalse(result.cited, 'ratio floor blocks');
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
  assertTrue(result.cited, 'cited via tool-call');
  assertEqual(result.finalScore, 1.0, 'max(1,0)=1');
});

test('tool-call 0 + text match cited → cited via text path', () => {
  const result = computeFinalCitation({
    toolCallScore: 0,
    textMatch: { ratio: 0.9, overlap: 50, entrySize: 60, generatedSize: 60, cited: true },
    threshold: 0.7,
  });
  assertTrue(result.cited, 'cited via text');
  if (Math.abs(result.finalScore - 0.9) > 1e-9) throw new Error('finalScore=0.9');
});

test('tool-call 0 + text match not cited → not cited', () => {
  const result = computeFinalCitation({
    toolCallScore: 0,
    textMatch: { ratio: 0.3, overlap: 5, entrySize: 20, generatedSize: 20, cited: false },
    threshold: 0.7,
  });
  assertFalse(result.cited, 'neither path');
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
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
