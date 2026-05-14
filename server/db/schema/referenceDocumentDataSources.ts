import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { referenceDocuments } from './referenceDocuments';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { scheduledTasks } from './scheduledTasks';
import { tasks } from './tasks';

// ---------------------------------------------------------------------------
// Reference Document Data Sources — five-tier scope links between reference
// documents and the agents/subaccounts/tasks that consume them.
// Five-tier scope: organisation tier (all four FKs null), subaccount tier,
// agent tier, scheduled_task tier, task_instance tier (spec §4.1).
// Partial unique indexes per tier and the HNSW-style CONSTRAINT CHECK live
// in the SQL migration only (Drizzle does not support complex partial unique
// expressions involving multiple IS NULL conditions).
// ---------------------------------------------------------------------------

export const referenceDocumentDataSources = pgTable(
  'reference_document_data_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull().references(() => referenceDocuments.id, { onDelete: 'cascade' }),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    scheduledTaskId: uuid('scheduled_task_id').references(() => scheduledTasks.id, { onDelete: 'cascade' }),
    taskInstanceId: uuid('task_instance_id').references(() => tasks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    orgDocActiveIdx: index('rdds_org_doc_idx')
      .on(t.organisationId, t.documentId)
      .where(sql`${t.deletedAt} IS NULL`),
    subaccountIdx: index('rdds_subaccount_idx')
      .on(t.subaccountId)
      .where(sql`${t.subaccountId} IS NOT NULL`),
    agentIdx: index('rdds_agent_idx')
      .on(t.agentId)
      .where(sql`${t.agentId} IS NOT NULL`),
    scheduledTaskIdx: index('rdds_scheduled_task_idx')
      .on(t.scheduledTaskId)
      .where(sql`${t.scheduledTaskId} IS NOT NULL`),
    taskInstanceIdx: index('rdds_task_instance_idx')
      .on(t.taskInstanceId)
      .where(sql`${t.taskInstanceId} IS NOT NULL`),
  })
);

export type ReferenceDocumentDataSource = typeof referenceDocumentDataSources.$inferSelect;
export type NewReferenceDocumentDataSource = typeof referenceDocumentDataSources.$inferInsert;

// Scope tier type — matches the five-tier model from spec §4.1
export type ReferenceDocumentScopeTier = 'organisation' | 'subaccount' | 'agent' | 'scheduled_task' | 'task_instance';
