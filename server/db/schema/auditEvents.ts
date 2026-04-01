import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// Audit Events — lightweight security audit log for compliance & debugging
// ---------------------------------------------------------------------------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .references(() => organisations.id),
    actorId: uuid('actor_id'),
    actorType: text('actor_type').notNull().$type<'user' | 'system' | 'agent'>(),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
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
