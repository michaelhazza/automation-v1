import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { agents } from './agents';
import { scorecards } from './scorecards';

// ---------------------------------------------------------------------------
// Agent Scorecard Attachments — many-to-many join of agents and scorecards.
// Trust & Verification Layer spec §6.4, §7 (migration 0291).
// Tenant-isolated via canonical org-isolation RLS policy.
// ---------------------------------------------------------------------------

export const agentScorecardAttachments = pgTable(
  'agent_scorecard_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    scorecardId: uuid('scorecard_id').notNull().references(() => scorecards.id),
    attachAuthority: text('attach_authority')
      .notNull()
      .$type<'system_mandatory' | 'org_mandatory' | 'suggested'>(),
    gradingFrequency: text('grading_frequency')
      .notNull()
      .default('q1')
      .$type<'off' | 'q1' | 'q2' | 'q3'>(),
    attachedAt: timestamp('attached_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('agent_scorecard_attachments_org_idx').on(table.organisationId),
    agentIdx: index('agent_scorecard_attachments_agent_idx').on(table.agentId),
    scorecardIdx: index('agent_scorecard_attachments_scorecard_idx').on(table.scorecardId),
    agentScorecardUniq: unique('agent_scorecard_attachments_agent_scorecard_uniq')
      .on(table.agentId, table.scorecardId),
  })
);

export type AgentScorecardAttachment = typeof agentScorecardAttachments.$inferSelect;
export type NewAgentScorecardAttachment = typeof agentScorecardAttachments.$inferInsert;
