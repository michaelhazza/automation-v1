import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { applyHierarchyTemplateConfigUpdate } from '../services/configUpdateHierarchyTemplateService.js';
import { db } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { agents } from '../db/schema/agents.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import { hierarchyTemplates } from '../db/schema/hierarchyTemplates.js';

const router = Router();

const applyBodySchema = z.object({
  templateId: z.string().uuid().optional(),
  path: z.string().min(1).max(500),
  value: z.unknown(),
  reason: z.string().min(1).max(5_000),
  sessionId: z.string().uuid().optional(),
});

/**
 * POST /api/clientpulse/config/apply
 *
 * Invoked by the Configuration Assistant chat popup when the operator confirms
 * a diff. Routes through configUpdateHierarchyTemplateService, which enforces
 * the sensitive-path split.
 */
router.post(
  '/api/clientpulse/config/apply',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };

    const parsed = applyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw { statusCode: 400, message: 'Invalid request body', errorCode: 'INVALID_BODY' };
    }

    // Resolve templateId: explicit or the org's default subaccount template.
    let templateId = parsed.data.templateId;
    if (!templateId) {
      const [t] = await db
        .select({ id: hierarchyTemplates.id })
        .from(hierarchyTemplates)
        .where(
          and(
            eq(hierarchyTemplates.organisationId, orgId),
            eq(hierarchyTemplates.isDefaultForSubaccount, true),
          ),
        )
        .limit(1);
      if (!t) throw { statusCode: 409, message: 'No default hierarchy template for this org', errorCode: 'TEMPLATE_NOT_FOUND' };
      templateId = t.id;
    }

    // Resolve the portfolio-health-agent for sensitive-path action enqueue.
    const [agentRow] = await db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(systemAgents, eq(agents.systemAgentId, systemAgents.id))
      .where(and(eq(agents.organisationId, orgId), eq(systemAgents.slug, 'portfolio-health-agent')))
      .limit(1);

    const result = await applyHierarchyTemplateConfigUpdate({
      organisationId: orgId,
      templateId,
      path: parsed.data.path,
      value: parsed.data.value,
      reason: parsed.data.reason,
      sourceSession: parsed.data.sessionId ?? null,
      changedByUserId: (req as { userId?: string }).userId ?? null,
      agentId: agentRow?.id,
    });

    res.json(result);
  }),
);

export default router;
