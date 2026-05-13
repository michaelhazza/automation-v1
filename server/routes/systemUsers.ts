import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { userService } from '../services/userService.js';

const router = Router();
const inviteRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
const resetPasswordRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

// List all system admin users — system_admin only
router.get('/api/system/users', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const rows = await userService.listSystemAdmins();
  res.json(rows);
}));

// Invite a new system admin — system_admin only
router.post('/api/system/users/invite', authenticate, inviteRateLimit, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { email, firstName, lastName } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Validation failed', details: 'email is required' });
    return;
  }

  try {
    const result = await userService.inviteSystemAdmin(req.orgId!, req.user!.id, { email, firstName, lastName });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw err;
  }
}));

// Reset any user's password — system_admin only
router.post('/api/system/users/:id/reset-password', authenticate, resetPasswordRateLimit, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const result = await userService.resetUserPassword(req.params.id, newPassword);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw err;
  }
}));

export default router;
