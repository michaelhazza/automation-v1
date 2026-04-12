import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { db } from '../db/index.js';
import { users } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../lib/env.js';
import { emailService } from '../services/emailService.js';

const router = Router();
const inviteRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
const resetPasswordRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

// List all system admin users — system_admin only
router.get('/api/system/users', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.role, 'system_admin'), isNull(users.deletedAt)));

  res.json(rows);
}));

// Invite a new system admin — system_admin only
router.post('/api/system/users/invite', authenticate, inviteRateLimit, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { email, firstName, lastName } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Validation failed', details: 'email is required' });
    return;
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)));

  if (existing.length > 0) {
    res.status(409).json({ error: 'A user with this email already exists on the platform' });
    return;
  }

  const inviteToken = crypto.randomBytes(32).toString('hex');
  const inviteExpiresAt = new Date(Date.now() + env.INVITE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
  const tempHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);

  const callerOrgId = req.orgId!;

  const [newUser] = await db
    .insert(users)
    .values({
      organisationId: callerOrgId,
      email: email.toLowerCase(),
      passwordHash: tempHash,
      firstName: firstName ?? '',
      lastName: lastName ?? '',
      role: 'system_admin',
      status: 'pending',
      inviteToken,
      inviteExpiresAt,
      invitedByUserId: req.user!.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  try {
    await emailService.sendInvitationEmail(email, inviteToken, 'Automation OS');
  } catch (err) {
    console.error('[EMAIL] Failed to send system admin invitation email to', email, ':', err instanceof Error ? err.message : 'Unknown error');
  }

  res.status(201).json({
    id: newUser.id,
    email: newUser.email,
    role: newUser.role,
    status: newUser.status,
    inviteExpiresAt: newUser.inviteExpiresAt,
  });
}));

// Reset any user's password — system_admin only
router.post('/api/system/users/:id/reset-password', authenticate, resetPasswordRateLimit, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, req.params.id), isNull(users.deletedAt)));

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(users)
    .set({ passwordHash, status: 'active', updatedAt: new Date() })
    .where(eq(users.id, req.params.id));

  res.json({ message: 'Password reset successfully', email: user.email });
}));

export default router;
