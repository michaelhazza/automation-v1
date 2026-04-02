import { db } from '../db/index.js';
import { pageViews, pages } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

export const pageTrackingService = {
  async recordView(data: {
    pageId: string;
    sessionId?: string;
    referrer?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
  }) {
    // Validate pageId exists and is published — prevents analytics poisoning
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, data.pageId), eq(pages.status, 'published')));

    if (!page) return; // Silently skip invalid/unpublished page IDs

    await db.insert(pageViews).values({
      pageId: data.pageId,
      sessionId: data.sessionId ?? null,
      referrer: data.referrer ?? null,
      utmSource: data.utmSource ?? null,
      utmMedium: data.utmMedium ?? null,
      utmCampaign: data.utmCampaign ?? null,
    });
  },
};
