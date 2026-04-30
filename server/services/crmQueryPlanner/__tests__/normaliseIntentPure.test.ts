/**
 * normaliseIntentPure.test.ts — spec §7.6, minimum 15 cases
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/normaliseIntentPure.test.ts
 */
import { expect, test } from 'vitest';
import { normaliseIntent } from '../normaliseIntentPure.js';

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Identity / stable output ──────────────────────────────────────────────

test('same input produces same hash (identity 1)', () => {
  expect(normaliseIntent('stale contacts').hash).toEqual(normaliseIntent('stale contacts').hash);
});

test('rawIntent is preserved verbatim', () => {
  const raw = 'Show Me Stale Contacts!';
  expect(normaliseIntent(raw).rawIntent).toEqual(raw);
});

test('hash is 16 hex characters', () => {
  expect(/^[0-9a-f]{16}$/.test(normaliseIntent('inactive contacts').hash), 'hash length/format').toBeTruthy();
});

// ── Whitespace / casing variants → identical hash ──────────────────────────

test('extra whitespace collapses to same hash', () => {
  expect(normaliseIntent('inactive  contacts').hash, 'whitespace').toEqual(normaliseIntent('inactive contacts').hash);
});

test('uppercase input → same hash as lowercase', () => {
  expect(normaliseIntent('Inactive Contacts').hash, 'casing').toEqual(normaliseIntent('inactive contacts').hash);
});

test('trailing punctuation stripped → same hash', () => {
  expect(normaliseIntent('inactive contacts!').hash, 'punctuation').toEqual(normaliseIntent('inactive contacts').hash);
});

// ── Synonym replacements ──────────────────────────────────────────────────

test('synonym: "leads" → "contacts"', () => {
  expect(normaliseIntent('stale leads').hash, 'leads synonym').toEqual(normaliseIntent('stale contacts').hash);
});

test('synonym: "deals" → "opportunities"', () => {
  expect(normaliseIntent('stale deals').hash, 'deals synonym').toEqual(normaliseIntent('stale opportunities').hash);
});

test('synonym: "clients" → "contacts"', () => {
  expect(normaliseIntent('stale clients').hash, 'clients synonym').toEqual(normaliseIntent('stale contacts').hash);
});

// ── Stop-word stripping ───────────────────────────────────────────────────

test('stop word "the" stripped', () => {
  expect(normaliseIntent('the stale contacts').hash, '"the" stop word').toEqual(normaliseIntent('stale contacts').hash);
});

test('stop word "list" stripped', () => {
  const { tokens } = normaliseIntent('list inactive contacts');
  expect(!tokens.includes('list'), '"list" must not be in tokens').toBeTruthy();
});

test('stop word "show" stripped', () => {
  const { tokens } = normaliseIntent('show stale contacts');
  expect(!tokens.includes('show'), '"show" must not be in tokens').toBeTruthy();
});

// ── Date-literal canonicalisation ─────────────────────────────────────────

test('date: "last 30 days" → last_30d token', () => {
  const { tokens } = normaliseIntent('contacts inactive last 30 days');
  expect(tokens.includes('last_30d'), 'last_30d token expected').toBeTruthy();
});

test('date: "30 days ago" → last_30d token', () => {
  const { tokens } = normaliseIntent('contacts inactive 30 days ago');
  expect(tokens.includes('last_30d'), 'last_30d token expected').toBeTruthy();
});

test('date: "past month" → last_30d token', () => {
  const { tokens } = normaliseIntent('stale contacts past month');
  expect(tokens.includes('last_30d'), 'last_30d token expected').toBeTruthy();
});

test('date: "this week" → this_week token', () => {
  const { tokens } = normaliseIntent('upcoming appointments this week');
  expect(tokens.includes('this_week'), 'this_week token expected').toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────
