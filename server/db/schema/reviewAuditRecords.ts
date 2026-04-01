import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { actions } from './actions';
import { agentRuns } from './agentRuns';
import { users } from './users';

// ---------------------------------------------------------------------------
// Review Audit Records — append-only HumanFeedbackResult log (CrewAI pattern)
// One row per human decision on a review-gated action.
// The DB CHECK constraint enforces comment requirement on rejection.
// ---------------------------------------------------------------------------

export const reviewAuditRecords = pgTable(
  'review_audit_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actionId: uuid('action_id').notNull().references(() => actions.id),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
    toolSlug: text('tool_slug').notNull(),

    /** Snapshot of the agent's proposed args at review time */
    agentOutput: jsonb('agent_output').notNull(),

    decidedBy: uuid('decided_by').notNull().references(() => users.id),
    decision: text('decision').notNull().$type<'approved' | 'rejected' | 'edited' | 'timed_out'>(),
    rawFeedback: text('raw_feedback'),
    /** LLM-collapsed outcome, written asynchronously after the record is inserted */
    collapsedOutcome: text('collapsed_outcome').$type<'approved' | 'rejected' | 'needs_revision'>(),
    /** Populated only when decision = 'edited' */
    editedArgs: jsonb('edited_args'),

    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
    /** decided_at minus proposed_at in milliseconds */
    waitDurationMs: integer('wait_duration_ms'),
  },
  (table) => ({
    orgIdx: index('review_audit_org_idx').on(table.organisationId, table.decidedAt),
    subaccountIdx: index('review_audit_subaccount_idx').on(table.subaccountId, table.decidedAt),
    actionIdx: index('review_audit_action_idx').on(table.actionId),
  }),
);

export type ReviewAuditRecord = typeof reviewAuditRecords.$inferSelect;
export type NewReviewAuditRecord = typeof reviewAuditRecords.$inferInsert;
