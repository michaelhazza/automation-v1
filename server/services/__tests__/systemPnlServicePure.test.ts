/**
 * systemPnlServicePure.test.ts — pure-function tests for the System P&L
 * page math (spec §16.2). No DB access; covers overhead predicate,
 * margin/profit computation, KPI change indicators, totals row.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/systemPnlServicePure.test.ts
 */

import { expect, test } from 'vitest';
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
  COUNTABLE_COST_STATUSES,
  contributesToCostAggregate,
} from '../systemPnlServicePure.js';

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n      actual:   ${a}\n      expected: ${e}`);
}

// ── isOverheadRow ────────────────────────────────────────────────────────

test('isOverheadRow — null revenue → true', () => {
  expect(isOverheadRow({ revenueCents: null }), 'should flag null revenue').toBe(true);
});

test('isOverheadRow — 0 revenue → false (revenue-bearing row with no revenue this period)', () => {
  expect(isOverheadRow({ revenueCents: 0 }), '0 is a distinct business state from null').toBe(false);
});

test('isOverheadRow — positive revenue → false', () => {
  expect(isOverheadRow({ revenueCents: 1000 }), 'billable row').toBe(false);
});

// ── computeMarginPct ─────────────────────────────────────────────────────

test('computeMarginPct — null revenue → null', () => {
  expect(computeMarginPct(null, 500), 'overhead row').toBe(null);
});

test('computeMarginPct — zero revenue → 0', () => {
  expect(computeMarginPct(0, 0), 'avoid NaN').toBe(0);
});

test('computeMarginPct — standard 30 percent margin', () => {
  // revenue $100, cost $70 → profit $30, margin 30%
  expect(computeMarginPct(10000, 7000), '30% margin').toBe(30);
});

test('computeMarginPct — negative margin (cost > revenue)', () => {
  // revenue $50, cost $100 → profit -$50, margin -100%
  expect(computeMarginPct(5000, 10000), 'loss row').toEqual(-100);
});

// ── computeProfitCents ───────────────────────────────────────────────────

test('computeProfitCents — overhead row → -cost', () => {
  expect(computeProfitCents(null, 700), 'pure expense').toEqual(-700);
});

test('computeProfitCents — billable row → revenue - cost', () => {
  expect(computeProfitCents(10000, 6500), 'standard profit').toBe(3500);
});

// ── computeKpiChangePct ──────────────────────────────────────────────────

test('computeKpiChangePct — null previous → null', () => {
  expect(computeKpiChangePct(1000, null), 'no prior period').toBe(null);
});

test('computeKpiChangePct — up 10 percent', () => {
  expect(computeKpiChangePct(11000, 10000), 'up 10%').toEqual({ pct: 10, direction: 'up' });
});

test('computeKpiChangePct — down 20 percent', () => {
  expect(computeKpiChangePct(8000, 10000), 'down 20%').toEqual({ pct: 20, direction: 'down' });
});

test('computeKpiChangePct — flat (both zero)', () => {
  expect(computeKpiChangePct(0, 0), 'both zero').toEqual({ pct: 0, direction: 'flat' });
});

test('computeKpiChangePct — previous zero, current non-zero → 100% up', () => {
  expect(computeKpiChangePct(100, 0), 'new period').toEqual({ pct: 100, direction: 'up' });
});

// ── computeKpiChangePp ───────────────────────────────────────────────────

test('computeKpiChangePp — null previous → null', () => {
  expect(computeKpiChangePp(13.5, null), 'no prior period').toBe(null);
});

test('computeKpiChangePp — +0.4pp', () => {
  expect(computeKpiChangePp(13.5, 13.1), '+0.4pp').toEqual({ pp: 0.4, direction: 'up' });
});

test('computeKpiChangePp — -1.2pp', () => {
  expect(computeKpiChangePp(12.3, 13.5), '-1.2pp').toEqual({ pp: 1.2, direction: 'down' });
});

// ── pctOfTotal ───────────────────────────────────────────────────────────

test('pctOfTotal — zero total → 0', () => {
  expect(pctOfTotal(100, 0), 'avoid divide-by-zero').toBe(0);
});

test('pctOfTotal — negative total → 0 (defensive)', () => {
  expect(pctOfTotal(100, -500), 'avoid negative percentages').toBe(0);
});

test('pctOfTotal — 27.5 percent', () => {
  expect(pctOfTotal(275, 1000), 'standard ratio').toBe(27.5);
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
  expect(row.requests, 'sum requests').toBe(150);
  expect(row.costCents, 'sum cost').toBe(800);
  expect(row.profitCents, '= -cost').toEqual(-800);
  expect(row.revenueCents, 'stays null').toBe(null);
  expect(row.marginPct, 'no margin for overhead').toBe(null);
  expect(row.pctOfRevenue, '800/10000 = 8%').toBe(8);
});

// ── computeNetProfit ─────────────────────────────────────────────────────

test('computeNetProfit — gross 1000, overhead 200 → 800', () => {
  expect(computeNetProfit(1000, 200), 'net = gross - overhead').toBe(800);
});

test('computeNetProfit — overhead exceeds gross → negative', () => {
  expect(computeNetProfit(100, 500), 'net loss').toEqual(-400);
});

// ── computeTotalsRow ─────────────────────────────────────────────────────

test('computeTotalsRow — sums across billable + overhead rows', () => {
  const totals = computeTotalsRow([
    { requests: 100, revenueCents: 5000, costCents: 3000 },   // billable
    { requests: 50,  revenueCents: null, costCents: 800 },    // overhead
    { requests: 75,  revenueCents: 2500, costCents: 1500 },   // billable
  ]);
  expect(totals.requests, 'sum requests').toBe(225);
  expect(totals.revenueCents, 'overhead contributes 0 to revenue').toBe(7500);
  expect(totals.costCents, 'sum cost (includes overhead)').toBe(5300);
  expect(totals.profitCents, '7500 - 5300').toBe(2200);
  expect(totals.marginPct, '2200/7500 ≈ 29.33%').toBe(29.33);
});

test('computeTotalsRow — empty rows → zero row', () => {
  const totals = computeTotalsRow([]);
  expect(totals, 'zeros').toEqual({ requests: 0, revenueCents: 0, costCents: 0, profitCents: 0, marginPct: 0 });
});

// ── Countable-cost status predicate (deferred-items brief §1 tripwire) ───
//
// Pins the invariant: `cost_aggregates` must ignore `'started'` rows so a
// provisional row (written before the provider call to close the double-
// dispatch window) never inflates cost totals. All terminal non-success
// statuses are also excluded. Only `success` and `partial` contribute.
//
// If this list ever needs to change, the change must be deliberate — both
// this test and every SQL query in systemPnlService.ts need to update
// together. The pair is the contract.

test('COUNTABLE_COST_STATUSES pins success + partial (brief §1)', () => {
  expect([...COUNTABLE_COST_STATUSES], 'countable set').toEqual(['success', 'partial']);
});

test('contributesToCostAggregate — provisional started is EXCLUDED', () => {
  expect(contributesToCostAggregate('started'), "'started' must not count toward cost").toBe(false);
});

test('contributesToCostAggregate — every terminal non-success is EXCLUDED', () => {
  const excluded = [
    'started',               // brief §1 — provisional row
    'error',
    'timeout',
    'budget_blocked',
    'rate_limited',
    'provider_unavailable',
    'provider_not_configured',
    'client_disconnected',
    'parse_failure',
    'aborted_by_caller',
  ];
  for (const s of excluded) {
    expect(contributesToCostAggregate(s), `status='${s}' must not count toward cost`).toBe(false);
  }
});

test('contributesToCostAggregate — success and partial are INCLUDED', () => {
  expect(contributesToCostAggregate('success'), 'success counts').toBe(true);
  expect(contributesToCostAggregate('partial'), 'partial counts').toBe(true);
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log('');
