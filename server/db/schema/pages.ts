import { pgTable, uuid, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { pageProjects } from './pageProjects';
import { agents } from './agents';

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').notNull().references(() => pageProjects.id),
    slug: text('slug').notNull(),
    pageType: text('page_type').notNull().$type<'website' | 'landing'>(),
    title: text('title'),
    html: text('html'),
    status: text('status').notNull().default('draft').$type<'draft' | 'published' | 'archived'>(),
    meta: jsonb('meta').$type<{
      title?: string;
      description?: string;
      ogImage?: string;
      canonicalUrl?: string;
      noIndex?: boolean;
    }>(),
    formConfig: jsonb('form_config').$type<{
      fields: Array<{ name: string; type: string; required: boolean }>;
      actions: Record<string, { action: string; fields: Record<string, unknown> }>;
      thankYou: { type: 'redirect' | 'message'; value: string };
    }>(),
    createdByAgentId: uuid('created_by_agent_id').references(() => agents.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectSlugUnique: unique('pages_project_slug_unique').on(table.projectId, table.slug),
    projectIdx: index('pages_project_idx').on(table.projectId),
    projectStatusIdx: index('pages_project_status_idx').on(table.projectId, table.status),
  })
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
