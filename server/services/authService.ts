import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, organisations } from '../db/schema/index.js';
import { env } from '../lib/env.js';
import { emailService } from './emailService.js';
import { subscriptionService } from './subscriptionService.js';

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

  async signup(agencyName: string, email: string, password: string) {
    const normalizedEmail = email.toLowerCase().trim();

    // Check for existing user with this email
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, normalizedEmail), isNull(users.deletedAt)));

    if (existing) {
      throw { statusCode: 409, message: 'An account with this email already exists.' };
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Generate a URL-safe slug from the agency name
    const baseSlug = agencyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'agency';

    // Ensure slug uniqueness with a random suffix if needed
    let slug = baseSlug;
    const [slugConflict] = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(and(eq(organisations.slug, slug), isNull(organisations.deletedAt)));
    if (slugConflict) {
      slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
    }

    // Derive first/last name from email local-part
    const localPart = normalizedEmail.split('@')[0];
    const nameParts = localPart.split(/[._-]/);
    const firstName = nameParts[0] ? nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1) : 'Admin';
    const lastName = nameParts[1] ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1) : '';

    // Wrap org + user creation in a transaction to prevent orphaned org rows
    const { org, user } = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organisations)
        .values({
          name: agencyName.trim(),
          slug,
          plan: 'starter',
          status: 'active',
        })
        .returning();

      const [user] = await tx
        .insert(users)
        .values({
          organisationId: org.id,
          email: normalizedEmail,
          passwordHash,
          firstName,
          lastName: lastName || 'User',
          role: 'org_admin',
          status: 'active',
        })
        .returning();

      return { org, user };
    });

    // Assign the Starter subscription (14-day trial) — non-blocking; failure should not block signup
    try {
      const starterSub = await subscriptionService.getSubscriptionBySlug('starter');
      await subscriptionService.assignSubscription(org.id, starterSub.id);
    } catch (err) {
      console.error('[AuthService.signup] Failed to assign starter subscription:', err);
    }

    // Send welcome email asynchronously (non-blocking)
    emailService.sendWelcomeEmail(normalizedEmail, firstName, agencyName).catch((err) => {
      console.error('[AuthService.signup] Welcome email failed:', err);
    });

    const jwtToken = signToken({
      id: user.id,
      organisationId: org.id,
      role: user.role,
      email: user.email,
    });

    return {
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organisationId: org.id,
      },
    };
  }
}

export const authService = new AuthService();
