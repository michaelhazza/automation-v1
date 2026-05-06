/**
 * sanitizeSearchQuery unit tests — runnable via:
 *   npx tsx server/lib/__tests__/sanitizeSearchQueryPure.test.ts
 */

import { expect, test } from 'vitest';
import { sanitizeSearchQuery } from '../sanitizeSearchQuery.js';

console.log('\nsanitizeSearchQuery');

test('empty string returns empty string', () => {
  expect(sanitizeSearchQuery('') === '', 'expected empty').toBeTruthy();
  expect(sanitizeSearchQuery('   ') === '', 'expected empty for whitespace').toBeTruthy();
});

test('short query passes through unchanged', () => {
  const q = 'What is the client email?';
  expect(sanitizeSearchQuery(q) === q, 'expected passthrough').toBeTruthy();
});

test('query at exactly 200 chars passes through', () => {
  const q = 'a'.repeat(200);
  expect(sanitizeSearchQuery(q) === q, 'expected passthrough at boundary').toBeTruthy();
});

test('long query with question mark extracts the question', () => {
  const preamble = 'I need to search the workspace memory for information about the client. Specifically, I am looking for details about their platform preferences and configuration settings that were discussed in prior conversations. ';
  const question = 'What platform does the client use?';
  const result = sanitizeSearchQuery(preamble + question);
  expect(result === question, `expected question extraction, got: ${result}`).toBeTruthy();
});

test('long query without question extracts last sentence', () => {
  const preamble = 'The agent needs to find information about the client configuration and platform details that were previously discussed in earlier sessions and stored in workspace memory across multiple prior runs. ';
  const lastSentence = 'Client platform configuration details and integration setup.';
  const input = preamble + lastSentence;
  expect(input.length > 200, `input too short: ${input.length}`).toBeTruthy();
  const result = sanitizeSearchQuery(input);
  expect(result === lastSentence, `expected last sentence, got: ${result}`).toBeTruthy();
});

test('long query with no sentence boundaries tail-truncates', () => {
  const long = 'a'.repeat(300);
  const result = sanitizeSearchQuery(long);
  expect(result.length === 200, `expected 200 chars, got: ${result.length}`).toBeTruthy();
  expect(result === 'a'.repeat(200), 'expected tail of input').toBeTruthy();
});

test('short question under 10 chars falls through to last sentence', () => {
  const input = 'I need to look up information about the client preferences and their current platform setup to determine what integrations they need and what their configuration looks like. ' + 'Why? ' + 'Check the client platform setup and integration requirements.';
  const result = sanitizeSearchQuery(input);
  // "Why?" is only 4 chars — too short, should fall through to last sentence
  expect(result === 'Check the client platform setup and integration requirements.', `got: ${result}`).toBeTruthy();
});

test('long multi-clause query without agent noise preserves structure via head-truncate', () => {
  const query = 'Compare client A vs client B performance over last 3 months including revenue growth, churn rates, and customer acquisition costs across all product lines and geographic segments. Also include NPS trends and support ticket resolution rates for both accounts.';
  expect(query.length > 200, `query too short: ${query.length}`).toBeTruthy();
  const result = sanitizeSearchQuery(query);
  // No agent noise → should preserve from the beginning, not extract last sentence
  expect(result.startsWith('Compare client A vs client B'), `expected head preserved, got: ${result.slice(0, 50)}`).toBeTruthy();
  expect(result.length === 200, `expected 200 chars, got: ${result.length}`).toBeTruthy();
});

test('long query with agent preamble still extracts meaningful part', () => {
  const input = 'Let me search the workspace memory for relevant information. I should look at previous run data to find insights about this particular client account and their historical engagement patterns across multiple quarters. ' + 'What are the client retention metrics?';
  const result = sanitizeSearchQuery(input);
  // Has agent noise → lossy extraction fires → question gets extracted
  expect(result === 'What are the client retention metrics?', `got: ${result}`).toBeTruthy();
});

test('long query with "searching for" noise applies sentence extraction', () => {
  const input = 'I am searching for information about pricing strategies and competitive analysis data from prior runs that I stored in the workspace memory system. The client prefers value-based pricing with tiered discounts.';
  const result = sanitizeSearchQuery(input);
  expect(result === 'The client prefers value-based pricing with tiered discounts.', `got: ${result}`).toBeTruthy();
});