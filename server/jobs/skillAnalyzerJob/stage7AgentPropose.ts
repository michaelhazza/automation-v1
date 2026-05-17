import { updateJobProgress } from '../../services/skillAnalyzerService.js';
import { skillAnalyzerServicePure } from '../../services/skillAnalyzerServicePure.js';
import { type JobContext } from './types.js';

// -------------------------------------------------------------------------
// Stage 7: Agent-propose (80% → 90%) — Phase 2 of skill-analyzer-v2
// -------------------------------------------------------------------------
// For every DISTINCT result, compute cosine similarity against every
// system agent embedding and write the top-K=3 to agent_proposals on
// the result row. The threshold drives pre-selection only — top-K is
// always persisted in full so reviewers can promote a below-threshold
// chip with one click. See spec §6.2.
export async function runStage7(ctx: JobContext, jobId: string): Promise<JobContext> {
  await updateJobProgress(jobId, {
    progressPct: 80,
    progressMessage: 'Proposing system agent attachments...',
  });

  const { agentEmbeddingService } = await import('../../services/agentEmbeddingService.js');
  const { systemAgentService } = await import('../../services/systemAgentService.js');

  // Pre-load every active system agent + its cached embedding into a
  // single in-memory list so the per-result loop is just N cosine
  // computations. Zero-agents edge case: empty list → empty proposals.
  const allSystemAgents = await systemAgentService.listAgents();
  const rankableAgents: JobContext['rankableAgents'] = [];
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
  const agentProposalsByCandidateIndex: JobContext['agentProposalsByCandidateIndex'] = new Map();

  if (rankableAgents.length > 0) {
    for (const distinctMatch of ctx.distinctResults) {
      const candidateEmbedding = ctx.candidateEmbeddingsForCompare.find(
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
    for (const r of ctx.classifiedResults) {
      if (r.classification !== 'DISTINCT') continue;
      const candidateEmbedding = ctx.candidateEmbeddingsForCompare.find(
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

  return { ...ctx, rankableAgents, agentProposalsByCandidateIndex };
}
