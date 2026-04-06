import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { agents } from './agents';
import { users } from './users';

export const agentPromptRevisions = pgTable(
  'agent_prompt_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    revisionNumber: integer('revision_number').notNull(),
    masterPrompt: text('master_prompt').notNull(),
    additionalPrompt: text('additional_prompt').notNull(),
    promptHash: text('prompt_hash').notNull(),
    changeDescription: text('change_description'),
    changedBy: uuid('changed_by').references(() => users.id),
    changedByAgentId: uuid('changed_by_agent_id').references(() => agents.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index('agent_prompt_rev_agent_idx').on(table.agentId),
    agentNumUniq: uniqueIndex('agent_prompt_rev_agent_num_uniq').on(table.agentId, table.revisionNumber),
    createdIdx: index('agent_prompt_rev_created_idx').on(table.agentId, table.createdAt),
  })
);

export type AgentPromptRevision = typeof agentPromptRevisions.$inferSelect;
export type NewAgentPromptRevision = typeof agentPromptRevisions.$inferInsert;
