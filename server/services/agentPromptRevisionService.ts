import crypto from 'crypto';
import { eq, and, desc, max } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agents, agentPromptRevisions } from '../db/schema/index.js';
import type { AgentPromptRevision } from '../db/schema/index.js';
import { agentService } from './agentService.js';
import { auditService } from './auditService.js';

function computePromptHash(masterPrompt: string, additionalPrompt: string): string {
  return crypto.createHash('sha256').update(masterPrompt + '\0' + additionalPrompt).digest('hex');
}

export const agentPromptRevisionService = {
  async listForAgent(
    orgId: string,
    agentId: string,
    params: { limit: number; offset: number },
  ): Promise<AgentPromptRevision[]> {
    // Verify agent ownership — throws { statusCode: 404 } if not found
    await agentService.getFull(agentId, orgId);

    return getOrgScopedDb('agentPromptRevisionService.listForAgent')
      .select()
      .from(agentPromptRevisions)
      .where(and(
        eq(agentPromptRevisions.agentId, agentId),
        eq(agentPromptRevisions.organisationId, orgId),
      ))
      .orderBy(desc(agentPromptRevisions.revisionNumber))
      .limit(params.limit)
      .offset(params.offset);
  },

  async getById(
    orgId: string,
    agentId: string,
    revisionId: string,
  ): Promise<AgentPromptRevision> {
    const [revision] = await getOrgScopedDb('agentPromptRevisionService.getById')
      .select()
      .from(agentPromptRevisions)
      .where(and(
        eq(agentPromptRevisions.id, revisionId),
        eq(agentPromptRevisions.agentId, agentId),
        eq(agentPromptRevisions.organisationId, orgId),
      ));

    if (!revision) throw { statusCode: 404, message: 'Revision not found' };

    return revision;
  },

  async rollback(
    orgId: string,
    agentId: string,
    revisionId: string,
    actorId: string | null,
  ): Promise<AgentPromptRevision> {
    // Verify agent ownership — throws { statusCode: 404 } if not found
    await agentService.getFull(agentId, orgId);

    const targetRevision = await agentPromptRevisionService.getById(orgId, agentId, revisionId);

    const hash = computePromptHash(targetRevision.masterPrompt, targetRevision.additionalPrompt);

    const result = await getOrgScopedDb('agentPromptRevisionService.rollback').transaction(async (tx) => {
      const [maxRow] = await tx
        .select({ maxNum: max(agentPromptRevisions.revisionNumber) })
        .from(agentPromptRevisions)
        .where(eq(agentPromptRevisions.agentId, agentId));

      const nextRevisionNumber = (maxRow?.maxNum ?? 0) + 1;

      const [newRevision] = await tx.insert(agentPromptRevisions).values({
        agentId,
        organisationId: orgId,
        revisionNumber: nextRevisionNumber,
        masterPrompt: targetRevision.masterPrompt,
        additionalPrompt: targetRevision.additionalPrompt,
        promptHash: hash,
        changeDescription: `Rolled back to revision #${targetRevision.revisionNumber}`,
        changedBy: actorId ?? null,
      }).returning();

      await tx
        .update(agents)
        .set({
          masterPrompt: targetRevision.masterPrompt,
          additionalPrompt: targetRevision.additionalPrompt,
          updatedAt: new Date(),
        })
        .where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)));

      return newRevision;
    });

    await auditService.log({
      organisationId: orgId,
      actorId: actorId ?? undefined,
      actorType: 'user',
      action: 'agent.prompt.rollback',
      entityType: 'agent',
      entityId: agentId,
      metadata: {
        rolledBackToRevisionId: revisionId,
        rolledBackToRevisionNumber: targetRevision.revisionNumber,
        newRevisionNumber: result.revisionNumber,
      },
    });

    return result;
  },
};
