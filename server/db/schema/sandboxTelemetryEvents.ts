import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { subaccounts } from './subaccounts.js';

// ---------------------------------------------------------------------------
// sandbox_telemetry_events — structured lifecycle events per execution (spec §20.5, §14.1).
// Closed event-type enum enforced at DB layer via CHECK constraint in the migration.
// Ordered by (sandbox_execution_id, sequence) for deterministic iteration.
// ---------------------------------------------------------------------------

// Surface A — closed enum from spec §14.2.
// Changes require a spec amendment + migration extending the CHECK constraint.
export const SANDBOX_TELEMETRY_EVENT_TYPES = [
  'sandbox_start',
  'sandbox_start_failed',
  'sandbox_terminal',
  'sandbox_timeout',
  'sandbox_cost_ceiling_hit',
  'sandbox_crashed',
  'output_validation_failed',
  'output_validated',
  'harvest_started',
  'harvest_failed',
  'artefact_uploaded',
  'artefact_upload_failed',
  'credential_injection_denied',
  'credential_leak_attempted',
  'egress_audited',
  'provider_diagnostic',
  'provider_unavailable',
  'runtime_install_requested',
  'runtime_install_denied',
  'runtime_install_completed',
] as const;

export type SandboxTelemetryEventType = typeof SANDBOX_TELEMETRY_EVENT_TYPES[number];

export const SANDBOX_TELEMETRY_CRITICALITIES = ['info', 'warn', 'error'] as const;
export type SandboxTelemetryCriticality = typeof SANDBOX_TELEMETRY_CRITICALITIES[number];

export const sandboxTelemetryEvents = pgTable(
  'sandbox_telemetry_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sandboxExecutionId: uuid('sandbox_execution_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'restrict' }),
    runId: uuid('run_id').notNull(),
    agentId: uuid('agent_id').notNull(),
    taskId: text('task_id').notNull(),

    // Provider + template context (denormalised for query convenience)
    provider: text('provider').notNull(),
    templateName: text('template_name').notNull(),
    templateVersion: text('template_version').notNull(),

    // Event classification (closed enum — see SANDBOX_TELEMETRY_EVENT_TYPES above)
    eventType: text('event_type').notNull().$type<SandboxTelemetryEventType>(),
    eventAt: timestamp('event_at', { withTimezone: true }).defaultNow().notNull(),
    // Per-execution ordered sequence; allocated atomically at write time (spec §14.1)
    sequence: integer('sequence').notNull(),
    criticality: text('criticality').notNull().$type<SandboxTelemetryCriticality>(),

    // Event-specific structured payload; schema declared per event type in spec §14.2
    payloadJson: jsonb('payload_json'),
  },
  (table) => ({
    // DB-level idempotency + ordering (spec §20.5)
    executionSequenceUniq: uniqueIndex('sandbox_telemetry_events_execution_sequence_uniq')
      .on(table.sandboxExecutionId, table.sequence),
    orgEventAtIdx: index('sandbox_telemetry_events_org_event_at_idx').on(table.organisationId, table.eventAt),
    // Partial index for warn/error — ops queries filter on these for paging
    eventTypeWarnErrorIdx: index('sandbox_telemetry_events_event_type_warn_error_idx')
      .on(table.eventType, table.eventAt)
      .where(sql`${table.criticality} IN ('warn', 'error')`),
  }),
);

export type SandboxTelemetryEvent = typeof sandboxTelemetryEvents.$inferSelect;
export type NewSandboxTelemetryEvent = typeof sandboxTelemetryEvents.$inferInsert;
