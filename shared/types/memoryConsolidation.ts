// Shared types for the memory tiered consolidation feature (spec §9.1–§9.4, §9.7, §14.7).
// Pure types and pure helpers only — no DB access, no side effects.

// RetrievalProfile is defined in server/lib/queryIntent.ts; redefined here
// because shared/types cannot import from server/. Must stay in sync with that source.
export type RetrievalProfile = 'temporal' | 'factual' | 'general' | 'exploratory' | 'relational';

export type ConsolidationTier = 'working' | 'episodic' | 'semantic' | 'procedural';

export type RetrievalProfileTierMultipliers = Record<ConsolidationTier, number>;

export interface PromotionSignals {
  reinforcementCount: number;
  crossSessionRecurrence: number;
  recency: number;
}

export type PromotionVerdict =
  | {
      shouldPromote: true;
      nextTier: ConsolidationTier;
      mode: 'auto' | 'operator-approved';
      signalContributions: PromotionSignals;
      totalScore: number;
      threshold: number;
      configVersion: number;
    }
  | {
      shouldPromote: false;
      reason: 'below_threshold' | 'already_top_tier' | 'invalid_source_tier';
    };

export interface MemoryConsolidationConfig {
  version: number;
  decayConfig: {
    strengthByTier: Record<ConsolidationTier, number>;
  };
  promotionConfig: {
    signalWeights: Record<keyof PromotionSignals, number>;
    thresholds: {
      workingToEpisodic: number;
      episodicToSemantic: number;
      episodicToProcedural: number;
      semanticToProcedural: number;
    };
  };
  tierMultipliersByProfile: Record<RetrievalProfile, RetrievalProfileTierMultipliers>;
}

export interface AuditCheckResult {
  checkName: string;
  status: 'pass' | 'warn' | 'fail' | 'n/a';
  findings: string[];
  evidence: unknown;
}

export interface MemoryConsolidationAuditResult {
  runAt: string;
  env: string;
  overallStatus: 'pass' | 'warn' | 'fail';
  checks: AuditCheckResult[];
}

export function isValidPromotionTransition(
  oldTier: ConsolidationTier,
  newTier: ConsolidationTier,
): boolean {
  switch (oldTier) {
    case 'working':
      return newTier === 'episodic';
    case 'episodic':
      return newTier === 'semantic' || newTier === 'procedural';
    case 'semantic':
      return newTier === 'procedural';
    case 'procedural':
      return false;
    default: {
      const _exhaustive: never = oldTier;
      void _exhaustive;
      return false;
    }
  }
}
