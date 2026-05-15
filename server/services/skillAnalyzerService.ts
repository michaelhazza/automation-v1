import { createJob } from './skillAnalyzerService/jobLifecycle/create.js';
import { resumeJob, RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS } from './skillAnalyzerService/jobLifecycle/resume.js';
import { getJob, getJobById, listJobs } from './skillAnalyzerService/jobLifecycle/get.js';
import { setResultAction, bulkSetResultAction } from './skillAnalyzerService/results/setAction.js';
import { updateProposedAgent, updateAgentProposal, updateResultAgentProposals } from './skillAnalyzerService/results/updateProposal.js';
import { resolveWarning, appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic } from './skillAnalyzerService/results/warnings.js';
import { patchMergeFields, resetMergeToOriginal } from './skillAnalyzerService/results/merge.js';
import { executeApproved } from './skillAnalyzerService/execute/approved.js';
import { retryClassification, bulkRetryFailedClassifications } from './skillAnalyzerService/execute/retry.js';
import { unlockStaleExecution } from './skillAnalyzerService/execute/unlock.js';
import { insertResults, insertSingleResult, listResultIndicesForJob } from './skillAnalyzerService/persistence/results.js';
import { markSkillInFlight, unmarkSkillInFlight } from './skillAnalyzerService/persistence/inFlight.js';
import { updateJobProgress, updateJobAgentRecommendation } from './skillAnalyzerService/persistence/progress.js';

// ---------------------------------------------------------------------------
// Skill Analyzer Service — CRUD for jobs/results + pipeline orchestration
// ---------------------------------------------------------------------------

// Status union is defined once in skillAnalyzerServicePure.ts alongside the
// mid-flight and terminal subsets. Re-export here so existing callers keep
// their import path.
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

export { createJob };
export { resumeJob, RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS };
export { getJob, getJobById, listJobs };

export type { MatchedSkillContent, AvailableSystemAgent, EnrichedResult, GetJobResponse, ResolveWarningParams, UpdateAgentProposalParams, PatchMergeFieldsParams } from './skillAnalyzerService/types.js';

export { setResultAction, bulkSetResultAction };
export { updateProposedAgent, updateAgentProposal, updateResultAgentProposals };
export { resolveWarning, appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic };
export { patchMergeFields, resetMergeToOriginal };

export { executeApproved } from './skillAnalyzerService/execute/approved.js';
export { retryClassification, bulkRetryFailedClassifications } from './skillAnalyzerService/execute/retry.js';
export { unlockStaleExecution } from './skillAnalyzerService/execute/unlock.js';

export { insertResults, insertSingleResult, listResultIndicesForJob } from './skillAnalyzerService/persistence/results.js';
export { markSkillInFlight, unmarkSkillInFlight } from './skillAnalyzerService/persistence/inFlight.js';
export { updateJobProgress, updateJobAgentRecommendation } from './skillAnalyzerService/persistence/progress.js';

export const skillAnalyzerService = {
  createJob,
  resumeJob,
  getJob,
  listJobs,
  setResultAction,
  bulkSetResultAction,
  updateAgentProposal,
  updateProposedAgent,
  patchMergeFields,
  resetMergeToOriginal,
  resolveWarning,
  executeApproved,
  unlockStaleExecution,
  updateJobProgress,
  retryClassification,
  bulkRetryFailedClassifications,
  // Internal — used by job handler only
  getJobById,
  insertResults,
  insertSingleResult,
  listResultIndicesForJob,
  markSkillInFlight,
  unmarkSkillInFlight,
  updateResultAgentProposals,
  updateJobAgentRecommendation,
  appendBatchCollisionWarnings,
  applyBatchDeductionAndWarningAtomic,
};
