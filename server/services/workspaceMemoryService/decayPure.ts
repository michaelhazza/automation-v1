import type { ConsolidationTier, MemoryConsolidationConfig } from '../../../shared/types/memoryConsolidation.js';

export function computeDecayWeight(
  tier: ConsolidationTier,
  lastAccessedAt: Date | null,
  now: Date,
  decayConfig: MemoryConsolidationConfig['decayConfig'],
): number {
  if (tier === 'procedural') {
    return 1.0;
  }
  if (lastAccessedAt === null) {
    return 1.0;
  }
  const t = (now.getTime() - lastAccessedAt.getTime()) / 86400000;
  if (t < 0) {
    return 1.0;
  }
  const S = decayConfig.strengthByTier[tier] ?? 1.0;
  return Math.exp(-t / S);
}
