import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { userService } from '../services/userService.js';
import { parsePositiveInt, validateBody } from '../middleware/validate.js';
import { inviteUserBody, createMemberBody, updateProfileBody, updateUserBody } from '../schemas/users.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();
const inviteRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

router.get('/api/users', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_VIEW), asyncHandler(async (req, res) => {
  const result = await userService.listUsers(req.orgId!, {
    role: req.query.role as string | undefined,
    status: req.query.status as string | undefined,
    limit: parsePositiveInt(req.query.limit),
    offset: parsePositiveInt(req.query.offset),
  });
  res.json(result);
}));

router.post('/api/users/invite', authenticate, inviteRateLimit, requireOrgPermission(ORG_PERMISSIONS.USERS_INVITE), validateBody(inviteUserBody, 'warn'), asyncHandler(async (req, res) => {
  const { email, role, firstName, lastName } = req.body;
  if (!email || !role) {
    res.status(400).json({ error: 'Validation failed', details: 'email and role are required' });
    return;
  }
  const result = await userService.inviteUser(req.orgId!, req.user!.id, { email, role, firstName, lastName });
  res.status(201).json(result);
}));

router.post('/api/users/create-member', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_INVITE), validateBody(createMemberBody, 'warn'), asyncHandler(async (req, res) => {
  const { email, firstName, lastName, role } = req.body;
  if (!email || !firstName || !lastName) {
    res.status(400).json({ error: 'Validation failed', details: 'email, firstName, and lastName are required' });
    return;
  }
  const result = await userService.createTeamMember(req.orgId!, req.user!.id, { email, firstName, lastName, role });
  res.status(201).json(result);
}));

router.get('/api/users/me', authenticate, asyncHandler(async (req, res) => {
  const result = await userService.getCurrentUserProfile(req.user!.id);
  res.json(result);
}));

router.patch('/api/users/me', authenticate, validateBody(updateProfileBody, 'warn'), asyncHandler(async (req, res) => {
  const result = await userService.updateCurrentUserProfile(req.user!.id, req.body);
  res.json(result);
}));

router.get('/api/users/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_VIEW), asyncHandler(async (req, res) => {
  const result = await userService.getUser(req.params.id, req.orgId!);
  res.json(result);
}));

router.patch('/api/users/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_EDIT), validateBody(updateUserBody, 'warn'), asyncHandler(async (req, res) => {
  const result = await userService.updateUser(req.params.id, req.orgId!, req.body);
  res.json(result);
}));

router.delete('/api/users/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_DELETE), asyncHandler(async (req, res) => {
  const result = await userService.deleteUser(req.params.id, req.orgId!, req.user!.id);
  res.json(result);
}));

export default router;
