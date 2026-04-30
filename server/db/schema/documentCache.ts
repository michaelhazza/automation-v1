import { pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { integrationConnections } from './integrationConnections';

export const documentCache = pgTable(
  'document_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    subaccountId:   uuid('subaccount_id').notNull().references(() => subaccounts.id,   { onDelete: 'cascade' }),
    provider:        varchar('provider', { length: 64 }).notNull(),
    fileId:          varchar('file_id', { length: 1024 }).notNull(),
    connectionId:    uuid('connection_id').notNull().references(() => integrationConnections.id, { onDelete: 'cascade' }),
    content:         text('content').notNull(),
    revisionId:      varchar('revision_id', { length: 512 }),
    fetchedAt:       timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    contentSizeTokens: integer('content_size_tokens').notNull(),
    contentHash:     varchar('content_hash', { length: 64 }).notNull(),
    resolverVersion: integer('resolver_version').notNull(),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerFileConnUniq: uniqueIndex('document_cache_provider_file_connection_uniq').on(t.provider, t.fileId, t.connectionId),
  })
);

export type DocumentCacheRow = typeof documentCache.$inferSelect;
export type NewDocumentCacheRow = typeof documentCache.$inferInsert;
