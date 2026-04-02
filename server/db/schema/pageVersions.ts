import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { pages } from './pages';

export const pageVersions = pgTable(
  'page_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').notNull().references(() => pages.id),
    html: text('html'),
    meta: jsonb('meta'),
    changeNote: text('change_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pageIdx: index('page_versions_page_idx').on(table.pageId),
  })
);

export type PageVersion = typeof pageVersions.$inferSelect;
export type NewPageVersion = typeof pageVersions.$inferInsert;
