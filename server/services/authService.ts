import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, organisations } from '../db/schema/index.js';
import { env } from '../lib/env.js';
import { emailService } from './emailService.js';

const JWT_EXPIRY = '24h';

function signToken(payload: { id: string; organisationId: string; role: string; email: string }): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export class AuthService {
  async login(email: string, password: string, organisationSlug?: string) {
    const normalizedEmail = email.toLowerCase();
    const rows = await db
      .select({
        user: users,
        organisationSlug: organisations.slug,
      })
      .from(users)
      .innerJoin(organisations, eq(organisations.id, users.organisationId))
      .where(
        and(
          eq(users.email, normalizedEmail),
          isNull(users.deletedAt),
          isNull(organisations.deletedAt),
          ...(organisationSlug ? [eq(organisations.slug, organisationSlug)] : [])
        )
      );

    if (!organisationSlug && rows.length > 1) {
      throw { statusCode: 400, message: 'Multiple accounts found for this email. Provide organisationSlug to continue.' };
    }

    const row = rows[0];
    const user = row?.user;

    if (!user) {
      throw { statusCode: 401, message: 'Invalid email or password' };
    }

    if (user.status === 'inactive') {
      throw { statusCode: 403, message: 'Account is inactive or suspended' };
    }

    if (user.status === 'pending') {
      throw { statusCode: 403, message: 'Account is inactive or suspended' };
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw { statusCode: 401, message: 'Invalid email or password' };
    }

    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const token = signToken({
      id: user.id,
      organisationId: user.organisationId,
      role: user.role,
      email: user.email,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organisationId: user.organisationId,
      },
    };
  }

  async acceptInvite(token: string, password: string, firstName: string, lastName: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.inviteToken, token),
          isNull(users.deletedAt),
          gt(users.inviteExpiresAt, new Date())
        )
      );

    if (!user) {
      throw { statusCode: 400, message: 'Invalid or expired invitation token' };
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db
      .update(users)
      .set({
        firstName,
        lastName,
        passwordHash,
        status: 'active',
        inviteToken: null,
        inviteExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const jwtToken = signToken({
      id: user.id,
      organisationId: user.organisationId,
      role: user.role,
      email: user.email,
    });

    return {
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        firstName,
        lastName,
        role: user.role,
        organisationId: user.organisationId,
      },
    };
  }

  async forgotPassword(email: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)));

    // Always return success to avoid email enumeration
    if (!user || user.status !== 'active') {
      return { message: 'If that email exists, a reset link has been sent.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiresAt = new Date(Date.now() + env.PASSWORD_RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await db
      .update(users)
      .set({
        passwordResetToken: resetToken,
        passwordResetExpiresAt: resetExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    try {
      await emailService.sendPasswordResetEmail(user.email, resetToken);
    } catch (err) {
      console.error('[EMAIL] Failed to send password reset email to', user.email, ':', err instanceof Error ? err.message : 'Unknown error');
    }

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.passwordResetToken, token),
          isNull(users.deletedAt),
          gt(users.passwordResetExpiresAt, new Date())
        )
      );

    if (!user) {
      throw { statusCode: 400, message: 'Invalid or expired password reset token' };
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await db
      .update(users)
      .set({
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { message: 'Password has been reset successfully. You can now log in.' };
  }

  async getCurrentUser(userId: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));

    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organisationId: user.organisationId,
    };
  }

  async logout() {
    return { message: 'Logged out successfully' };
  }
}

export const authService = new AuthService();
