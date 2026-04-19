/**
 * mergeFieldResolverPure.test.ts — V1 grammar resolver (§16).
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/mergeFieldResolverPure.test.ts
 */

import {
  resolveMergeFields,
  resolveMergeFieldsOnObject,
  MERGE_FIELD_NAMESPACES,
} from '../mergeFieldResolverPure.js';

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
  assert(MERGE_FIELD_NAMESPACES.length === 5, 'expected 5 namespaces');
  for (const ns of ['contact', 'subaccount', 'signals', 'org', 'agency']) {
    assert(MERGE_FIELD_NAMESPACES.includes(ns as never), `missing ns: ${ns}`);
  }
});

// ── Resolution — happy path ───────────────────────────────────────────────

test('resolves {{contact.firstName}}', () => {
  const r = resolveMergeFields('Hi {{contact.firstName}}!', inputs);
  assert(r.output === 'Hi Marcia!', `output=${r.output}`);
  assert(r.unresolved.length === 0, 'unresolved should be empty');
});

test('resolves {{subaccount.name}}', () => {
  const r = resolveMergeFields('Check on {{subaccount.name}}', inputs);
  assert(r.output === 'Check on Smith Dental', `output=${r.output}`);
});

test('resolves {{signals.healthScore}} (number)', () => {
  const r = resolveMergeFields('Score: {{signals.healthScore}}', inputs);
  assert(r.output === 'Score: 48', `output=${r.output}`);
});

test('resolves {{org.tradingName}}', () => {
  const r = resolveMergeFields('From {{org.tradingName}}', inputs);
  assert(r.output === 'From Synthetos Agency', `output=${r.output}`);
});

test('resolves {{agency.brandColour}}', () => {
  const r = resolveMergeFields('Colour {{agency.brandColour}}', inputs);
  assert(r.output === 'Colour #4F46E5', `output=${r.output}`);
});

// ── Resolution — nested paths ─────────────────────────────────────────────

test('resolves nested path {{contact.address.line1}}', () => {
  const r = resolveMergeFields('Address: {{contact.address.line1}}', inputs);
  assert(r.output === 'Address: 123 Main St', `output=${r.output}`);
  assert(r.unresolved.length === 0, 'unresolved should be empty');
});

test('resolves nested path {{subaccount.primaryContact.email}}', () => {
  const r = resolveMergeFields('Email: {{subaccount.primaryContact.email}}', inputs);
  assert(r.output === 'Email: marcia@smith.example', `output=${r.output}`);
});

// ── Resolution — unknown fields stay as literal + appear in unresolved ────

test('unknown field leaves literal and reports unresolved', () => {
  const r = resolveMergeFields('Hi {{contact.bogus}}!', inputs);
  assert(r.output === 'Hi {{contact.bogus}}!', `output=${r.output}`);
  assert(r.unresolved.length === 1, `unresolved length=${r.unresolved.length}`);
  assert(r.unresolved[0] === 'contact.bogus', 'unresolved path mismatch');
});

test('unknown namespace reports unresolved', () => {
  const r = resolveMergeFields('Secret: {{secret.apiKey}}', inputs);
  assert(r.output === 'Secret: {{secret.apiKey}}', `output=${r.output}`);
  assert(r.unresolved.includes('secret.apiKey'), 'unresolved missing secret.apiKey');
});

test('null field reports unresolved', () => {
  const r = resolveMergeFields('Phone: {{contact.phone}}', inputs);
  assert(r.output === 'Phone: {{contact.phone}}', `output=${r.output}`);
  assert(r.unresolved.includes('contact.phone'), 'null should report unresolved');
});

test('object field reports unresolved (cannot render nested object)', () => {
  const r = resolveMergeFields('Addr: {{contact.address}}', inputs);
  assert(r.output === 'Addr: {{contact.address}}', `object path should not render`);
  assert(r.unresolved.includes('contact.address'), 'object should report unresolved');
});

// ── Resolution — multiple tokens + deduplication ──────────────────────────

test('multiple tokens resolved in one string', () => {
  const r = resolveMergeFields('{{contact.firstName}} at {{subaccount.name}}', inputs);
  assert(r.output === 'Marcia at Smith Dental', `output=${r.output}`);
});

test('duplicate unknown tokens are deduplicated', () => {
  const r = resolveMergeFields('{{contact.missing}} and {{contact.missing}}', inputs);
  assert(r.unresolved.length === 1, `expected 1 unresolved, got ${r.unresolved.length}`);
  assert(r.unresolved[0] === 'contact.missing', 'dedup path mismatch');
});

test('token with missing namespace without dot reports unresolved (no crash)', () => {
  const r = resolveMergeFields('{{nodot}}', inputs);
  assert(r.unresolved.includes('nodot'), 'single-segment token should report unresolved');
  assert(r.output === '{{nodot}}', 'literal should remain');
});

// ── Grammar errors ────────────────────────────────────────────────────────

test('malformed: unmatched {{ throws', () => {
  let threw = false;
  try { resolveMergeFields('Hello {{contact.firstName', inputs); } catch { threw = true; }
  assert(threw, 'expected throw on unmatched {{');
});

test('malformed: empty {{}} token throws', () => {
  let threw = false;
  try { resolveMergeFields('Hello {{}}', inputs); } catch { threw = true; }
  assert(threw, 'expected throw on empty token');
});

test('non-string template throws', () => {
  let threw = false;
  try { resolveMergeFields(undefined as unknown as string, inputs); } catch { threw = true; }
  assert(threw, 'expected throw on undefined template');
});

// ── Whitespace inside tokens ──────────────────────────────────────────────

test('whitespace inside token allowed', () => {
  const r = resolveMergeFields('{{ contact.firstName }}', inputs);
  assert(r.output === 'Marcia', `output=${r.output}`);
});

// ── Empty / no-token input ────────────────────────────────────────────────

test('empty input returns empty output', () => {
  const r = resolveMergeFields('', inputs);
  assert(r.output === '', `output=${r.output}`);
  assert(r.unresolved.length === 0, 'unresolved should be empty');
});

test('no tokens returns input unchanged', () => {
  const r = resolveMergeFields('Hello world', inputs);
  assert(r.output === 'Hello world', `output=${r.output}`);
});

// ── Missing namespace inputs ──────────────────────────────────────────────

test('missing namespace input reports unresolved (strict)', () => {
  const r = resolveMergeFields('{{contact.firstName}}', {});
  assert(r.unresolved.includes('contact.firstName'), 'missing contact ns should report unresolved');
  assert(r.output === '{{contact.firstName}}', 'literal stays when ns missing');
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
  assert(output.subject === 'Hi Marcia', `subject=${output.subject}`);
  assert(output.body === 'Score 48 for {{contact.missing}}', `body=${output.body}`);
  assert(unresolved.length === 1, `unresolved length=${unresolved.length}`);
  assert(unresolved[0] === 'contact.missing', 'unresolved path');
});

test('resolveMergeFieldsOnObject preserves undefined leaves', () => {
  const { output } = resolveMergeFieldsOnObject(
    { subject: undefined, body: 'Hi {{contact.firstName}}' },
    inputs,
  );
  assert(output.subject === undefined, 'undefined subject preserved');
  assert(output.body === 'Hi Marcia', `body=${output.body}`);
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
