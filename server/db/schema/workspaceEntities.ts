import { pgTable, uuid, text, real, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Workspace Entities — named entities extracted from agent runs
// ---------------------------------------------------------------------------

export const workspaceEntities = pgTable(
  'workspace_entities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),

    name: text('name').notNull(),                    // normalized (lowercase, trimmed)
    displayName: text('display_name').notNull(),     // original casing
    entityType: text('entity_type').notNull()
      .$type<'person' | 'company' | 'product' | 'project' | 'location' | 'other'>(),

    attributes: jsonb('attributes').default('{}'),
    confidence: real('confidence'),                  // LLM confidence at extraction (0.0–1.0)

    mentionCount: integer('mention_count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    subaccountIdx: index('workspace_entities_subaccount_idx').on(table.subaccountId),
    orgIdx: index('workspace_entities_org_idx').on(table.organisationId),
    // M-21: partial unique — excludes soft-deleted rows so names can be reused
    uniqueEntity: uniqueIndex('workspace_entities_unique').on(
      table.subaccountId,
      table.name,
      table.entityType
    ).where(sql`${table.deletedAt} IS NULL`),
  })
);

export type WorkspaceEntity = typeof workspaceEntities.$inferSelect;
export type NewWorkspaceEntity = typeof workspaceEntities.$inferInsert;
