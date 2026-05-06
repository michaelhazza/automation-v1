/**
 * configDocumentParserServicePure.test.ts — validation + outcome routing
 *
 * Spec: docs/memory-and-briefings-spec.md §9.4 (S21)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/configDocumentParserServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  validateParsedField,
  computeOutcome,
  PARSE_CONFIDENCE_THRESHOLD,
  PARSE_REJECTION_ANSWERED_FRACTION,
} from '../configDocumentParserServicePure.js';
import type { ConfigQuestion, ParsedConfigField } from '../../types/configSchema.js';

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

console.log('');
console.log('configDocumentParserServicePure — validation + outcome (§9.4 S21)');
console.log('');

// ---------------------------------------------------------------------------
// validateParsedField
// ---------------------------------------------------------------------------

console.log('validateParsedField:');

const textQ: ConfigQuestion = { id: 'q.text', section: 's', question: '?', type: 'text', required: true };
const emailQ: ConfigQuestion = { id: 'q.email', section: 's', question: '?', type: 'email', required: true };
const selectQ: ConfigQuestion = { id: 'q.select', section: 's', question: '?', type: 'select', options: ['a', 'b'], required: true };
const multiQ: ConfigQuestion = { id: 'q.multi', section: 's', question: '?', type: 'multiselect', options: ['x', 'y', 'z'], required: true };
const boolQ: ConfigQuestion = { id: 'q.bool', section: 's', question: '?', type: 'boolean', required: false };
const urlQ: ConfigQuestion = { id: 'q.url', section: 's', question: '?', type: 'url', required: true };

test('unknown fieldId → invalid', () => {
  const r = validateParsedField({ fieldId: 'q.missing', answer: 'x', confidence: 1 }, undefined);
  expect(r.invalid === true, 'invalid').toBe(true);
});

test('null answer stays valid (gap captured separately)', () => {
  const r = validateParsedField({ fieldId: 'q.text', answer: null, confidence: 0 }, textQ);
  expect(r.invalid === true, 'null = not invalid').toBe(false);
});

test('email validation catches malformed address', () => {
  const r = validateParsedField({ fieldId: 'q.email', answer: 'not-an-email', confidence: 0.9 }, emailQ);
  expect(r.invalid === true, 'rejected').toBe(true);
});

test('valid email passes', () => {
  const r = validateParsedField({ fieldId: 'q.email', answer: 'alice@acme.com', confidence: 0.9 }, emailQ);
  expect(r.invalid === true, 'ok').toBe(false);
});

test('URL must start with http(s)://', () => {
  const bad = validateParsedField({ fieldId: 'q.url', answer: 'acme.com', confidence: 0.9 }, urlQ);
  expect(bad.invalid === true, 'rejected').toBe(true);
  const good = validateParsedField({ fieldId: 'q.url', answer: 'https://acme.com', confidence: 0.9 }, urlQ);
  expect(good.invalid === true, 'ok').toBe(false);
});

test('select option not in list → invalid', () => {
  const r = validateParsedField({ fieldId: 'q.select', answer: 'z', confidence: 0.9 }, selectQ);
  expect(r.invalid === true, 'bad option').toBe(true);
});

test('multiselect with value outside options → invalid', () => {
  const r = validateParsedField({ fieldId: 'q.multi', answer: ['x', 'bad'], confidence: 0.9 }, multiQ);
  expect(r.invalid === true, 'bad element').toBe(true);
});

test('boolean expects boolean', () => {
  const bad = validateParsedField({ fieldId: 'q.bool', answer: 'true', confidence: 1 }, boolQ);
  expect(bad.invalid === true, 'string rejected').toBe(true);
  const good = validateParsedField({ fieldId: 'q.bool', answer: true, confidence: 1 }, boolQ);
  expect(good.invalid === true, 'boolean ok').toBe(false);
});

test('confidence out of [0,1] → invalid', () => {
  const r = validateParsedField({ fieldId: 'q.text', answer: 'x', confidence: 2 }, textQ);
  expect(r.invalid === true, 'out of range').toBe(true);
});

// ---------------------------------------------------------------------------
// computeOutcome
// ---------------------------------------------------------------------------

console.log('computeOutcome:');

const schema: ConfigQuestion[] = [
  { id: 'q.a', section: 's', question: '?', type: 'text', required: true },
  { id: 'q.b', section: 's', question: '?', type: 'text', required: true },
  { id: 'q.c', section: 's', question: '?', type: 'text', required: false },
];

test('all required high-confidence → auto_apply, zero gaps', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.b', answer: 'v2', confidence: 0.8 },
    { fieldId: 'q.c', answer: 'v3', confidence: 0.9 },
  ];
  const r = computeOutcome({ parsed, schema });
  expect(r.outcome, 'outcome').toBe('auto_apply');
  expect(r.gaps.length, 'no gaps').toBe(0);
  expect(r.autoApplyFields.length, '3 auto-apply').toBe(3);
});

test('required unanswered → gaps', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.b', answer: null, confidence: 0 },
    { fieldId: 'q.c', answer: 'v3', confidence: 0.9 },
  ];
  const r = computeOutcome({ parsed, schema });
  expect(r.outcome, 'outcome').toBe('gaps');
  expect(r.gaps.length, '1 gap').toBe(1);
  expect(r.gaps[0].fieldId, 'q.b').toBe('q.b');
});

test('required below threshold → gap', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.b', answer: 'v2', confidence: 0.4 }, // below 0.7
    { fieldId: 'q.c', answer: 'v3', confidence: 0.9 },
  ];
  const r = computeOutcome({ parsed, schema });
  expect(r.outcome, 'outcome').toBe('gaps');
  expect(r.gaps.length, '1 gap').toBe(1);
});

test('optional unanswered → NOT a gap', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.b', answer: 'v2', confidence: 0.9 },
    { fieldId: 'q.c', answer: null, confidence: 0 }, // optional unanswered
  ];
  const r = computeOutcome({ parsed, schema });
  expect(r.outcome, 'optional miss is not a gap').toBe('auto_apply');
  expect(r.gaps.length, 'no gaps').toBe(0);
});

test('empty / unrecognisable document → rejected', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: null, confidence: 0 },
    { fieldId: 'q.b', answer: null, confidence: 0 },
    { fieldId: 'q.c', answer: null, confidence: 0 },
  ];
  const r = computeOutcome({ parsed, schema });
  expect(r.outcome, 'rejected').toBe('rejected');
  expect(Boolean(r.rejectionReason), 'has reason').toBe(true);
});

test('schema field absent from parsed output → gap (required)', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.c', answer: 'v3', confidence: 0.9 },
    // q.b missing
  ];
  const r = computeOutcome({ parsed, schema });
  expect(r.outcome, 'outcome').toBe('gaps');
  expect(r.gaps[0].fieldId, 'q.b is the gap').toBe('q.b');
});

test('invalid field counts as gap when required', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.b', answer: 'v2', confidence: 0.9, invalid: true, invalidReason: 'x' },
    { fieldId: 'q.c', answer: 'v3', confidence: 0.9 },
  ];
  const r = computeOutcome({ parsed, schema });
  expect(r.outcome, 'outcome').toBe('gaps');
  expect(r.gaps.some((g) => g.fieldId === 'q.b'), 'q.b is gap').toBe(true);
});

test('threshold override respected', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.5 },
    { fieldId: 'q.b', answer: 'v2', confidence: 0.5 },
  ];
  const r = computeOutcome({ parsed, schema: schema.slice(0, 2), threshold: 0.4 });
  expect(r.outcome, 'passes under lower threshold').toBe('auto_apply');
});

test('exactly at threshold → auto-apply (inclusive)', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: PARSE_CONFIDENCE_THRESHOLD },
    { fieldId: 'q.b', answer: 'v2', confidence: PARSE_CONFIDENCE_THRESHOLD },
  ];
  const r = computeOutcome({ parsed, schema: schema.slice(0, 2) });
  expect(r.outcome, 'at threshold passes').toBe('auto_apply');
});

console.log('');
console.log('');
