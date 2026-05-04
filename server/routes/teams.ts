import { Router, Request, Response } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { teamsService, TeamNameConflictError, TeamNotFoundError } from '../services/teamsService.js';

const router = Router();

function checkOrgId(req: Request, res: Response): boolean {
  if (req.params.orgId !== req.orgId!) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

router.get(
  '/api/orgs/:orgId/teams',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    if (!checkOrgId(req, res)) return;
    const teams = await teamsService.listTeams(req.orgId!);
    res.json({ teams });
  })
);

router.post(
  '/api/orgs/:orgId/teams',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    if (!checkOrgId(req, res)) return;
    const { name, subaccountId } = req.body as { name: string; subaccountId?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    try {
      const team = await teamsService.createTeam({
        organisationId: req.orgId!,
        name,
        subaccountId,
      });
      res.status(201).json(team);
    } catch (err) {
      if (err instanceof TeamNameConflictError) {
        res.status(409).json({ error: 'team_name_conflict' });
        return;
      }
      throw err;
    }
  })
);

router.patch(
  '/api/orgs/:orgId/teams/:teamId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    if (!checkOrgId(req, res)) return;
    const { name } = req.body as { name: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    try {
      const team = await teamsService.updateTeam(req.params.teamId, req.orgId!, name);
      res.json({ team });
    } catch (err) {
      if (err instanceof TeamNameConflictError) {
        res.status(409).json({ error: 'team_name_conflict' });
        return;
      }
      if (err instanceof TeamNotFoundError) {
        res.status(404).json({ error: 'team_not_found' });
        return;
      }
      throw err;
    }
  })
);

router.delete(
  '/api/orgs/:orgId/teams/:teamId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    if (!checkOrgId(req, res)) return;
    try {
      await teamsService.deleteTeam(req.params.teamId, req.orgId!);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        res.status(404).json({ error: 'team_not_found' });
        return;
      }
      throw err;
    }
  })
);

router.get(
  '/api/orgs/:orgId/teams/:teamId/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    if (!checkOrgId(req, res)) return;
    try {
      const members = await teamsService.listMembers(req.params.teamId, req.orgId!);
      res.json({ members });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        res.status(404).json({ error: 'team_not_found' });
        return;
      }
      throw err;
    }
  })
);

router.post(
  '/api/orgs/:orgId/teams/:teamId/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    if (!checkOrgId(req, res)) return;
    const { userIds } = req.body as { userIds: string[] };
    if (!Array.isArray(userIds) || userIds.length === 0) {
      res.status(400).json({ error: 'userIds must be a non-empty array' });
      return;
    }
    try {
      const result = await teamsService.addMembers(req.params.teamId, req.orgId!, userIds);
      res.json(result);
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        res.status(404).json({ error: 'team_not_found' });
        return;
      }
      throw err;
    }
  })
);

router.delete(
  '/api/orgs/:orgId/teams/:teamId/members/:userId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TEAMS_MANAGE),
  asyncHandler(async (req, res) => {
    if (!checkOrgId(req, res)) return;
    try {
      await teamsService.removeMember(req.params.teamId, req.orgId!, req.params.userId);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        res.status(404).json({ error: 'team_not_found' });
        return;
      }
      throw err;
    }
  })
);

export default router;
