import { describe, it, expect } from 'vitest';
import { aggregateBlockReasons } from '../TopBlockReasonsAggregationPure.js';
import type { ChargeForAggregation } from '../TopBlockReasonsAggregationPure.js';

const REF = new Date('2026-01-10T12:00:00Z');

function makeCharge(overrides: Partial<ChargeForAggregation>): ChargeForAggregation {
  return {
    status: 'blocked',
    failureReason: 'allowlist_miss',
    createdAt: '2026-01-09T10:00:00Z',
    ...overrides,
  };
}

describe('aggregateBlockReasons', () => {
  it('counts blocked and denied charges by failure reason', () => {
    const rows: ChargeForAggregation[] = [
      makeCharge({ failureReason: 'allowlist_miss' }),
      makeCharge({ failureReason: 'allowlist_miss' }),
      makeCharge({ status: 'denied', failureReason: 'per_txn_limit' }),
    ];
    const result = aggregateBlockReasons(rows, 7, REF);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ reason: 'allowlist_miss', count: 2 });
    expect(result[1]).toEqual({ reason: 'per_txn_limit', count: 1 });
  });

  it('excludes non-blocked/denied statuses', () => {
    const rows: ChargeForAggregation[] = [
      makeCharge({ status: 'settled', failureReason: 'allowlist_miss' }),
      makeCharge({ status: 'shadow_settled', failureReason: 'allowlist_miss' }),
      makeCharge({ status: 'blocked', failureReason: 'allowlist_miss' }),
    ];
    const result = aggregateBlockReasons(rows, 7, REF);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(1);
  });

  it('excludes charges older than the window', () => {
    const rows: ChargeForAggregation[] = [
      makeCharge({ createdAt: '2026-01-02T00:00:00Z' }), // 8 days before REF, outside 7d window
      makeCharge({ createdAt: '2026-01-04T00:00:00Z' }), // 6 days before, inside
    ];
    const result = aggregateBlockReasons(rows, 7, REF);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(1);
  });

  it('uses "unknown" for null failureReason', () => {
    const rows: ChargeForAggregation[] = [
      makeCharge({ failureReason: null }),
    ];
    const result = aggregateBlockReasons(rows, 7, REF);
    expect(result[0].reason).toBe('unknown');
  });

  it('sorts by count desc then reason asc for tiebreaking', () => {
    const rows: ChargeForAggregation[] = [
      makeCharge({ failureReason: 'z_reason' }),
      makeCharge({ failureReason: 'a_reason' }),
      makeCharge({ failureReason: 'z_reason' }),
    ];
    const result = aggregateBlockReasons(rows, 7, REF);
    expect(result[0].reason).toBe('z_reason');
    expect(result[1].reason).toBe('a_reason');
  });

  it('returns empty array for empty input', () => {
    expect(aggregateBlockReasons([], 7, REF)).toEqual([]);
  });

  it('returns empty array when no blocked/denied rows', () => {
    const rows: ChargeForAggregation[] = [
      makeCharge({ status: 'settled' }),
    ];
    expect(aggregateBlockReasons(rows, 7, REF)).toEqual([]);
  });
});
