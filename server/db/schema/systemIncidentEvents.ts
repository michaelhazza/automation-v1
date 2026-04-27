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
  | 'diagnosis'                 // Phase 2: agent annotated diagnosis (generic)
  | 'note'                      // free-form human note
  // ── Phase 2 (System Monitor active layer) ────────────────────────────────
  | 'agent_diagnosis_added'     // agent wrote a diagnosis + investigate_prompt (spec §12.1)
  | 'agent_triage_skipped'      // triage was skipped — rate-limited, self-check, not eligible
  | 'agent_triage_failed'       // triage failed after exhausting retries (spec §9.8)
  | 'agent_auto_escalated'      // auto-escalation past rate limit (spec §9.9)
  | 'heuristic_fired'           // sweep heuristic fired for an entity
  | 'heuristic_suppressed'      // sweep heuristic fire was suppressed
  | 'sweep_completed'           // sweep tick completed (spec §9.3)
  | 'sweep_capped'              // sweep tick hit candidate or payload cap
  | 'prompt_generated'          // investigate_prompt generated (audit stamp)
  | 'investigate_prompt_outcome'// operator marked prompt useful/not (spec §11)
  | 'synthetic_check_fired'     // a synthetic check fired (spec §8)
  | 'baseline_refreshed'        // baseline window refreshed successfully
  | 'baseline_refresh_failed'   // baseline refresh job failed
  | 'agent_triage_timed_out';   // worker died; staleness sweep flipped row to failed (spec §4.3)

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
