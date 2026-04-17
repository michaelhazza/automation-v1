import { eq, and, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations, users } from '../db/schema/index.js';
import { emailService } from './emailService.js';
import { assignOrgUserRole } from './permissionSeedService.js';
import { policyEngineService } from './policyEngineService.js';
import { ensureOrgSubaccount } from './orgSubaccountService.js';
import crypto from 'crypto';
import { env } from '../lib/env.js';

export class OrganisationService {
  async listOrganisations(params: { status?: string; limit?: number; offset?: number }) {
    const conditions = [isNull(organisations.deletedAt)];
    if (params.status) conditions.push(eq(organisations.status, params.status as 'active' | 'suspended'));

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    return db.select().from(organisations).where(and(...conditions)).limit(limit).offset(offset);
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
      .where(and(isNull(organisations.deletedAt), or(eq(organisations.name, data.name), eq(organisations.slug, data.slug))));

    if (existing.length > 0) {
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

    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default ?? bcryptModule;
    const tempHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);

    const [adminUser] = await db.insert(users).values({
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
    }).returning({ id: users.id });

    // Assign the org_admin permission set so the new admin passes org permission checks
    await assignOrgUserRole(org.id, adminUser.id, 'org_admin');

    // Seed the wildcard fallback policy rule for this new org
    await policyEngineService.seedFallbackRule(org.id).catch((err) => {
      // Non-fatal — the policy engine falls back to registry defaults if missing
      console.error('[OrganisationService] Failed to seed policy fallback rule:', err);
    });

    // Create the org subaccount (the org's own workspace)
    await ensureOrgSubaccount(org.id, org.name).catch((err) => {
      // Non-fatal at creation time — org subaccount will be created lazily if needed
      console.error('[OrganisationService] Failed to create org subaccount:', err instanceof Error ? err.message : err);
    });

    try {
      await emailService.sendInvitationEmail(data.adminEmail, inviteToken, org.name);
    } catch (err) {
      console.error('[EMAIL] Failed to send org admin invitation email to', data.adminEmail, ':', err instanceof Error ? err.message : 'Unknown error');
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
      brandColor: org.brandColor ?? null,
      requireAgentApproval: org.requireAgentApproval ?? false,
      pulseMajorThreshold: org.pulseMajorThreshold ?? null,
      defaultCurrencyCode: org.defaultCurrencyCode ?? 'AUD',
    };
  }

  async updateOrganisation(id: string, data: {
    name?: string; plan?: string; status?: string; settings?: unknown;
    logoUrl?: string | null; brandColor?: string | null; requireAgentApproval?: boolean;
    pulseMajorThreshold?: { perActionMinor: number; perRunMinor: number } | null;
    defaultCurrencyCode?: string;
  }) {
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
    // Branding
    if (data.logoUrl !== undefined) update.logoUrl = data.logoUrl;
    if (data.brandColor !== undefined) {
      // Strict hex validation
      if (data.brandColor !== null && !/^#[0-9a-fA-F]{6}$/.test(data.brandColor)) {
        throw { statusCode: 400, message: 'brandColor must be a valid hex colour (e.g. #6366f1)' };
      }
      update.brandColor = data.brandColor;
    }
    // Governance
    if (data.requireAgentApproval !== undefined) update.requireAgentApproval = data.requireAgentApproval;
    // Pulse thresholds
    if (data.pulseMajorThreshold !== undefined) {
      if (data.pulseMajorThreshold !== null) {
        const MAX = 1_000_000;
        const { perActionMinor, perRunMinor } = data.pulseMajorThreshold;
        if (typeof perActionMinor !== 'number' || perActionMinor < 0 || typeof perRunMinor !== 'number' || perRunMinor < 0) {
          throw { statusCode: 400, message: 'Pulse thresholds must be non-negative numbers' };
        }
        if (perActionMinor > MAX || perRunMinor > MAX) {
          throw { statusCode: 400, message: `Pulse thresholds must not exceed ${MAX} minor units ($${MAX / 100})` };
        }
      }
      update.pulseMajorThreshold = data.pulseMajorThreshold;
    }
    if (data.defaultCurrencyCode !== undefined) {
      if (!/^[A-Z]{3}$/.test(data.defaultCurrencyCode)) {
        throw { statusCode: 400, message: 'defaultCurrencyCode must be a 3-character uppercase ISO 4217 code' };
      }
      update.defaultCurrencyCode = data.defaultCurrencyCode;
    }

    const [updated] = await db
      .update(organisations)
      .set(update)
      .where(eq(organisations.id, id))
      .returning();

    return {
      id: updated.id,
      name: updated.name,
      plan: updated.plan,
      status: updated.status,
      brandColor: updated.brandColor ?? null,
      requireAgentApproval: updated.requireAgentApproval ?? false,
      pulseMajorThreshold: updated.pulseMajorThreshold ?? null,
      defaultCurrencyCode: updated.defaultCurrencyCode ?? 'AUD',
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

    const { processCategories } = await import('../db/schema/index.js');
    await db.update(processCategories).set({ deletedAt: now, updatedAt: now }).where(
      and(eq(processCategories.organisationId, id), isNull(processCategories.deletedAt))
    );

    const { processes } = await import('../db/schema/index.js');
    await db.update(processes).set({ deletedAt: now, updatedAt: now }).where(
      and(eq(processes.organisationId, id), isNull(processes.deletedAt))
    );

    return { message: 'Organisation deleted successfully' };
  }
}

export const organisationService = new OrganisationService();
