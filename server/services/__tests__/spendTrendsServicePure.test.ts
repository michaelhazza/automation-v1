import { describe, it, expect } from 'vitest';
import {
  classifyCapUsage, firstBlownIndex,
  projectIndividual, projectOther, buildTrends,
} from '../spendTrendsServicePure.js';

const mk = (id: string, mtd: number, spend: number[] = [0,0,0,0,0,mtd], cap: Array<number|null> = [null,null,null,null,null,null]): import('../spendTrendsServicePure.js').WorkspaceTrendInput =>
  ({ workspaceId: id, workspaceName: id, spend6moCents: spend, cap6moCents: cap, currentMtdCents: mtd });

describe('spendTrendsServicePure', () => {
  describe('classifyCapUsage', () => {
    it('50 spend / 100 cap → 50%', () => expect(classifyCapUsage(50, 100)).toBe(50));
    it('150 spend / 100 cap → 150% (over)', () => expect(classifyCapUsage(150, 100)).toBe(150));
    it('cap 0 → null (unbounded)', () => expect(classifyCapUsage(100, 0)).toBeNull());
    it('cap null → null', () => expect(classifyCapUsage(100, null)).toBeNull());
  });

  describe('firstBlownIndex', () => {
    it('returns null when no month is blown', () => expect(firstBlownIndex([50, 80, null])).toBeNull());
    it('returns 0 when first month is blown', () => expect(firstBlownIndex([150, 50])).toBe(0));
    it('null months are NOT counted as blown', () => expect(firstBlownIndex([null, null, 50, 150])).toBe(3));
  });

  describe('buildTrends', () => {
    it('≤5 workspaces → no Other entry', () => {
      const ws = [mk('a', 100), mk('b', 80), mk('c', 60)];
      const out = buildTrends(ws, ['Jan','Feb','Mar','Apr','May','Jun']);
      expect(out.workspaces.length).toBe(3);
      expect(out.workspaces.find(w => w.id === '__other__')).toBeUndefined();
    });
    it('>5 workspaces → top-4 + synthetic Other at index 4', () => {
      const ws = [mk('a',600),mk('b',500),mk('c',400),mk('d',300),mk('e',200),mk('f',100)];
      const out = buildTrends(ws, ['Jan','Feb','Mar','Apr','May','Jun']);
      expect(out.workspaces.length).toBe(5);
      expect(out.workspaces[4].id).toBe('__other__');
    });
    it('sorted by currentMtdCents desc (top spender first)', () => {
      const ws = [mk('b', 50), mk('a', 100)];
      const out = buildTrends(ws, ['Jan','Feb','Mar','Apr','May','Jun']);
      expect(out.workspaces[0].id).toBe('a');
    });
    it('Other rollup sums spend of non-top-4', () => {
      const spend = [10,10,10,10,10,10];
      const ws = [mk('a',600),mk('b',500),mk('c',400),mk('d',300),mk('e',200,spend),mk('f',100,spend)];
      const out = buildTrends(ws, ['Jan','Feb','Mar','Apr','May','Jun']);
      expect(out.workspaces[4].spend6mo).toEqual([0.2,0.2,0.2,0.2,0.2,0.2]);
    });
    it('zero-cap contributors add 0 to summed cap (capUsage[i] null when summedCap=0)', () => {
      const ws = [mk('a',600),mk('b',500),mk('c',400),mk('d',300),
        mk('e',200,[50,50,50,50,50,50],[null,null,null,null,null,null]),
        mk('f',100,[50,50,50,50,50,50],[null,null,null,null,null,null])];
      const out = buildTrends(ws, ['Jan','Feb','Mar','Apr','May','Jun']);
      expect(out.workspaces[4].capUsage6mo).toEqual([null,null,null,null,null,null]);
    });
  });
});
