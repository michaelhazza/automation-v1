import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { users } from './users';

// ---------------------------------------------------------------------------
// Config Backups — point-in-time snapshots of groups of configuration entities.
// Each backup captures the state of one or more entity types before a bulk
// mutation (e.g. skill analyser apply). Restore replays the snapshot.
// ---------------------------------------------------------------------------

export interface ConfigBackupEntity {
  entityType: string;        // e.g. 'system_skill', 'system_agent'
  entityId: string;          // UUID of the entity row
  snapshot: Record<string, unknown>;
}

export const configBackups = pgTable(
  'config_backups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),

    // What triggered this backup — extensible for future scopes
    scope: text('scope')
      .notNull()
      .$type<'skill_analyzer' | 'manual' | 'config_agent'>(),

    // Human-readable label (e.g. "Before skill analyser job abc123")
    label: text('label').notNull(),

    // Optional reference to the source that triggered the backup
    sourceId: text('source_id'),

    // The actual snapshot payload — array of entity snapshots
    entities: jsonb('entities').notNull().$type<ConfigBackupEntity[]>(),

    // Lifecycle
    status: text('status')
      .notNull()
      .default('active')
      .$type<'active' | 'restored' | 'expired'>(),

    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    // Populated when the backup is restored
    restoredAt: timestamp('restored_at', { withTimezone: true }),
    restoredBy: uuid('restored_by').references(() => users.id),
  },
  (table) => ({
    orgIdx: index('config_backups_org_idx').on(table.organisationId),
    scopeIdx: index('config_backups_scope_idx').on(table.organisationId, table.scope),
    sourceUniq: uniqueIndex('config_backups_source_uniq')
      .on(table.organisationId, table.sourceId)
      .where(sql`${table.sourceId} IS NOT NULL`),
  })
);

export type ConfigBackup = typeof configBackups.$inferSelect;
export type NewConfigBackup = typeof configBackups.$inferInsert;
