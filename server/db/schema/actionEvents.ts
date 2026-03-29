import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { actions } from './actions';
import { users } from './users';

// ---------------------------------------------------------------------------
// Action Events — immutable audit trail of action state transitions
// ---------------------------------------------------------------------------

export const actionEvents = pgTable(
  'action_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull().$type<
      'created' | 'validation_failed' | 'queued_for_review' | 'approved' | 'edited_and_approved' |
      'rejected' | 'execution_started' | 'execution_completed' | 'execution_failed' |
      'retry_scheduled' | 'blocked' | 'skipped_duplicate'
    >(),
    actorId: uuid('actor_id')
      .references(() => users.id),
    metadataJson: jsonb('metadata_json'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    actionIdx: index('action_events_action_idx').on(table.actionId),
    orgCreatedIdx: index('action_events_org_created_idx').on(table.organisationId, table.createdAt),
  })
);

export type ActionEvent = typeof actionEvents.$inferSelect;
export type NewActionEvent = typeof actionEvents.$inferInsert;
