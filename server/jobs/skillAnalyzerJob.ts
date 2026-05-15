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

import { env } from '../lib/env.js';
import {
  updateJobProgress,
  getJobById,
  insertResults,
  updateResultAgentProposals,
  updateJobAgentRecommendation,
} from '../services/skillAnalyzerService.js';
import type { skillAnalyzerResults } from '../db/schema/index.js';
import {
  skillAnalyzerServicePure,
  type ValidationThresholds,
  type ConsolidationOutcome,
} from '../services/skillAnalyzerServicePure.js';
import { effectiveTierMap } from '../services/skillAnalyzerConfigService.js';
import type { SkillAnalyzerConfig } from '../db/schema/skillAnalyzerConfig.js';
import { routeCall } from '../services/llmRouter.js';
import { logger } from '../lib/logger.js';
import { getPLimit } from './skillAnalyzerJob/helpers.js';
import { runStage1 } from './skillAnalyzerJob/stage1Parse.js';
import { runStage2 } from './skillAnalyzerJob/stage2Hash.js';
import { runStage3 } from './skillAnalyzerJob/stage3Embed.js';
import { runStage4 } from './skillAnalyzerJob/stage4Compare.js';
import { runStage4b } from './skillAnalyzerJob/stage4bNonSkillDetect.js';
import { JobAlreadyFailedAbort, type JobContext } from './skillAnalyzerJob/types.js';
import { runStage5 } from './skillAnalyzerJob/stage5Classify.js';
import { runStage5b } from './skillAnalyzerJob/stage5bCrossBatchCollision.js';
import { runStage5c } from './skillAnalyzerJob/stage5cSourceFork.js';

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

  // Destructure context fields needed by the remaining inline stages (6–8b).
  const {
    candidates,
    distinctResults,
    exactDuplicates,
    candidateEmbeddingsForCompare,
    nonSkillFlagsByIndex,
    classifiedResults,
    completedCandidateIndices,
  } = ctx;
  const getCandidateHash = ctx.hashFromCandidateContent;

  // -------------------------------------------------------------------------
  // Stage 6: Agent-embed (75% → 80%) — Phase 2 of skill-analyzer-v2
  // -------------------------------------------------------------------------
  // Refresh embeddings for every active system agent. Lazy invalidation:
  // anything whose stored content_hash matches the live hash is a cache hit
  // and skipped. See spec §6 Pipeline + agentEmbeddingService.
  await updateJobProgress(jobId, {
    progressPct: 75,
    progressMessage: 'Refreshing system agent embeddings...',
  });

  const { agentEmbeddingService } = await import('../services/agentEmbeddingService.js');
  const { systemAgentService } = await import('../services/systemAgentService.js');

  await agentEmbeddingService.refreshSystemAgentEmbeddings();

  // -------------------------------------------------------------------------
  // Stage 7: Agent-propose (80% → 90%) — Phase 2 of skill-analyzer-v2
  // -------------------------------------------------------------------------
  // For every DISTINCT result, compute cosine similarity against every
  // system agent embedding and write the top-K=3 to agent_proposals on
  // the result row. The threshold drives pre-selection only — top-K is
  // always persisted in full so reviewers can promote a below-threshold
  // chip with one click. See spec §6.2.
  await updateJobProgress(jobId, {
    progressPct: 80,
    progressMessage: 'Proposing system agent attachments...',
  });

  // Pre-load every active system agent + its cached embedding into a
  // single in-memory list so the per-result loop is just N cosine
  // computations. Zero-agents edge case: empty list → empty proposals.
  const allSystemAgents = await systemAgentService.listAgents();
  const rankableAgents: Array<{
    systemAgentId: string;
    slug: string;
    name: string;
    embedding: number[];
  }> = [];
  for (const agent of allSystemAgents) {
    const embRow = await agentEmbeddingService.getAgentEmbedding(agent.id);
    if (embRow) {
      rankableAgents.push({
        systemAgentId: agent.id,
        slug: agent.slug,
        name: agent.name,
        embedding: embRow.embedding,
      });
    }
  }

  // Compute proposals for every DISTINCT result. Indexed by candidateIndex
  // so the Write stage below can look them up alongside the existing result
  // row data.
  const agentProposalsByCandidateIndex = new Map<
    number,
    ReturnType<typeof skillAnalyzerServicePure.rankAgentsForCandidate>
  >();

  if (rankableAgents.length > 0) {
    for (const distinctMatch of distinctResults) {
      const candidateEmbedding = candidateEmbeddingsForCompare.find(
        (c) => c.index === distinctMatch.candidateIndex,
      )?.embedding;
      if (!candidateEmbedding) continue;
      const proposals = skillAnalyzerServicePure.rankAgentsForCandidate(
        candidateEmbedding,
        rankableAgents,
      );
      agentProposalsByCandidateIndex.set(distinctMatch.candidateIndex, proposals);
    }
    // Also propose for any LLM-classified result that landed on DISTINCT.
    for (const r of classifiedResults) {
      if (r.classification !== 'DISTINCT') continue;
      const candidateEmbedding = candidateEmbeddingsForCompare.find(
        (c) => c.index === r.candidateIndex,
      )?.embedding;
      if (!candidateEmbedding) continue;
      const proposals = skillAnalyzerServicePure.rankAgentsForCandidate(
        candidateEmbedding,
        rankableAgents,
      );
      agentProposalsByCandidateIndex.set(r.candidateIndex, proposals);
    }
  }

  // -------------------------------------------------------------------------
  // Stage 8: Write Results (90% → 100%)
  // -------------------------------------------------------------------------
  await updateJobProgress(jobId, {
    progressPct: 90,
    progressMessage: 'Writing results...',
  });

  // Collect all result rows
  const resultRows: (typeof skillAnalyzerResults.$inferInsert)[] = [];

  // Exact duplicates from Stage 2
  for (const dup of exactDuplicates) {
    const candidate = candidates[dup.candidateIndex];
    resultRows.push({
      jobId,
      candidateIndex: dup.candidateIndex,
      candidateName: candidate.name,
      candidateSlug: candidate.slug,
      candidateContentHash: getCandidateHash(dup.candidateIndex),
      matchedSkillId: dup.matchedLib.id ?? undefined,
      classification: 'DUPLICATE',
      confidence: 1.0,
      similarityScore: 1.0,
      classificationReasoning: 'Exact content match (identical content hash).',
      diffSummary: null,
      // Spec §10 state-machine closure: post-migration rows MUST carry one of
      // the four enum values, never NULL. DUPLICATE rows produce no merge, so
      // consolidation never fires for them — write 'not_triggered'.
      consolidationOutcome: 'not_triggered' as ConsolidationOutcome,
    });
  }

  // Distinct from Stage 4
  for (const m of distinctResults) {
    const candidate = candidates[m.candidateIndex];
    const flags = nonSkillFlagsByIndex.get(m.candidateIndex);
    resultRows.push({
      jobId,
      candidateIndex: m.candidateIndex,
      candidateName: candidate.name,
      candidateSlug: candidate.slug,
      candidateContentHash: getCandidateHash(m.candidateIndex),
      matchedSkillId: undefined,
      classification: 'DISTINCT',
      confidence: 1 - m.similarity,
      similarityScore: m.similarity,
      classificationReasoning: `Low embedding similarity (${(m.similarity * 100).toFixed(0)}%) - no existing skill is close.`,
      diffSummary: null,
      // Phase 2: agent proposals from the Agent-propose stage above. The
      // map only has entries for DISTINCT candidates that had a candidate
      // embedding; rows with no proposals fall back to the column default
      // of [].
      agentProposals: agentProposalsByCandidateIndex.get(m.candidateIndex) ?? [],
      isDocumentationFile: flags?.isDocumentationFile ?? false,
      isContextFile: flags?.isContextFile ?? false,
      // Spec §10 state-machine closure: post-migration rows MUST carry one of
      // the four enum values. DISTINCT rows produce no merge — write
      // 'not_triggered'.
      consolidationOutcome: 'not_triggered' as ConsolidationOutcome,
    });
  }

  // On crash-resume, Stage 2 exactDuplicate rows and Stage 4 distinctResults
  // rows that were already written by a prior run must not be re-inserted —
  // skill_analyzer_results has no UNIQUE(job_id, candidate_index) constraint,
  // so a plain insert would silently duplicate every such row. Filter against
  // the indices we observed at the start of Stage 5. candidateIndex is
  // `integer().notNull()` with no default, so $inferInsert types it as number;
  // no nullability guard needed.
  const resultRowsToWrite = resultRows.filter(
    (row) => !completedCandidateIndices.has(row.candidateIndex),
  );

  // Insert via service (avoids direct db import in jobs)
  await insertResults(resultRowsToWrite);

  // Backfill agentProposals onto classified-DISTINCT rows. These rows were
  // written incrementally in Stage 5 (before Stage 7 ran), so their
  // agentProposals column is still the default []. Patch them now.
  const classifiedDistinct = classifiedResults.filter(
    (r) => r.classification === 'DISTINCT',
  );
  for (const r of classifiedDistinct) {
    const proposals = agentProposalsByCandidateIndex.get(r.candidateIndex) ?? [];
    await updateResultAgentProposals(jobId, r.candidateIndex, proposals);
  }

  // -------------------------------------------------------------------------
  // Stage 7b: LLM agent suggestion (Haiku) — enrich agent proposals
  // -------------------------------------------------------------------------
  // For every DISTINCT result that has agent proposals, run a cheap Haiku
  // call to confirm or override the top cosine-similarity proposal and add
  // a human-readable reasoning string. This replaces the pure-embedding
  // ranking with a judgment-based routing decision.
  //
  // The Haiku result is written back into the agentProposals JSONB by
  // patching the top proposal's llmReasoning + llmConfirmed fields. The
  // pre-selection logic (selected: true/false) is also updated: if Haiku
  // disagrees with the top cosine pick, the Haiku-preferred agent is promoted.
  if (env.ANTHROPIC_API_KEY && rankableAgents.length > 0) {
    await updateJobProgress(jobId, {
      progressPct: 92,
      progressMessage: 'Refining agent assignments with AI…',
    });

    // Collect all DISTINCT result indices to enrich
    const distinctIndicesToEnrich = new Set<number>([
      ...distinctResults.map((m) => m.candidateIndex),
      ...classifiedDistinct.map((r) => r.candidateIndex),
    ]);

    // Concurrency 3: matches Stage 5 to stay within rate-limit budget.
    // Haiku calls are cheaper but share the same API key quota.
    const agentEnrichLimit = await getPLimit(3);

    // Heartbeat — bump `updated_at` every HEARTBEAT_EVERY enriched skills so
    // the stale-analyzer-job sweep can distinguish a slow Stage 7b from a
    // dead worker. Without this, Stage 7b updates progress once at start
    // and stays silent until Stage 8 — a 10+ min legitimate window that
    // the 15-min sweep threshold would otherwise have to absorb.
    //
    // Concurrency safety: enrichedCount is incremented inside per-task
    // `finally` blocks running under p-limit(3). JS is single-threaded;
    // `enrichedCount++` then `enrichedCount % HEARTBEAT_EVERY === 0` runs
    // atomically per microtask, so no heartbeat can be skipped due to
    // interleaving. The `|| enrichedCount === totalToEnrich` clause covers
    // the degenerate `totalToEnrich < HEARTBEAT_EVERY` case.
    const HEARTBEAT_EVERY = 5;
    const totalToEnrich = distinctIndicesToEnrich.size;
    let enrichedCount = 0;

    await Promise.all(
      [...distinctIndicesToEnrich].map((candidateIndex) =>
        agentEnrichLimit(async () => {
          const candidate = candidates[candidateIndex];
          if (!candidate) {
            enrichedCount++;
            return;
          }

          const existingProposals = agentProposalsByCandidateIndex.get(candidateIndex) ?? [];
          if (existingProposals.length === 0) {
            enrichedCount++;
            return;
          }

          try {
            const { system, userMessage } = skillAnalyzerServicePure.buildAgentSuggestionPrompt(
              {
                name: candidate.name,
                slug: candidate.slug,
                description: candidate.description,
                instructions: candidate.instructions,
              },
              rankableAgents.map((a) => ({ slug: a.slug, name: a.name })),
            );

            const response = await routeCall({
              system,
              messages: [{ role: 'user', content: userMessage }],
              maxTokens: 256,
              temperature: 0.1,
              context: {
                organisationId:     job.organisationId,
                sourceType:         'analyzer',
                sourceId:           jobId,
                featureTag:         'skill-analyzer-agent-match',
                taskType:           'general',
                systemCallerPolicy: 'bypass_routing',
                provider:           'anthropic',
                // Haiku: cheaper model for simple routing task
                model:              'claude-haiku-4-5-20251001',
              },
            });

            const suggestion = skillAnalyzerServicePure.parseAgentSuggestionResponse(response.content);
            if (!suggestion) return;

            // Capture whether any cosine proposal was originally selected before
            // enrichment so we can restore selection if Haiku's pick is out-of-top-K.
            const hadSelected = existingProposals.some((p) => p.selected);

            // Enrich agentProposals with Haiku reasoning and re-order if
            // Haiku picked a different agent than cosine similarity.
            const enriched = existingProposals.map((p) => {
              if (p.slugSnapshot === suggestion.suggestedAgentSlug) {
                return {
                  ...p,
                  selected: !suggestion.noGoodMatch,
                  llmReasoning: suggestion.reasoning,
                  // llmConfirmed reflects whether Haiku positively confirmed
                  // the match — false when noGoodMatch is true.
                  llmConfirmed: !suggestion.noGoodMatch,
                };
              }
              // When Haiku says no good match, deselect all cosine-selected
              // proposals — the overall verdict is "no home here".
              if (suggestion.noGoodMatch && p.selected) {
                return { ...p, selected: false };
              }
              // Demote other proposals when Haiku found a clear winner
              if (!suggestion.noGoodMatch && p.selected) {
                return { ...p, selected: false };
              }
              return p;
            });

            // If Haiku's choice isn't in the top-3 cosine proposals, add it
            // informational-only: do NOT mark it llmConfirmed or selected.
            // A 0%-cosine agent picked by Haiku is a weak signal — cosine and
            // LLM strongly disagree, so the skill likely has no good home yet.
            // Leaving llmConfirmed=false ensures Stage 8b includes these skills
            // in the cluster recommendation rather than falsely treating them as
            // homed. The cosine-top proposal's selection is also preserved.
            if (
              !suggestion.noGoodMatch &&
              suggestion.suggestedAgentSlug &&
              !enriched.some((p) => p.slugSnapshot === suggestion.suggestedAgentSlug)
            ) {
              const agent = rankableAgents.find((a) => a.slug === suggestion.suggestedAgentSlug);
              if (agent) {
                enriched.push({
                  systemAgentId: agent.systemAgentId,
                  slugSnapshot: agent.slug,
                  nameSnapshot: agent.name,
                  score: 0,
                  selected: false,
                  llmReasoning: suggestion.reasoning,
                  llmConfirmed: false,
                });
                // Restore selection on the highest-scoring cosine proposal only
                // if a selection existed before enrichment — if no proposal was
                // originally selected, there is no good home to restore.
                if (hadSelected) {
                  const topCosine = enriched.reduce((best, p) =>
                    p.score > (best?.score ?? -1) ? p : best, enriched[0]);
                  if (topCosine) topCosine.selected = true;
                }
              }
            }

            agentProposalsByCandidateIndex.set(candidateIndex, enriched);
            await updateResultAgentProposals(jobId, candidateIndex, enriched);
          } catch (err) {
            // Stage 7b is best-effort — a Haiku failure leaves the cosine
            // proposals intact. Log and continue.
            logger.warn('skill_analyzer_agent_suggestion_failed', {
              jobId,
              slug: candidate.slug,
              error: err instanceof Error ? err.message : String(err),
            });
          } finally {
            enrichedCount++;
            // Heartbeat: bump `updated_at` every HEARTBEAT_EVERY tasks (and
            // always on the last one) so the stale-job sweep can tell a
            // working Stage 7b from a dead one. Best-effort — a heartbeat
            // failure must not abort enrichment.
            if (enrichedCount % HEARTBEAT_EVERY === 0 || enrichedCount === totalToEnrich) {
              try {
                await updateJobProgress(jobId, {
                  progressPct: 92,
                  progressMessage: `Refining agent assignments with AI… ${enrichedCount}/${totalToEnrich}`,
                });
              } catch (heartbeatErr) {
                logger.warn('skill_analyzer_stage7b_heartbeat_failed', {
                  jobId,
                  enrichedCount,
                  error: heartbeatErr instanceof Error ? heartbeatErr.message : String(heartbeatErr),
                });
              }
            }
          }
        })
      )
    );
  }

  // -------------------------------------------------------------------------
  // Stage 8b: Agent cluster recommendation (Sonnet)
  // -------------------------------------------------------------------------
  // After all proposals are written, check whether a meaningful cluster of
  // DISTINCT skills has no good agent home. If so, run Sonnet to recommend
  // whether a new agent should be created to house them.
  //
  // "No good home" = every agent proposal for that skill has score < threshold.
  // "Meaningful cluster" = at least AGENT_RECOMMENDATION_MIN_SKILLS skills.
  {
    const { AGENT_RECOMMENDATION_THRESHOLD, AGENT_RECOMMENDATION_MIN_SKILLS } = skillAnalyzerServicePure;

    const allDistinctIndices = new Set<number>([
      ...distinctResults.map((m) => m.candidateIndex),
      ...classifiedDistinct.map((r) => r.candidateIndex),
    ]);

    const weakMatchSkills: Array<{ slug: string; name: string; description: string }> = [];
    for (const idx of allDistinctIndices) {
      const proposals = agentProposalsByCandidateIndex.get(idx) ?? [];
      // "No good home" = no Haiku-confirmed match AND no cosine score above
      // threshold. Prefer llmConfirmed as the signal when Stage 7b ran; fall
      // back to cosine score alone when proposals have no llmConfirmed field
      // (Stage 7b skipped or failed for this skill).
      const haiku7bRan = proposals.some((p) => 'llmConfirmed' in p);
      const hasGoodHome = haiku7bRan
        ? proposals.some((p) => p.llmConfirmed === true)
        : proposals.some((p) => p.score >= AGENT_RECOMMENDATION_THRESHOLD);
      if (!hasGoodHome) {
        const candidate = candidates[idx];
        if (candidate) {
          weakMatchSkills.push({
            slug: candidate.slug,
            name: candidate.name,
            description: candidate.description ?? '',
          });
        }
      }
    }

    if (env.ANTHROPIC_API_KEY && weakMatchSkills.length >= AGENT_RECOMMENDATION_MIN_SKILLS) {
      try {
        const { system, userMessage } = skillAnalyzerServicePure.buildAgentClusterRecommendationPrompt(
          weakMatchSkills,
          rankableAgents.map((a) => ({ slug: a.slug, name: a.name })),
        );

        const response = await routeCall({
          system,
          messages: [{ role: 'user', content: userMessage }],
          maxTokens: 512,
          temperature: 0.2,
          context: {
            organisationId:     job.organisationId,
            sourceType:         'analyzer',
            sourceId:           jobId,
            featureTag:         'skill-analyzer-cluster-recommend',
            taskType:           'general',
            systemCallerPolicy: 'bypass_routing',
            provider:           'anthropic',
            model:              'claude-sonnet-4-6',
          },
        });

        const recommendation = skillAnalyzerServicePure.parseAgentClusterRecommendationResponse(response.content);
        if (recommendation) {
          await updateJobAgentRecommendation(jobId, recommendation);
          logger.info('skill_analyzer_agent_recommendation', {
            jobId,
            shouldCreateAgent: recommendation.shouldCreateAgent,
            agentName: recommendation.agentName,
            skillCount: weakMatchSkills.length,
          });
        }
      } catch (err) {
        // Best-effort — cluster recommendation failure never fails the job.
        logger.warn('skill_analyzer_cluster_recommendation_failed', {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await updateJobProgress(jobId, {
    status: 'completed',
    progressPct: 100,
    progressMessage: `Analysis complete - ${candidates.length} result${candidates.length === 1 ? '' : 's'}.`,
    completedAt: new Date(),
  });
}
