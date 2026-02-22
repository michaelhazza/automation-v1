import { eq, and, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { users, permissionGroupMembers } from '../db/schema/index.js';
import { emailService } from './emailService.js';
import { env } from '../lib/env.js';

// Roles that managers are NOT permitted to assign or modify
const MANAGER_RESTRICTED_ROLES = ['system_admin', 'org_admin', 'manager'];

export class UserService {
  async listUsers(organisationId: string, params: { role?: string; status?: string; limit?: number; offset?: number }) {
    const conditions = [eq(users.organisationId, organisationId), isNull(users.deletedAt)];
    if (params.role) conditions.push(eq(users.role, params.role as 'system_admin' | 'org_admin' | 'manager' | 'user' | 'client_user'));
    if (params.status) conditions.push(eq(users.status, params.status as 'active' | 'inactive' | 'pending'));

    const rows = await db
      .select()
      .from(users)
      .where(and(...conditions));

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    return rows.slice(offset, offset + limit).map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    }));
  }

  async inviteUser(
    organisationId: string,
    invitedByUserId: string,
    callerRole: string,
    data: { email: string; role: string; firstName?: string; lastName?: string }
  ) {
    // Managers can only invite users at the user/client_user level
    if (callerRole === 'manager' && MANAGER_RESTRICTED_ROLES.includes(data.role)) {
      throw { statusCode: 403, message: 'Managers can only invite users with role: user or client_user' };
    }

    // org_admin cannot create system_admin accounts
    if (callerRole === 'org_admin' && data.role === 'system_admin') {
      throw { statusCode: 403, message: 'Cannot assign system_admin role' };
    }

    const existing = await db
      .select()
      .from(users)
      .where(and(eq(users.organisationId, organisationId), eq(users.email, data.email.toLowerCase()), isNull(users.deletedAt)));

    if (existing.length > 0) {
      throw { statusCode: 409, message: 'User with this email already exists in organisation' };
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(Date.now() + env.INVITE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
    const tempHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);

    const [user] = await db
      .insert(users)
      .values({
        organisationId,
        email: data.email.toLowerCase(),
        passwordHash: tempHash,
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        role: data.role as 'org_admin' | 'manager' | 'user',
        status: 'pending',
        inviteToken,
        inviteExpiresAt,
        invitedByUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    try {
      await emailService.sendInvitationEmail(data.email, inviteToken, organisationId);
    } catch (err) {
      console.error('[EMAIL] Failed to send invitation email to', data.email, ':', err instanceof Error ? err.message : 'Unknown error');
    }

    return {
      id: user.id,
      email: user.email,
      status: user.status,
      inviteExpiresAt: user.inviteExpiresAt,
    };
  }

  async getCurrentUserProfile(userId: string) {
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
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      organisationId: user.organisationId,
    };
  }

  async updateCurrentUserProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; currentPassword?: string; newPassword?: string }
  ) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));

    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (data.firstName !== undefined) update.firstName = data.firstName;
    if (data.lastName !== undefined) update.lastName = data.lastName;

    if (data.newPassword) {
      if (!data.currentPassword) {
        throw { statusCode: 400, message: 'Current password incorrect' };
      }
      const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
      if (!valid) {
        throw { statusCode: 400, message: 'Current password incorrect' };
      }
      update.passwordHash = await bcrypt.hash(data.newPassword, 12);
    }

    const [updated] = await db
      .update(users)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(users.id, userId))
      .returning();

    return {
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
    };
  }

  async getUser(id: string, organisationId: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.organisationId, organisationId), isNull(users.deletedAt)));

    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
    };
  }

  async updateUser(
    id: string,
    organisationId: string,
    callerRole: string,
    data: { role?: string; status?: string; firstName?: string; lastName?: string }
  ) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.organisationId, organisationId), isNull(users.deletedAt)));

    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    if (user.role === 'system_admin') {
      throw { statusCode: 400, message: 'Cannot modify system_admin role via this endpoint' };
    }

    // Managers cannot modify other managers, org_admins, or system_admins
    if (callerRole === 'manager' && MANAGER_RESTRICTED_ROLES.includes(user.role)) {
      throw { statusCode: 403, message: 'Managers cannot modify users with admin or manager roles' };
    }

    // Managers cannot promote a user to manager or above
    if (callerRole === 'manager' && data.role && MANAGER_RESTRICTED_ROLES.includes(data.role)) {
      throw { statusCode: 403, message: 'Managers can only assign role: user or client_user' };
    }

    // org_admin cannot assign system_admin
    if (callerRole === 'org_admin' && data.role === 'system_admin') {
      throw { statusCode: 403, message: 'Cannot assign system_admin role' };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.role !== undefined) update.role = data.role;
    if (data.status !== undefined) update.status = data.status;
    if (data.firstName !== undefined) update.firstName = data.firstName;
    if (data.lastName !== undefined) update.lastName = data.lastName;

    const [updated] = await db
      .update(users)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(and(eq(users.id, id), eq(users.organisationId, organisationId)))
      .returning();

    return {
      id: updated.id,
      role: updated.role,
      status: updated.status,
    };
  }

  async deleteUser(id: string, organisationId: string, requestingUserId: string, callerRole: string) {
    if (id === requestingUserId) {
      throw { statusCode: 400, message: 'Cannot delete your own account' };
    }

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.organisationId, organisationId), isNull(users.deletedAt)));

    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    // Managers can only delete users with role user or client_user
    if (callerRole === 'manager' && MANAGER_RESTRICTED_ROLES.includes(user.role)) {
      throw { statusCode: 403, message: 'Managers cannot remove users with admin or manager roles' };
    }

    const now = new Date();
    await db.update(users).set({ deletedAt: now, updatedAt: now }).where(and(eq(users.id, id), eq(users.organisationId, organisationId)));

    // Hard delete permission group memberships
    await db.delete(permissionGroupMembers).where(eq(permissionGroupMembers.userId, id));

    return { message: 'User deleted successfully' };
  }
}

export const userService = new UserService();
