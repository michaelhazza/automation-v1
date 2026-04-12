import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// slack_conversations — Feature 4: Slack Conversational Surface
// Thread → agent conversation mapping for persistent Slack threads.
// ---------------------------------------------------------------------------

export const slackConversations = pgTable(
  'slack_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    agentId: uuid('agent_id')
      .references(() => agents.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').notNull(),
    channelId: text('channel_id').notNull(),
    threadTs: text('thread_ts').notNull(),
    agentRunId: uuid('agent_run_id')
      .references(() => agentRuns.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadUnique: uniqueIndex('slack_conversations_thread_idx').on(
      table.workspaceId, table.channelId, table.threadTs,
    ),
    orgIdx: index('slack_conversations_org_idx').on(table.organisationId),
  }),
);

export type SlackConversation = typeof slackConversations.$inferSelect;
export type NewSlackConversation = typeof slackConversations.$inferInsert;
