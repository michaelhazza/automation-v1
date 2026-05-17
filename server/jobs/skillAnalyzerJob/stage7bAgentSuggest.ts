import { env } from '../../lib/env.js';
import { updateJobProgress, updateResultAgentProposals } from '../../services/skillAnalyzerService.js';
import { skillAnalyzerServicePure } from '../../services/skillAnalyzerServicePure.js';
import { routeCall } from '../../services/llmRouter.js';
import { logger } from '../../lib/logger.js';
import { getPLimit } from './helpers.js';
import { type JobContext } from './types.js';

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
export async function runStage7b(ctx: JobContext, jobId: string): Promise<JobContext> {
  const { candidates, distinctResults, classifiedDistinct, rankableAgents, agentProposalsByCandidateIndex } = ctx;
  const { job } = ctx;

  if (!(env.ANTHROPIC_API_KEY && rankableAgents.length > 0)) {
    return ctx;
  }

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

  return ctx;
}
