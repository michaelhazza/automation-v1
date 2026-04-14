import { pgTable, uuid, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { users } from './users';

export const configHistory = pgTable(
  'config_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull().$type<Record<string, unknown>>(),
    changedBy: uuid('changed_by').references(() => users.id),
    changeSource: text('change_source')
      .notNull()
      .default('ui')
      .$type<'ui' | 'api' | 'config_agent' | 'system_sync' | 'restore'>(),
    sessionId: uuid('session_id'),
    changeSummary: text('change_summary'),
    changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('config_history_org_idx').on(table.organisationId),
    entityIdx: index('config_history_entity_idx').on(table.entityType, table.entityId),
    sessionIdx: index('config_history_session_idx')
      .on(table.sessionId)
      .where(sql`${table.sessionId} IS NOT NULL`),
    changedAtIdx: index('config_history_changed_at_idx').on(table.organisationId, table.changedAt),
    entityVersionUniq: uniqueIndex('config_history_org_entity_version_uniq').on(
      table.organisationId,
      table.entityType,
      table.entityId,
      table.version
    ),
  })
);

export type ConfigHistory = typeof configHistory.$inferSelect;
export type NewConfigHistory = typeof configHistory.$inferInsert;
