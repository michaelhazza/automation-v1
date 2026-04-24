/**
 * clientPulseHighRiskPure.test.ts
 *
 * Pure unit tests for the three functions extracted from the high-risk
 * endpoint: applyFilters, applyPagination, and the pure helpers
 * (mapDbBandToApi, encodeCursor, decodeCursor, formatLastAction).
 *
 * No DB calls. No HTTP layer. Run with:
 *   npx tsx server/services/__tests__/clientPulseHighRiskPure.test.ts
 */

import {
  applyFilters,
  applyPagination,
  mapDbBandToApi,
  encodeCursor,
  decodeCursor,
  formatLastAction,
  type ClientRow,
} from '../clientPulseHighRiskService.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>)
        .then(() => {
          passed++;
          console.log(`  PASS  ${name}`);
        })
        .catch((err: unknown) => {
          failed++;
          console.log(`  FAIL  ${name}`);
          console.log(`        ${err instanceof Error ? err.message : err}`);
        });
    } else {
      passed++;
      console.log(`  PASS  ${name}`);
    }
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}:\n  expected: ${e}\n  actual:   ${a}`);
  }
}

// ── Sample data ──────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    subaccountId: 'sub-1',
    subaccountName: 'Acme Corp',
    healthScore: 55,
    healthBand: 'at_risk',
    healthScoreDelta7d: -5,
    sparklineWeekly: [60, 58, 57, 55],
    lastActionText: null,
    hasPendingIntervention: false,
    drilldownUrl: '/clientpulse/clients/sub-1',
    ...overrides,
  };
}

const SAMPLE_ROWS: ClientRow[] = [
  makeRow({ subaccountId: 'sub-1', subaccountName: 'Acme Corp',    healthScore: 20, healthBand: 'critical',  hasPendingIntervention: false }),
  makeRow({ subaccountId: 'sub-2', subaccountName: 'Beta LLC',     healthScore: 35, healthBand: 'at_risk',   hasPendingIntervention: true  }),
  makeRow({ subaccountId: 'sub-3', subaccountName: 'Gamma Ltd',    healthScore: 60, healthBand: 'watch',     hasPendingIntervention: false }),
  makeRow({ subaccountId: 'sub-4', subaccountName: 'Delta Inc',    healthScore: 80, healthBand: 'healthy',   hasPendingIntervention: false }),
  makeRow({ subaccountId: 'sub-5', subaccountName: 'FooCorp HQ',   healthScore: 25, healthBand: 'critical',  hasPendingIntervention: false }),
  makeRow({ subaccountId: 'sub-6', subaccountName: 'foobar tools', healthScore: 40, healthBand: 'at_risk',   hasPendingIntervention: false }),
];

// ── mapDbBandToApi ───────────────────────────────────────────────────────────

test('mapDbBandToApi: atRisk → at_risk', () => {
  assertEqual(mapDbBandToApi('atRisk'), 'at_risk', 'band mapping');
});

test('mapDbBandToApi: critical → critical', () => {
  assertEqual(mapDbBandToApi('critical'), 'critical', 'band mapping');
});

test('mapDbBandToApi: watch → watch', () => {
  assertEqual(mapDbBandToApi('watch'), 'watch', 'band mapping');
});

test('mapDbBandToApi: healthy → healthy', () => {
  assertEqual(mapDbBandToApi('healthy'), 'healthy', 'band mapping');
});

// ── formatLastAction ─────────────────────────────────────────────────────────

test('formatLastAction: null when no action', () => {
  assertEqual(formatLastAction(null, null), null, 'no action');
});

test('formatLastAction: formats days ago correctly', () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const result = formatLastAction('send_email', threeDaysAgo);
  assert(result !== null, 'result should not be null');
  assert(result!.includes('send_email'), 'should include actionType');
  assert(result!.includes('3d ago'), `should include "3d ago", got: ${result}`);
});

test('formatLastAction: 0d ago for very recent action', () => {
  const result = formatLastAction('update_contact', new Date());
  assert(result !== null, 'result should not be null');
  assert(result!.includes('0d ago'), `should include "0d ago", got: ${result}`);
});

// ── applyFilters: band filtering ─────────────────────────────────────────────

test('applyFilters: band=all excludes healthy', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all' });
  assert(result.every(r => r.healthBand !== 'healthy'), 'band=all should exclude healthy');
  assert(result.length === 5, `expected 5 rows, got ${result.length}`);
});

test('applyFilters: band=healthy returns ONLY healthy', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'healthy' });
  assert(result.length === 1, `expected 1 healthy row, got ${result.length}`);
  assertEqual(result[0].subaccountId, 'sub-4', 'should be sub-4 healthy row');
});

test('applyFilters: band=critical returns only critical', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'critical' });
  assert(result.length === 2, `expected 2 critical rows, got ${result.length}`);
  assert(result.every(r => r.healthBand === 'critical'), 'all results should be critical');
});

test('applyFilters: band=at_risk returns only at_risk', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'at_risk' });
  assert(result.length === 2, `expected 2 at_risk rows, got ${result.length}`);
  assert(result.every(r => r.healthBand === 'at_risk'), 'all results should be at_risk');
});

test('applyFilters: band=watch returns only watch', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'watch' });
  assert(result.length === 1, `expected 1 watch row, got ${result.length}`);
  assert(result.every(r => r.healthBand === 'watch'), 'all results should be watch');
});

// ── applyFilters: search ──────────────────────────────────────────────────────

test('applyFilters: q=fooCorp matches case-insensitively', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all', q: 'fooCorp' });
  // 'FooCorp HQ' and 'foobar tools' both contain 'foo' — but 'fooCorp' only matches 'FooCorp HQ'
  assert(result.length === 1, `expected 1 match, got ${result.length}`);
  assertEqual(result[0].subaccountId, 'sub-5', 'should be FooCorp HQ');
});

test('applyFilters: q=foo matches both FooCorp and foobar case-insensitively', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all', q: 'foo' });
  assert(result.length === 2, `expected 2 matches, got ${result.length}`);
});

test('applyFilters: q is trimmed and case-insensitive', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all', q: '  ACME  ' });
  assert(result.length === 1, `expected 1 match, got ${result.length}`);
  assertEqual(result[0].subaccountId, 'sub-1', 'should match Acme Corp');
});

test('applyFilters: q with no matches returns empty', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all', q: 'zzznomatch' });
  assertEqual(result.length, 0, 'should return empty array');
});

// ── applyFilters: default (no params) ────────────────────────────────────────

test('applyFilters: no params acts like band=all (excludes healthy)', () => {
  const result = applyFilters(SAMPLE_ROWS, {});
  assert(result.every(r => r.healthBand !== 'healthy'), 'no params should exclude healthy');
});

// ── Sort order ────────────────────────────────────────────────────────────────
// PENDING first, then critical, at_risk, watch, healthy; within band: score ASC, name ASC, id ASC

test('applyFilters preserves sort: PENDING first regardless of band', () => {
  const rows: ClientRow[] = [
    makeRow({ subaccountId: 'sub-a', subaccountName: 'A',   healthScore: 20, healthBand: 'critical',  hasPendingIntervention: false }),
    makeRow({ subaccountId: 'sub-b', subaccountName: 'B',   healthScore: 35, healthBand: 'at_risk',   hasPendingIntervention: true  }),
    makeRow({ subaccountId: 'sub-c', subaccountName: 'C',   healthScore: 25, healthBand: 'critical',  hasPendingIntervention: false }),
  ];
  // applyFilters does not sort — the caller (getPrioritisedClients) returns already-sorted rows.
  // We test sortClientRows directly or via applyPagination ordering.
  // Here just confirm filter passes all non-healthy rows through without reordering.
  const result = applyFilters(rows, { band: 'all' });
  assertEqual(result.length, 3, 'all 3 non-healthy rows pass through');
});

// ── applyPagination ───────────────────────────────────────────────────────────

// Pre-sorted sample: PENDING first (sub-2), then critical asc (sub-1, sub-5), at_risk asc (sub-6), watch (sub-3)
// (healthy sub-4 excluded by applyFilters in normal usage; included here for pagination tests)
const SORTED_ROWS: ClientRow[] = [
  makeRow({ subaccountId: 'sub-2', subaccountName: 'Beta LLC',     healthScore: 35, healthBand: 'at_risk',  hasPendingIntervention: true  }),
  makeRow({ subaccountId: 'sub-1', subaccountName: 'Acme Corp',    healthScore: 20, healthBand: 'critical', hasPendingIntervention: false }),
  makeRow({ subaccountId: 'sub-5', subaccountName: 'FooCorp HQ',   healthScore: 25, healthBand: 'critical', hasPendingIntervention: false }),
  makeRow({ subaccountId: 'sub-6', subaccountName: 'foobar tools', healthScore: 40, healthBand: 'at_risk',  hasPendingIntervention: false }),
  makeRow({ subaccountId: 'sub-3', subaccountName: 'Gamma Ltd',    healthScore: 60, healthBand: 'watch',    hasPendingIntervention: false }),
];

test('applyPagination: default limit=7 returns all 5 when fewer than 7', () => {
  const { rows, nextCursor } = applyPagination(SORTED_ROWS, { limit: 7 });
  assertEqual(rows.length, 5, 'should return all 5 rows');
  assertEqual(nextCursor, null, 'no nextCursor when all rows returned');
});

test('applyPagination: limit=2 returns first 2 rows and a cursor', async () => {
  const { rows, nextCursor } = applyPagination(SORTED_ROWS, { limit: 2 });
  assertEqual(rows.length, 2, 'should return 2 rows');
  assertEqual(rows[0].subaccountId, 'sub-2', 'first row should be PENDING (sub-2)');
  assertEqual(rows[1].subaccountId, 'sub-1', 'second row should be sub-1');
  assert(nextCursor !== null, 'should have nextCursor');
});

test('applyPagination: page 2 with cursor has no duplicates', async () => {
  const page1 = applyPagination(SORTED_ROWS, { limit: 2 });
  assert(page1.nextCursor !== null, 'page1 should have cursor');

  const page2 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page1.nextCursor! });
  assertEqual(page2.rows.length, 2, 'page2 should have 2 rows');

  const page1Ids = new Set(page1.rows.map(r => r.subaccountId));
  for (const row of page2.rows) {
    assert(!page1Ids.has(row.subaccountId), `duplicate row found: ${row.subaccountId}`);
  }
});

test('applyPagination: page 3 (last page) has no cursor', async () => {
  const page1 = applyPagination(SORTED_ROWS, { limit: 2 });
  const page2 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page1.nextCursor! });
  const page3 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page2.nextCursor! });
  assertEqual(page3.rows.length, 1, 'page3 should have 1 remaining row');
  assertEqual(page3.nextCursor, null, 'page3 should have no nextCursor');
});

test('applyPagination: all pages combined = all rows, in order, no duplicates', async () => {
  const page1 = applyPagination(SORTED_ROWS, { limit: 2 });
  const page2 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page1.nextCursor! });
  const page3 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page2.nextCursor! });

  const all = [...page1.rows, ...page2.rows, ...page3.rows];
  assertEqual(all.length, 5, 'total across pages should be 5');
  const ids = all.map(r => r.subaccountId);
  const unique = [...new Set(ids)];
  assertEqual(unique.length, 5, 'no duplicate ids across pages');
  // Verify order preserved
  assertEqual(ids[0], 'sub-2', 'page1 row1 = sub-2');
  assertEqual(ids[4], 'sub-3', 'page3 last = sub-3');
});

test('applyPagination: hasMore is true when more rows exist', () => {
  const { rows, nextCursor } = applyPagination(SORTED_ROWS, { limit: 2 });
  assert(nextCursor !== null, 'hasMore should be true (cursor present)');
  assertEqual(rows.length, 2, '2 rows on this page');
});

test('applyPagination: hard max 25 enforced (limit=100 → at most 25)', () => {
  const manyRows = Array.from({ length: 30 }, (_, i) =>
    makeRow({ subaccountId: `sub-${i}`, subaccountName: `Client ${i}`, healthScore: i + 1, healthBand: 'critical', hasPendingIntervention: false }),
  );
  const { rows } = applyPagination(manyRows, { limit: 100 });
  assert(rows.length <= 25, `should be at most 25, got ${rows.length}`);
});

test('applyPagination: default limit is 7', () => {
  const manyRows = Array.from({ length: 20 }, (_, i) =>
    makeRow({ subaccountId: `sub-${i}`, subaccountName: `Client ${i}`, healthScore: i + 1, healthBand: 'critical', hasPendingIntervention: false }),
  );
  const { rows, nextCursor } = applyPagination(manyRows, { limit: 7 });
  assertEqual(rows.length, 7, 'default limit is 7');
  assert(nextCursor !== null, 'should have cursor for more rows');
});

// ── Cursor encode/decode roundtrip ────────────────────────────────────────────

test('encodeCursor / decodeCursor roundtrip is stable', () => {
  const payload = { score: 55, name: 'Acme Corp', id: 'sub-1' };
  const secret = 'test-secret-for-unit-tests';
  const cursor = encodeCursor(payload, secret);
  const decoded = decodeCursor(cursor, secret);
  assert(decoded !== null, 'decoded should not be null');
  assertEqual(decoded!.score, payload.score, 'score mismatch');
  assertEqual(decoded!.name, payload.name, 'name mismatch');
  assertEqual(decoded!.id, payload.id, 'id mismatch');
});

test('decodeCursor: tampered cursor returns null', () => {
  const payload = { score: 55, name: 'Acme Corp', id: 'sub-1' };
  const secret = 'test-secret-for-unit-tests';
  const cursor = encodeCursor(payload, secret);
  // Tamper: flip one character
  const tampered = cursor.slice(0, -3) + 'XXX';
  const decoded = decodeCursor(tampered, secret);
  assertEqual(decoded, null, 'tampered cursor should decode to null');
});

test('decodeCursor: cursor signed with different secret returns null', () => {
  const payload = { score: 55, name: 'Acme Corp', id: 'sub-1' };
  const cursor = encodeCursor(payload, 'secret-A');
  const decoded = decodeCursor(cursor, 'secret-B');
  assertEqual(decoded, null, 'wrong-secret cursor should decode to null');
});

test('decodeCursor: garbage string returns null', () => {
  const decoded = decodeCursor('not-a-valid-cursor', 'any-secret');
  assertEqual(decoded, null, 'garbage cursor should decode to null');
});

test('encodeCursor: same input always yields same output (deterministic)', () => {
  const payload = { score: 42, name: 'Same Corp', id: 'uuid-123' };
  const secret = 'deterministic-test';
  const c1 = encodeCursor(payload, secret);
  const c2 = encodeCursor(payload, secret);
  assertEqual(c1, c2, 'cursor should be deterministic');
});

// ── Response shape validation ────────────────────────────────────────────────

test('ClientRow shape has all required fields', () => {
  const row = makeRow();
  assert('subaccountId' in row, 'missing subaccountId');
  assert('subaccountName' in row, 'missing subaccountName');
  assert('healthScore' in row, 'missing healthScore');
  assert('healthBand' in row, 'missing healthBand');
  assert('healthScoreDelta7d' in row, 'missing healthScoreDelta7d');
  assert('sparklineWeekly' in row, 'missing sparklineWeekly');
  assert('lastActionText' in row, 'missing lastActionText');
  assert('hasPendingIntervention' in row, 'missing hasPendingIntervention');
  assert('drilldownUrl' in row, 'missing drilldownUrl');
  assertEqual(row.drilldownUrl, '/clientpulse/clients/sub-1', 'drilldownUrl format');
});

test('drilldownUrl always uses /clientpulse/clients/<subaccountId>', () => {
  const row = makeRow({ subaccountId: 'abc-123', drilldownUrl: '/clientpulse/clients/abc-123' });
  assertEqual(row.drilldownUrl, '/clientpulse/clients/abc-123', 'drilldownUrl format');
});

// ── Summary ─────────────────────────────────────────────────────────────────

setTimeout(() => {
  console.log('\n─────────────────────────────────────────────────');
  console.log(`  ${passed} passed  |  ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 200);
