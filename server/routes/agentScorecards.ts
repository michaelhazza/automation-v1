// server/routes/agentScorecards.ts
// Agent scorecard attach / detach / list routes.
// Trust & Verification Layer spec §12.2.

import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { scorecardService } from '../services/scorecardService.js';
import { attachScorecardBody } from '../schemas/scorecards.js';

const router = Router();

// ── GET /api/agents/:agentId/scorecards ──────────────────────────────────────

router.get(
  '/api/agents/:agentId/scorecards',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const attachments = await scorecardService.listForAgent(agentId);
    res.json({ attachments });
  }),
);

// ── POST /api/agents/:agentId/scorecards/attach ──────────────────────────────

router.post(
  '/api/agents/:agentId/scorecards/attach',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(attachScorecardBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { scorecardId, gradingFrequency } = req.body;
    const attachment = await scorecardService.attachToAgent(agentId, scorecardId, req.orgId!, {
      gradingFrequency,
    });
    res.status(201).json(attachment);
  }),
);

// ── DELETE /api/agents/:agentId/scorecards/:scorecardId (org-admin / system-admin) ──

router.delete(
  '/api/agents/:agentId/scorecards/:scorecardId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  asyncHandler(async (req, res) => {
    const { agentId, scorecardId } = req.params;
    const role = req.user?.role;
    const callerScope = role === 'system_admin' ? 'system_admin' : 'org_admin';
    await scorecardService.detachFromAgent(agentId, scorecardId, callerScope);
    res.status(204).end();
  }),
);

// ── DELETE /api/subaccounts/:subaccountId/agents/:agentId/scorecards/:scorecardId ──
// Subaccount-scoped detach — only removes `suggested` attachments (authority guard in service).

router.delete(
  '/api/subaccounts/:subaccountId/agents/:agentId/scorecards/:scorecardId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SCORECARDS_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, agentId, scorecardId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    await scorecardService.detachFromAgent(agentId, scorecardId, 'subaccount');
    res.status(204).end();
  }),
);

export default router;
