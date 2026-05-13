import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { agentPromptRevisionService } from '../services/agentPromptRevisionService.js';

const router = Router();

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

    const rows = await agentPromptRevisionService.listForAgent(req.orgId!, agentId, { limit, offset });
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

    const revision = await agentPromptRevisionService.getById(req.orgId!, agentId, revisionId);
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

    const revision = await agentPromptRevisionService.rollback(
      req.orgId!,
      agentId,
      revisionId,
      req.user?.id ?? null,
    );
    res.json(revision);
  })
);

export default router;
