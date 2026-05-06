import { pgTable, uuid, text, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export const workspaceActors = pgTable(
  'workspace_actors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    actorKind: text('actor_kind').notNull(), // 'agent' | 'human' — CHECK enforced in SQL migration
    displayName: text('display_name').notNull(),
    parentActorId: uuid('parent_actor_id'), // self-referential FK added in SQL migration
    agentRole: text('agent_role'),
    agentTitle: text('agent_title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('workspace_actors_org_idx').on(table.organisationId),
    subaccountIdx: index('workspace_actors_subaccount_idx').on(table.subaccountId),
    kindIdx: index('workspace_actors_kind_idx').on(table.actorKind),
    parentIdx: index('workspace_actors_parent_idx').on(table.parentActorId),
    actorKindCheck: check('workspace_actors_kind_chk', sql`${table.actorKind} IN ('agent', 'human')`),
  })
);

export type WorkspaceActor = typeof workspaceActors.$inferSelect;
export type NewWorkspaceActor = typeof workspaceActors.$inferInsert;
