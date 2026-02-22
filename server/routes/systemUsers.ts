import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../lib/env.js';
import { emailService } from '../services/emailService.js';

const router = Router();

// List all system admin users — system_admin only
router.get('/api/system/users', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
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
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// Invite a new system admin — system_admin only
// The new system admin is placed in the calling admin's organisation (the platform org)
router.post('/api/system/users/invite', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    const { email, firstName, lastName } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Validation failed', details: 'email is required' });
      return;
    }

    // Prevent duplicate: any non-deleted user with this email anywhere on the platform
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

    // Use the calling system_admin's organisationId as the "platform" org for the new system admin
    const callerOrgId = req.user!.organisationId;

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
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
