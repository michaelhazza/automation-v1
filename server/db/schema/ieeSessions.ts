import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// iee_sessions — IEE session lifecycle rows, one per agent run.
// Migration 0295. Spec: tasks/builds/agent-workspace/spec.md §10.
// ---------------------------------------------------------------------------

export const ieeSessions = pgTable(
  'iee_sessions',
  {
    id:                   uuid('id').defaultRandom().primaryKey(),
    organisationId:       uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId:         uuid('subaccount_id').references(() => subaccounts.id),
    agentId:              uuid('agent_id').notNull().references(() => agents.id),
    runId:                uuid('run_id').notNull().unique().references(() => agentRuns.id),
    parentRunId:          uuid('parent_run_id').references(() => agentRuns.id),
    containerHandle:      text('container_handle'),
    status:               text('status').notNull().$type<'active' | 'idle' | 'torn_down' | 'failed'>(),
    idleTimeoutSeconds:   integer('idle_timeout_seconds').notNull().default(300),
    lastHeartbeatAt:      timestamp('last_heartbeat_at', { withTimezone: true }),
    startedAt:            timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt:           timestamp('released_at', { withTimezone: true }),
    releaseReason:        text('release_reason').$type<'run_completed' | 'idle_timeout' | 'orphan_cleanup' | 'failed' | 'operator_cancelled' | null>(),
    summary:              jsonb('summary'),
    createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentStartedIdx:    index('iee_sessions_agent_started_idx').on(table.agentId, table.startedAt),
    statusActiveIdx:    index('iee_sessions_status_active_idx').on(table.status).where(sql`${table.status} IN ('active','idle')`),
    orphanScanIdx:      index('iee_sessions_orphan_scan_idx').on(table.lastHeartbeatAt).where(sql`${table.status} IN ('active','idle')`),
  }),
);

export type IeeSession = typeof ieeSessions.$inferSelect;
export type NewIeeSession = typeof ieeSessions.$inferInsert;
