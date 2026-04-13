import { pgTable, uuid, text, integer, real, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Agent Beliefs — discrete, agent-maintained facts per agent-subaccount.
// Phase 1: confidence-scored, individually addressable, supersession-ready.
// Spec: docs/beliefs-spec.md
// ---------------------------------------------------------------------------

export const agentBeliefs = pgTable(
  'agent_beliefs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),

    // Belief content
    beliefKey: text('belief_key').notNull(),
    category: text('category').notNull().default('general'),
    subject: text('subject'),
    value: text('value').notNull(),
    confidence: real('confidence').notNull().default(0.7),

    // Provenance
    sourceRunId: uuid('source_run_id'),
    evidenceCount: integer('evidence_count').notNull().default(1),
    source: text('source').notNull().default('agent'),
    confidenceReason: text('confidence_reason'),
    lastReinforcedAt: timestamp('last_reinforced_at', { withTimezone: true }),

    // Supersession (Phase 2 — nullable in Phase 1)
    supersededBy: uuid('superseded_by'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    activeKeyUniq: uniqueIndex('agent_beliefs_active_key_uniq')
      .on(table.organisationId, table.subaccountId, table.agentId, table.beliefKey)
      .where(sql`${table.deletedAt} IS NULL AND ${table.supersededBy} IS NULL`),
    activeLookup: index('agent_beliefs_active_lookup')
      .on(table.organisationId, table.subaccountId, table.agentId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.supersededBy} IS NULL`),
  })
);

export type AgentBelief = typeof agentBeliefs.$inferSelect;
export type NewAgentBelief = typeof agentBeliefs.$inferInsert;
