import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { users } from './users';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Feedback Votes — thumbs up/down on agent-generated outputs
// NOTE: Intentionally hard-delete (not soft-delete). Votes are ephemeral
// user preferences, not audit-worthy records. See CC-3 exception in spec.
// ---------------------------------------------------------------------------

export const feedbackVotes = pgTable(
  'feedback_votes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    entityType: text('entity_type').notNull().$type<'task_activity' | 'task_deliverable' | 'agent_message'>(),
    entityId: uuid('entity_id').notNull(),
    vote: text('vote').notNull().$type<'up' | 'down'>(),
    comment: text('comment'), // optional reason for downvote
    agentId: uuid('agent_id')
      .references(() => agents.id), // which agent produced the output
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userEntityUniq: uniqueIndex('feedback_user_entity_uniq').on(table.userId, table.entityType, table.entityId),
    agentIdx: index('feedback_agent_idx').on(table.agentId),
    orgIdx: index('feedback_org_idx').on(table.organisationId),
    agentTimeIdx: index('feedback_agent_time_idx').on(table.agentId, table.createdAt),
  })
);

export type FeedbackVote = typeof feedbackVotes.$inferSelect;
export type NewFeedbackVote = typeof feedbackVotes.$inferInsert;
