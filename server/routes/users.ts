import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { userService } from '../services/userService.js';
import { parsePositiveInt } from '../middleware/validate.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

router.get('/api/users', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_VIEW), asyncHandler(async (req, res) => {
  const result = await userService.listUsers(req.orgId!, {
    role: req.query.role as string | undefined,
    status: req.query.status as string | undefined,
    limit: parsePositiveInt(req.query.limit),
    offset: parsePositiveInt(req.query.offset),
  });
  res.json(result);
}));

router.post('/api/users/invite', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_INVITE), asyncHandler(async (req, res) => {
  const { email, role, firstName, lastName } = req.body;
  if (!email || !role) {
    res.status(400).json({ error: 'Validation failed', details: 'email and role are required' });
    return;
  }
  const result = await userService.inviteUser(req.orgId!, req.user!.id, { email, role, firstName, lastName });
  res.status(201).json(result);
}));

router.get('/api/users/me', authenticate, asyncHandler(async (req, res) => {
  const result = await userService.getCurrentUserProfile(req.user!.id);
  res.json(result);
}));

router.patch('/api/users/me', authenticate, asyncHandler(async (req, res) => {
  const result = await userService.updateCurrentUserProfile(req.user!.id, req.body);
  res.json(result);
}));

router.get('/api/users/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_VIEW), asyncHandler(async (req, res) => {
  const result = await userService.getUser(req.params.id, req.orgId!);
  res.json(result);
}));

router.patch('/api/users/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_EDIT), asyncHandler(async (req, res) => {
  const result = await userService.updateUser(req.params.id, req.orgId!, req.body);
  res.json(result);
}));

router.delete('/api/users/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.USERS_DELETE), asyncHandler(async (req, res) => {
  const result = await userService.deleteUser(req.params.id, req.orgId!, req.user!.id);
  res.json(result);
}));

export default router;
