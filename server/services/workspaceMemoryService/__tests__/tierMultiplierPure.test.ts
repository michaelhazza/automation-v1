import { describe, it, expect } from 'vitest';
import { applyTierMultiplier } from '../tierMultiplierPure.js';
import { MEMORY_CONSOLIDATION_CONFIG_HISTORY } from '../../../config/memoryConsolidationConfig.js';
import type { ConsolidationTier } from '../../../../shared/types/memoryConsolidation.js';

const config = MEMORY_CONSOLIDATION_CONFIG_HISTORY[0]!;

describe('applyTierMultiplier', () => {
  const profiles = ['temporal', 'factual', 'general', 'exploratory', 'relational'] as const;
  const tiers: ConsolidationTier[] = ['working', 'episodic', 'semantic', 'procedural'];

  for (const profile of profiles) {
    for (const tier of tiers) {
      it(`${profile} x ${tier} returns locked v1 value`, () => {
        const expected = config.tierMultipliersByProfile[profile][tier];
        expect(applyTierMultiplier(tier, profile, config)).toBe(expected);
      });
    }
  }

  it('unknown profile returns 1.0', () => {
    expect(applyTierMultiplier('working', 'unknown_profile', config)).toBe(1.0);
  });

  it('unknown tier (cast as any) returns 1.0', () => {
    expect(applyTierMultiplier('unknown_tier' as ConsolidationTier, 'temporal', config)).toBe(1.0);
  });
});
