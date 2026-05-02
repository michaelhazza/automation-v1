import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Workflow Drafts — orchestrator-authored workflow draft payloads (Workflows V1)
// Migration: 0268_workflows_v1_additive_schema.sql
// ---------------------------------------------------------------------------

export type WorkflowDraftSource = 'orchestrator' | 'studio_handoff';

export const workflowDrafts = pgTable(
  'workflow_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: text('session_id').notNull(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    draftSource: text('draft_source')
      .notNull()
      .default('orchestrator')
      .$type<WorkflowDraftSource>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => ({
    subaccountSessionUniqIdx: uniqueIndex('workflow_drafts_subaccount_session_uniq_idx').on(
      table.subaccountId,
      table.sessionId
    ),
    unconsumedIdx: index('workflow_drafts_unconsumed_idx')
      .on(table.consumedAt, table.createdAt)
      .where(sql`${table.consumedAt} IS NULL`),
  })
);

export type WorkflowDraft = typeof workflowDrafts.$inferSelect;
export type NewWorkflowDraft = typeof workflowDrafts.$inferInsert;
