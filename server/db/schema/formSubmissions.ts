import { pgTable, uuid, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { pages } from './pages';

export const formSubmissions = pgTable(
  'form_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').notNull().references(() => pages.id),
    data: jsonb('data').notNull(),
    submissionHash: text('submission_hash').notNull(),
    integrationStatus: text('integration_status')
      .notNull()
      .default('pending')
      .$type<'pending' | 'processing' | 'success' | 'partial_failure' | 'failed'>(),
    integrationResults: jsonb('integration_results'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    hashUnique: unique('form_submissions_hash_unique').on(table.submissionHash),
    pageIdx: index('form_submissions_page_idx').on(table.pageId),
    submittedAtIdx: index('form_submissions_submitted_at_idx').on(table.submittedAt),
    statusIdx: index('form_submissions_status_idx').on(table.integrationStatus),
  })
);

export type FormSubmission = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;
