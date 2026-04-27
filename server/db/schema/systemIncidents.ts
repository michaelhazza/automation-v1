// BYPASSES RLS — every reader MUST be sysadmin-gated at the route/service layer.
// See spec §7.4 Option A and architecture.md "System Incidents + Monitoring Foundation".
import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';
import { tasks } from './tasks';
import { agentRuns } from './agentRuns';

export type SystemIncidentSource = 'route' | 'job' | 'agent' | 'connector' | 'skill' | 'llm' | 'synthetic' | 'self';
export type SystemIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SystemIncidentClassification = 'user_fault' | 'system_fault' | 'persistent_defect';
export type SystemIncidentStatus = 'open' | 'investigating' | 'remediating' | 'resolved' | 'suppressed' | 'escalated';

export const systemIncidents = pgTable(
  'system_incidents',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Identity & dedupe
    fingerprint: text('fingerprint').notNull(),
    source: text('source').notNull().$type<SystemIncidentSource>(),
    severity: text('severity').notNull().default('medium').$type<SystemIncidentSeverity>(),
    classification: text('classification').notNull().default('system_fault').$type<SystemIncidentClassification>(),

    // Status lifecycle
    status: text('status').notNull().default('open').$type<SystemIncidentStatus>(),

    // Counts & timestamps
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),

    // Scope (nullable — system-level incidents have no org)
    organisationId: uuid('organisation_id').references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    // Resource linkage
    affectedResourceKind: text('affected_resource_kind'),
    affectedResourceId: text('affected_resource_id'),

    // Error content (snapshot of the most recent occurrence)
    errorCode: text('error_code'),
    summary: text('summary').notNull(),
    latestErrorDetail: jsonb('latest_error_detail'),
    latestStack: text('latest_stack'),
    latestCorrelationId: text('latest_correlation_id'),

    // Human lifecycle metadata
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedByUserId: uuid('acknowledged_by_user_id').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    resolutionNote: text('resolution_note'),
    linkedPrUrl: text('linked_pr_url'),

    // Escalation metadata
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    escalatedTaskId: uuid('escalated_task_id').references(() => tasks.id),
    escalationCount: integer('escalation_count').notNull().default(0),
    previousTaskIds: uuid('previous_task_ids').array().notNull().default(sql`'{}'`),

    // Test-incident flag — hidden from default list, never auto-escalates
    isTestIncident: boolean('is_test_incident').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    // Agent triage — Phase A+2 additions (migration 0233)
    investigatePrompt: text('investigate_prompt'),
    agentDiagnosis: jsonb('agent_diagnosis'),
    agentDiagnosisRunId: uuid('agent_diagnosis_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    promptWasUseful: boolean('prompt_was_useful'),
    promptFeedbackText: text('prompt_feedback_text'),
    triageAttemptCount: integer('triage_attempt_count').notNull().default(0),
    lastTriageAttemptAt: timestamp('last_triage_attempt_at', { withTimezone: true }),
    sweepEvidenceRunIds: uuid('sweep_evidence_run_ids').array().notNull().default(sql`'{}'`),
  },
  (table) => ({
    // One active incident per fingerprint. Resolved/suppressed rows do not block
    // new 'open' rows — the partial index allows multiple rows with the same
    // fingerprint as long as at most one has an "active" status.
    uniqueActiveFingerprint: uniqueIndex('system_incidents_active_fingerprint_idx')
      .on(table.fingerprint)
      .where(sql`${table.status} IN ('open', 'investigating', 'remediating', 'escalated')`),
    statusSeverityIdx: index('system_incidents_status_severity_idx')
      .on(table.status, table.severity, table.lastSeenAt),
    sourceIdx: index('system_incidents_source_idx').on(table.source, table.status),
    orgIdx: index('system_incidents_org_idx')
      .on(table.organisationId, table.status)
      .where(sql`${table.organisationId} IS NOT NULL`),
    classificationIdx: index('system_incidents_classification_idx').on(table.classification, table.status),
  })
);

export type SystemIncident = typeof systemIncidents.$inferSelect;
export type NewSystemIncident = typeof systemIncidents.$inferInsert;
