import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { users } from './users.js';
import { teams } from './teams.js';

// ---------------------------------------------------------------------------
// Team Members — junction table linking users to teams.
// Composite PK on (teamId, userId).
// ---------------------------------------------------------------------------

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id').notNull().references(() => teams.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.teamId, table.userId] }),
    orgIdx: index('team_members_org_idx').on(table.organisationId),
  })
);

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
