import { pgTable, uuid, text, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { actions } from './actions';
import { agentRuns } from './agentRuns';
import { users } from './users';

// ---------------------------------------------------------------------------
// Review Items — human-facing projection of actions needing approval
// ---------------------------------------------------------------------------

export const reviewItems = pgTable(
  'review_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    agentRunId: uuid('agent_run_id')
      .references(() => agentRuns.id),

    reviewStatus: text('review_status').notNull().default('pending').$type<
      'pending' | 'edited_pending' | 'approved' | 'rejected' | 'completed'
    >(),
    reviewPayloadJson: jsonb('review_payload_json').notNull(),
    humanEditJson: jsonb('human_edit_json'),

    reviewedBy: uuid('reviewed_by')
      .references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actionUnique: unique('review_items_action_unique').on(table.actionId),
    subaccountStatusIdx: index('review_items_subaccount_status_idx').on(table.subaccountId, table.reviewStatus),
    agentRunIdx: index('review_items_agent_run_idx').on(table.agentRunId),
    orgIdx: index('review_items_org_idx').on(table.organisationId),
  })
);

export type ReviewItem = typeof reviewItems.$inferSelect;
export type NewReviewItem = typeof reviewItems.$inferInsert;
