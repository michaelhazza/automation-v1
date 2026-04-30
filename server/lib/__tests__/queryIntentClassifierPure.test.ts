/**
 * queryIntentClassifier unit tests — runnable via:
 *   npx tsx server/lib/__tests__/queryIntentClassifierPure.test.ts
 */

import { expect, test } from 'vitest';
import { classifyQueryIntent } from '../queryIntentClassifier.js';

console.log('\nclassifyQueryIntent');

test('temporal: "What happened with Client X last week?"', () => {
  expect(classifyQueryIntent('What happened with Client X last week?') === 'temporal', 'expected temporal').toBeTruthy();
});

test('temporal: "recent activity"', () => {
  expect(classifyQueryIntent('recent activity') === 'temporal', 'expected temporal').toBeTruthy();
});

test('temporal: "since yesterday"', () => {
  expect(classifyQueryIntent('updates since yesterday') === 'temporal', 'expected temporal').toBeTruthy();
});

test('factual: "What is the client email address?"', () => {
  expect(classifyQueryIntent("What is the client's email address?") === 'factual', 'expected factual').toBeTruthy();
});

test('factual: "specific budget number"', () => {
  expect(classifyQueryIntent('specific budget allocation for Q1') === 'factual', 'expected factual').toBeTruthy();
});

test('relational: "How are campaigns connected to revenue?"', () => {
  expect(classifyQueryIntent('How are the marketing campaigns connected to revenue?') === 'relational', 'expected relational').toBeTruthy();
});

test('relational: "impact of the migration"', () => {
  expect(classifyQueryIntent('What was the impact of the platform migration?') === 'relational', 'expected relational').toBeTruthy();
});

test('exploratory: "Tell me about the onboarding process"', () => {
  expect(classifyQueryIntent('Tell me about the onboarding process') === 'exploratory', 'expected exploratory').toBeTruthy();
});

test('exploratory: "overview of current state"', () => {
  expect(classifyQueryIntent('Give me an overview of the current state') === 'exploratory', 'expected exploratory').toBeTruthy();
});

test('general: "client preferences"', () => {
  expect(classifyQueryIntent('client preferences') === 'general', 'expected general').toBeTruthy();
});

test('general: "campaign performance"', () => {
  expect(classifyQueryIntent('campaign performance data') === 'general', 'expected general').toBeTruthy();
});

test('empty string returns general', () => {
  expect(classifyQueryIntent('') === 'general', 'expected general for empty').toBeTruthy();
});