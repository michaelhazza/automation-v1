// CRM Query Planner route — POST /api/crm-query-planner/query (spec §18.1)
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { runQuery } from '../services/crmQueryPlanner/index.js';
import { resolveAmbientRunId } from '../services/crmQueryPlanner/crmQueryPlannerService.js';
import { listAgentCapabilityMaps } from '../services/capabilityMapService.js';
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

    // Validate subaccount belongs to the org (§18.1). The returned row is not
    // consumed — the call's side effect (404 if ownership check fails) is the
    // gate we need.
    await resolveSubaccount(subaccountId, organisationId);

    // Capability gate (§18.1) — the caller's subaccount must be onboarded to
    // the planner. The capability map lookup mirrors the rollout model: grant
    // `crm.query` to an agent on the target subaccount before its users can
    // invoke the planner. Union across all enabled agents' skills is passed
    // through so downstream per-entry `canonical.*` checks behave correctly
    // per §12.1's skip-unknown-capability rule.
    const agentMaps = await listAgentCapabilityMaps(organisationId, subaccountId);
    const callerCapabilities = new Set<string>();
    for (const { capabilityMap } of agentMaps) {
      if (!capabilityMap) continue;
      for (const skill of capabilityMap.skills ?? []) callerCapabilities.add(skill);
      for (const read of capabilityMap.read_capabilities ?? []) callerCapabilities.add(read);
    }
    if (!callerCapabilities.has('crm.query')) {
      return res.status(403).json({
        error:     'missing_permission',
        message:   'This subaccount is not onboarded to the CRM Query Planner.',
        requires:  'crm.query',
      });
    }

    const context: ExecutorContext = {
      orgId:                  organisationId,
      organisationId,
      subaccountId,
      // subaccountLocationId is deprecated — the live executor resolves the
      // real GHL locationId from integration_connections.configJson at
      // dispatch time (spec §13.5 / §16.3). Omitted here on purpose.
      runId:                  resolveAmbientRunId(user as { runId?: string } | null),
      briefId,
      principalType:          'user',
      principalId:            user.id,
      teamIds:                [],
      callerCapabilities,
      defaultSenderIdentifier: undefined,
    };

    const result = await runQuery({ rawIntent, subaccountId, briefId }, context);
    return res.json(result);
  }),
);

export default router;
