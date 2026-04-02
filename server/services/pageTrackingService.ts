import { db } from '../db/index.js';
import { pageViews } from '../db/schema/index.js';

export const pageTrackingService = {
  async recordView(data: { pageId: string; sessionId?: string; referrer?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string }) {
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
