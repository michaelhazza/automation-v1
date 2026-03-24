import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaceItems } from './workspaceItems';

export const workspaceItemDeliverables = pgTable(
  'workspace_item_deliverables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceItemId: uuid('workspace_item_id')
      .notNull()
      .references(() => workspaceItems.id, { onDelete: 'cascade' }),
    deliverableType: text('deliverable_type').notNull().$type<'file' | 'url' | 'artifact'>(),
    title: text('title').notNull(),
    path: text('path'),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    itemIdx: index('ws_item_deliverables_item_idx').on(table.workspaceItemId),
  })
);

export type WorkspaceItemDeliverable = typeof workspaceItemDeliverables.$inferSelect;
export type NewWorkspaceItemDeliverable = typeof workspaceItemDeliverables.$inferInsert;
