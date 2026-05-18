import type { MemoryConsolidationConfig } from '../../shared/types/memoryConsolidation.js';

export const MEMORY_CONSOLIDATION_CONFIG_HISTORY: MemoryConsolidationConfig[] = [
  {
    version: 1,
    decayConfig: {
      strengthByTier: {
        working:    3,
        episodic:   14,
        semantic:   90,
        procedural: 999999,
      },
    },
    promotionConfig: {
      signalWeights: {
        reinforcementCount:     0.5,
        crossSessionRecurrence: 0.3,
        recency:                0.2,
      },
      thresholds: {
        workingToEpisodic:     3.0,
        episodicToSemantic:    8.0,
        episodicToProcedural: 15.0,
        semanticToProcedural: 15.0,
      },
    },
    tierMultipliersByProfile: {
      temporal:    { working: 1.3, episodic: 1.1, semantic: 0.9, procedural: 0.8 },
      factual:     { working: 0.9, episodic: 1.0, semantic: 1.3, procedural: 1.2 },
      general:     { working: 1.0, episodic: 1.0, semantic: 1.0, procedural: 1.0 },
      exploratory: { working: 1.2, episodic: 1.1, semantic: 0.9, procedural: 0.9 },
      relational:  { working: 1.0, episodic: 1.1, semantic: 1.2, procedural: 1.3 },
    },
  },
];

export const ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION: number = 1;

export function getActiveMemoryConsolidationConfig(): MemoryConsolidationConfig {
  const config = MEMORY_CONSOLIDATION_CONFIG_HISTORY.find(
    c => c.version === ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION
  );
  if (!config) throw new Error(
    `Active memory consolidation config version ${ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION} not found in history`
  );
  return config;
}
