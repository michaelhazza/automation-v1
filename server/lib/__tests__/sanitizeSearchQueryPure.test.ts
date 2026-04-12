/**
 * sanitizeSearchQuery unit tests — runnable via:
 *   npx tsx server/lib/__tests__/sanitizeSearchQueryPure.test.ts
 */

import { sanitizeSearchQuery } from '../sanitizeSearchQuery.js';

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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

console.log('\nsanitizeSearchQuery');

test('empty string returns empty string', () => {
  assert(sanitizeSearchQuery('') === '', 'expected empty');
  assert(sanitizeSearchQuery('   ') === '', 'expected empty for whitespace');
});

test('short query passes through unchanged', () => {
  const q = 'What is the client email?';
  assert(sanitizeSearchQuery(q) === q, 'expected passthrough');
});

test('query at exactly 200 chars passes through', () => {
  const q = 'a'.repeat(200);
  assert(sanitizeSearchQuery(q) === q, 'expected passthrough at boundary');
});

test('long query with question mark extracts the question', () => {
  const preamble = 'I need to search the workspace memory for information about the client. Specifically, I am looking for details about their platform preferences and configuration settings that were discussed in prior conversations. ';
  const question = 'What platform does the client use?';
  const result = sanitizeSearchQuery(preamble + question);
  assert(result === question, `expected question extraction, got: ${result}`);
});

test('long query without question extracts last sentence', () => {
  const preamble = 'The agent needs to find information about the client configuration and platform details that were previously discussed in earlier sessions and stored in workspace memory across multiple prior runs. ';
  const lastSentence = 'Client platform configuration details and integration setup.';
  const input = preamble + lastSentence;
  assert(input.length > 200, `input too short: ${input.length}`);
  const result = sanitizeSearchQuery(input);
  assert(result === lastSentence, `expected last sentence, got: ${result}`);
});

test('long query with no sentence boundaries tail-truncates', () => {
  const long = 'a'.repeat(300);
  const result = sanitizeSearchQuery(long);
  assert(result.length === 200, `expected 200 chars, got: ${result.length}`);
  assert(result === 'a'.repeat(200), 'expected tail of input');
});

test('short question under 10 chars falls through to last sentence', () => {
  const input = 'I need to look up information about the client preferences and their current platform setup to determine what integrations they need and what their configuration looks like. ' + 'Why? ' + 'Check the client platform setup and integration requirements.';
  const result = sanitizeSearchQuery(input);
  // "Why?" is only 4 chars — too short, should fall through to last sentence
  assert(result === 'Check the client platform setup and integration requirements.', `got: ${result}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
