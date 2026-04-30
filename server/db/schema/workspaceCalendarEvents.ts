import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { workspaceIdentities } from './workspaceIdentities';
import { workspaceActors } from './workspaceActors';

// Partial unique index (workspace_calendar_events_external_uniq) lives in SQL.
export const workspaceCalendarEvents = pgTable(
  'workspace_calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    identityId: uuid('identity_id').notNull().references(() => workspaceIdentities.id),
    actorId: uuid('actor_id').notNull().references(() => workspaceActors.id),
    externalEventId: text('external_event_id'),
    organiserEmail: text('organiser_email').notNull(),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    attendeeEmails: text('attendee_emails').array().notNull().default(sql`'{}'`),
    responseStatus: text('response_status').notNull(), // CHECK enforced in SQL
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorIdx: index('workspace_calendar_events_actor_idx').on(table.actorId),
    startsIdx: index('workspace_calendar_events_starts_idx').on(table.startsAt),
  })
);

export type WorkspaceCalendarEvent = typeof workspaceCalendarEvents.$inferSelect;
export type NewWorkspaceCalendarEvent = typeof workspaceCalendarEvents.$inferInsert;
