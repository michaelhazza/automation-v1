import { describe, it, expect } from 'vitest';
import { groupByIntent, flattenGroups } from '../RetryGroupingPure.js';
import type { ChargeRow } from '../RetryGroupingPure.js';

function makeRow(overrides: Partial<ChargeRow> & { id: string }): ChargeRow {
  return {
    intentId: null,
    createdAt: '2026-01-01T00:00:00Z',
    status: 'settled',
    amountMinor: 1000,
    currency: 'USD',
    merchantDescriptor: 'OPENAI',
    merchantId: null,
    mode: 'live',
    failureReason: null,
    ...overrides,
  };
}

describe('groupByIntent', () => {
  it('groups rows with the same intentId together', () => {
    const rows: ChargeRow[] = [
      makeRow({ id: 'a', intentId: 'i1', createdAt: '2026-01-01T10:00:00Z' }),
      makeRow({ id: 'b', intentId: 'i1', createdAt: '2026-01-01T09:00:00Z' }),
      makeRow({ id: 'c', intentId: 'i2', createdAt: '2026-01-01T08:00:00Z' }),
    ];
    const groups = groupByIntent(rows);
    expect(groups).toHaveLength(2);
    const g1 = groups.find(g => g.intentId === 'i1');
    expect(g1).toBeDefined();
    expect(g1!.attemptCount).toBe(2);
    expect(g1!.latest.id).toBe('a'); // most recent
  });

  it('rows without intentId become standalone groups', () => {
    const rows: ChargeRow[] = [
      makeRow({ id: 'x', intentId: null }),
      makeRow({ id: 'y', intentId: null }),
    ];
    const groups = groupByIntent(rows);
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(g.intentId).toBeNull();
      expect(g.attemptCount).toBe(1);
    }
  });

  it('sorts attempts most-recent first within a group', () => {
    const rows: ChargeRow[] = [
      makeRow({ id: 'old', intentId: 'i1', createdAt: '2026-01-01T08:00:00Z' }),
      makeRow({ id: 'new', intentId: 'i1', createdAt: '2026-01-01T10:00:00Z' }),
    ];
    const groups = groupByIntent(rows);
    expect(groups[0].attempts[0].id).toBe('new');
    expect(groups[0].attempts[1].id).toBe('old');
  });

  it('returns empty array for empty input', () => {
    expect(groupByIntent([])).toEqual([]);
  });

  it('sorts groups by latest attempt descending', () => {
    const rows: ChargeRow[] = [
      makeRow({ id: 'a', intentId: 'i1', createdAt: '2026-01-01T08:00:00Z' }),
      makeRow({ id: 'b', intentId: 'i2', createdAt: '2026-01-01T12:00:00Z' }),
    ];
    const groups = groupByIntent(rows);
    expect(groups[0].intentId).toBe('i2');
    expect(groups[1].intentId).toBe('i1');
  });
});

describe('flattenGroups', () => {
  it('produces a flat list sorted most-recent first', () => {
    const rows: ChargeRow[] = [
      makeRow({ id: 'a', intentId: 'i1', createdAt: '2026-01-01T10:00:00Z' }),
      makeRow({ id: 'b', intentId: 'i1', createdAt: '2026-01-01T09:00:00Z' }),
      makeRow({ id: 'c', intentId: 'i2', createdAt: '2026-01-01T11:00:00Z' }),
    ];
    const groups = groupByIntent(rows);
    const flat = flattenGroups(groups);
    expect(flat.map(r => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns empty for empty input', () => {
    expect(flattenGroups([])).toEqual([]);
  });
});
