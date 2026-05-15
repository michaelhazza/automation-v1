/**
 * Skill Analyzer Job — pg-boss handler for the 'skill-analyzer' queue.
 *
 * Executes the 6-stage pipeline:
 *   Stage 1: Parse    (0%  → 10%)
 *   Stage 2: Hash     (10% → 20%)
 *   Stage 3: Embed    (20% → 40%)
 *   Stage 4: Compare  (40% → 60%)
 *   Stage 5: Classify (60% → 90%)
 *   Stage 6: Write    (90% → 100%)
 *
 * Crash-resume: on pg-boss retry (worker died mid-pipeline) this handler
 * PRESERVES any rows already written to skill_analyzer_results and skips
 * re-running their LLM classifications. Without this, a single dev-server
 * restart mid-import costs 2× the LLM budget on every skill already done.
 * See Stage 1 (preserves job.parsedCandidates to stabilise candidateIndex)
 * and Stage 5 (skips slugs with existing rows). Max 1 retry with 5-minute
 * delay on crash.
 */

import { getJobById } from '../services/skillAnalyzerService.js';
import {
  type ValidationThresholds,
} from '../services/skillAnalyzerServicePure.js';
import { effectiveTierMap } from '../services/skillAnalyzerConfigService.js';
import type { SkillAnalyzerConfig } from '../db/schema/skillAnalyzerConfig.js';
import { runStage1 } from './skillAnalyzerJob/stage1Parse.js';
import { runStage2 } from './skillAnalyzerJob/stage2Hash.js';
import { runStage3 } from './skillAnalyzerJob/stage3Embed.js';
import { runStage4 } from './skillAnalyzerJob/stage4Compare.js';
import { runStage4b } from './skillAnalyzerJob/stage4bNonSkillDetect.js';
import { JobAlreadyFailedAbort, type JobContext } from './skillAnalyzerJob/types.js';
import { runStage5 } from './skillAnalyzerJob/stage5Classify.js';
import { runStage5b } from './skillAnalyzerJob/stage5bCrossBatchCollision.js';
import { runStage5c } from './skillAnalyzerJob/stage5cSourceFork.js';
import { runStage6 } from './skillAnalyzerJob/stage6AgentEmbed.js';
import { runStage7 } from './skillAnalyzerJob/stage7AgentPropose.js';
import { runStage8 } from './skillAnalyzerJob/stage8WriteResults.js';
import { runStage7b } from './skillAnalyzerJob/stage7bAgentSuggest.js';
import { runStage8b } from './skillAnalyzerJob/stage8bClusterRecommend.js';

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

  // -------------------------------------------------------------------------
  // Stages 1-4b — extracted to sibling modules; orchestrated here.
  // -------------------------------------------------------------------------
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
  } catch (err) {
    if (err instanceof JobAlreadyFailedAbort) return;
    throw err;
  }

  // -------------------------------------------------------------------------
  // Stages 5, 5b, 5c — extracted to sibling modules.
  // -------------------------------------------------------------------------
  try {
    ctx = await runStage5(ctx, jobId);
    ctx = await runStage5b(ctx, jobId);
    ctx = await runStage5c(ctx, jobId);
  } catch (err) {
    if (err instanceof JobAlreadyFailedAbort) return;
    throw err;
  }

  // -------------------------------------------------------------------------
  // Stages 6-8b — extracted to sibling modules; orchestrated here.
  // Execution order: 6 → 7 → 8 → 7b → 8b (matches source order in barrel).
  // -------------------------------------------------------------------------
  ctx = await runStage6(ctx, jobId);
  ctx = await runStage7(ctx, jobId);
  ctx = await runStage8(ctx, jobId);
  ctx = await runStage7b(ctx, jobId);
  await runStage8b(ctx, jobId);
}
