import { db } from '../db/index.js';
import { pages, pageVersions, pageProjects, type NewPage } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { sanitizePageHtml } from '../lib/htmlSanitizer.js';
import { previewTokenService } from '../lib/previewTokenService.js';

const PAGES_BASE_DOMAIN = process.env.PAGES_BASE_DOMAIN ?? 'synthetos.ai';

function buildPreviewUrl(projectSlug: string, pageSlug: string, token: string): string {
  return `https://${projectSlug}.${PAGES_BASE_DOMAIN}/preview/${pageSlug}?token=${token}`;
}

export const pageService = {
  async getPublishedBySlug(projectId: string, slug: string) {
    const [row] = await db.select().from(pages)
      .where(and(eq(pages.projectId, projectId), eq(pages.slug, slug), eq(pages.status, 'published')));
    return row ?? null;
  },

  async getForPreview(pageId: string, projectId: string, slug: string) {
    const [row] = await db.select().from(pages)
      .where(and(eq(pages.id, pageId), eq(pages.projectId, projectId), eq(pages.slug, slug)));
    return row ?? null;
  },

  async list(projectId: string) {
    return db
      .select()
      .from(pages)
      .where(eq(pages.projectId, projectId));
  },

  async getById(id: string, projectId: string) {
    const [row] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.id, id), eq(pages.projectId, projectId)));
    return row ?? null;
  },

  async create(
    data: {
      projectId: string;
      slug: string;
      pageType: 'website' | 'landing';
      title?: string;
      html?: string;
      meta?: Record<string, unknown>;
      formConfig?: Record<string, unknown>;
      createdByAgentId?: string;
    },
    projectSlug: string
  ) {
    const sanitizedHtml = data.html ? sanitizePageHtml(data.html) : null;

    const [page] = await db
      .insert(pages)
      .values({
        projectId: data.projectId,
        slug: data.slug,
        pageType: data.pageType,
        title: data.title ?? null,
        html: sanitizedHtml,
        status: 'draft',
        meta: (data.meta as typeof pages.$inferInsert['meta']) ?? null,
        formConfig: (data.formConfig as typeof pages.$inferInsert['formConfig']) ?? null,
        createdByAgentId: data.createdByAgentId ?? null,
      })
      .returning();

    // Save initial version
    await db.insert(pageVersions).values({
      pageId: page.id,
      html: sanitizedHtml,
      meta: data.meta ?? null,
      changeNote: 'Initial version',
    });

    const token = previewTokenService.generate(page.id, data.projectId, page.slug, page.createdAt);
    const previewUrl = buildPreviewUrl(projectSlug, page.slug, token);

    return { ...page, previewUrl };
  },

  async update(
    pageId: string,
    projectId: string,
    updates: {
      html?: string;
      meta?: Record<string, unknown>;
      formConfig?: Record<string, unknown>;
      changeNote?: string;
    },
    projectSlug: string
  ) {
    const existing = await this.getById(pageId, projectId);
    if (!existing) throw { statusCode: 404, message: 'Page not found' };

    // Save current state as a version snapshot before updating
    await db.insert(pageVersions).values({
      pageId: existing.id,
      html: existing.html,
      meta: existing.meta,
      changeNote: updates.changeNote ?? null,
    });

    const updateValues: Partial<typeof pages.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (updates.html !== undefined) {
      updateValues.html = sanitizePageHtml(updates.html);
    }
    if (updates.meta !== undefined) {
      updateValues.meta = updates.meta as typeof pages.$inferInsert['meta'];
    }
    if (updates.formConfig !== undefined) {
      updateValues.formConfig = updates.formConfig as typeof pages.$inferInsert['formConfig'];
    }

    const [updated] = await db
      .update(pages)
      .set(updateValues)
      .where(and(eq(pages.id, pageId), eq(pages.projectId, existing.projectId)))
      .returning();

    const token = previewTokenService.generate(pageId, projectId, updated.slug, updated.updatedAt);
    const previewUrl = buildPreviewUrl(projectSlug, updated.slug, token);

    return { ...updated, previewUrl };
  },

  async publish(pageId: string, projectId: string) {
    const existing = await this.getById(pageId, projectId);
    if (!existing) throw { statusCode: 404, message: 'Page not found' };

    const now = new Date();
    const [updated] = await db
      .update(pages)
      .set({
        status: 'published',
        publishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(pages.id, pageId), eq(pages.projectId, existing.projectId)))
      .returning();

    return updated;
  },
};
