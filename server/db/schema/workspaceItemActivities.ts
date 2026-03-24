import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaceItems } from './workspaceItems';
import { agents } from './agents';
import { users } from './users';

export const workspaceItemActivities = pgTable(
  'workspace_item_activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceItemId: uuid('workspace_item_id')
      .notNull()
      .references(() => workspaceItems.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .references(() => agents.id),
    userId: uuid('user_id')
      .references(() => users.id),
    activityType: text('activity_type').notNull().$type<'created' | 'assigned' | 'status_changed' | 'progress' | 'completed' | 'note' | 'blocked' | 'deliverable_added'>(),
    message: text('message').notNull(),
    metadata: jsonb('metadata'),
    // Optional reference to the agent run that created this activity
    agentRunId: uuid('agent_run_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    itemIdx: index('ws_item_activities_item_idx').on(table.workspaceItemId),
    itemCreatedIdx: index('ws_item_activities_item_created_idx').on(table.workspaceItemId, table.createdAt),
    agentIdx: index('ws_item_activities_agent_idx').on(table.agentId),
  })
);

export type WorkspaceItemActivity = typeof workspaceItemActivities.$inferSelect;
export type NewWorkspaceItemActivity = typeof workspaceItemActivities.$inferInsert;
