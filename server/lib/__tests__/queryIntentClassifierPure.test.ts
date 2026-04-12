/**
 * queryIntentClassifier unit tests — runnable via:
 *   npx tsx server/lib/__tests__/queryIntentClassifierPure.test.ts
 */

import { classifyQueryIntent } from '../queryIntentClassifier.js';

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

console.log('\nclassifyQueryIntent');

test('temporal: "What happened with Client X last week?"', () => {
  assert(classifyQueryIntent('What happened with Client X last week?') === 'temporal', 'expected temporal');
});

test('temporal: "recent activity"', () => {
  assert(classifyQueryIntent('recent activity') === 'temporal', 'expected temporal');
});

test('temporal: "since yesterday"', () => {
  assert(classifyQueryIntent('updates since yesterday') === 'temporal', 'expected temporal');
});

test('factual: "What is the client email address?"', () => {
  assert(classifyQueryIntent("What is the client's email address?") === 'factual', 'expected factual');
});

test('factual: "specific budget number"', () => {
  assert(classifyQueryIntent('specific budget allocation for Q1') === 'factual', 'expected factual');
});

test('relational: "How are campaigns connected to revenue?"', () => {
  assert(classifyQueryIntent('How are the marketing campaigns connected to revenue?') === 'relational', 'expected relational');
});

test('relational: "impact of the migration"', () => {
  assert(classifyQueryIntent('What was the impact of the platform migration?') === 'relational', 'expected relational');
});

test('exploratory: "Tell me about the onboarding process"', () => {
  assert(classifyQueryIntent('Tell me about the onboarding process') === 'exploratory', 'expected exploratory');
});

test('exploratory: "overview of current state"', () => {
  assert(classifyQueryIntent('Give me an overview of the current state') === 'exploratory', 'expected exploratory');
});

test('general: "client preferences"', () => {
  assert(classifyQueryIntent('client preferences') === 'general', 'expected general');
});

test('general: "campaign performance"', () => {
  assert(classifyQueryIntent('campaign performance data') === 'general', 'expected general');
});

test('empty string returns general', () => {
  assert(classifyQueryIntent('') === 'general', 'expected general for empty');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
