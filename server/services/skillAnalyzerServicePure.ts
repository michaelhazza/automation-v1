// Pure-service barrel — re-exports the full public surface from sub-modules.
// All callers continue to import from './skillAnalyzerServicePure.js'.

export * from './skillAnalyzerServicePure/statuses.js';
export * from './skillAnalyzerServicePure/similarity.js';
export * from './skillAnalyzerServicePure/serialisation.js';
export * from './skillAnalyzerServicePure/classification/prompts.js';
export * from './skillAnalyzerServicePure/classification/parse.js';
export * from './skillAnalyzerServicePure/classification/failureReason.js';
export * from './skillAnalyzerServicePure/crossRef.js';
export * from './skillAnalyzerServicePure/mergeWarnings/types.js';
export * from './skillAnalyzerServicePure/mergeWarnings/defaults.js';
export * from './skillAnalyzerServicePure/mergeWarnings/sort.js';
export * from './skillAnalyzerServicePure/mergeWarnings/resolutions.js';
export * from './skillAnalyzerServicePure/mergeWarnings/approval.js';
export * from './skillAnalyzerServicePure/concurrency.js';
export * from './skillAnalyzerServicePure/validation.js';
export * from './skillAnalyzerServicePure/ruleBasedMerge.js';
export * from './skillAnalyzerServicePure/textExtraction.js';
export * from './skillAnalyzerServicePure/collisions.js';
export * from './skillAnalyzerServicePure/agentRanking.js';
export * from './skillAnalyzerServicePure/consolidation.js';
export * from './skillAnalyzerServicePure/diff.js';

import { cosineSimilarity, classifyBand, computeBestMatches } from './skillAnalyzerServicePure/similarity.js';
import { deriveClassificationFailureReason } from './skillAnalyzerServicePure/classification/failureReason.js';
import { buildClassificationPrompt, buildClassifyPromptWithMerge } from './skillAnalyzerServicePure/classification/prompts.js';
import { parseClassificationResponse, parseClassificationResponseWithMerge } from './skillAnalyzerServicePure/classification/parse.js';
import { generateDiffSummary } from './skillAnalyzerServicePure/diff.js';
import { rankAgentsForCandidate, deriveDiffRows, detectNonSkillFile, buildAgentSuggestionPrompt, parseAgentSuggestionResponse, buildAgentClusterRecommendationPrompt, parseAgentClusterRecommendationResponse, AGENT_RECOMMENDATION_THRESHOLD, AGENT_RECOMMENDATION_MIN_SKILLS } from './skillAnalyzerServicePure/agentRanking.js';
import { crossReferencesLibrarySkill } from './skillAnalyzerServicePure/crossRef.js';
import { rationaleArguesAgainstMerge } from './skillAnalyzerServicePure/ruleBasedMerge.js';
import { classifyDemotedFields, parseDemotedFieldStatuses, adjustClassifierConfidence } from './skillAnalyzerServicePure/mergeWarnings/approval.js';
import { extractPreservationInventory, buildConsolidationPrompt, parseConsolidationResponse, computeConsolidationViolations } from './skillAnalyzerServicePure/consolidation.js';

export const skillAnalyzerServicePure = {
  cosineSimilarity,
  classifyBand,
  computeBestMatches,
  buildClassificationPrompt,
  parseClassificationResponse,
  buildClassifyPromptWithMerge,
  parseClassificationResponseWithMerge,
  generateDiffSummary,
  rankAgentsForCandidate,
  deriveDiffRows,
  deriveClassificationFailureReason,
  detectNonSkillFile,
  buildAgentSuggestionPrompt,
  parseAgentSuggestionResponse,
  buildAgentClusterRecommendationPrompt,
  parseAgentClusterRecommendationResponse,
  crossReferencesLibrarySkill,
  rationaleArguesAgainstMerge,
  classifyDemotedFields,
  parseDemotedFieldStatuses,
  adjustClassifierConfidence,
  AGENT_RECOMMENDATION_THRESHOLD,
  AGENT_RECOMMENDATION_MIN_SKILLS,
  extractPreservationInventory,
  buildConsolidationPrompt,
  parseConsolidationResponse,
  computeConsolidationViolations,
};
