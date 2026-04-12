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

    // Phase 2A: Temporal validity — tracks when entity facts were true
    validFrom: timestamp('valid_from', { withTimezone: true }).defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    supersededBy: uuid('superseded_by'),  // FK to self — points to the newer version

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    subaccountIdx: index('workspace_entities_subaccount_idx').on(table.subaccountId),
    orgIdx: index('workspace_entities_org_idx').on(table.organisationId),
    validityIdx: index('workspace_entities_validity_idx').on(
      table.subaccountId,
      table.validTo
    ),
    // Phase 2A: Only one current (valid_to IS NULL) entity per name+type
    currentUnique: uniqueIndex('workspace_entities_current_unique').on(
      table.subaccountId,
      table.name,
      table.entityType
    ).where(sql`${table.deletedAt} IS NULL AND ${table.validTo} IS NULL`),
  })
);

export type WorkspaceEntity = typeof workspaceEntities.$inferSelect;
export type NewWorkspaceEntity = typeof workspaceEntities.$inferInsert;
