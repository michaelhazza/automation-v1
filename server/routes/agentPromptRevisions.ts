import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { agents, agentPromptRevisions } from '../db/schema/index.js';
import { eq, and, isNull, desc, max } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { auditService } from '../services/auditService.js';
import crypto from 'crypto';

const router = Router();

function computePromptHash(masterPrompt: string, additionalPrompt: string): string {
  return crypto.createHash('sha256').update(masterPrompt + '\0' + additionalPrompt).digest('hex');
}

/**
 * GET /api/agents/:agentId/prompt-revisions
 * List paginated prompt revisions for an agent.
 */
router.get(
  '/api/agents/:agentId/prompt-revisions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    // Verify agent belongs to org
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, req.orgId!), isNull(agents.deletedAt)));

    if (!agent) throw { statusCode: 404, message: 'Agent not found' };

    const rows = await db
      .select()
      .from(agentPromptRevisions)
      .where(and(
        eq(agentPromptRevisions.agentId, agentId),
        eq(agentPromptRevisions.organisationId, req.orgId!),
      ))
      .orderBy(desc(agentPromptRevisions.revisionNumber))
      .limit(limit)
      .offset(offset);

    res.json(rows);
  })
);

/**
 * GET /api/agents/:agentId/prompt-revisions/:revisionId
 * Get a single prompt revision.
 */
router.get(
  '/api/agents/:agentId/prompt-revisions/:revisionId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { agentId, revisionId } = req.params;

    const [revision] = await db
      .select()
      .from(agentPromptRevisions)
      .where(and(
        eq(agentPromptRevisions.id, revisionId),
        eq(agentPromptRevisions.agentId, agentId),
        eq(agentPromptRevisions.organisationId, req.orgId!),
      ));

    if (!revision) throw { statusCode: 404, message: 'Revision not found' };

    res.json(revision);
  })
);

/**
 * POST /api/agents/:agentId/prompt-revisions/:revisionId/rollback
 * Rollback agent prompts to the specified revision, creating a new revision.
 */
router.post(
  '/api/agents/:agentId/prompt-revisions/:revisionId/rollback',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { agentId, revisionId } = req.params;

    // Verify agent belongs to org
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, req.orgId!), isNull(agents.deletedAt)));

    if (!agent) throw { statusCode: 404, message: 'Agent not found' };

    // Fetch the target revision
    const [targetRevision] = await db
      .select()
      .from(agentPromptRevisions)
      .where(and(
        eq(agentPromptRevisions.id, revisionId),
        eq(agentPromptRevisions.agentId, agentId),
        eq(agentPromptRevisions.organisationId, req.orgId!),
      ));

    if (!targetRevision) throw { statusCode: 404, message: 'Revision not found' };

    const hash = computePromptHash(targetRevision.masterPrompt, targetRevision.additionalPrompt);

    // Use a transaction: create new revision + update agent atomically
    const result = await db.transaction(async (tx) => {
      // Get max revision number
      const [maxRow] = await tx
        .select({ maxNum: max(agentPromptRevisions.revisionNumber) })
        .from(agentPromptRevisions)
        .where(eq(agentPromptRevisions.agentId, agentId));

      const nextRevisionNumber = (maxRow?.maxNum ?? 0) + 1;

      // Create new revision for the rollback
      const [newRevision] = await tx.insert(agentPromptRevisions).values({
        agentId,
        organisationId: req.orgId!,
        revisionNumber: nextRevisionNumber,
        masterPrompt: targetRevision.masterPrompt,
        additionalPrompt: targetRevision.additionalPrompt,
        promptHash: hash,
        changeDescription: `Rolled back to revision #${targetRevision.revisionNumber}`,
        changedBy: req.user?.id ?? null,
      }).returning();

      // Update agent prompts
      const [updatedAgent] = await tx
        .update(agents)
        .set({
          masterPrompt: targetRevision.masterPrompt,
          additionalPrompt: targetRevision.additionalPrompt,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agentId))
        .returning();

      return { revision: newRevision, agent: updatedAgent };
    });

    // Audit event
    await auditService.log({
      organisationId: req.orgId!,
      actorId: req.user?.id,
      actorType: 'user',
      action: 'agent.prompt.rollback',
      entityType: 'agent',
      entityId: agentId,
      metadata: {
        rolledBackToRevisionId: revisionId,
        rolledBackToRevisionNumber: targetRevision.revisionNumber,
        newRevisionNumber: result.revision.revisionNumber,
      },
    });

    res.json(result.revision);
  })
);

export default router;
