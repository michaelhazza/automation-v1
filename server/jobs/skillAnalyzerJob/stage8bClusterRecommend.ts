import { env } from '../../lib/env.js';
import { updateJobProgress, updateJobAgentRecommendation } from '../../services/skillAnalyzerService.js';
import { skillAnalyzerServicePure } from '../../services/skillAnalyzerServicePure.js';
import { routeCall } from '../../services/llmRouter.js';
import { logger } from '../../lib/logger.js';
import { type JobContext } from './types.js';

// -------------------------------------------------------------------------
// Stage 8b: Agent cluster recommendation (Sonnet)
// -------------------------------------------------------------------------
// After all proposals are written, check whether a meaningful cluster of
// DISTINCT skills has no good agent home. If so, run Sonnet to recommend
// whether a new agent should be created to house them.
//
// "No good home" = every agent proposal for that skill has score < threshold.
// "Meaningful cluster" = at least AGENT_RECOMMENDATION_MIN_SKILLS skills.
export async function runStage8b(ctx: JobContext, jobId: string): Promise<JobContext> {
  const { candidates, distinctResults, classifiedDistinct, rankableAgents, agentProposalsByCandidateIndex } = ctx;
  const { job } = ctx;

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

  return ctx;
}
