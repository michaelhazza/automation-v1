import { pgTable, uuid, text, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { pageProjects } from './pageProjects';
import { integrationConnections } from './integrationConnections';

export const projectIntegrations = pgTable(
  'project_integrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').notNull().references(() => pageProjects.id),
    purpose: text('purpose').notNull().$type<'crm' | 'payments' | 'email' | 'ads' | 'analytics'>(),
    connectionId: uuid('connection_id').notNull().references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectPurposeUnique: unique('project_integrations_project_purpose').on(table.projectId, table.purpose),
    projectIdx: index('project_integrations_project_idx').on(table.projectId),
  })
);

export type ProjectIntegration = typeof projectIntegrations.$inferSelect;
export type NewProjectIntegration = typeof projectIntegrations.$inferInsert;
