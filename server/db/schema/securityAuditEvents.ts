import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

export const securityAuditEvents = pgTable('security_audit_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull(),
  subaccountId:   uuid('subaccount_id'),
  actorUserId:    uuid('actor_user_id'),
  actorRole:      text('actor_role'),
  eventType:      text('event_type').notNull(),
  targetType:     text('target_type'),
  targetId:       text('target_id'),
  ip:             text('ip'),
  userAgent:      text('user_agent'),
  meta:           jsonb('meta').notNull().default({}),
  occurredAt:     timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgTimeIdx:   index('idx_security_audit_org_time').on(t.organisationId, t.occurredAt),
  eventTimeIdx: index('idx_security_audit_event_time').on(t.eventType, t.occurredAt),
}));

export type SecurityAuditEvent = typeof securityAuditEvents.$inferSelect;
export type NewSecurityAuditEvent = typeof securityAuditEvents.$inferInsert;
