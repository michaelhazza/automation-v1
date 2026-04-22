// CRM Query Planner route — POST /api/crm-query-planner/query (spec §18.1)
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { runQuery } from '../services/crmQueryPlanner/index.js';
import { resolveAmbientRunId } from '../services/crmQueryPlanner/crmQueryPlannerService.js';
import type { ExecutorContext } from '../../shared/types/crmQueryPlanner.js';

const router = Router();

const queryBody = z.object({
  rawIntent:    z.string().min(3).max(2000),
  subaccountId: z.string().uuid(),
  briefId:      z.string().optional(),
});

router.post(
  '/api/crm-query-planner/query',
  authenticate,
  validateBody(queryBody, 'enforce'),
  asyncHandler(async (req, res) => {
    const { rawIntent, subaccountId, briefId } = queryBody.parse(req.body);
    const organisationId = req.orgId!;
    const user = req.user!;

    // Validate subaccount belongs to the org (§18.1)
    const subaccount = await resolveSubaccount(subaccountId, organisationId);

    const context: ExecutorContext = {
      orgId:                  organisationId,
      organisationId,
      subaccountId,
      subaccountLocationId:   (subaccount as any).locationId ?? subaccountId,
      runId:                  resolveAmbientRunId(user as { runId?: string } | null),
      briefId,
      principalType:          'user',
      principalId:            user.id,
      teamIds:                [],
      callerCapabilities:     new Set<string>(['crm.query']),
      defaultSenderIdentifier: undefined,
    };

    const result = await runQuery({ rawIntent, subaccountId, briefId }, context);
    res.json(result);
  }),
);

export default router;
