import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { actions } from './actions';
import { users } from './users';

// ---------------------------------------------------------------------------
// Action Resume Events — immutable log of every human decision on a
// review-gated action (approve, reject, timeout, edit-and-approve).
// Written by reviewService; used for audit trail and durability.
// ---------------------------------------------------------------------------

export const actionResumeEvents = pgTable(
  'action_resume_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),

    eventType: text('event_type')
      .notNull()
      .$type<'approved' | 'rejected' | 'timeout' | 'edited'>(),

    resolvedBy: uuid('resolved_by').references(() => users.id),
    // approved: { result } | rejected: { comment } | edited: { edits, result }
    payload: jsonb('payload'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actionIdx: index('action_resume_events_action_idx').on(table.actionId),
    orgCreatedIdx: index('action_resume_events_org_created_idx').on(
      table.organisationId,
      table.createdAt,
    ),
  }),
);

export type ActionResumeEvent = typeof actionResumeEvents.$inferSelect;
export type NewActionResumeEvent = typeof actionResumeEvents.$inferInsert;
