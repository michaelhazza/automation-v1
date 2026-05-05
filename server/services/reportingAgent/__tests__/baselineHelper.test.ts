import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { computeDelta } from '../baselineHelper.js';
import type { BaselineSnapshot } from '../baselineHelper.js';

function makeSnapshot(overrides?: Array<Partial<BaselineSnapshot['metrics'][0]>>): BaselineSnapshot {
  const defaults: BaselineSnapshot['metrics'] = [
    { slug: 'pipeline_value',          value: { numeric: 100000, currency: 'USD', unit: 'cents' }, source: 'canonical_metric' },
    { slug: 'lead_count',              value: { numeric: 50,     unit: 'count' },                  source: 'canonical_metric' },
    { slug: 'conversation_engagement', value: { numeric: 200,    unit: 'count' },                  source: 'canonical_metric' },
    { slug: 'open_opportunity_count',  value: { numeric: 10,     unit: 'count' },                  source: 'canonical_metric' },
    { slug: 'revenue_last_30d',        value: { numeric: 50000,  currency: 'USD', unit: 'cents' }, source: 'canonical_metric' },
  ];
  const metrics = overrides
    ? defaults.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }))
    : defaults;
  return {
    id: 'baseline-1',
    subaccountId: 'sub-1',
    baselineVersion: 1,
    status: 'captured',
    source: 'auto',
    confidence: 'confirmed',
    capturedAt: new Date('2026-01-01'),
    metrics,
  };
}

describe('computeDelta', () => {
  it('full baseline → 5 deltas, all unavailableAtBaseline=false, correct math', () => {
    const snapshot = makeSnapshot();
    const current = [
      { slug: 'pipeline_value'          as const, numeric: 120000 },
      { slug: 'lead_count'              as const, numeric: 60 },
      { slug: 'conversation_engagement' as const, numeric: 180 },
      { slug: 'open_opportunity_count'  as const, numeric: 10 },
      { slug: 'revenue_last_30d'        as const, numeric: 55000 },
    ];
    const deltas = computeDelta(snapshot, current);
    assert.equal(deltas.length, 5);
    for (const d of deltas) {
      assert.equal(d.unavailableAtBaseline, false);
    }
    const pv = deltas.find(d => d.slug === 'pipeline_value')!;
    assert.equal(pv.delta, 20000);
    assert.ok(Math.abs(pv.pct! - 20) < 0.001, `pct should be ~20, got ${pv.pct}`);

    const lc = deltas.find(d => d.slug === 'lead_count')!;
    assert.equal(lc.delta, 10);
    assert.ok(Math.abs(lc.pct! - 20) < 0.001);

    const ce = deltas.find(d => d.slug === 'conversation_engagement')!;
    assert.equal(ce.delta, -20);
    assert.ok(Math.abs(ce.pct! - (-10)) < 0.001);
  });

  it('2 unavailable metrics in baseline → unavailableAtBaseline=true, delta/pct null', () => {
    const snapshot = makeSnapshot([
      {},
      { source: 'unavailable', value: { numeric: 0, unit: 'count' } },
      {},
      { source: 'unavailable', value: { numeric: 0, unit: 'count' } },
      {},
    ]);
    const current = [
      { slug: 'pipeline_value'          as const, numeric: 100000 },
      { slug: 'lead_count'              as const, numeric: 60 },
      { slug: 'conversation_engagement' as const, numeric: 200 },
      { slug: 'open_opportunity_count'  as const, numeric: 15 },
      { slug: 'revenue_last_30d'        as const, numeric: 50000 },
    ];
    const deltas = computeDelta(snapshot, current);
    const lc = deltas.find(d => d.slug === 'lead_count')!;
    assert.equal(lc.unavailableAtBaseline, true);
    assert.equal(lc.delta, null);
    assert.equal(lc.pct, null);
    const oo = deltas.find(d => d.slug === 'open_opportunity_count')!;
    assert.equal(oo.unavailableAtBaseline, true);
    assert.equal(oo.delta, null);
    assert.equal(oo.pct, null);
    // non-unavailable ones are still computed
    const pv = deltas.find(d => d.slug === 'pipeline_value')!;
    assert.equal(pv.unavailableAtBaseline, false);
    assert.equal(pv.delta, 0);
  });

  it('baseline is null → all unavailableAtBaseline=true', () => {
    const current = [
      { slug: 'pipeline_value' as const, numeric: 50000 },
      { slug: 'lead_count'     as const, numeric: 25 },
    ];
    const deltas = computeDelta(null, current);
    assert.equal(deltas.length, 2);
    for (const d of deltas) {
      assert.equal(d.unavailableAtBaseline, true);
      assert.equal(d.delta, null);
      assert.equal(d.pct, null);
    }
  });

  it('baseline value is 0 → pct is null (division guard)', () => {
    const snapshot = makeSnapshot([
      { value: { numeric: 0, currency: 'USD', unit: 'cents' } },
    ]);
    const current = [{ slug: 'pipeline_value' as const, numeric: 10000 }];
    const deltas = computeDelta(snapshot, current);
    const pv = deltas.find(d => d.slug === 'pipeline_value')!;
    assert.equal(pv.unavailableAtBaseline, false);
    assert.equal(pv.baselineValue, 0);
    assert.equal(pv.delta, 10000);
    assert.equal(pv.pct, null);
  });

  it('current < baseline → negative delta and negative pct', () => {
    const snapshot = makeSnapshot();
    const current = [{ slug: 'lead_count' as const, numeric: 40 }];
    const deltas = computeDelta(snapshot, current);
    const lc = deltas.find(d => d.slug === 'lead_count')!;
    assert.equal(lc.delta, -10);
    assert.ok(lc.pct! < 0, `pct should be negative, got ${lc.pct}`);
    assert.ok(Math.abs(lc.pct! - (-20)) < 0.001);
  });
});

describe.skip('getBaselineForSubaccount (requires DATABASE_URL)', () => {
  it.todo('status=pending → null');
  it.todo('status=reset → null (excluded by IN filter)');
  it.todo('status=captured + 5 metric rows → snapshot with metrics.length === 5');
  it.todo('status=manual → snapshot returned');
});
