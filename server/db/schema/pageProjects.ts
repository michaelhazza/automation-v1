import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export const pageProjects = pgTable(
  'page_projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    theme: jsonb('theme').$type<{
      primaryColor?: string;
      secondaryColor?: string;
      fontHeading?: string;
      fontBody?: string;
      logoUrl?: string;
      faviconUrl?: string;
    }>(),
    customDomain: text('custom_domain'),
    githubRepo: text('github_repo'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    subaccountIdx: index('page_projects_subaccount_idx').on(table.subaccountId),
    orgIdx: index('page_projects_org_idx').on(table.organisationId),
    slugSubaccountIdx: index('page_projects_slug_subaccount_idx').on(table.subaccountId, table.slug),
  })
);

export type PageProject = typeof pageProjects.$inferSelect;
export type NewPageProject = typeof pageProjects.$inferInsert;
