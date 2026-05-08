import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { agentRuns } from './agentRuns';
import { agentExecutionEvents } from './agentExecutionEvents';

// ---------------------------------------------------------------------------
// agent_presence_projections — mutable projection of current presence state
// per agent. One row per agent (PK = agent_id). Updated by the presence
// service whenever relevant execution events arrive.
// Migration 0295. Spec: tasks/builds/agent-workspace/spec.md §4.
// ---------------------------------------------------------------------------

export const agentPresenceProjections = pgTable(
  'agent_presence_projections',
  {
    agentId:                   uuid('agent_id').primaryKey().references(() => agents.id),
    organisationId:            uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId:              uuid('subaccount_id').references(() => subaccounts.id),
    presenceState:             text('presence_state').notNull().$type<'idle' | 'running' | 'waiting_on_human' | 'waiting_on_dependency' | 'scheduled' | 'degraded' | 'failed'>(),
    presenceSubtitle:          text('presence_subtitle'),
    activeRunId:               uuid('active_run_id').references(() => agentRuns.id),
    currentFocusText:          text('current_focus_text'),
    currentFocusEventId:       uuid('current_focus_event_id').references(() => agentExecutionEvents.id),
    lastEventId:               uuid('last_event_id').references(() => agentExecutionEvents.id),
    lastEventRunId:            uuid('last_event_run_id').references(() => agentRuns.id),
    lastEventRunSeq:           integer('last_event_run_seq').notNull().default(0),
    lastEventTimestamp:        timestamp('last_event_timestamp', { withTimezone: true }),
    nextRunAt:                 timestamp('next_run_at', { withTimezone: true }),
    scheduledLabel:            text('scheduled_label'),
    degradedReason:            text('degraded_reason').$type<'event_stream_delayed' | 'worker_heartbeat_stale' | 'focus_source_unavailable' | null>(),
    degradedBaseState:         text('degraded_base_state').$type<'idle' | 'running' | 'waiting_on_human' | 'waiting_on_dependency' | 'scheduled' | null>(),
    degradedEnteredAt:         timestamp('degraded_entered_at', { withTimezone: true }),
    degradedOscillationCount:  integer('degraded_oscillation_count').notNull().default(0),
    updatedAt:                 timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subaccountIdx:        index('agent_presence_projections_subaccount_idx').on(table.subaccountId, table.presenceState, table.updatedAt),
    workspaceWidgetIdx:   index('agent_presence_projections_workspace_widget_idx').on(table.organisationId, table.presenceState).where(sql`${table.presenceState} IN ('waiting_on_human','running','failed','scheduled')`),
  }),
);

export type AgentPresenceProjection = typeof agentPresenceProjections.$inferSelect;
export type NewAgentPresenceProjection = typeof agentPresenceProjections.$inferInsert;
