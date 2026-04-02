import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { formSubmissions } from './formSubmissions';

export const conversionEvents = pgTable(
  'conversion_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').notNull().references(() => pages.id),
    submissionId: uuid('submission_id').references(() => formSubmissions.id),
    eventType: text('event_type')
      .notNull()
      .$type<'form_submitted' | 'checkout_started' | 'checkout_completed' | 'checkout_abandoned' | 'contact_created'>(),
    sessionId: text('session_id'),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pageIdx: index('conversion_events_page_idx').on(table.pageId),
    pageEventTypeIdx: index('conversion_events_page_event_type_idx').on(table.pageId, table.eventType),
    occurredAtIdx: index('conversion_events_occurred_at_idx').on(table.occurredAt),
  })
);

export type ConversionEvent = typeof conversionEvents.$inferSelect;
export type NewConversionEvent = typeof conversionEvents.$inferInsert;
