import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';

// ---------------------------------------------------------------------------
// Agent Test Fixtures — saved input payloads for the inline Run-Now test panel
// ---------------------------------------------------------------------------
//
// Per spec §9 (Feature 2). `target_id` is a polymorphic FK: it holds an
// agent id when scope='agent', or a skill id when scope='skill'. No DB-level
// FK is placed on target_id; referential integrity is enforced at the service
// layer in agentTestFixturesService.ts.
//
// Access matrix (enforced by assertScope() in the service):
//   - Org admins: read/write all fixtures within their organisation_id.
//   - Subaccount users: read/write only fixtures where subaccount_id matches
//     their own subaccount. Cannot see org-level fixtures (subaccount_id IS NULL)
//     or other subaccounts' fixtures.
//   - client_user: no access.
// ---------------------------------------------------------------------------

export const agentTestFixtures = pgTable(
  'agent_test_fixtures',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    /** 'agent' | 'skill' — determines what target_id points to */
    scope: text('scope').notNull().$type<'agent' | 'skill'>(),
    /** Polymorphic: agent.id when scope='agent', skill.id when scope='skill' */
    targetId: uuid('target_id').notNull(),
    label: text('label').notNull(),
    inputJson: jsonb('input_json').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    targetIdx: index('agent_test_fixtures_target_idx').on(
      t.organisationId, t.scope, t.targetId
    ),
  })
);

export type AgentTestFixture = typeof agentTestFixtures.$inferSelect;
export type NewAgentTestFixture = typeof agentTestFixtures.$inferInsert;
