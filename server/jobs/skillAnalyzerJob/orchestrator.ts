import { getJobById } from '../../services/skillAnalyzerService.js';
import {
  type ValidationThresholds,
} from '../../services/skillAnalyzerServicePure.js';
import { effectiveTierMap } from '../../services/skillAnalyzerConfigService.js';
import type { SkillAnalyzerConfig } from '../../db/schema/skillAnalyzerConfig.js';
import { runStage1 } from './stage1Parse.js';
import { runStage2 } from './stage2Hash.js';
import { runStage3 } from './stage3Embed.js';
import { runStage4 } from './stage4Compare.js';
import { runStage4b } from './stage4bNonSkillDetect.js';
import { JobAlreadyFailedAbort, type JobContext } from './types.js';
import { runStage5 } from './stage5Classify.js';
import { runStage5b } from './stage5bCrossBatchCollision.js';
import { runStage5c } from './stage5cSourceFork.js';
import { runStage6 } from './stage6AgentEmbed.js';
import { runStage7 } from './stage7AgentPropose.js';
import { runStage8 } from './stage8WriteResults.js';
import { runStage7b } from './stage7bAgentSuggest.js';
import { runStage8b } from './stage8bClusterRecommend.js';

/** Process a skill analyzer job through all pipeline stages. */
export async function processSkillAnalyzerJob(jobId: string): Promise<void> {
  // Load job via service (no direct DB access in jobs)
  const job = await getJobById(jobId);
  if (!job) {
    console.error(`[SkillAnalyzerJob] Job ${jobId} not found`);
    return;
  }

  // v2 §11.11.4: all pipeline thresholds come from the job's config_snapshot,
  // not the live table. Stale snapshots on pre-0155 jobs fall back to the
  // hardcoded defaults inside validateMergeOutput / effectiveTierMap.
  const configSnapshot = (job.configSnapshot ?? null) as SkillAnalyzerConfig | null;
  const validationThresholds: ValidationThresholds = {
    scopeExpansionStandardPct: configSnapshot?.scopeExpansionStandardThreshold,
    scopeExpansionCriticalPct: configSnapshot?.scopeExpansionCriticalThreshold,
    tierMap: effectiveTierMap(configSnapshot),
  };

  // Note: we do NOT clear skill_analyzer_results here. On pg-boss retry
  // (e.g. worker died mid-classification) Stage 5 reads existing rows and
  // skips their LLM calls — wiping would force every completed slug to be
  // re-classified, doubling LLM spend on each restart.

  let ctx: JobContext = {
    job,
    configSnapshot,
    candidates: [],
    libraryById: new Map(),
    libraryByName: new Map(),
    librarySkills: [],
    remainingCandidates: [],
    embeddingByContent: new Map(),
    resultRows: [],
    validationThresholds,
    classifiedDistinct: [],
    bestMatches: [],
    distinctResults: [],
    llmQueue: [],
    nonSkillFlagsByIndex: new Map(),
    exactDuplicates: [],
    hashFromCandidateContent: () => { throw new Error('hashFromCandidateContent not yet initialized'); },
    candidateEmbeddingsForCompare: [],
    classifiedResults: [],
    completedCandidateIndices: new Set(),
    rankableAgents: [],
    agentProposalsByCandidateIndex: new Map(),
  };

  try {
    ctx = await runStage1(ctx, jobId, job);
    ctx = await runStage2(ctx, jobId);
    ctx = await runStage3(ctx, jobId);
    ctx = await runStage4(ctx, jobId);
    ctx = await runStage4b(ctx, jobId);
    ctx = await runStage5(ctx, jobId);
    ctx = await runStage5b(ctx, jobId);
    ctx = await runStage5c(ctx, jobId);
    ctx = await runStage6(ctx, jobId);
    ctx = await runStage7(ctx, jobId);
    ctx = await runStage8(ctx, jobId);
    ctx = await runStage7b(ctx, jobId);
    await runStage8b(ctx, jobId);
  } catch (err) {
    if (err instanceof JobAlreadyFailedAbort) return;
    throw err;
  }
}
