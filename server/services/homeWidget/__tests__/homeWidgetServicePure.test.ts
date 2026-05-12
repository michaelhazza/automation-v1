import { describe, it, expect } from 'vitest';
import { orderAgents, shouldRefetch } from '../homeWidgetServicePure.js';
import type { AgentForWidget, ShouldRefetchArgs } from '../homeWidgetServicePure.js';

// ---------------------------------------------------------------------------
// orderAgents
// ---------------------------------------------------------------------------

describe('orderAgents', () => {
  it('sorts by createdAt ascending', () => {
    const agents: AgentForWidget[] = [
      { id: 'b', name: 'B', createdAt: new Date('2026-01-02T00:00:00Z') },
      { id: 'a', name: 'A', createdAt: new Date('2026-01-01T00:00:00Z') },
    ];
    const result = orderAgents(agents);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('uses UUID tiebreaker when createdAt is equal', () => {
    const ts = new Date('2026-01-01T00:00:00Z');
    const agents: AgentForWidget[] = [
      { id: 'z-agent', name: 'Z', createdAt: ts },
      { id: 'a-agent', name: 'A', createdAt: ts },
    ];
    const result = orderAgents(agents);
    expect(result[0].id).toBe('a-agent');
    expect(result[1].id).toBe('z-agent');
  });

  it('does not mutate the input array', () => {
    const agents: AgentForWidget[] = [
      { id: 'b', name: 'B', createdAt: new Date('2026-01-02T00:00:00Z') },
      { id: 'a', name: 'A', createdAt: new Date('2026-01-01T00:00:00Z') },
    ];
    const original = [...agents];
    orderAgents(agents);
    expect(agents[0].id).toBe(original[0].id);
    expect(agents[1].id).toBe(original[1].id);
  });

  it('handles empty array', () => {
    expect(orderAgents([])).toEqual([]);
  });

  it('handles single agent', () => {
    const agents: AgentForWidget[] = [{ id: 'x', name: 'X', createdAt: new Date() }];
    expect(orderAgents(agents)).toHaveLength(1);
  });

  it('sorts multiple agents with mixed timestamps correctly', () => {
    const agents: AgentForWidget[] = [
      { id: 'c', name: 'C', createdAt: new Date('2026-03-01T00:00:00Z') },
      { id: 'a', name: 'A', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'b', name: 'B', createdAt: new Date('2026-02-01T00:00:00Z') },
    ];
    const result = orderAgents(agents);
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// shouldRefetch
// ---------------------------------------------------------------------------

describe('shouldRefetch', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  describe('on_demand policy', () => {
    it('always returns false regardless of lastFetchedAt', () => {
      const args: ShouldRefetchArgs = { refreshPolicy: 'on_demand', lastFetchedAt: null, now };
      expect(shouldRefetch(args)).toBe(false);
    });

    it('returns false even when lastFetchedAt is set', () => {
      const args: ShouldRefetchArgs = {
        refreshPolicy: 'on_demand',
        lastFetchedAt: new Date('2026-01-01T11:00:00Z'),
        now,
      };
      expect(shouldRefetch(args)).toBe(false);
    });
  });

  describe('on_login policy', () => {
    it('returns true when lastFetchedAt is null', () => {
      const args: ShouldRefetchArgs = { refreshPolicy: 'on_login', lastFetchedAt: null, now };
      expect(shouldRefetch(args)).toBe(true);
    });

    it('returns false when lastFetchedAt is set', () => {
      const args: ShouldRefetchArgs = {
        refreshPolicy: 'on_login',
        lastFetchedAt: new Date('2026-01-01T11:00:00Z'),
        now,
      };
      expect(shouldRefetch(args)).toBe(false);
    });
  });

  describe('every_5m policy', () => {
    it('returns true when lastFetchedAt is null', () => {
      const args: ShouldRefetchArgs = { refreshPolicy: 'every_5m', lastFetchedAt: null, now };
      expect(shouldRefetch(args)).toBe(true);
    });

    it('returns true when more than 5 minutes have elapsed', () => {
      const args: ShouldRefetchArgs = {
        refreshPolicy: 'every_5m',
        lastFetchedAt: new Date(now.getTime() - 6 * 60 * 1000),
        now,
      };
      expect(shouldRefetch(args)).toBe(true);
    });

    it('returns false when exactly 5 minutes have elapsed (boundary: not strictly greater)', () => {
      const args: ShouldRefetchArgs = {
        refreshPolicy: 'every_5m',
        lastFetchedAt: new Date(now.getTime() - 5 * 60 * 1000),
        now,
      };
      expect(shouldRefetch(args)).toBe(false);
    });

    it('returns false when less than 5 minutes have elapsed', () => {
      const args: ShouldRefetchArgs = {
        refreshPolicy: 'every_5m',
        lastFetchedAt: new Date(now.getTime() - 4 * 60 * 1000),
        now,
      };
      expect(shouldRefetch(args)).toBe(false);
    });
  });
});
