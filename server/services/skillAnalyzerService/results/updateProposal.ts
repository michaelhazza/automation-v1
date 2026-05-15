import { eq, and } from 'drizzle-orm';
import { logger } from '../../../lib/logger.js';
import { db } from '../../../db/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../../../db/schema/index.js';
import { skillAnalyzerServicePure } from '../../skillAnalyzerServicePure.js';
import { systemSkillService } from '../../systemSkillService.js';
import type { EnrichedResult } from '../types.js';
import type { UpdateAgentProposalParams } from '../types.js';

// ---------------------------------------------------------------------------
// Proposed new agents — v2 Fix 5 (confirm/reject)
// ---------------------------------------------------------------------------

export async function updateProposedAgent(params: {
  jobId: string;
  organisationId: string;
  proposedAgentIndex: number;
  action: 'confirm' | 'reject';
}): Promise<void> {
  const { jobId, organisationId, proposedAgentIndex, action } = params;

  const jobRows = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  const job = jobRows[0];
  if (!job) throw { statusCode: 404, message: 'Job not found' };

  const current = Array.isArray(job.proposedNewAgents) ? (job.proposedNewAgents as Array<Record<string, unknown>>) : [];
  if (current.length === 0 || !current[proposedAgentIndex]) {
    throw { statusCode: 404, message: `Proposed agent index ${proposedAgentIndex} not found` };
  }

  const next = current.map((entry, i) => {
    if (i !== proposedAgentIndex) return entry;
    if (action === 'confirm') {
      return { ...entry, status: 'confirmed', confirmedAt: new Date().toISOString() };
    }
    return { ...entry, status: 'rejected', rejectedAt: new Date().toISOString() };
  });

  await db
    .update(skillAnalyzerJobs)
    .set({ proposedNewAgents: next })
    .where(eq(skillAnalyzerJobs.id, jobId));
}

/** Update one entry in a result row's agentProposals jsonb. Used by the
 *  Phase 4 PATCH /agents endpoint. Per spec §7.3 the endpoint has three
 *  modes — toggle / remove / addIfMissing — exactly one of which must be
 *  set. The service throws on validation failures with the same shape the
 *  routes expect: { statusCode, message }. */
export async function updateAgentProposal(
  params: UpdateAgentProposalParams,
): Promise<EnrichedResult> {
  const { resultId, jobId, organisationId, systemAgentId } = params;

  // Mutual exclusivity validation
  const modeCount =
    (params.selected !== undefined ? 1 : 0) +
    (params.remove === true ? 1 : 0) +
    (params.addIfMissing === true ? 1 : 0);
  if (modeCount !== 1) {
    throw {
      statusCode: 400,
      message: 'exactly one of selected, remove, or addIfMissing is required',
    };
  }

  // Verify job belongs to org and load the result row.
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  if (!jobRows[0]) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  const resultRows = await getOrgScopedDb('skillAnalyzerService.updateAgentProposal.read')
    .select()
    .from(skillAnalyzerResults)
    .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)))
    .limit(1);
  const row = resultRows[0];
  if (!row) {
    throw { statusCode: 404, message: 'Result not found' };
  }

  // Per spec §7.3, agent proposals are only valid on DISTINCT results.
  if (row.classification !== 'DISTINCT') {
    throw {
      statusCode: 409,
      message: 'agent proposals are only valid on DISTINCT results',
    };
  }

  type ProposalRow = {
    systemAgentId: string;
    slugSnapshot: string;
    nameSnapshot: string;
    score: number;
    selected: boolean;
  };
  const proposals: ProposalRow[] = Array.isArray(row.agentProposals)
    ? (row.agentProposals as ProposalRow[])
    : [];

  // ---------------------------------------------------------------------
  // Mode dispatch
  // ---------------------------------------------------------------------
  let nextProposals: ProposalRow[];

  if (params.remove === true) {
    if (!proposals.find((p) => p.systemAgentId === systemAgentId)) {
      throw { statusCode: 404, message: 'proposal not found' };
    }
    nextProposals = proposals.filter((p) => p.systemAgentId !== systemAgentId);
  } else if (params.selected !== undefined) {
    const idx = proposals.findIndex((p) => p.systemAgentId === systemAgentId);
    if (idx === -1) {
      throw { statusCode: 404, message: 'proposal not found' };
    }
    nextProposals = proposals.map((p, i) =>
      i === idx ? { ...p, selected: params.selected === true } : p,
    );
  } else {
    // addIfMissing
    const existingIdx = proposals.findIndex((p) => p.systemAgentId === systemAgentId);
    if (existingIdx !== -1) {
      // Already present — no-op. Return the row unchanged so the client
      // can follow up with a separate selected toggle if needed.
      nextProposals = proposals;
    } else {
      // Manual-add path: refresh the agent's embedding (lazy), look up
      // the candidate embedding from skill_embeddings via the persisted
      // candidateContentHash, compute live cosine similarity, append a
      // fully-scored proposal with selected=true. Re-sort by score desc.
      // See spec §6.2 manual-add flow.
      const { agentEmbeddingService } = await import('../../agentEmbeddingService.js');
      const { skillEmbeddingService } = await import('../../skillEmbeddingService.js');
      const { systemAgentService } = await import('../../systemAgentService.js');

      const agent = await systemAgentService.getAgent(systemAgentId);
      const agentEmbedding = await agentEmbeddingService.refreshSystemAgentEmbedding(systemAgentId);
      // Hash-only lookup is intentional. Per skill_embeddings.ts schema
      // comment, sourceType reflects the LAST writer for a content hash and
      // is provenance-only — filtering by sourceType here would be wrong
      // because the same hash may have been re-written by a system or org
      // path before the candidate path. Spec §5.2 candidateContentHash.
      const candidateEmbedding = await skillEmbeddingService.getByContentHash(row.candidateContentHash);
      if (!candidateEmbedding) {
        throw {
          statusCode: 409,
          message: `candidate embedding not found for hash ${row.candidateContentHash}; re-run the analysis to repopulate`,
        };
      }
      const score = skillAnalyzerServicePure.cosineSimilarity(
        candidateEmbedding.embedding,
        agentEmbedding.embedding,
      );
      const newProposal: ProposalRow = {
        systemAgentId,
        slugSnapshot: agent.slug,
        nameSnapshot: agent.name,
        score,
        selected: true,
      };
      nextProposals = [...proposals, newProposal].sort((a, b) => b.score - a.score);
    }
  }

  await getOrgScopedDb('skillAnalyzerService.updateAgentProposal.update')
    .update(skillAnalyzerResults)
    .set({ agentProposals: nextProposals })
    .where(eq(skillAnalyzerResults.id, resultId));

  // Return the freshly enriched result via getJob (so the response shape
  // matches the GET endpoint). For efficiency we re-fetch only this row's
  // join data rather than re-running the full job lookup.
  const updatedRows = await getOrgScopedDb('skillAnalyzerService.updateAgentProposal.refetch')
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.id, resultId))
    .limit(1);
  const updated = updatedRows[0];
  if (!updated) {
    // Race condition — extremely unlikely. Surface as 500.
    throw { statusCode: 500, message: 'updateAgentProposal: row vanished after update' };
  }

  let enriched: EnrichedResult = updated;
  if (updated.matchedSkillId) {
    try {
      const matched = await systemSkillService.getSkill(updated.matchedSkillId);
      enriched = {
        ...updated,
        matchedSkillContent: {
          id: matched.id,
          slug: matched.slug,
          name: matched.name,
          description: matched.description,
          definition: matched.definition as object,
          instructions: matched.instructions,
        },
      };
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) {
        // Library skill deleted — leave matchedSkillContent omitted.
      } else {
        logger.error('[skillAnalyzer] Unexpected error fetching matched skill', {
          matchedSkillId: updated.matchedSkillId,
          error: String(err),
        });
        throw err;
      }
    }
  }
  return enriched;
}

/** Backfill agentProposals onto a result row that was written incrementally
 *  in Stage 5 (before Stage 7 computed proposals). Used in Stage 8 to
 *  patch classified-DISTINCT rows. No-op when proposals is empty. */
export async function updateResultAgentProposals(
  jobId: string,
  candidateIndex: number,
  agentProposals: unknown[],
): Promise<void> {
  if (agentProposals.length === 0) return;
  await getOrgScopedDb('skillAnalyzerService.updateResultAgentProposals')
    .update(skillAnalyzerResults)
    .set({ agentProposals })
    .where(
      and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.candidateIndex, candidateIndex),
      ),
    );
}

