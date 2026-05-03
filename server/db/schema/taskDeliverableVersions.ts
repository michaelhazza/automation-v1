import { pgTable, uuid, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { taskDeliverables } from './taskDeliverables';
import { organisations } from './organisations';

/**
 * task_deliverable_versions — per-deliverable version history.
 *
 * Every content-mutation path writes a row in the same transaction as the
 * deliverable body update. Monotonically incrementing version per deliverable.
 *
 * Spec: docs/workflows-dev-spec.md §12 (diff view, per-hunk revert).
 */
export const taskDeliverableVersions = pgTable(
  'task_deliverable_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    deliverableId: uuid('deliverable_id')
      .notNull()
      .references(() => taskDeliverables.id, { onDelete: 'cascade' }),
    /** Monotonically incremented per deliverable. Starts at 1. */
    version: integer('version').notNull(),
    /** Full text content at this version. */
    bodyText: text('body_text').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** User who made this change; null for agent-produced versions. */
    createdByUserId: uuid('created_by_user_id'),
    /** Free-form note (e.g. edit request summary). */
    changeNote: text('change_note'),
  },
  (table) => ({
    deliverableVersionUniq: unique('task_deliverable_versions_deliverable_version_uq').on(
      table.deliverableId,
      table.version,
    ),
    deliverableVersionIdx: index('task_deliverable_versions_deliverable_version_idx').on(
      table.deliverableId,
      table.version,
    ),
    orgIdx: index('task_deliverable_versions_org_idx').on(table.organisationId),
  }),
);

export type TaskDeliverableVersion = typeof taskDeliverableVersions.$inferSelect;
export type NewTaskDeliverableVersion = typeof taskDeliverableVersions.$inferInsert;
