import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations, users } from '../db/schema/index.js';
import { userService } from './userService.js';
import { emailService } from './emailService.js';
import crypto from 'crypto';
import { env } from '../lib/env.js';

export class OrganisationService {
  async listOrganisations(params: { status?: string; limit?: number; offset?: number }) {
    const query = db.select().from(organisations).where(isNull(organisations.deletedAt));
    const rows = await query;

    let result = rows;
    if (params.status) {
      result = result.filter((o) => o.status === params.status);
    }

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    return result.slice(offset, offset + limit);
  }

  async createOrganisation(data: {
    name: string;
    slug: string;
    plan: string;
    adminEmail: string;
    adminFirstName: string;
    adminLastName: string;
  }) {
    const existing = await db
      .select()
      .from(organisations)
      .where(and(isNull(organisations.deletedAt)));

    const nameTaken = existing.some((o) => o.name === data.name);
    const slugTaken = existing.some((o) => o.slug === data.slug);

    if (nameTaken || slugTaken) {
      throw { statusCode: 409, message: 'Organisation name or slug already in use' };
    }

    const [org] = await db
      .insert(organisations)
      .values({
        name: data.name,
        slug: data.slug,
        plan: data.plan as 'starter' | 'pro' | 'agency',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Create initial org_admin with invite
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(Date.now() + env.INVITE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    const bcrypt = await import('bcryptjs');
    const tempHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);

    await db.insert(users).values({
      organisationId: org.id,
      email: data.adminEmail.toLowerCase(),
      passwordHash: tempHash,
      firstName: data.adminFirstName,
      lastName: data.adminLastName,
      role: 'org_admin',
      status: 'pending',
      inviteToken,
      inviteExpiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    try {
      await emailService.sendInvitationEmail(data.adminEmail, inviteToken, org.name);
    } catch {
      // Email failure should not fail org creation
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      status: org.status,
    };
  }

  async getOrganisation(id: string) {
    const [org] = await db
      .select()
      .from(organisations)
      .where(and(eq(organisations.id, id), isNull(organisations.deletedAt)));

    if (!org) {
      throw { statusCode: 404, message: 'Organisation not found' };
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      status: org.status,
      settings: org.settings,
      createdAt: org.createdAt,
    };
  }

  async updateOrganisation(id: string, data: { name?: string; plan?: string; status?: string; settings?: unknown }) {
    const [org] = await db
      .select()
      .from(organisations)
      .where(and(eq(organisations.id, id), isNull(organisations.deletedAt)));

    if (!org) {
      throw { statusCode: 404, message: 'Organisation not found' };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.plan !== undefined) update.plan = data.plan;
    if (data.status !== undefined) update.status = data.status;
    if (data.settings !== undefined) update.settings = data.settings;

    const [updated] = await db
      .update(organisations)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(organisations.id, id))
      .returning();

    return {
      id: updated.id,
      name: updated.name,
      plan: updated.plan,
      status: updated.status,
    };
  }

  async deleteOrganisation(id: string) {
    const [org] = await db
      .select()
      .from(organisations)
      .where(and(eq(organisations.id, id), isNull(organisations.deletedAt)));

    if (!org) {
      throw { statusCode: 404, message: 'Organisation not found' };
    }

    const now = new Date();
    await db.update(organisations).set({ deletedAt: now, updatedAt: now }).where(eq(organisations.id, id));

    // Cascade soft delete to child tables
    await db.update(users).set({ deletedAt: now, updatedAt: now }).where(
      and(eq(users.organisationId, id), isNull(users.deletedAt))
    );

    const { workflowEngines } = await import('../db/schema/index.js');
    await db.update(workflowEngines).set({ deletedAt: now, updatedAt: now }).where(
      and(eq(workflowEngines.organisationId, id), isNull(workflowEngines.deletedAt))
    );

    const { taskCategories } = await import('../db/schema/index.js');
    await db.update(taskCategories).set({ deletedAt: now, updatedAt: now }).where(
      and(eq(taskCategories.organisationId, id), isNull(taskCategories.deletedAt))
    );

    const { tasks } = await import('../db/schema/index.js');
    await db.update(tasks).set({ deletedAt: now, updatedAt: now }).where(
      and(eq(tasks.organisationId, id), isNull(tasks.deletedAt))
    );

    const { permissionGroups } = await import('../db/schema/index.js');
    await db.update(permissionGroups).set({ deletedAt: now, updatedAt: now }).where(
      and(eq(permissionGroups.organisationId, id), isNull(permissionGroups.deletedAt))
    );

    return { message: 'Organisation deleted successfully' };
  }
}

export const organisationService = new OrganisationService();
