// BYPASSES RLS — every reader MUST be sysadmin-gated at the route/service layer.
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { systemIncidents } from './systemIncidents';
import { users } from './users';
import { agentRuns } from './agentRuns';

export type SystemIncidentEventType =
  | 'occurrence'                // the fingerprint fired again
  | 'status_change'             // lifecycle transition
  | 'ack'                       // human acknowledged
  | 'resolve'                   // human resolved
  | 'suppress'                  // human suppressed
  | 'unsuppress'                // suppression lifted (auto or manual)
  | 'escalation'                // manual escalate-to-agent, or Phase 2 auto-escalation
  | 'escalation_blocked'        // guardrail refused an escalation attempt
  | 'resolution_linked_to_task' // resolve happened on an escalated incident — links resolver to the task
  | 'notification_surfaced'     // Phase 0.5 in-app notification fired
  | 'remediation_attempt'       // Phase 3: something tried to fix
  | 'remediation_outcome'       // Phase 3: result of the attempt
  | 'diagnosis'                 // Phase 2: agent annotated diagnosis
  | 'note'                      // free-form human note
  // Triage agent lifecycle events (system monitor triage + diagnosis flow)
  | 'agent_triage_skipped'
  | 'agent_triage_failed'
  | 'agent_triage_timed_out'
  | 'agent_auto_escalated'
  | 'agent_diagnosis_added'
  | 'heuristic_fired'
  | 'heuristic_suppressed'
  | 'sweep_completed'
  | 'sweep_capped'
  | 'prompt_generated';

export type SystemIncidentActorKind = 'system' | 'user' | 'agent';

export const systemIncidentEvents = pgTable(
  'system_incident_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    incidentId: uuid('incident_id').notNull().references(() => systemIncidents.id, { onDelete: 'cascade' }),

    eventType: text('event_type').notNull().$type<SystemIncidentEventType>(),

    actorKind: text('actor_kind').notNull().$type<SystemIncidentActorKind>(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorAgentRunId: uuid('actor_agent_run_id').references(() => agentRuns.id),

    payload: jsonb('payload'),
    correlationId: text('correlation_id'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentTimeIdx: index('system_incident_events_incident_time_idx').on(table.incidentId, table.occurredAt),
    eventTypeIdx: index('system_incident_events_event_type_idx').on(table.eventType, table.occurredAt),
  })
);

export type SystemIncidentEvent = typeof systemIncidentEvents.$inferSelect;
export type NewSystemIncidentEvent = typeof systemIncidentEvents.$inferInsert;
