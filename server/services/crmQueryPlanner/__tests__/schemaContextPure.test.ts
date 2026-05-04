/**
 * schemaContextPure.test.ts — spec §11.11 / §20.1
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/schemaContextPure.test.ts
 */
import { expect, test } from 'vitest';
import {
  buildSchemaContextText,
  detectRelevantEntities,
  getTopFieldsForEntity,
} from '../schemaContextPure.js';
import { normaliseIntent } from '../normaliseIntentPure.js';

// ── Test 1: Token budget respected ───────────────────────────────────────────

test('output fits within token budget (rough check)', () => {
  const intent = normaliseIntent('show me stale contacts');
  const text = buildSchemaContextText(intent, 200);
  const roughTokens = Math.ceil(text.length / 4);
  expect(roughTokens <= 200, `exceeded budget: ~${roughTokens} tokens`).toBeTruthy();
});

// ── Test 2: Relevant entity detection — single entity ────────────────────────

test('intent mentioning contacts returns contacts as relevant', () => {
  const intent = normaliseIntent('show contacts inactive 30 days');
  const entities = detectRelevantEntities(intent);
  expect(entities.includes('contacts'), 'contacts not in relevant entities').toBeTruthy();
});

// ── Test 3: Relevant entity detection — synonym ───────────────────────────────

test('synonym "deals" maps to opportunities', () => {
  const intent = normaliseIntent('stale deals in pipeline');
  const entities = detectRelevantEntities(intent);
  expect(entities.includes('opportunities'), 'opportunities not detected via synonym "deals"').toBeTruthy();
});

// ── Test 4: Unrecognised tokens → all entities ────────────────────────────────

test('unrecognised tokens return all entities', () => {
  const intent = normaliseIntent('weather forecast tomorrow');
  const entities = detectRelevantEntities(intent);
  expect(entities.length >= 5, `expected all entities (6), got ${entities.length}`).toBeTruthy();
});

// ── Test 5: Schema output contains the relevant entity ────────────────────────

test('schema text includes entity line for detected entity', () => {
  const intent = normaliseIntent('contacts inactive last month');
  const text = buildSchemaContextText(intent, 2000);
  expect(text.includes('contacts:'), `schema text missing contacts line: "${text}"`).toBeTruthy();
});

// ── Test 6: Large budget includes more fields ──────────────────────────────────

test('larger budget produces more fields than small budget', () => {
  const intent = normaliseIntent('opportunities');
  const small = buildSchemaContextText(intent, 50);
  const large = buildSchemaContextText(intent, 2000);
  expect(large.length >= small.length, `large budget should produce >= chars than small`).toBeTruthy();
});

// ── Test 7: top fields for each entity are non-empty ─────────────────────────

test('getTopFieldsForEntity returns non-empty list for all entities', () => {
  const entities = ['contacts', 'opportunities', 'appointments', 'conversations', 'revenue', 'tasks'] as const;
  for (const e of entities) {
    const fields = getTopFieldsForEntity(e);
    expect(fields.length > 0, `no top fields for entity: ${e}`).toBeTruthy();
  }
});

// ── Test 8: liveOnly marker propagated in text ────────────────────────────────

test('live-only fields are labelled in schema text', () => {
  const intent = normaliseIntent('contacts with custom fields');
  const text = buildSchemaContextText(intent, 2000);
  expect(text.includes('live-only'), `expected "live-only" label in schema text: "${text.slice(0, 200)}"`).toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────────
