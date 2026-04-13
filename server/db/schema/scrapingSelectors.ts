import { pgTable, uuid, text, integer, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export interface ElementFingerprint {
  tagName: string;
  id: string | null;
  classList: string[];
  attributes: Record<string, string>;
  textContentHash: string;
  textPreview: string;
  domPath: string[];
  parentTag: string;
  siblingTags: string[];
  childTags: string[];
  position: { index: number; total: number };
}

export const scrapingSelectors = pgTable(
  'scraping_selectors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    urlPattern: text('url_pattern').notNull(),
    selectorName: text('selector_name').notNull(),
    selectorGroup: text('selector_group'),
    cssSelector: text('css_selector').notNull(),
    elementFingerprint: jsonb('element_fingerprint').notNull().$type<ElementFingerprint>(),
    hitCount: integer('hit_count').notNull().default(0),
    missCount: integer('miss_count').notNull().default(0),
    lastMatchedAt: timestamp('last_matched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('scraping_selectors_org_idx').on(table.organisationId),
    urlPatternIdx: index('scraping_selectors_url_pattern_idx').on(table.organisationId, table.urlPattern),
    groupIdx: index('scraping_selectors_group_idx').on(table.organisationId, table.selectorGroup),
    upsertKey: unique('scraping_selectors_upsert_key')
      .on(table.organisationId, table.subaccountId, table.urlPattern, table.selectorGroup, table.selectorName)
      .nullsNotDistinct(),
  })
);

export type ScrapingSelector = typeof scrapingSelectors.$inferSelect;
export type NewScrapingSelector = typeof scrapingSelectors.$inferInsert;
