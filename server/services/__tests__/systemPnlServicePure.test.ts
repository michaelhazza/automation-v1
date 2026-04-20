/**
 * systemPnlServicePure.test.ts — pure-function tests for the System P&L
 * page math (spec §16.2). No DB access; covers overhead predicate,
 * margin/profit computation, KPI change indicators, totals row.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/systemPnlServicePure.test.ts
 */

import {
  isOverheadRow,
  computeMarginPct,
  computeProfitCents,
  computeKpiChangePct,
  computeKpiChangePp,
  pctOfTotal,
  buildAggregatedOverheadRow,
  computeNetProfit,
  computeTotalsRow,
} from '../systemPnlServicePure.js';

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

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n      actual:   ${a}\n      expected: ${e}`);
}

// ── isOverheadRow ────────────────────────────────────────────────────────

test('isOverheadRow — null revenue → true', () => {
  assertEqual(isOverheadRow({ revenueCents: null }), true, 'should flag null revenue');
});

test('isOverheadRow — 0 revenue → false (revenue-bearing row with no revenue this period)', () => {
  assertEqual(isOverheadRow({ revenueCents: 0 }), false, '0 is a distinct business state from null');
});

test('isOverheadRow — positive revenue → false', () => {
  assertEqual(isOverheadRow({ revenueCents: 1000 }), false, 'billable row');
});

// ── computeMarginPct ─────────────────────────────────────────────────────

test('computeMarginPct — null revenue → null', () => {
  assertEqual(computeMarginPct(null, 500), null, 'overhead row');
});

test('computeMarginPct — zero revenue → 0', () => {
  assertEqual(computeMarginPct(0, 0), 0, 'avoid NaN');
});

test('computeMarginPct — standard 30 percent margin', () => {
  // revenue $100, cost $70 → profit $30, margin 30%
  assertEqual(computeMarginPct(10000, 7000), 30, '30% margin');
});

test('computeMarginPct — negative margin (cost > revenue)', () => {
  // revenue $50, cost $100 → profit -$50, margin -100%
  assertEqual(computeMarginPct(5000, 10000), -100, 'loss row');
});

// ── computeProfitCents ───────────────────────────────────────────────────

test('computeProfitCents — overhead row → -cost', () => {
  assertEqual(computeProfitCents(null, 700), -700, 'pure expense');
});

test('computeProfitCents — billable row → revenue - cost', () => {
  assertEqual(computeProfitCents(10000, 6500), 3500, 'standard profit');
});

// ── computeKpiChangePct ──────────────────────────────────────────────────

test('computeKpiChangePct — null previous → null', () => {
  assertEqual(computeKpiChangePct(1000, null), null, 'no prior period');
});

test('computeKpiChangePct — up 10 percent', () => {
  assertEqual(computeKpiChangePct(11000, 10000), { pct: 10, direction: 'up' }, 'up 10%');
});

test('computeKpiChangePct — down 20 percent', () => {
  assertEqual(computeKpiChangePct(8000, 10000), { pct: 20, direction: 'down' }, 'down 20%');
});

test('computeKpiChangePct — flat (both zero)', () => {
  assertEqual(computeKpiChangePct(0, 0), { pct: 0, direction: 'flat' }, 'both zero');
});

test('computeKpiChangePct — previous zero, current non-zero → 100% up', () => {
  assertEqual(computeKpiChangePct(100, 0), { pct: 100, direction: 'up' }, 'new period');
});

// ── computeKpiChangePp ───────────────────────────────────────────────────

test('computeKpiChangePp — null previous → null', () => {
  assertEqual(computeKpiChangePp(13.5, null), null, 'no prior period');
});

test('computeKpiChangePp — +0.4pp', () => {
  assertEqual(computeKpiChangePp(13.5, 13.1), { pp: 0.4, direction: 'up' }, '+0.4pp');
});

test('computeKpiChangePp — -1.2pp', () => {
  assertEqual(computeKpiChangePp(12.3, 13.5), { pp: 1.2, direction: 'down' }, '-1.2pp');
});

// ── pctOfTotal ───────────────────────────────────────────────────────────

test('pctOfTotal — zero total → 0', () => {
  assertEqual(pctOfTotal(100, 0), 0, 'avoid divide-by-zero');
});

test('pctOfTotal — negative total → 0 (defensive)', () => {
  assertEqual(pctOfTotal(100, -500), 0, 'avoid negative percentages');
});

test('pctOfTotal — 27.5 percent', () => {
  assertEqual(pctOfTotal(275, 1000), 27.5, 'standard ratio');
});

// ── buildAggregatedOverheadRow ───────────────────────────────────────────

test('buildAggregatedOverheadRow — sums requests and cost', () => {
  const row = buildAggregatedOverheadRow({
    overheadRows: [
      { sourceType: 'system', label: '', description: '', orgsCount: 0, requests: 100, revenueCents: null, costCents: 500, profitCents: -500, marginPct: null, pctOfCost: 0 },
      { sourceType: 'analyzer', label: '', description: '', orgsCount: 0, requests: 50, revenueCents: null, costCents: 300, profitCents: -300, marginPct: null, pctOfCost: 0 },
    ],
    platformRevenueCents: 10000,
  });
  assertEqual(row.requests, 150, 'sum requests');
  assertEqual(row.costCents, 800, 'sum cost');
  assertEqual(row.profitCents, -800, '= -cost');
  assertEqual(row.revenueCents, null, 'stays null');
  assertEqual(row.marginPct, null, 'no margin for overhead');
  assertEqual(row.pctOfRevenue, 8, '800/10000 = 8%');
});

// ── computeNetProfit ─────────────────────────────────────────────────────

test('computeNetProfit — gross 1000, overhead 200 → 800', () => {
  assertEqual(computeNetProfit(1000, 200), 800, 'net = gross - overhead');
});

test('computeNetProfit — overhead exceeds gross → negative', () => {
  assertEqual(computeNetProfit(100, 500), -400, 'net loss');
});

// ── computeTotalsRow ─────────────────────────────────────────────────────

test('computeTotalsRow — sums across billable + overhead rows', () => {
  const totals = computeTotalsRow([
    { requests: 100, revenueCents: 5000, costCents: 3000 },   // billable
    { requests: 50,  revenueCents: null, costCents: 800 },    // overhead
    { requests: 75,  revenueCents: 2500, costCents: 1500 },   // billable
  ]);
  assertEqual(totals.requests, 225, 'sum requests');
  assertEqual(totals.revenueCents, 7500, 'overhead contributes 0 to revenue');
  assertEqual(totals.costCents, 5300, 'sum cost (includes overhead)');
  assertEqual(totals.profitCents, 2200, '7500 - 5300');
  assertEqual(totals.marginPct, 29.33, '2200/7500 ≈ 29.33%');
});

test('computeTotalsRow — empty rows → zero row', () => {
  const totals = computeTotalsRow([]);
  assertEqual(totals, { requests: 0, revenueCents: 0, costCents: 0, profitCents: 0, marginPct: 0 }, 'zeros');
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log('');
console.log(`[systemPnlServicePure] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
