import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Tracks application-level data migration completions.
 * Created in migration 0106_org_subaccount.sql.
 * Keyed by a string identifier; upserted idempotently so startup retries are safe.
 */
export const migrationStates = pgTable('migration_states', {
  key: text('key').primaryKey(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
});

export type MigrationState = typeof migrationStates.$inferSelect;
