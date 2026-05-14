import { describe, it, expect } from 'vitest';
import { computeDeltaPct, computeInsights, centsToUsd } from '../spendInsightsServicePure.js';

describe('spendInsightsServicePure', () => {
  describe('computeDeltaPct', () => {
    it('prev 0 → null (no infinite growth)', () => expect(computeDeltaPct(100, 0)).toBeNull());
    it('prev null → null', () => expect(computeDeltaPct(100, null)).toBeNull());
    it('prev 100, current 150 → +50', () => expect(computeDeltaPct(150, 100)).toBe(50));
    it('prev 100, current 50 → -50 (decline allowed)', () => expect(computeDeltaPct(50, 100)).toBe(-50));
  });

  describe('computeInsights', () => {
    it('empty inputs → all-null output', () => {
      expect(computeInsights([], [])).toEqual({ topSpender: null, fastestGrower: null, mostActiveAgent: null });
    });
    it('topSpender returns null deltaPct when previous month was zero', () => {
      const out = computeInsights(
        [{ workspaceId: 'a', workspaceName: 'A', mtdCents: 5000, prevMonthCents: 0 }], [],
      );
      expect(out.topSpender?.deltaPct).toBeNull();
    });
    it('topSpender pctOfOrgTotal = mtd/sum*100', () => {
      const out = computeInsights([
        { workspaceId: 'a', workspaceName: 'A', mtdCents: 6000, prevMonthCents: null },
        { workspaceId: 'b', workspaceName: 'B', mtdCents: 4000, prevMonthCents: null },
      ], []);
      expect(out.topSpender?.pctOfOrgTotal).toBe(60);
    });
    it('fastestGrower picks max deltaPct, skipping null deltas', () => {
      const out = computeInsights([
        { workspaceId: 'a', workspaceName: 'A', mtdCents: 200, prevMonthCents: 100 }, // +100%
        { workspaceId: 'b', workspaceName: 'B', mtdCents: 300, prevMonthCents: 0 },   // null
        { workspaceId: 'c', workspaceName: 'C', mtdCents: 150, prevMonthCents: 100 }, // +50%
      ], []);
      expect(out.fastestGrower?.workspace.id).toBe('a');
    });
    it('fastestGrower null when no workspace has comparable prevMonth', () => {
      const out = computeInsights(
        [{ workspaceId: 'a', workspaceName: 'A', mtdCents: 200, prevMonthCents: 0 }], [],
      );
      expect(out.fastestGrower).toBeNull();
    });
    it('mostActiveAgent ranks by runs30d (INVARIANT I6 tiebreaker)', () => {
      const out = computeInsights([], [
        { agentId: 'a', agentName: 'A', workspaceId: 'w', workspaceName: 'W', runs30d: 5 },
        { agentId: 'b', agentName: 'B', workspaceId: 'w', workspaceName: 'W', runs30d: 12 },
      ]);
      expect(out.mostActiveAgent?.agent.id).toBe('b');
    });
  });

  describe('centsToUsd', () => {
    it('12345 → 123.45', () => expect(centsToUsd(12345)).toBe(123.45));
  });
});
