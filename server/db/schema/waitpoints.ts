import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// waitpoints — generalised pause/resume primitive.
//
// Spec: docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md §4.1
//
// Three kinds:
//   'oauth'          — bound to an agent run; resume_queue required
//   'approval'       — bound via resumePayload; resume_queue must be null
//   'external_event' — unconstrained in V1 (no callers yet)
//
// CHECK constraints enforce per-kind invariants at the DB layer (defence in
// depth alongside service-layer validation in waitpointService.ts).
// ---------------------------------------------------------------------------

export const waitpoints = pgTable(
  'waitpoints',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull().$type<'oauth' | 'approval' | 'external_event'>(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id'),
    boundRunId: uuid('bound_run_id').references(() => agentRuns.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending').$type<'pending' | 'completed' | 'expired'>(),
    resumeQueue: text('resume_queue'),
    resumePayload: jsonb('resume_payload').notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    orgStatusIdx: index('waitpoints_org_status_idx').on(table.organisationId, table.status),
    boundRunIdx: index('waitpoints_bound_run_idx').on(table.boundRunId),
  }),
);

export type Waitpoint = typeof waitpoints.$inferSelect;
export type NewWaitpoint = typeof waitpoints.$inferInsert;
