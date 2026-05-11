import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { users } from './users';
import { operatorSessionConsents } from './operatorSessionConsents';

// ---------------------------------------------------------------------------
// Operator Session Consent Events — append-only event ledger
//
// Records granted / revoked / superseded transitions for operator session
// consents. Append-only — rows are never modified after INSERT.
//
// Spec: docs/operator-session-identity-spec.md §7.2, §8.2
// Migration: 0321_operator_session_consents.sql
// ---------------------------------------------------------------------------

export const operatorSessionConsentEvents = pgTable(
  'operator_session_consent_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    consentId: uuid('consent_id')
      .notNull()
      .references(() => operatorSessionConsents.id, { onDelete: 'restrict' }),
    eventType: text('event_type')
      .notNull()
      .$type<'granted' | 'revoked' | 'superseded'>(),
    actorUserId: uuid('actor_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    // Only non-NULL for event_type = 'superseded'
    supersededByConsentId: uuid('superseded_by_consent_id')
      .references(() => operatorSessionConsents.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

export type OperatorSessionConsentEvent = typeof operatorSessionConsentEvents.$inferSelect;
export type NewOperatorSessionConsentEvent = typeof operatorSessionConsentEvents.$inferInsert;
