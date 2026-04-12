import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const modules = pgTable(
  'modules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    allowedAgentSlugs: jsonb('allowed_agent_slugs').$type<string[] | null>(),
    allowAllAgents: boolean('allow_all_agents').notNull().default(false),
    sidebarConfig: jsonb('sidebar_config').$type<string[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    slugUniqueIdx: uniqueIndex('modules_slug_unique_idx')
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type Module = typeof modules.$inferSelect;
export type NewModule = typeof modules.$inferInsert;
