// Tests for validateInvestigatePrompt — pure function, no I/O.
// Run: npx tsx server/services/systemMonitor/triage/__tests__/promptValidation.test.ts

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

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`  ✗ ${name}: ${msg}`);
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ── Valid prompt ──────────────────────────────────────────────────────────────

console.log('\nvalid prompt');

test('passes when all sections present and within length bounds', () => {
  const result = validateInvestigatePrompt(makeValid());
  assert(result.valid, `Expected valid, got errors: ${JSON.stringify(result.errors)}`);
  assert(result.errors.length === 0, 'Expected no errors');
});

// ── Length checks ─────────────────────────────────────────────────────────────

console.log('\nlength checks');

test('rejects prompt shorter than 200 chars', () => {
  const short = REQUIRED_SECTIONS.join('\n');
  const result = validateInvestigatePrompt(short);
  assert(!result.valid, 'Expected invalid');
  assert(result.errors.some((e) => e.code === 'TOO_SHORT'), 'Expected TOO_SHORT error');
});

test('rejects prompt longer than 6,000 chars', () => {
  const long = makeValid() + 'x'.repeat(6_000);
  const result = validateInvestigatePrompt(long);
  assert(!result.valid, 'Expected invalid');
  assert(result.errors.some((e) => e.code === 'TOO_LONG'), 'Expected TOO_LONG error');
});

test('accepts prompt exactly at 200 chars with all sections', () => {
  // Build smallest possible valid text.
  const minimal = REQUIRED_SECTIONS.join('\n');
  const padded = minimal.padEnd(200, ' ');
  const result = validateInvestigatePrompt(padded);
  // May still fail if sections are absent after padding — only check length error absent.
  assert(!result.errors.some((e) => e.code === 'TOO_SHORT'), 'Should not emit TOO_SHORT at exactly 200 chars');
});

test('accepts prompt exactly at 6,000 chars', () => {
  const base = makeValid();
  const exact = base.padEnd(6_000, ' ');
  const result = validateInvestigatePrompt(exact);
  assert(!result.errors.some((e) => e.code === 'TOO_LONG'), 'Should not emit TOO_LONG at exactly 6,000 chars');
});

// ── Missing section checks ────────────────────────────────────────────────────

console.log('\nmissing section checks');

for (const section of REQUIRED_SECTIONS) {
  test(`rejects prompt missing '${section}'`, () => {
    const text = makeValid().replace(section, '## Replaced');
    const result = validateInvestigatePrompt(text);
    assert(!result.valid, 'Expected invalid');
    assert(
      result.errors.some((e) => e.code === 'MISSING_SECTION' && e.detail.includes(section)),
      `Expected MISSING_SECTION error for '${section}'`,
    );
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
  assert(!result.valid, 'Expected invalid due to section ordering');
  assert(result.errors.some((e) => e.code === 'MISSING_SECTION'), 'Expected MISSING_SECTION error');
});

test('rejects prompt where Evidence appears before Hypothesis is consumed but Hypothesis missing', () => {
  // Omit Hypothesis entirely; other sections present in order.
  const sections = REQUIRED_SECTIONS.filter((s) => s !== '## Hypothesis');
  const text = sections.map((h) => `${h}\nContent.`).join('\n\n').padEnd(210, ' ');
  const result = validateInvestigatePrompt(text);
  assert(!result.valid, 'Expected invalid');
  assert(
    result.errors.some((e) => e.code === 'MISSING_SECTION' && e.detail.includes('## Hypothesis')),
    'Expected MISSING_SECTION for ## Hypothesis',
  );
});

// ── Forbidden pattern checks ──────────────────────────────────────────────────

console.log('\nforbidden pattern checks');

test('rejects prompt containing "git push"', () => {
  const text = makeValid() + ' Then run: git push origin main';
  const result = validateInvestigatePrompt(text);
  assert(!result.valid, 'Expected invalid');
  assert(result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'Expected FORBIDDEN_PATTERN error');
});

test('rejects prompt containing "Git Push" (case-insensitive)', () => {
  const text = makeValid() + ' Git Push to remote';
  const result = validateInvestigatePrompt(text);
  assert(result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'Expected FORBIDDEN_PATTERN error');
});

test('rejects prompt containing "merge to main"', () => {
  const text = makeValid() + ' Please merge to main when done.';
  const result = validateInvestigatePrompt(text);
  assert(result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'Expected FORBIDDEN_PATTERN error');
});

test('rejects prompt containing "auto-deploy"', () => {
  const text = makeValid() + ' This will auto-deploy to production.';
  const result = validateInvestigatePrompt(text);
  assert(result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'Expected FORBIDDEN_PATTERN error');
});

test('does not reject valid prompt that mentions git diff (allowed)', () => {
  const text = makeValid() + ' Run git diff to see changes.';
  const result = validateInvestigatePrompt(text);
  assert(!result.errors.some((e) => e.code === 'FORBIDDEN_PATTERN'), 'git diff should be allowed');
});

// ── Multiple errors ───────────────────────────────────────────────────────────

console.log('\nmultiple errors');

test('reports both TOO_SHORT and MISSING_SECTION when prompt is short and incomplete', () => {
  const result = validateInvestigatePrompt('## Protocol\nHi');
  assert(result.errors.some((e) => e.code === 'TOO_SHORT'), 'Expected TOO_SHORT');
  assert(result.errors.some((e) => e.code === 'MISSING_SECTION'), 'Expected MISSING_SECTION');
});

test('reports FORBIDDEN_PATTERN alongside other errors', () => {
  const text = makeValid() + ' git push && merge to main';
  const result = validateInvestigatePrompt(text);
  // Both git push and merge to main are forbidden.
  const forbidden = result.errors.filter((e) => e.code === 'FORBIDDEN_PATTERN');
  assert(forbidden.length >= 2, `Expected at least 2 FORBIDDEN_PATTERN errors, got ${forbidden.length}`);
});

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
