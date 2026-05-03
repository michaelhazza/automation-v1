/**
 * server/routes/assignableUsers.ts
 *
 * GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users?intent=pick_approver|pick_submitter
 *
 * Returns the pool of users and teams that can be assigned as approvers or
 * submitters for a workflow step, scoped by the caller's role.
 *
 * Spec: docs/workflows-dev-spec.md §14
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { validateIntent } from '../services/assignableUsersServicePure.js';
import { assignableUsersService } from '../services/assignableUsersService.js';

const router = Router();

router.get(
  '/api/orgs/:orgId/subaccounts/:subaccountId/assignable-users',
  authenticate,
  asyncHandler(async (req, res) => {
    const { orgId, subaccountId } = req.params;
    const callerOrgId = req.orgId!;

    // Validate orgId matches the authenticated org context
    if (orgId !== callerOrgId) {
      res.status(403).json({ error: 'Forbidden', errorCode: 'forbidden' });
      return;
    }

    // Validate subaccount belongs to the org
    await resolveSubaccount(subaccountId, callerOrgId);

    // Validate intent query param
    const intentResult = validateIntent(req.query['intent']);
    if (!intentResult.ok) {
      res.status(400).json({ error: 'Missing or invalid intent', errorCode: 'invalid_intent' });
      return;
    }

    // Load caller's subaccount memberships (needed for subaccount_admin access decision)
    const callerSubaccountIds = await assignableUsersService.getCallerSubaccountIds(req.user!.id, callerOrgId);

    const result = await assignableUsersService.resolvePool({
      caller: {
        id: req.user!.id,
        role: req.user!.role,
        organisationId: callerOrgId,
        subaccountIds: callerSubaccountIds,
      },
      organisationId: callerOrgId,
      subaccountId,
      intent: intentResult.intent,
    });

    res.json(result);
  }),
);

export default router;
