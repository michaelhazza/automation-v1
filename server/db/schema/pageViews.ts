import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { pages } from './pages';

export const pageViews = pgTable(
  'page_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').notNull().references(() => pages.id),
    sessionId: text('session_id'),
    referrer: text('referrer'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    country: text('country'),
    deviceType: text('device_type'),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pageIdx: index('page_views_page_idx').on(table.pageId),
    pageViewedAtIdx: index('page_views_page_viewed_at_idx').on(table.pageId, table.viewedAt),
  })
);

export type PageView = typeof pageViews.$inferSelect;
export type NewPageView = typeof pageViews.$inferInsert;
