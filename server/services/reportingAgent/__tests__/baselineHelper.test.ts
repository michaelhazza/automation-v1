import { describe, it, expect } from 'vitest';
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
    expect(deltas.length).toBe(5);
    for (const d of deltas) {
      expect(d.unavailableAtBaseline).toBe(false);
    }
    const pv = deltas.find(d => d.slug === 'pipeline_value')!;
    expect(pv.delta).toBe(20000);
    expect(Math.abs(pv.pct! - 20) < 0.001).toBeTruthy();

    const lc = deltas.find(d => d.slug === 'lead_count')!;
    expect(lc.delta).toBe(10);
    expect(Math.abs(lc.pct! - 20) < 0.001).toBeTruthy();

    const ce = deltas.find(d => d.slug === 'conversation_engagement')!;
    expect(ce.delta).toBe(-20);
    expect(Math.abs(ce.pct! - (-10)) < 0.001).toBeTruthy();
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
    expect(lc.unavailableAtBaseline).toBe(true);
    expect(lc.delta).toBe(null);
    expect(lc.pct).toBe(null);
    const oo = deltas.find(d => d.slug === 'open_opportunity_count')!;
    expect(oo.unavailableAtBaseline).toBe(true);
    expect(oo.delta).toBe(null);
    expect(oo.pct).toBe(null);
    // non-unavailable ones are still computed
    const pv = deltas.find(d => d.slug === 'pipeline_value')!;
    expect(pv.unavailableAtBaseline).toBe(false);
    expect(pv.delta).toBe(0);
  });

  it('baseline is null → all unavailableAtBaseline=true', () => {
    const current = [
      { slug: 'pipeline_value' as const, numeric: 50000 },
      { slug: 'lead_count'     as const, numeric: 25 },
    ];
    const deltas = computeDelta(null, current);
    expect(deltas.length).toBe(2);
    for (const d of deltas) {
      expect(d.unavailableAtBaseline).toBe(true);
      expect(d.delta).toBe(null);
      expect(d.pct).toBe(null);
    }
  });

  it('baseline value is 0 → pct is null (division guard)', () => {
    const snapshot = makeSnapshot([
      { value: { numeric: 0, currency: 'USD', unit: 'cents' } },
    ]);
    const current = [{ slug: 'pipeline_value' as const, numeric: 10000 }];
    const deltas = computeDelta(snapshot, current);
    const pv = deltas.find(d => d.slug === 'pipeline_value')!;
    expect(pv.unavailableAtBaseline).toBe(false);
    expect(pv.baselineValue).toBe(0);
    expect(pv.delta).toBe(10000);
    expect(pv.pct).toBe(null);
  });

  it('current < baseline → negative delta and negative pct', () => {
    const snapshot = makeSnapshot();
    const current = [{ slug: 'lead_count' as const, numeric: 40 }];
    const deltas = computeDelta(snapshot, current);
    const lc = deltas.find(d => d.slug === 'lead_count')!;
    expect(lc.delta).toBe(-10);
    expect(lc.pct! < 0).toBeTruthy();
    expect(Math.abs(lc.pct! - (-20)) < 0.001).toBeTruthy();
  });
});

describe.skip('getBaselineForSubaccount (requires DATABASE_URL)', () => {
  it.todo('status=pending → null');
  it.todo('status=reset → null (excluded by IN filter)');
  it.todo('status=captured + 5 metric rows → snapshot with metrics.length === 5');
  it.todo('status=manual → snapshot returned');
});
