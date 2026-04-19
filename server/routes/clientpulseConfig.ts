import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  applyHierarchyTemplateConfigUpdate,
  resolveDefaultHierarchyTemplateId,
  resolvePortfolioHealthAgentId,
} from '../services/configUpdateHierarchyTemplateService.js';

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
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };

    const parsed = applyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw { statusCode: 400, message: 'Invalid request body', errorCode: 'INVALID_BODY' };
    }

    const templateId =
      parsed.data.templateId ?? (await resolveDefaultHierarchyTemplateId(orgId));
    if (!templateId) {
      throw {
        statusCode: 409,
        message: 'No default hierarchy template for this org',
        errorCode: 'TEMPLATE_NOT_FOUND',
      };
    }

    const agentId = (await resolvePortfolioHealthAgentId(orgId)) ?? undefined;

    const result = await applyHierarchyTemplateConfigUpdate({
      organisationId: orgId,
      templateId,
      path: parsed.data.path,
      value: parsed.data.value,
      reason: parsed.data.reason,
      sourceSession: parsed.data.sessionId ?? null,
      changedByUserId: req.user?.id ?? null,
      agentId,
    });

    res.json(result);
  }),
);

export default router;
