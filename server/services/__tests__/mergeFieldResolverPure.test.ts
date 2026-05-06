/**
 * mergeFieldResolverPure.test.ts — V1 grammar resolver (§16).
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/mergeFieldResolverPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  resolveMergeFields,
  resolveMergeFieldsOnObject,
  MERGE_FIELD_NAMESPACES,
} from '../mergeFieldResolverPure.js';

const inputs = {
  contact: {
    firstName: 'Marcia',
    lastName: 'Smith',
    address: { line1: '123 Main St', city: 'Sydney' },
    phone: null,
  },
  subaccount: { name: 'Smith Dental', primaryContact: { email: 'marcia@smith.example' } },
  signals: { healthScore: 48, band: 'at_risk' },
  org: { tradingName: 'Synthetos Agency' },
  agency: { brandColour: '#4F46E5' },
};

// ── Namespace surface ─────────────────────────────────────────────────────

test('exports all 5 V1 namespaces', () => {
  expect(MERGE_FIELD_NAMESPACES.length === 5, 'expected 5 namespaces').toBeTruthy();
  for (const ns of ['contact', 'subaccount', 'signals', 'org', 'agency']) {
    expect(MERGE_FIELD_NAMESPACES.includes(ns as never), `missing ns: ${ns}`).toBeTruthy();
  }
});

// ── Resolution — happy path ───────────────────────────────────────────────

test('resolves {{contact.firstName}}', () => {
  const r = resolveMergeFields('Hi {{contact.firstName}}!', inputs);
  expect(r.output === 'Hi Marcia!', `output=${r.output}`).toBeTruthy();
  expect(r.unresolved.length === 0, 'unresolved should be empty').toBeTruthy();
});

test('resolves {{subaccount.name}}', () => {
  const r = resolveMergeFields('Check on {{subaccount.name}}', inputs);
  expect(r.output === 'Check on Smith Dental', `output=${r.output}`).toBeTruthy();
});

test('resolves {{signals.healthScore}} (number)', () => {
  const r = resolveMergeFields('Score: {{signals.healthScore}}', inputs);
  expect(r.output === 'Score: 48', `output=${r.output}`).toBeTruthy();
});

test('resolves {{org.tradingName}}', () => {
  const r = resolveMergeFields('From {{org.tradingName}}', inputs);
  expect(r.output === 'From Synthetos Agency', `output=${r.output}`).toBeTruthy();
});

test('resolves {{agency.brandColour}}', () => {
  const r = resolveMergeFields('Colour {{agency.brandColour}}', inputs);
  expect(r.output === 'Colour #4F46E5', `output=${r.output}`).toBeTruthy();
});

// ── Resolution — nested paths ─────────────────────────────────────────────

test('resolves nested path {{contact.address.line1}}', () => {
  const r = resolveMergeFields('Address: {{contact.address.line1}}', inputs);
  expect(r.output === 'Address: 123 Main St', `output=${r.output}`).toBeTruthy();
  expect(r.unresolved.length === 0, 'unresolved should be empty').toBeTruthy();
});

test('resolves nested path {{subaccount.primaryContact.email}}', () => {
  const r = resolveMergeFields('Email: {{subaccount.primaryContact.email}}', inputs);
  expect(r.output === 'Email: marcia@smith.example', `output=${r.output}`).toBeTruthy();
});

// ── Resolution — unknown fields stay as literal + appear in unresolved ────

test('unknown field leaves literal and reports unresolved', () => {
  const r = resolveMergeFields('Hi {{contact.bogus}}!', inputs);
  expect(r.output === 'Hi {{contact.bogus}}!', `output=${r.output}`).toBeTruthy();
  expect(r.unresolved.length === 1, `unresolved length=${r.unresolved.length}`).toBeTruthy();
  expect(r.unresolved[0] === 'contact.bogus', 'unresolved path mismatch').toBeTruthy();
});

test('unknown namespace reports unresolved', () => {
  const r = resolveMergeFields('Secret: {{secret.apiKey}}', inputs);
  expect(r.output === 'Secret: {{secret.apiKey}}', `output=${r.output}`).toBeTruthy();
  expect(r.unresolved.includes('secret.apiKey'), 'unresolved missing secret.apiKey').toBeTruthy();
});

test('null field reports unresolved', () => {
  const r = resolveMergeFields('Phone: {{contact.phone}}', inputs);
  expect(r.output === 'Phone: {{contact.phone}}', `output=${r.output}`).toBeTruthy();
  expect(r.unresolved.includes('contact.phone'), 'null should report unresolved').toBeTruthy();
});

test('object field reports unresolved (cannot render nested object)', () => {
  const r = resolveMergeFields('Addr: {{contact.address}}', inputs);
  expect(r.output === 'Addr: {{contact.address}}', `object path should not render`).toBeTruthy();
  expect(r.unresolved.includes('contact.address'), 'object should report unresolved').toBeTruthy();
});

// ── Resolution — multiple tokens + deduplication ──────────────────────────

test('multiple tokens resolved in one string', () => {
  const r = resolveMergeFields('{{contact.firstName}} at {{subaccount.name}}', inputs);
  expect(r.output === 'Marcia at Smith Dental', `output=${r.output}`).toBeTruthy();
});

test('duplicate unknown tokens are deduplicated', () => {
  const r = resolveMergeFields('{{contact.missing}} and {{contact.missing}}', inputs);
  expect(r.unresolved.length === 1, `expected 1 unresolved, got ${r.unresolved.length}`).toBeTruthy();
  expect(r.unresolved[0] === 'contact.missing', 'dedup path mismatch').toBeTruthy();
});

test('token with missing namespace without dot reports unresolved (no crash)', () => {
  const r = resolveMergeFields('{{nodot}}', inputs);
  expect(r.unresolved.includes('nodot'), 'single-segment token should report unresolved').toBeTruthy();
  expect(r.output === '{{nodot}}', 'literal should remain').toBeTruthy();
});

// ── Grammar errors ────────────────────────────────────────────────────────

test('malformed: unmatched {{ throws', () => {
  let threw = false;
  try { resolveMergeFields('Hello {{contact.firstName', inputs); } catch { threw = true; }
  expect(threw, 'expected throw on unmatched {{').toBeTruthy();
});

test('malformed: empty {{}} token throws', () => {
  let threw = false;
  try { resolveMergeFields('Hello {{}}', inputs); } catch { threw = true; }
  expect(threw, 'expected throw on empty token').toBeTruthy();
});

test('non-string template throws', () => {
  let threw = false;
  try { resolveMergeFields(undefined as unknown as string, inputs); } catch { threw = true; }
  expect(threw, 'expected throw on undefined template').toBeTruthy();
});

// ── Whitespace inside tokens ──────────────────────────────────────────────

test('whitespace inside token allowed', () => {
  const r = resolveMergeFields('{{ contact.firstName }}', inputs);
  expect(r.output === 'Marcia', `output=${r.output}`).toBeTruthy();
});

// ── Empty / no-token input ────────────────────────────────────────────────

test('empty input returns empty output', () => {
  const r = resolveMergeFields('', inputs);
  expect(r.output === '', `output=${r.output}`).toBeTruthy();
  expect(r.unresolved.length === 0, 'unresolved should be empty').toBeTruthy();
});

test('no tokens returns input unchanged', () => {
  const r = resolveMergeFields('Hello world', inputs);
  expect(r.output === 'Hello world', `output=${r.output}`).toBeTruthy();
});

// ── Missing namespace inputs ──────────────────────────────────────────────

test('missing namespace input reports unresolved (strict)', () => {
  const r = resolveMergeFields('{{contact.firstName}}', {});
  expect(r.unresolved.includes('contact.firstName'), 'missing contact ns should report unresolved').toBeTruthy();
  expect(r.output === '{{contact.firstName}}', 'literal stays when ns missing').toBeTruthy();
});

// ── Object helper ─────────────────────────────────────────────────────────

test('resolveMergeFieldsOnObject transforms subject + body + unions unresolved', () => {
  const { output, unresolved } = resolveMergeFieldsOnObject(
    {
      subject: 'Hi {{contact.firstName}}',
      body: 'Score {{signals.healthScore}} for {{contact.missing}}',
    },
    inputs,
  );
  expect(output.subject === 'Hi Marcia', `subject=${output.subject}`).toBeTruthy();
  expect(output.body === 'Score 48 for {{contact.missing}}', `body=${output.body}`).toBeTruthy();
  expect(unresolved.length === 1, `unresolved length=${unresolved.length}`).toBeTruthy();
  expect(unresolved[0] === 'contact.missing', 'unresolved path').toBeTruthy();
});

test('resolveMergeFieldsOnObject preserves undefined leaves', () => {
  const { output } = resolveMergeFieldsOnObject(
    { subject: undefined, body: 'Hi {{contact.firstName}}' },
    inputs,
  );
  expect(output.subject === undefined, 'undefined subject preserved').toBeTruthy();
  expect(output.body === 'Hi Marcia', `body=${output.body}`).toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────
