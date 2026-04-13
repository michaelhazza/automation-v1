import { pgTable, uuid, text, integer, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export const scrapingCache = pgTable(
  'scraping_cache',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    url: text('url').notNull(),
    contentHash: text('content_hash').notNull(),
    extractedData: jsonb('extracted_data'),
    rawContentPreview: text('raw_content_preview'),
    ttlSeconds: integer('ttl_seconds').notNull().default(3600),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgUrlIdx: unique('scraping_cache_org_url_idx')
      .on(table.organisationId, table.subaccountId, table.url)
      .nullsNotDistinct(),
    fetchedAtIdx: index('scraping_cache_fetched_at_idx').on(table.fetchedAt),
    expiryIdx: index('scraping_cache_expiry_idx').on(table.fetchedAt, table.ttlSeconds),
  })
);

export type ScrapingCache = typeof scrapingCache.$inferSelect;
export type NewScrapingCache = typeof scrapingCache.$inferInsert;
