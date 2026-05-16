import { eq, and, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { users, organisations, orgUserRoles } from '../db/schema/index.js';
import { emailService } from './emailService.js';
import { assignOrgUserRole } from './permissionSeedService.js';
import { env } from '../lib/env.js';
import { getOrgSubaccount } from './orgSubaccountService.js';

export class UserService {
  async listUsers(organisationId: string, params: { role?: string; status?: string; limit?: number; offset?: number }) {
    const conditions = [eq(users.organisationId, organisationId), isNull(users.deletedAt)];
    if (params.role) conditions.push(eq(users.role, params.role as 'system_admin' | 'org_admin' | 'manager' | 'user' | 'client_user'));
    if (params.status) conditions.push(eq(users.status, params.status as 'active' | 'inactive' | 'pending'));

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — org-scoped user list; called from route after authenticate middleware"
    const rows = await db
      .select()
      .from(users)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    return rows.map((u) => ({
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
    data: { email: string; role: string; firstName?: string; lastName?: string }
  ) {
    // system_admin inviting another system_admin must use the dedicated endpoint
    if (data.role === 'system_admin') {
      throw { statusCode: 403, message: 'Use the system admin invite endpoint to create system admin accounts' };
    }

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — org-scoped email uniqueness check; called from route after authenticate"
    const existing = await db
      .select()
      .from(users)
      .where(and(eq(users.organisationId, organisationId), eq(users.email, data.email.toLowerCase()), isNull(users.deletedAt)));

    if (existing.length > 0) {
      throw { statusCode: 409, message: 'User with this email already exists in organisation' };
    }

    // Look up the org name for the invitation email
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — org name lookup for invite email; called from route after authenticate"
    const [org] = await db
      .select({ name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, organisationId));

    const orgName = org?.name ?? 'your organisation';

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(Date.now() + env.INVITE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
    const tempHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — insert invited user; org-scoped, called from route after authenticate"
    const [user] = await db
      .insert(users)
      .values({
        organisationId,
        email: data.email.toLowerCase(),
        passwordHash: tempHash,
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        role: data.role as 'org_admin' | 'manager' | 'user' | 'client_user',
        status: 'pending',
        inviteToken,
        inviteExpiresAt,
        invitedByUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Assign the corresponding org-level permission set so the user passes
    // org permission checks as soon as they accept their invite.
    await assignOrgUserRole(organisationId, user.id, data.role);

    try {
      await emailService.sendInvitationEmail(data.email, inviteToken, orgName);
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

  /**
   * Create a team member with a generated temporary password.
   * Returns the plaintext password so the org admin can share it.
   */
  async createTeamMember(
    organisationId: string,
    createdByUserId: string,
    data: { email: string; firstName: string; lastName: string; role?: string }
  ) {
    const role = data.role ?? 'user';
    if (role === 'system_admin') {
      throw { statusCode: 403, message: 'Cannot create system admin via this endpoint' };
    }

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — org-scoped email uniqueness for team member create; called from route"
    const existing = await db
      .select()
      .from(users)
      .where(and(eq(users.organisationId, organisationId), eq(users.email, data.email.toLowerCase()), isNull(users.deletedAt)));

    if (existing.length > 0) {
      throw { statusCode: 409, message: 'User with this email already exists in this organisation' };
    }

    // Generate a readable temporary password
    const tempPassword = this.generateReadablePassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — insert team member; org-scoped, called from route"
    const [user] = await db
      .insert(users)
      .values({
        organisationId,
        email: data.email.toLowerCase(),
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: role as 'org_admin' | 'manager' | 'user' | 'client_user',
        status: 'active',
        invitedByUserId: createdByUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await assignOrgUserRole(organisationId, user.id, role);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      temporaryPassword: tempPassword,
    };
  }

  private generateReadablePassword(): string {
    const words = ['alpha', 'bravo', 'coral', 'delta', 'ember', 'frost', 'grain', 'haven', 'ivory', 'jade', 'karma', 'lunar', 'maple', 'noble', 'orbit', 'prism', 'quest', 'ridge', 'solar', 'terra'];
    const w1 = words[crypto.randomInt(words.length)];
    const w2 = words[crypto.randomInt(words.length)];
    const num = crypto.randomInt(100, 999);
    return `${w1}-${w2}-${num}`;
  }

  async getCurrentUserProfile(userId: string) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — get current user profile; called from authenticated route"
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));

    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    // Workspace subaccount for the user's org — consumed by Home widget
    // (live presence stream) and any other surface needing the canonical
    // workspace-scope id without re-fetching `/api/subaccounts`.
    const orgSubaccount = await getOrgSubaccount(user.organisationId);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      organisationId: user.organisationId,
      defaultAgentTab: user.defaultAgentTab,
      workspaceSubaccountId: orgSubaccount?.id ?? null,
    };
  }

  async updateCurrentUserProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; currentPassword?: string; newPassword?: string }
  ) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — update profile pre-read; called from authenticated route"
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
        throw { statusCode: 400, message: 'Current password is required to set a new password' };
      }
      const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
      if (!valid) {
        throw { statusCode: 400, message: 'Current password incorrect' };
      }
      update.passwordHash = await bcrypt.hash(data.newPassword, 12);
    }

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — update profile write; called from authenticated route"
    const [updated] = await db
      .update(users)
      .set(update)
      .where(eq(users.id, userId))
      .returning();

    return {
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
    };
  }

  async getUser(id: string, organisationId: string) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — org-scoped user lookup; called from route after authenticate"
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
    data: { role?: string; status?: string; firstName?: string; lastName?: string }
  ) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — org-scoped user pre-read for update; called from route"
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

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.role !== undefined) update.role = data.role;
    if (data.status !== undefined) update.status = data.status;
    if (data.firstName !== undefined) update.firstName = data.firstName;
    if (data.lastName !== undefined) update.lastName = data.lastName;

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — org-scoped user update write; called from route"
    const [updated] = await db
      .update(users)
      .set(update)
      .where(and(eq(users.id, id), eq(users.organisationId, organisationId)))
      .returning();

    // Keep org_user_roles in sync when the role changes
    if (data.role !== undefined) {
      // Always remove the existing entry first so demotions to 'user'/'client_user'
      // don't leave stale org-admin access behind.
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — delete stale org_user_roles on role change; called from route"
      await db
        .delete(orgUserRoles)
        .where(and(eq(orgUserRoles.userId, id), eq(orgUserRoles.organisationId, organisationId)));
      // Re-assign if the new role maps to an org-level permission set
      await assignOrgUserRole(organisationId, id, data.role);
    }

    return {
      id: updated.id,
      role: updated.role,
      status: updated.status,
    };
  }

  async deleteUser(id: string, organisationId: string, requestingUserId: string) {
    if (id === requestingUserId) {
      throw { statusCode: 400, message: 'Cannot delete your own account' };
    }

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — org-scoped user pre-read for delete; called from route"
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.organisationId, organisationId), isNull(users.deletedAt)));

    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    const now = new Date();
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — org-scoped user soft-delete; called from route"
    await db.update(users).set({ deletedAt: now, updatedAt: now }).where(and(eq(users.id, id), eq(users.organisationId, organisationId)));

    return { message: 'User deleted successfully' };
  }

  async listSystemAdmins() {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — list system admins; cross-tenant admin operation"
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

    return rows;
  }

  async inviteSystemAdmin(
    callerOrgId: string,
    invitedByUserId: string,
    data: { email: string; firstName?: string; lastName?: string }
  ) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — cross-tenant email uniqueness for system admin invite"
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, data.email.toLowerCase()), isNull(users.deletedAt)));

    if (existing.length > 0) {
      throw { statusCode: 409, message: 'A user with this email already exists on the platform' };
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(Date.now() + env.INVITE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
    const tempHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — insert system admin user; cross-tenant admin operation"
    const [newUser] = await db
      .insert(users)
      .values({
        organisationId: callerOrgId,
        email: data.email.toLowerCase(),
        passwordHash: tempHash,
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        role: 'system_admin',
        status: 'pending',
        inviteToken,
        inviteExpiresAt,
        invitedByUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    try {
      await emailService.sendInvitationEmail(data.email, inviteToken, 'Automation OS');
    } catch (err) {
      console.error('[EMAIL] Failed to send system admin invitation email to', data.email, ':', err instanceof Error ? err.message : 'Unknown error');
    }

    return {
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
      status: newUser.status,
      inviteExpiresAt: newUser.inviteExpiresAt,
    };
  }

  async resetUserPassword(id: string, newPassword: string) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — admin password reset user lookup; cross-tenant admin operation"
    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));

    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="user service — admin password reset write; cross-tenant admin operation"
    await db
      .update(users)
      .set({ passwordHash, status: 'active', updatedAt: new Date() })
      .where(eq(users.id, id));

    return { message: 'Password reset successfully', email: user.email };
  }
}

export const userService = new UserService();
