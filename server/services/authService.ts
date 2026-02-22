import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema/index.js';
import { env } from '../lib/env.js';

const JWT_EXPIRY = '24h';

function signToken(payload: { id: string; organisationId: string; role: string; email: string }): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export class AuthService {
  async login(email: string, password: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)));

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
