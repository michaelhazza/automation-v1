import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    title: text('title').notNull(),
    reportType: text('report_type').notNull().default('portfolio_health').$type<'portfolio_health' | 'ad_hoc'>(),
    status: text('status').notNull().default('generating').$type<'generating' | 'complete' | 'error'>(),
    totalClients: integer('total_clients').notNull().default(0),
    healthyCount: integer('healthy_count').notNull().default(0),
    attentionCount: integer('attention_count').notNull().default(0),
    atRiskCount: integer('at_risk_count').notNull().default(0),
    htmlContent: text('html_content'),
    metadata: jsonb('metadata'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    isFirstReport: boolean('is_first_report').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('reports_org_id_idx').on(table.organisationId),
    orgGeneratedAtIdx: index('reports_org_generated_at_idx').on(table.organisationId, table.generatedAt),
  })
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
