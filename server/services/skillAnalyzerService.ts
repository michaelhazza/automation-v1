// Impure-shell barrel — re-exports the full public surface from sub-modules.
// All callers import from './skillAnalyzerService.js'.

// Status enums re-exported from Pure tree (existing callers expect these here)
export {
  SKILL_ANALYZER_JOB_STATUSES,
  SKILL_ANALYZER_MID_FLIGHT_STATUSES,
  SKILL_ANALYZER_TERMINAL_STATUSES,
  isSkillAnalyzerTerminalStatus,
  isSkillAnalyzerMidFlightStatus,
  type SkillAnalyzerJobStatus,
  type SkillAnalyzerMidFlightStatus,
  type SkillAnalyzerTerminalStatus,
} from './skillAnalyzerServicePure.js';

// Public types
export type {
  MatchedSkillContent,
  AvailableSystemAgent,
  EnrichedResult,
  GetJobResponse,
  ResolveWarningParams,
  UpdateAgentProposalParams,
  PatchMergeFieldsParams,
} from './skillAnalyzerService/types.js';

// Job lifecycle
import { createJob } from './skillAnalyzerService/jobLifecycle/create.js';
import { resumeJob } from './skillAnalyzerService/jobLifecycle/resume.js';
import { getJob, getJobById, listJobs } from './skillAnalyzerService/jobLifecycle/get.js';

// Per-result operations
import { setResultAction, bulkSetResultAction } from './skillAnalyzerService/results/setAction.js';
import { updateProposedAgent, updateAgentProposal, updateResultAgentProposals } from './skillAnalyzerService/results/updateProposal.js';
import { resolveWarning, appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic } from './skillAnalyzerService/results/warnings.js';
import { patchMergeFields, resetMergeToOriginal } from './skillAnalyzerService/results/merge.js';

// Execute
import { executeApproved } from './skillAnalyzerService/execute/approved.js';
import { retryClassification, bulkRetryFailedClassifications } from './skillAnalyzerService/execute/retry.js';
import { unlockStaleExecution } from './skillAnalyzerService/execute/unlock.js';

// Persistence + progress
import { insertResults, insertSingleResult, listResultIndicesForJob } from './skillAnalyzerService/persistence/results.js';
import { markSkillInFlight, unmarkSkillInFlight } from './skillAnalyzerService/persistence/inFlight.js';
import { updateJobProgress, updateJobAgentRecommendation } from './skillAnalyzerService/persistence/progress.js';

// Named re-exports (for callers that import named functions directly)
export {
  createJob, resumeJob, getJob, listJobs,
  setResultAction, bulkSetResultAction,
  updateProposedAgent, updateAgentProposal,
  patchMergeFields, resetMergeToOriginal,
  resolveWarning,
  executeApproved, unlockStaleExecution,
  updateJobProgress,
  retryClassification, bulkRetryFailedClassifications,
  getJobById, insertResults, insertSingleResult, listResultIndicesForJob,
  markSkillInFlight, unmarkSkillInFlight,
  updateResultAgentProposals, updateJobAgentRecommendation,
  appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic,
};

// Aggregate object — locked at 26 keys per spec §4.2
export const skillAnalyzerService = {
  createJob, resumeJob, getJob, listJobs,
  setResultAction, bulkSetResultAction,
  updateAgentProposal, updateProposedAgent,
  patchMergeFields, resetMergeToOriginal,
  resolveWarning,
  executeApproved, unlockStaleExecution,
  updateJobProgress,
  retryClassification, bulkRetryFailedClassifications,
  getJobById, insertResults, insertSingleResult, listResultIndicesForJob,
  markSkillInFlight, unmarkSkillInFlight,
  updateResultAgentProposals, updateJobAgentRecommendation,
  appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic,
};
