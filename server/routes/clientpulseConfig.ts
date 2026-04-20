import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  applyOrganisationConfigUpdate,
  resolvePortfolioHealthAgentId,
} from '../services/configUpdateOrganisationService.js';

const router = Router();

// Session 1: this route is retired in Chunk A.3 in favour of the generic
// `/api/organisation/config/apply`. Kept here only so the build stays green
// between A.2 and A.3. Do not extend.
const applyBodySchema = z.object({
  path: z.string().min(1).max(500),
  value: z.unknown(),
  reason: z.string().min(1).max(5_000),
  sessionId: z.string().uuid().optional(),
});

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

    const agentId = (await resolvePortfolioHealthAgentId(orgId)) ?? undefined;

    const result = await applyOrganisationConfigUpdate({
      organisationId: orgId,
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
