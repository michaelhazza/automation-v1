import {
  pgTable, uuid, text, timestamp, boolean, integer, index, jsonb, numeric,
} from 'drizzle-orm/pg-core';
import { tasks } from './tasks.js';

export const fastPathDecisions = pgTable('fast_path_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  briefId: uuid('brief_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  organisationId: uuid('organisation_id').notNull(),
  subaccountId: uuid('subaccount_id'),
  decidedRoute: text('decided_route', {
    enum: ['simple_reply', 'needs_clarification', 'needs_orchestrator', 'cheap_answer'],
  }).notNull(),
  decidedScope: text('decided_scope', { enum: ['subaccount', 'org', 'system'] }).notNull(),
  decidedConfidence: numeric('decided_confidence', { precision: 4, scale: 3 }).notNull(),
  decidedTier: integer('decided_tier').notNull(),
  secondLookTriggered: boolean('second_look_triggered').default(false).notNull(),
  downstreamOutcome: text('downstream_outcome', {
    enum: ['proceeded', 're_issued', 'clarified', 'abandoned', 'user_overrode_scope'],
  }),
  userOverrodeScopeTo: text('user_overrode_scope_to', { enum: ['subaccount', 'org', 'system'] }),
  decidedAt: timestamp('decided_at').defaultNow().notNull(),
  outcomeAt: timestamp('outcome_at'),
  metadata: jsonb('metadata').default({}).notNull(),
}, (table) => ({
  briefIdx: index('fast_path_brief_idx').on(table.briefId),
  orgIdx: index('fast_path_org_idx').on(table.organisationId),
  routeIdx: index('fast_path_route_idx').on(table.decidedRoute),
  decidedAtIdx: index('fast_path_decided_at_idx').on(table.decidedAt),
}));

export type FastPathDecision = typeof fastPathDecisions.$inferSelect;
export type NewFastPathDecision = typeof fastPathDecisions.$inferInsert;
