import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { workspaceActors } from './workspaceActors';

// ---------------------------------------------------------------------------
// Audit Events — lightweight security audit log for compliance & debugging
// ---------------------------------------------------------------------------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .references(() => organisations.id),
    // actorId = auth/request principal (user_id, agent_id, or system origin).
    // Polymorphic — unioned with actorType. Do NOT join across actorId and
    // workspaceActorId: they live in different identity spaces.
    actorId: uuid('actor_id'),
    actorType: text('actor_type').notNull().$type<'user' | 'system' | 'agent'>(),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    correlationId: text('correlation_id'), // end-to-end flow tracing (runId, requestId, etc.)
    ipAddress: text('ip_address'),
    // workspaceActorId = canonical domain identity (the "who" in workspace
    // terms). FK to workspace_actors. Use this for activity feeds, org charts,
    // and cross-actor analytics. Not a substitute for actorId in auth checks.
    workspaceActorId: uuid('workspace_actor_id').references(() => workspaceActors.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgCreatedIdx: index('audit_events_org_created_idx').on(table.organisationId, table.createdAt),
    actorCreatedIdx: index('audit_events_actor_created_idx').on(table.actorId, table.createdAt),
    actionCreatedIdx: index('audit_events_action_created_idx').on(table.action, table.createdAt),
  })
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
