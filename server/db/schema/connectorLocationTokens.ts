import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { connectorConfigs } from './connectorConfigs.js';

export const connectorLocationTokens = pgTable(
  'connector_location_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectorConfigId: uuid('connector_config_id').notNull().references(() => connectorConfigs.id),
    locationId: text('location_id').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    scope: text('scope').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // Partial unique index (live_uniq) is SQL-only — Drizzle cannot express WHERE.
    // Secondary index for expiry sweep:
    expiresIdx: index('connector_location_tokens_expires_idx').on(table.expiresAt),
  }),
);

export type ConnectorLocationToken = typeof connectorLocationTokens.$inferSelect;
export type NewConnectorLocationToken = typeof connectorLocationTokens.$inferInsert;
