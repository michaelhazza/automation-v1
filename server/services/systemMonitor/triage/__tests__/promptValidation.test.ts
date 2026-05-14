// Tests for validateInvestigatePrompt — pure function, no I/O.
// Run: npx tsx server/services/systemMonitor/triage/__tests__/promptValidation.test.ts

import { expect, test } from 'vitest';
import { validateInvestigatePrompt } from '../promptValidation.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const REQUIRED_SECTIONS = [
  '## Protocol',
  '## Incident',
  '## Problem statement',
  '## Evidence',
  '## Hypothesis',
  '## Investigation steps',
  '## Scope',
  '## Expected output',
  '## Approval gate',
];

/** Builds a minimal valid prompt (all required sections, within length bounds). */
function makeValid(): string {
  const body = REQUIRED_SECTIONS.map((h) => `${h}\nContent for this section.`).join('\n\n');
  // Pad to ensure MIN_LENGTH is met (it should already be, but just in case).
  return body.padEnd(210, ' ');
}

const failures: string[] = [];

// ── Valid prompt ──────────────────────────────────────────────────────────────

console.log('\nvalid prompt');

test('passes when all sections present and within length bounds', () => {
  const result = validateInvestigatePrompt(makeValid());
  expect(result.valid, `Expected valid, got errors: ${JSON.stringify(result.errors)}`).toBeTruthy();
  expect(result.errors.length === 0, 'Expected no errors').toBeTruthy();
});

// ── Length checks ─────────────────────────────────────────────────────────────

console.log('\nlength checks');

test('rejects prompt shorter than 200 chars', () => {
  const short = REQUIRED_SECTIONS.join('\n');
  const result = validateInvestigatePrompt(short);
  expect(!result.valid, 'Expected invalid').toBeTruthy();
  expect(result.errors.some((e) => e.code === 'TOO_SHORT'), 'Expected TOO_SHORT error').toBeTruthy();
});

test('rejects prompt longer than 6,000 chars', () => {
  const long = makeValid() + 'x'.repeat(6_000);
  const result = validateInvestigatePrompt(long);
  expect(!result.valid, 'Expected invalid').toBeTruthy();
  expect(result.errors.some((e) => e.code === 'TOO_LONG'), 'Expected TOO_LONG error').toBeTruthy();
});

test('accepts prompt exactly at 200 chars with all sections', () => {
  // Build smallest possible valid text.
  const minimal = REQUIRED_SECTIONS.join('\n');
  const padded = minimal.padEnd(200, ' ');
  const result = validateInvestigatePrompt(padded);
  // May still fail if sections are absent after padding — only check length error absent.
  expect(!result.errors.some((e) => e.code === 'TOO_SHORT'), 'Should not emit TOO_SHORT at exactly 200 chars').toBeTruthy();
});

test('accepts prompt exactly at 6,000 chars', () => {
  const base = makeValid();
  const exact = base.padEnd(6_000, ' ');
  const result = validateInvestigatePrompt(exact);
  expect(!result.errors.some((e) => e.code === 'TOO_LONG'), 'Should not emit TOO_LONG at exactly 6,000 chars').toBeTruthy();
});

// ── Missing section checks ────────────────────────────────────────────────────

console.log('\nmissing section checks');

for (const section of REQUIRED_SECTIONS) {
  test(`rejects prompt missing '${section}'`, () => {
    const text = makeValid().replace(section, '## Replaced');
    const result = validateInvestigatePrompt(text);
    expect(!result.valid, 'Expected invalid').toBeTruthy();
    expect(result.errors.some((e) => e.code === 'MISSING_SECTION' && e.detail.includes(section)), `Expected MISSING_SECTION error for '${section}'`).toBeTruthy();
  });
}

// ── Ordering constraint ───────────────────────────────────────────────────────

console.log('\nordering constraint');

test('rejects prompt where Approval gate appears before Protocol', () => {
  // Build text that has all sections but in wrong order.
  const reversed = [...REQUIRED_SECTIONS].reverse();
  const text = reversed.map((h) => `${h}\nContent.`).join('\n\n').padEnd(210, ' ');
  const result = validateInvestigatePrompt(text);
  // With reversed order, Protocol is missing (appears after Approval gate which is first)
  // — the validator should flag at least one MISSING_SECTION.
  expect(!result.valid, 'Expected invalid due to section ordering').toBeTruthy();
  expect(result.errors.some((e) => e.code === 'MISSING_SECTION'), 'Expected MISSING_SECTION error').toBeTruthy();
});

test('rejects prompt where Evidence appears before Hypothesis is consumed but Hypothesis missing', () => {
  // Omit Hypothesis entirely; other sections present in order.
  const sections = REQUIRED_SECTIONS.filter((s) => s !== '## Hypothesis');
  const text = sections.map((h) => `${h}\nContent.`).join('\n\n').padEnd(210, ' ');
  const result = validateInvestigatePrompt(text);
  expect(!result.valid, 'Expected invalid').toBeTruthy();
  expect(result.errors.some((e) => e.code === 'MISSING_SECTION' && e.detail.includes('## Hypothesis')), 'Expected MISSING_SECTION for ## Hypothesis').toBeTruthy();
});

// ── Forbidden pattern checks ──────────────────────────────────────────────────

console.log('\nforbidden pattern checks');

test('rejects prompt containing "git push"', () => {
  const text = makeValid() + ' Then run: git push origin main';
  const result = validateInvestigatePrompt(text);
  expect(!result.valid, 'Expected invalid').toBeTruthy();
  expect(result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'Expected FORBIDDEN_PATTERN error').toBeTruthy();
});

test('rejects prompt containing "Git Push" (case-insensitive)', () => {
  const text = makeValid() + ' Git Push to remote';
  const result = validateInvestigatePrompt(text);
  expect(result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'Expected FORBIDDEN_PATTERN error').toBeTruthy();
});

test('rejects prompt containing "merge to main"', () => {
  const text = makeValid() + ' Please merge to main when done.';
  const result = validateInvestigatePrompt(text);
  expect(result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'Expected FORBIDDEN_PATTERN error').toBeTruthy();
});

test('rejects prompt containing "auto-deploy"', () => {
  const text = makeValid() + ' This will auto-deploy to production.';
  const result = validateInvestigatePrompt(text);
  expect(result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'Expected FORBIDDEN_PATTERN error').toBeTruthy();
});

test('does not reject valid prompt that mentions git diff (allowed)', () => {
  const text = makeValid() + ' Run git diff to see changes.';
  const result = validateInvestigatePrompt(text);
  expect(!result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'git diff should be allowed').toBeTruthy();
});

// ── Multiple errors ───────────────────────────────────────────────────────────

console.log('\nmultiple errors');

test('reports both TOO_SHORT and MISSING_SECTION when prompt is short and incomplete', () => {
  const result = validateInvestigatePrompt('## Protocol\nHi');
  expect(result.errors.some((e) => e.code === 'TOO_SHORT'), 'Expected TOO_SHORT').toBeTruthy();
  expect(result.errors.some((e) => e.code === 'MISSING_SECTION'), 'Expected MISSING_SECTION').toBeTruthy();
});

test('reports FORBIDDEN_PATTERN alongside other errors', () => {
  const text = makeValid() + ' git push && merge to main';
  const result = validateInvestigatePrompt(text);
  // Both git push and merge to main are forbidden.
  const forbidden = result.errors.filter((e) => e.code === 'FORBIDDEN_PATTERN');
  expect(forbidden.length >= 2, `Expected at least 2 FORBIDDEN_PATTERN errors, got ${forbidden.length}`).toBeTruthy();
});

// ── Report ────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.log('\nFailed:');
  failures.forEach((f) => console.log(f));
}
