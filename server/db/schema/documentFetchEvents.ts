import { pgTable, uuid, varchar, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export const documentFetchEvents = pgTable(
  'document_fetch_events',
  {
    id:              uuid('id').primaryKey().defaultRandom(),
    organisationId:  uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    subaccountId:    uuid('subaccount_id').notNull().references(() => subaccounts.id,    { onDelete: 'cascade' }),
    referenceId:     uuid('reference_id'),
    referenceType:   varchar('reference_type', { length: 32 }).notNull(),
    runId:           uuid('run_id'),
    fetchedAt:       timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    cacheHit:        boolean('cache_hit').notNull(),
    provider:        varchar('provider', { length: 64 }).notNull(),
    docName:         varchar('doc_name', { length: 512 }),
    revisionId:      varchar('revision_id', { length: 512 }),
    tokensUsed:      integer('tokens_used').notNull(),
    tokensBeforeTruncation: integer('tokens_before_truncation'),
    resolverVersion: integer('resolver_version').notNull(),
    failureReason:   varchar('failure_reason', { length: 64 }),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subaccountIdx: index('document_fetch_events_subaccount_idx').on(t.subaccountId),
    referenceIdx:  index('document_fetch_events_reference_idx').on(t.referenceId, t.referenceType),
    runIdx:        index('document_fetch_events_run_idx').on(t.runId),
    fetchedAtIdx:  index('document_fetch_events_fetched_at_idx').on(t.fetchedAt),
  })
);

export type DocumentFetchEventRow = typeof documentFetchEvents.$inferSelect;
export type NewDocumentFetchEventRow = typeof documentFetchEvents.$inferInsert;

export const FETCH_FAILURE_REASONS = [
  'auth_revoked',
  'file_deleted',
  'rate_limited',
  'network_error',
  'quota_exceeded',
  'budget_exceeded',
  'unsupported_content',
] as const;

export type FetchFailureReason = (typeof FETCH_FAILURE_REASONS)[number];
