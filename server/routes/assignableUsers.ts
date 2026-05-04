import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { assignableUsersService, ForbiddenError } from '../services/assignableUsersService.js';
import { ASSIGNABLE_USERS_INTENTS } from '../../shared/types/assignableUsers.js';
import type { AssignableUsersIntent } from '../../shared/types/assignableUsers.js';

const router = Router();

router.get(
  '/api/orgs/:orgId/subaccounts/:subaccountId/assignable-users',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    if (req.params.orgId !== req.orgId!) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const intent = req.query.intent as string | undefined;
    if (!intent || !ASSIGNABLE_USERS_INTENTS.includes(intent as AssignableUsersIntent)) {
      res.status(400).json({ error: 'invalid_intent' });
      return;
    }

    // Resolve and validate subaccount belongs to org. Without this, a same-org
    // user could pass a foreign org's subaccount UUID and the service's LEFT
    // JOIN on subaccount_user_assignments would leak cross-tenant membership.
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    try {
      const result = await assignableUsersService.resolvePool({
        caller: { id: req.user!.id, dbRole: req.user!.role },
        organisationId: req.orgId!,
        subaccountId: subaccount.id,
        intent: intent as AssignableUsersIntent,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof ForbiddenError) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      throw err;
    }
  })
);

export default router;
