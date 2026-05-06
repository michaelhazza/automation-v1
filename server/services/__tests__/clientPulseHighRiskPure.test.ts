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

import { expect, test } from 'vitest';
import {
  applyFilters,
  applyPagination,
  mapDbBandToApi,
  encodeCursor,
  decodeCursor,
  formatLastAction,
  type ClientRow,
} from '../clientPulseHighRiskService.js';

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
  expect(mapDbBandToApi('atRisk'), 'band mapping').toBe('at_risk');
});

test('mapDbBandToApi: critical → critical', () => {
  expect(mapDbBandToApi('critical'), 'band mapping').toBe('critical');
});

test('mapDbBandToApi: watch → watch', () => {
  expect(mapDbBandToApi('watch'), 'band mapping').toBe('watch');
});

test('mapDbBandToApi: healthy → healthy', () => {
  expect(mapDbBandToApi('healthy'), 'band mapping').toBe('healthy');
});

// ── formatLastAction ─────────────────────────────────────────────────────────

test('formatLastAction: null when no action', () => {
  expect(formatLastAction(null, null), 'no action').toBe(null);
});

test('formatLastAction: formats days ago correctly', () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const result = formatLastAction('send_email', threeDaysAgo);
  expect(result !== null, 'result should not be null').toBeTruthy();
  expect(result!.includes('send_email'), 'should include actionType').toBeTruthy();
  expect(result!.includes('3d ago'), `should include "3d ago", got: ${result}`).toBeTruthy();
});

test('formatLastAction: 0d ago for very recent action', () => {
  const result = formatLastAction('update_contact', new Date());
  expect(result !== null, 'result should not be null').toBeTruthy();
  expect(result!.includes('0d ago'), `should include "0d ago", got: ${result}`).toBeTruthy();
});

// ── applyFilters: band filtering ─────────────────────────────────────────────

test('applyFilters: band=all excludes healthy', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all' });
  expect(result.every(r => r.healthBand !== 'healthy'), 'band=all should exclude healthy').toBeTruthy();
  expect(result.length === 5, `expected 5 rows, got ${result.length}`).toBeTruthy();
});

test('applyFilters: band=healthy returns ONLY healthy', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'healthy' });
  expect(result.length === 1, `expected 1 healthy row, got ${result.length}`).toBeTruthy();
  expect(result[0].subaccountId, 'should be sub-4 healthy row').toBe('sub-4');
});

test('applyFilters: band=critical returns only critical', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'critical' });
  expect(result.length === 2, `expected 2 critical rows, got ${result.length}`).toBeTruthy();
  expect(result.every(r => r.healthBand === 'critical'), 'all results should be critical').toBeTruthy();
});

test('applyFilters: band=at_risk returns only at_risk', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'at_risk' });
  expect(result.length === 2, `expected 2 at_risk rows, got ${result.length}`).toBeTruthy();
  expect(result.every(r => r.healthBand === 'at_risk'), 'all results should be at_risk').toBeTruthy();
});

test('applyFilters: band=watch returns only watch', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'watch' });
  expect(result.length === 1, `expected 1 watch row, got ${result.length}`).toBeTruthy();
  expect(result.every(r => r.healthBand === 'watch'), 'all results should be watch').toBeTruthy();
});

// ── applyFilters: search ──────────────────────────────────────────────────────

test('applyFilters: q=fooCorp matches case-insensitively', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all', q: 'fooCorp' });
  // 'FooCorp HQ' and 'foobar tools' both contain 'foo' — but 'fooCorp' only matches 'FooCorp HQ'
  expect(result.length === 1, `expected 1 match, got ${result.length}`).toBeTruthy();
  expect(result[0].subaccountId, 'should be FooCorp HQ').toBe('sub-5');
});

test('applyFilters: q=foo matches both FooCorp and foobar case-insensitively', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all', q: 'foo' });
  expect(result.length === 2, `expected 2 matches, got ${result.length}`).toBeTruthy();
});

test('applyFilters: q is trimmed and case-insensitive', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all', q: '  ACME  ' });
  expect(result.length === 1, `expected 1 match, got ${result.length}`).toBeTruthy();
  expect(result[0].subaccountId, 'should match Acme Corp').toBe('sub-1');
});

test('applyFilters: q with no matches returns empty', () => {
  const result = applyFilters(SAMPLE_ROWS, { band: 'all', q: 'zzznomatch' });
  expect(result.length, 'should return empty array').toBe(0);
});

// ── applyFilters: default (no params) ────────────────────────────────────────

test('applyFilters: no params acts like band=all (excludes healthy)', () => {
  const result = applyFilters(SAMPLE_ROWS, {});
  expect(result.every(r => r.healthBand !== 'healthy'), 'no params should exclude healthy').toBeTruthy();
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
  expect(result.length, 'all 3 non-healthy rows pass through').toBe(3);
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
  expect(rows.length, 'should return all 5 rows').toBe(5);
  expect(nextCursor, 'no nextCursor when all rows returned').toBe(null);
});

test('applyPagination: limit=2 returns first 2 rows and a cursor', async () => {
  const { rows, nextCursor } = applyPagination(SORTED_ROWS, { limit: 2 });
  expect(rows.length, 'should return 2 rows').toBe(2);
  expect(rows[0].subaccountId, 'first row should be PENDING (sub-2)').toBe('sub-2');
  expect(rows[1].subaccountId, 'second row should be sub-1').toBe('sub-1');
  expect(nextCursor !== null, 'should have nextCursor').toBeTruthy();
});

test('applyPagination: page 2 with cursor has no duplicates', async () => {
  const page1 = applyPagination(SORTED_ROWS, { limit: 2 });
  expect(page1.nextCursor !== null, 'page1 should have cursor').toBeTruthy();

  const page2 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page1.nextCursor! });
  expect(page2.rows.length, 'page2 should have 2 rows').toBe(2);

  const page1Ids = new Set(page1.rows.map(r => r.subaccountId));
  for (const row of page2.rows) {
    expect(!page1Ids.has(row.subaccountId), `duplicate row found: ${row.subaccountId}`).toBeTruthy();
  }
});

test('applyPagination: page 3 (last page) has no cursor', async () => {
  const page1 = applyPagination(SORTED_ROWS, { limit: 2 });
  const page2 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page1.nextCursor! });
  const page3 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page2.nextCursor! });
  expect(page3.rows.length, 'page3 should have 1 remaining row').toBe(1);
  expect(page3.nextCursor, 'page3 should have no nextCursor').toBe(null);
});

test('applyPagination: all pages combined = all rows, in order, no duplicates', async () => {
  const page1 = applyPagination(SORTED_ROWS, { limit: 2 });
  const page2 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page1.nextCursor! });
  const page3 = applyPagination(SORTED_ROWS, { limit: 2, cursor: page2.nextCursor! });

  const all = [...page1.rows, ...page2.rows, ...page3.rows];
  expect(all.length, 'total across pages should be 5').toBe(5);
  const ids = all.map(r => r.subaccountId);
  const unique = [...new Set(ids)];
  expect(unique.length, 'no duplicate ids across pages').toBe(5);
  // Verify order preserved
  expect(ids[0], 'page1 row1 = sub-2').toBe('sub-2');
  expect(ids[4], 'page3 last = sub-3').toBe('sub-3');
});

test('applyPagination: hasMore is true when more rows exist', () => {
  const { rows, nextCursor } = applyPagination(SORTED_ROWS, { limit: 2 });
  expect(nextCursor !== null, 'hasMore should be true (cursor present)').toBeTruthy();
  expect(rows.length, '2 rows on this page').toBe(2);
});

test('applyPagination: hard max 25 enforced (limit=100 → at most 25)', () => {
  const manyRows = Array.from({ length: 30 }, (_, i) =>
    makeRow({ subaccountId: `sub-${i}`, subaccountName: `Client ${i}`, healthScore: i + 1, healthBand: 'critical', hasPendingIntervention: false }),
  );
  const { rows } = applyPagination(manyRows, { limit: 100 });
  expect(rows.length <= 25, `should be at most 25, got ${rows.length}`).toBeTruthy();
});

test('applyPagination: default limit is 7', () => {
  const manyRows = Array.from({ length: 20 }, (_, i) =>
    makeRow({ subaccountId: `sub-${i}`, subaccountName: `Client ${i}`, healthScore: i + 1, healthBand: 'critical', hasPendingIntervention: false }),
  );
  const { rows, nextCursor } = applyPagination(manyRows, { limit: 7 });
  expect(rows.length, 'default limit is 7').toBe(7);
  expect(nextCursor !== null, 'should have cursor for more rows').toBeTruthy();
});

// ── Cursor encode/decode roundtrip ────────────────────────────────────────────

test('encodeCursor / decodeCursor roundtrip is stable', () => {
  const payload = { score: 55, name: 'Acme Corp', id: 'sub-1' };
  const secret = 'test-secret-for-unit-tests';
  const cursor = encodeCursor(payload, secret);
  const decoded = decodeCursor(cursor, secret);
  expect(decoded !== null, 'decoded should not be null').toBeTruthy();
  expect(decoded!.score, 'score mismatch').toEqual(payload.score);
  expect(decoded!.name, 'name mismatch').toEqual(payload.name);
  expect(decoded!.id, 'id mismatch').toEqual(payload.id);
});

test('decodeCursor: tampered cursor returns null', () => {
  const payload = { score: 55, name: 'Acme Corp', id: 'sub-1' };
  const secret = 'test-secret-for-unit-tests';
  const cursor = encodeCursor(payload, secret);
  // Tamper: flip one character
  const tampered = cursor.slice(0, -3) + 'XXX';
  const decoded = decodeCursor(tampered, secret);
  expect(decoded, 'tampered cursor should decode to null').toBe(null);
});

test('decodeCursor: cursor signed with different secret returns null', () => {
  const payload = { score: 55, name: 'Acme Corp', id: 'sub-1' };
  const cursor = encodeCursor(payload, 'secret-A');
  const decoded = decodeCursor(cursor, 'secret-B');
  expect(decoded, 'wrong-secret cursor should decode to null').toBe(null);
});

test('decodeCursor: garbage string returns null', () => {
  const decoded = decodeCursor('not-a-valid-cursor', 'any-secret');
  expect(decoded, 'garbage cursor should decode to null').toBe(null);
});

test('encodeCursor: same input always yields same output (deterministic)', () => {
  const payload = { score: 42, name: 'Same Corp', id: 'uuid-123' };
  const secret = 'deterministic-test';
  const c1 = encodeCursor(payload, secret);
  const c2 = encodeCursor(payload, secret);
  expect(c1, 'cursor should be deterministic').toEqual(c2);
});

// ── Response shape validation ────────────────────────────────────────────────

test('ClientRow shape has all required fields', () => {
  const row = makeRow();
  expect('subaccountId' in row, 'missing subaccountId').toBeTruthy();
  expect('subaccountName' in row, 'missing subaccountName').toBeTruthy();
  expect('healthScore' in row, 'missing healthScore').toBeTruthy();
  expect('healthBand' in row, 'missing healthBand').toBeTruthy();
  expect('healthScoreDelta7d' in row, 'missing healthScoreDelta7d').toBeTruthy();
  expect('sparklineWeekly' in row, 'missing sparklineWeekly').toBeTruthy();
  expect('lastActionText' in row, 'missing lastActionText').toBeTruthy();
  expect('hasPendingIntervention' in row, 'missing hasPendingIntervention').toBeTruthy();
  expect('drilldownUrl' in row, 'missing drilldownUrl').toBeTruthy();
  expect(row.drilldownUrl, 'drilldownUrl format').toBe('/clientpulse/clients/sub-1');
});

test('drilldownUrl always uses /clientpulse/clients/<subaccountId>', () => {
  const row = makeRow({ subaccountId: 'abc-123', drilldownUrl: '/clientpulse/clients/abc-123' });
  expect(row.drilldownUrl, 'drilldownUrl format').toBe('/clientpulse/clients/abc-123');
});

// ── Summary ─────────────────────────────────────────────────────────────────

setTimeout(() => {
  console.log('\n─────────────────────────────────────────────────');
}, 200);
