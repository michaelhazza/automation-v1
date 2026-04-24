/**
 * normaliseIntentPure.test.ts — spec §7.6, minimum 15 cases
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/normaliseIntentPure.test.ts
 */
import { normaliseIntent } from '../normaliseIntentPure.js';

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

function assertEqual<T>(a: T, b: T, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

// ── Identity / stable output ──────────────────────────────────────────────

test('same input produces same hash (identity 1)', () => {
  assertEqual(normaliseIntent('stale contacts').hash, normaliseIntent('stale contacts').hash);
});

test('rawIntent is preserved verbatim', () => {
  const raw = 'Show Me Stale Contacts!';
  assertEqual(normaliseIntent(raw).rawIntent, raw);
});

test('hash is 16 hex characters', () => {
  assert(/^[0-9a-f]{16}$/.test(normaliseIntent('inactive contacts').hash), 'hash length/format');
});

// ── Whitespace / casing variants → identical hash ──────────────────────────

test('extra whitespace collapses to same hash', () => {
  assertEqual(
    normaliseIntent('inactive  contacts').hash,
    normaliseIntent('inactive contacts').hash,
    'whitespace',
  );
});

test('uppercase input → same hash as lowercase', () => {
  assertEqual(
    normaliseIntent('Inactive Contacts').hash,
    normaliseIntent('inactive contacts').hash,
    'casing',
  );
});

test('trailing punctuation stripped → same hash', () => {
  assertEqual(
    normaliseIntent('inactive contacts!').hash,
    normaliseIntent('inactive contacts').hash,
    'punctuation',
  );
});

// ── Synonym replacements ──────────────────────────────────────────────────

test('synonym: "leads" → "contacts"', () => {
  assertEqual(
    normaliseIntent('stale leads').hash,
    normaliseIntent('stale contacts').hash,
    'leads synonym',
  );
});

test('synonym: "deals" → "opportunities"', () => {
  assertEqual(
    normaliseIntent('stale deals').hash,
    normaliseIntent('stale opportunities').hash,
    'deals synonym',
  );
});

test('synonym: "clients" → "contacts"', () => {
  assertEqual(
    normaliseIntent('stale clients').hash,
    normaliseIntent('stale contacts').hash,
    'clients synonym',
  );
});

// ── Stop-word stripping ───────────────────────────────────────────────────

test('stop word "the" stripped', () => {
  assertEqual(
    normaliseIntent('the stale contacts').hash,
    normaliseIntent('stale contacts').hash,
    '"the" stop word',
  );
});

test('stop word "list" stripped', () => {
  const { tokens } = normaliseIntent('list inactive contacts');
  assert(!tokens.includes('list'), '"list" must not be in tokens');
});

test('stop word "show" stripped', () => {
  const { tokens } = normaliseIntent('show stale contacts');
  assert(!tokens.includes('show'), '"show" must not be in tokens');
});

// ── Date-literal canonicalisation ─────────────────────────────────────────

test('date: "last 30 days" → last_30d token', () => {
  const { tokens } = normaliseIntent('contacts inactive last 30 days');
  assert(tokens.includes('last_30d'), 'last_30d token expected');
});

test('date: "30 days ago" → last_30d token', () => {
  const { tokens } = normaliseIntent('contacts inactive 30 days ago');
  assert(tokens.includes('last_30d'), 'last_30d token expected');
});

test('date: "past month" → last_30d token', () => {
  const { tokens } = normaliseIntent('stale contacts past month');
  assert(tokens.includes('last_30d'), 'last_30d token expected');
});

test('date: "this week" → this_week token', () => {
  const { tokens } = normaliseIntent('upcoming appointments this week');
  assert(tokens.includes('this_week'), 'this_week token expected');
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
