import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import type { PrincipalContext } from '../../services/principal/types.js';
import type { SupportInboxAgentConfig } from '../../../shared/types/supportInboxAgentConfig.js';
import { listInboxes, updateAgentConfig } from '../../services/supportInboxService.js';

const router = Router();

function makePrincipal(req: Express.Request & { user?: import('../../middleware/auth.js').JwtPayload; orgId?: string }): PrincipalContext {
  return {
    type: 'user',
    id: req.user!.id,
    organisationId: req.orgId!,
    subaccountId: null,
    teamIds: [],
  };
}

router.get('/inboxes', authenticate, asyncHandler(async (req, res) => {
  const inboxes = await listInboxes(makePrincipal(req));
  res.json({ inboxes });
}));

router.patch('/inboxes/:id', authenticate, requireOrgPermission('support.inbox.configure'), asyncHandler(async (req, res) => {
  const { agentConfig } = req.body as { agentConfig: SupportInboxAgentConfig };
  const inbox = await updateAgentConfig(req.params.id, agentConfig, makePrincipal(req));
  res.json({ inbox });
}));

export default router;
