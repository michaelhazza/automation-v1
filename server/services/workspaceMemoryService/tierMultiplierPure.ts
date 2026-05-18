import type { ConsolidationTier, MemoryConsolidationConfig } from '../../../shared/types/memoryConsolidation.js';

export function applyTierMultiplier(
  tier: ConsolidationTier,
  profileName: string,
  config: MemoryConsolidationConfig,
): number {
  return config.tierMultipliersByProfile[profileName as keyof typeof config.tierMultipliersByProfile]?.[tier] ?? 1.0;
}
