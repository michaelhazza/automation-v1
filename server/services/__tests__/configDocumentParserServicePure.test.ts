/**
 * configDocumentParserServicePure.test.ts — validation + outcome routing
 *
 * Spec: docs/memory-and-briefings-spec.md §9.4 (S21)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/configDocumentParserServicePure.test.ts
 */

import {
  validateParsedField,
  computeOutcome,
  PARSE_CONFIDENCE_THRESHOLD,
  PARSE_REJECTION_ANSWERED_FRACTION,
} from '../configDocumentParserServicePure.js';
import type { ConfigQuestion, ParsedConfigField } from '../../types/configSchema.js';

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
  assertTrue(r.invalid === true, 'invalid');
});

test('null answer stays valid (gap captured separately)', () => {
  const r = validateParsedField({ fieldId: 'q.text', answer: null, confidence: 0 }, textQ);
  assertFalse(r.invalid === true, 'null = not invalid');
});

test('email validation catches malformed address', () => {
  const r = validateParsedField({ fieldId: 'q.email', answer: 'not-an-email', confidence: 0.9 }, emailQ);
  assertTrue(r.invalid === true, 'rejected');
});

test('valid email passes', () => {
  const r = validateParsedField({ fieldId: 'q.email', answer: 'alice@acme.com', confidence: 0.9 }, emailQ);
  assertFalse(r.invalid === true, 'ok');
});

test('URL must start with http(s)://', () => {
  const bad = validateParsedField({ fieldId: 'q.url', answer: 'acme.com', confidence: 0.9 }, urlQ);
  assertTrue(bad.invalid === true, 'rejected');
  const good = validateParsedField({ fieldId: 'q.url', answer: 'https://acme.com', confidence: 0.9 }, urlQ);
  assertFalse(good.invalid === true, 'ok');
});

test('select option not in list → invalid', () => {
  const r = validateParsedField({ fieldId: 'q.select', answer: 'z', confidence: 0.9 }, selectQ);
  assertTrue(r.invalid === true, 'bad option');
});

test('multiselect with value outside options → invalid', () => {
  const r = validateParsedField({ fieldId: 'q.multi', answer: ['x', 'bad'], confidence: 0.9 }, multiQ);
  assertTrue(r.invalid === true, 'bad element');
});

test('boolean expects boolean', () => {
  const bad = validateParsedField({ fieldId: 'q.bool', answer: 'true', confidence: 1 }, boolQ);
  assertTrue(bad.invalid === true, 'string rejected');
  const good = validateParsedField({ fieldId: 'q.bool', answer: true, confidence: 1 }, boolQ);
  assertFalse(good.invalid === true, 'boolean ok');
});

test('confidence out of [0,1] → invalid', () => {
  const r = validateParsedField({ fieldId: 'q.text', answer: 'x', confidence: 2 }, textQ);
  assertTrue(r.invalid === true, 'out of range');
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
  assertEqual(r.outcome, 'auto_apply', 'outcome');
  assertEqual(r.gaps.length, 0, 'no gaps');
  assertEqual(r.autoApplyFields.length, 3, '3 auto-apply');
});

test('required unanswered → gaps', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.b', answer: null, confidence: 0 },
    { fieldId: 'q.c', answer: 'v3', confidence: 0.9 },
  ];
  const r = computeOutcome({ parsed, schema });
  assertEqual(r.outcome, 'gaps', 'outcome');
  assertEqual(r.gaps.length, 1, '1 gap');
  assertEqual(r.gaps[0].fieldId, 'q.b', 'q.b');
});

test('required below threshold → gap', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.b', answer: 'v2', confidence: 0.4 }, // below 0.7
    { fieldId: 'q.c', answer: 'v3', confidence: 0.9 },
  ];
  const r = computeOutcome({ parsed, schema });
  assertEqual(r.outcome, 'gaps', 'outcome');
  assertEqual(r.gaps.length, 1, '1 gap');
});

test('optional unanswered → NOT a gap', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.b', answer: 'v2', confidence: 0.9 },
    { fieldId: 'q.c', answer: null, confidence: 0 }, // optional unanswered
  ];
  const r = computeOutcome({ parsed, schema });
  assertEqual(r.outcome, 'auto_apply', 'optional miss is not a gap');
  assertEqual(r.gaps.length, 0, 'no gaps');
});

test('empty / unrecognisable document → rejected', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: null, confidence: 0 },
    { fieldId: 'q.b', answer: null, confidence: 0 },
    { fieldId: 'q.c', answer: null, confidence: 0 },
  ];
  const r = computeOutcome({ parsed, schema });
  assertEqual(r.outcome, 'rejected', 'rejected');
  assertTrue(Boolean(r.rejectionReason), 'has reason');
});

test('schema field absent from parsed output → gap (required)', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.c', answer: 'v3', confidence: 0.9 },
    // q.b missing
  ];
  const r = computeOutcome({ parsed, schema });
  assertEqual(r.outcome, 'gaps', 'outcome');
  assertEqual(r.gaps[0].fieldId, 'q.b', 'q.b is the gap');
});

test('invalid field counts as gap when required', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.9 },
    { fieldId: 'q.b', answer: 'v2', confidence: 0.9, invalid: true, invalidReason: 'x' },
    { fieldId: 'q.c', answer: 'v3', confidence: 0.9 },
  ];
  const r = computeOutcome({ parsed, schema });
  assertEqual(r.outcome, 'gaps', 'outcome');
  assertTrue(r.gaps.some((g) => g.fieldId === 'q.b'), 'q.b is gap');
});

test('threshold override respected', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: 0.5 },
    { fieldId: 'q.b', answer: 'v2', confidence: 0.5 },
  ];
  const r = computeOutcome({ parsed, schema: schema.slice(0, 2), threshold: 0.4 });
  assertEqual(r.outcome, 'auto_apply', 'passes under lower threshold');
});

test('exactly at threshold → auto-apply (inclusive)', () => {
  const parsed: ParsedConfigField[] = [
    { fieldId: 'q.a', answer: 'v1', confidence: PARSE_CONFIDENCE_THRESHOLD },
    { fieldId: 'q.b', answer: 'v2', confidence: PARSE_CONFIDENCE_THRESHOLD },
  ];
  const r = computeOutcome({ parsed, schema: schema.slice(0, 2) });
  assertEqual(r.outcome, 'auto_apply', 'at threshold passes');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
