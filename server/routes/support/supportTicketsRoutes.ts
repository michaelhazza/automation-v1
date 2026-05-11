import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import type { PrincipalContext } from '../../services/principal/types.js';
import { resolveSubaccount } from '../../lib/resolveSubaccount.js';
import { listOpenTickets, readThreadForHumanUi } from '../../services/supportTicketService.js';

const router = Router({ mergeParams: true });

router.get('/tickets', authenticate, asyncHandler(async (req, res) => {
  const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const principal: PrincipalContext = {
    type: 'user',
    id: req.user!.id,
    organisationId: req.orgId!,
    subaccountId: subaccount.id,
    teamIds: [],
  };

  const inboxIds = req.query.inboxIds
    ? (Array.isArray(req.query.inboxIds) ? req.query.inboxIds : [req.query.inboxIds]) as string[]
    : undefined;

  const statusGroup = req.query.statusGroup as 'needs_attention' | 'all_open' | 'quarantined' | undefined;

  const tickets = await listOpenTickets({ inboxIds, statusGroup }, principal);
  res.json({ tickets });
}));

router.get('/tickets/:id', authenticate, asyncHandler(async (req, res) => {
  const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
  const principal: PrincipalContext = {
    type: 'user',
    id: req.user!.id,
    organisationId: req.orgId!,
    subaccountId: subaccount.id,
    teamIds: [],
  };

  const result = await readThreadForHumanUi(req.params.id, principal);
  res.json(result);
}));

export default router;
