/**
 * server/routes/teams.ts
 *
 * CRUD endpoints for teams (org-level) and team members.
 *
 * POST   /api/orgs/:orgId/teams
 * GET    /api/orgs/:orgId/teams
 * PATCH  /api/orgs/:orgId/teams/:teamId
 * DELETE /api/orgs/:orgId/teams/:teamId
 * POST   /api/orgs/:orgId/teams/:teamId/members
 * DELETE /api/orgs/:orgId/teams/:teamId/members/:userId
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { teamsService } from '../services/teamsService.js';

const router = Router();

// ─── List teams ───────────────────────────────────────────────────────────────

router.get(
  '/api/orgs/:orgId/teams',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.query as Record<string, string | undefined>;
    const result = await teamsService.listTeams(orgId, subaccountId);
    res.json(result);
  }),
);

// ─── Create team ──────────────────────────────────────────────────────────────

router.post(
  '/api/orgs/:orgId/teams',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { name, subaccountId } = req.body as { name?: string; subaccountId?: string };

    if (!name) {
      res.status(400).json({ error: 'name is required', errorCode: 'missing_name' });
      return;
    }

    const team = await teamsService.createTeam(orgId, name, subaccountId, req.user!.id);
    res.status(201).json(team);
  }),
);

// ─── Update team ──────────────────────────────────────────────────────────────

router.patch(
  '/api/orgs/:orgId/teams/:teamId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { teamId } = req.params;
    const { name } = req.body as { name?: string };

    const team = await teamsService.updateTeam(orgId, teamId, { name });
    res.json(team);
  }),
);

// ─── Delete team ──────────────────────────────────────────────────────────────

router.delete(
  '/api/orgs/:orgId/teams/:teamId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { teamId } = req.params;

    await teamsService.deleteTeam(orgId, teamId);
    res.status(204).send();
  }),
);

// ─── List team members ────────────────────────────────────────────────────────

router.get(
  '/api/orgs/:orgId/teams/:teamId/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { teamId } = req.params;
    const result = await teamsService.listTeamMembers(orgId, teamId);
    res.json(result);
  }),
);

// ─── Add team members ─────────────────────────────────────────────────────────

router.post(
  '/api/orgs/:orgId/teams/:teamId/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { teamId } = req.params;
    const { userIds } = req.body as { userIds?: string[] };

    if (!Array.isArray(userIds) || userIds.length === 0) {
      res.status(400).json({ error: 'userIds must be a non-empty array', errorCode: 'missing_user_ids' });
      return;
    }

    const result = await teamsService.addTeamMembers(orgId, teamId, userIds);
    res.status(201).json(result);
  }),
);

// ─── Remove team member ───────────────────────────────────────────────────────

router.delete(
  '/api/orgs/:orgId/teams/:teamId/members/:userId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { teamId, userId } = req.params;

    await teamsService.removeTeamMember(orgId, teamId, userId);
    res.status(204).send();
  }),
);

export default router;
