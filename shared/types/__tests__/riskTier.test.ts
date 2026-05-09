import { describe, it, expect } from 'vitest';
import { RISK_TIERS, deriveGateLevel } from '../riskTier.js';
import type { RiskTier, GateLevel } from '../riskTier.js';

describe('riskTier', () => {
  describe('RISK_TIERS const', () => {
    it('contains exactly tiers 0-6', () => {
      expect(RISK_TIERS).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('has length 7', () => {
      expect(RISK_TIERS.length).toBe(7);
    });
  });

  describe('deriveGateLevel — tier defaults (no preserved, no override)', () => {
    it('tier 0 -> auto', () => {
      const result = deriveGateLevel(0);
      expect(result.gateLevel).toBe('auto');
      expect(result.source).toBe('tier_default');
    });

    it('tier 1 -> auto', () => {
      const result = deriveGateLevel(1);
      expect(result.gateLevel).toBe('auto');
      expect(result.source).toBe('tier_default');
    });

    it('tier 2 -> auto', () => {
      const result = deriveGateLevel(2);
      expect(result.gateLevel).toBe('auto');
      expect(result.source).toBe('tier_default');
    });

    it('tier 3 -> review', () => {
      const result = deriveGateLevel(3);
      expect(result.gateLevel).toBe('review');
      expect(result.source).toBe('tier_default');
    });

    it('tier 4 -> review', () => {
      const result = deriveGateLevel(4);
      expect(result.gateLevel).toBe('review');
      expect(result.source).toBe('tier_default');
    });

    it('tier 5 -> block', () => {
      const result = deriveGateLevel(5);
      expect(result.gateLevel).toBe('block');
      expect(result.source).toBe('tier_default');
    });

    it('tier 6 -> block', () => {
      const result = deriveGateLevel(6);
      expect(result.gateLevel).toBe('block');
      expect(result.source).toBe('tier_default');
    });
  });

  describe('deriveGateLevel — preserved_existing wins over tier default (INV-8)', () => {
    const tiers: RiskTier[] = [0, 1, 2, 3, 4, 5, 6];
    const preservedValues: GateLevel[] = ['auto', 'review', 'block'];

    for (const tier of tiers) {
      for (const preserved of preservedValues) {
        it(`tier ${tier} + preserved ${preserved} -> source preserved_existing`, () => {
          const result = deriveGateLevel(tier, preserved);
          expect(result.gateLevel).toBe(preserved);
          expect(result.source).toBe('preserved_existing');
        });
      }
    }
  });

  describe('deriveGateLevel — policy_override wins over everything', () => {
    const tiers: RiskTier[] = [0, 1, 2, 3, 4, 5, 6];
    const overrideValues: GateLevel[] = ['auto', 'review', 'block'];

    for (const tier of tiers) {
      for (const override of overrideValues) {
        it(`tier ${tier} + override ${override} -> source policy_override`, () => {
          const result = deriveGateLevel(tier, undefined, override);
          expect(result.gateLevel).toBe(override);
          expect(result.source).toBe('policy_override');
        });
      }
    }

    it('override beats preserved when both are provided', () => {
      const result = deriveGateLevel(3, 'auto', 'block');
      expect(result.gateLevel).toBe('block');
      expect(result.source).toBe('policy_override');
    });

    it('override auto beats preserved block', () => {
      const result = deriveGateLevel(6, 'block', 'auto');
      expect(result.gateLevel).toBe('auto');
      expect(result.source).toBe('policy_override');
    });
  });
});
