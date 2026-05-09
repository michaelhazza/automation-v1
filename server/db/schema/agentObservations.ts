import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { agentRuns } from './agentRuns';
import { agentExecutionEvents } from './agentExecutionEvents';
import { users } from './users';

// ---------------------------------------------------------------------------
// agent_observations — append-only typed observation rows per agent run.
// Migration 0295. Spec: tasks/builds/agent-workspace/spec.md §6.
// Immutability enforced by the agent_observations_immutability_guard trigger.
// Self-referencing FK (supersedes_observation_id) lives in the migration;
// Drizzle treats it as a plain uuid to avoid circular-type inference.
// ---------------------------------------------------------------------------

export const agentObservations = pgTable(
  'agent_observations',
  {
    id:                       uuid('id').defaultRandom().primaryKey(),
    organisationId:           uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId:             uuid('subaccount_id').references(() => subaccounts.id),
    agentId:                  uuid('agent_id').notNull().references(() => agents.id),
    runId:                    uuid('run_id').references(() => agentRuns.id),
    eventId:                  uuid('event_id').notNull().references(() => agentExecutionEvents.id),
    observationType:          text('observation_type').notNull().$type<'learned' | 'detected' | 'decided' | 'flagged' | 'produced'>(),
    body:                     text('body').notNull(),
    bodyTruncated:            boolean('body_truncated').notNull().default(false),
    metadata:                 jsonb('metadata').notNull().default({}).$type<Record<string, unknown>>(),
    supersedesObservationId:  uuid('supersedes_observation_id'),
    isPinned:                 boolean('is_pinned').notNull().default(false),
    pinnedBy:                 uuid('pinned_by').references(() => users.id),
    pinnedAt:                 timestamp('pinned_at', { withTimezone: true }),
    createdAt:                timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey:           text('idempotency_key').notNull(),
  },
  (table) => ({
    agentCreatedIdx:    index('agent_observations_agent_created_idx').on(table.agentId, table.createdAt),
    runIdx:             index('agent_observations_run_idx').on(table.runId).where(sql`${table.runId} IS NOT NULL`),
    eventIdx:           index('agent_observations_event_idx').on(table.eventId),
    pinnedIdx:          index('agent_observations_pinned_idx').on(table.agentId, table.createdAt).where(sql`${table.isPinned} = true`),
    supersedesIdx:      index('agent_observations_supersedes_idx').on(table.supersedesObservationId).where(sql`${table.supersedesObservationId} IS NOT NULL`),
    dedupeIdx:          uniqueIndex('agent_observations_dedupe').on(table.idempotencyKey),
  }),
);

export type AgentObservation = typeof agentObservations.$inferSelect;
export type NewAgentObservation = typeof agentObservations.$inferInsert;
