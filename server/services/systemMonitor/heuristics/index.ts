// ---------------------------------------------------------------------------
// Heuristic registry — public API.
// ---------------------------------------------------------------------------

import type { Heuristic } from './types.js';
import { parseHeuristicPhases, matchesPhase } from './phaseFilter.js';

// Agent quality
import { emptyOutputBaselineAware } from './agentQuality/emptyOutputBaselineAware.js';
import { maxTurnsHit } from './agentQuality/maxTurnsHit.js';
import { toolSuccessButFailureLanguage } from './agentQuality/toolSuccessButFailureLanguage.js';
import { runtimeAnomaly } from './agentQuality/runtimeAnomaly.js';
import { tokenAnomaly } from './agentQuality/tokenAnomaly.js';
import { repeatedSkillInvocation } from './agentQuality/repeatedSkillInvocation.js';
import { finalMessageNotAssistant } from './agentQuality/finalMessageNotAssistant.js';
import { outputTruncation } from './agentQuality/outputTruncation.js';
import { identicalOutputDifferentInputs } from './agentQuality/identicalOutputDifferentInputs.js';

// Skill execution
import { toolOutputSchemaMismatch } from './skillExecution/toolOutputSchemaMismatch.js';
import { skillLatencyAnomaly } from './skillExecution/skillLatencyAnomaly.js';
import { toolFailedButAgentClaimedSuccess } from './skillExecution/toolFailedButAgentClaimedSuccess.js';

// Infrastructure (day-one)
import { jobCompletedNoSideEffect } from './infrastructure/jobCompletedNoSideEffect.js';
import { connectorEmptyResponseRepeated } from './infrastructure/connectorEmptyResponseRepeated.js';

// Infrastructure (Phase 2.5)
import { cacheHitRateDegradation } from './infrastructure/cacheHitRateDegradation.js';
import { latencyCreep } from './infrastructure/latencyCreep.js';
import { retryRateIncrease } from './infrastructure/retryRateIncrease.js';
import { authRefreshSpike } from './infrastructure/authRefreshSpike.js';
import { llmFallbackUnexpected } from './infrastructure/llmFallbackUnexpected.js';

// Systemic (Phase 2.5)
import { successRateDegradationTrend } from './systemic/successRateDegradationTrend.js';
import { outputEntropyCollapse } from './systemic/outputEntropyCollapse.js';
import { toolSelectionDrift } from './systemic/toolSelectionDrift.js';
import { costPerOutcomeIncreasing } from './systemic/costPerOutcomeIncreasing.js';

export type { Heuristic };
export type { HeuristicContext, HeuristicResult, Candidate, Evidence, EvidenceItem, Baseline, BaselineReader, Severity, EntityKind, BaselineEntityKind, BaselineRequirement, SuppressionRule } from './types.js';

/** All 23 heuristics: 14 day-one (Phase 2.0) + 9 Phase 2.5. */
export const HEURISTICS: Heuristic[] = [
  // Agent quality (9)
  emptyOutputBaselineAware,
  maxTurnsHit,
  toolSuccessButFailureLanguage,
  runtimeAnomaly,
  tokenAnomaly,
  repeatedSkillInvocation,
  finalMessageNotAssistant,
  outputTruncation,
  identicalOutputDifferentInputs,
  // Skill execution (3)
  toolOutputSchemaMismatch,
  skillLatencyAnomaly,
  toolFailedButAgentClaimedSuccess,
  // Infrastructure day-one (2)
  jobCompletedNoSideEffect,
  connectorEmptyResponseRepeated,
  // Infrastructure Phase 2.5 (5)
  cacheHitRateDegradation,
  latencyCreep,
  retryRateIncrease,
  authRefreshSpike,
  llmFallbackUnexpected,
  // Systemic Phase 2.5 (4)
  successRateDegradationTrend,
  outputEntropyCollapse,
  toolSelectionDrift,
  costPerOutcomeIncreasing,
];

/**
 * Returns all heuristics whose phase matches SYSTEM_MONITOR_HEURISTIC_PHASES.
 * Default: both '2.0' and '2.5' are active.
 */
export function getEligibleHeuristics(): Heuristic[] {
  const phases = parseHeuristicPhases(process.env.SYSTEM_MONITOR_HEURISTIC_PHASES);
  return HEURISTICS.filter(h => matchesPhase(h, phases));
}

/** Alias for getEligibleHeuristics — use either name. */
export const getActiveHeuristics = getEligibleHeuristics;
