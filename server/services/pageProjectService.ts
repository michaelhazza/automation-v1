import { db } from '../db/index.js';
import { pageProjects, type NewPageProject } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

const SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Slug uniqueness is enforced GLOBALLY (not per-org or per-subaccount).
 * This is intentional: each slug becomes a subdomain under *.synthetos.ai,
 * and DNS subdomains are globally unique. Two different organisations cannot
 * both have "acme.synthetos.ai".
 */
async function checkSlugUniqueness(
  slug: string,
  excludeId?: string
): Promise<void> {
  const conditions = [
    eq(pageProjects.slug, slug),
    isNull(pageProjects.deletedAt),
  ];

  const [existing] = await db
    .select({ id: pageProjects.id })
    .from(pageProjects)
    .where(and(...conditions));

  if (existing && existing.id !== excludeId) {
    throw { statusCode: 409, message: `Slug "${slug}" is already taken. Page project slugs must be globally unique because they become subdomains.` };
  }
}

export const pageProjectService = {
  async list(subaccountId: string, organisationId: string) {
    return db
      .select()
      .from(pageProjects)
      .where(
        and(
          eq(pageProjects.subaccountId, subaccountId),
          eq(pageProjects.organisationId, organisationId),
          isNull(pageProjects.deletedAt)
        )
      );
  },

  async getById(id: string, subaccountId: string, organisationId: string) {
    const [row] = await db
      .select()
      .from(pageProjects)
      .where(
        and(
          eq(pageProjects.id, id),
          eq(pageProjects.subaccountId, subaccountId),
          eq(pageProjects.organisationId, organisationId),
          isNull(pageProjects.deletedAt)
        )
      );
    return row ?? null;
  },

  async create(data: NewPageProject) {
    if (!SLUG_PATTERN.test(data.slug)) {
      throw { statusCode: 400, message: 'Slug must contain only lowercase letters, numbers, and hyphens' };
    }

    await checkSlugUniqueness(data.slug);

    try {
      const [created] = await db.insert(pageProjects).values(data).returning();
      return created;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        throw { statusCode: 409, message: `Slug "${data.slug}" is already taken. Page project slugs must be globally unique because they become subdomains.` };
      }
      throw err;
    }
  },

  async update(
    id: string,
    subaccountId: string,
    organisationId: string,
    updates: Partial<Pick<NewPageProject, 'name' | 'slug' | 'theme' | 'customDomain' | 'githubRepo'>>
  ) {
    const existing = await this.getById(id, subaccountId, organisationId);
    if (!existing) throw { statusCode: 404, message: 'Page project not found' };

    if (updates.slug !== undefined) {
      if (!SLUG_PATTERN.test(updates.slug)) {
        throw { statusCode: 400, message: 'Slug must contain only lowercase letters, numbers, and hyphens' };
      }
      if (updates.slug !== existing.slug) {
        await checkSlugUniqueness(updates.slug, id);
      }
    }

    const [updated] = await db
      .update(pageProjects)
      .set({ ...updates, updatedAt: new Date() })
      // guard-ignore-next-line: org-scoped-writes reason="existing record verified via getById(id, subaccountId, organisationId) above — org membership already confirmed"
      .where(eq(pageProjects.id, id))
      .returning();

    return updated;
  },

  async softDelete(id: string, subaccountId: string, organisationId: string) {
    const existing = await this.getById(id, subaccountId, organisationId);
    if (!existing) throw { statusCode: 404, message: 'Page project not found' };

    await db
      .update(pageProjects)
      .set({ deletedAt: new Date() })
      // guard-ignore-next-line: org-scoped-writes reason="existing record verified via getById(id, subaccountId, organisationId) above — org membership already confirmed"
      .where(eq(pageProjects.id, id));
  },
};
