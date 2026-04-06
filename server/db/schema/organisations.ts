import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const organisations = pgTable(
  'organisations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    plan: text('plan').notNull().$type<'starter' | 'pro' | 'agency'>(),
    status: text('status').notNull().default('active').$type<'active' | 'suspended'>(),
    settings: jsonb('settings'),
    orgExecutionEnabled: boolean('org_execution_enabled').notNull().default(true),
    // ── Branding ──────────────────────────────────────────────────────
    logoUrl: text('logo_url'),
    brandColor: text('brand_color'), // hex colour e.g. '#6366f1'
    // ── Governance ────────────────────────────────────────────────────
    requireAgentApproval: boolean('require_agent_approval').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    nameUniqueIdx: uniqueIndex('organisations_name_unique_idx')
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    slugUniqueIdx: uniqueIndex('organisations_slug_unique_idx')
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    slugIdx: index('organisations_slug_idx').on(table.slug),
    statusIdx: index('organisations_status_idx').on(table.status),
  })
);

import { sql } from 'drizzle-orm';

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
