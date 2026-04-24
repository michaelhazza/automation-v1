import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { workflowRuns } from './workflowRuns';

// ---------------------------------------------------------------------------
// Portal Briefs — published output from config_publish_workflow_output_to_portal
//
// Phase G — onboarding-Workflows-spec §11.6.
//
// One row per run + slug combination. The portal card (§9.4) reads the most
// recent non-retracted row per (subaccount_id, workflow_slug).  Admin can
// retract a brief by setting `retractedAt`; this hides it from the portal
// without deleting the audit trail.
// ---------------------------------------------------------------------------

export const portalBriefs = pgTable(
  'portal_briefs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    /** The Workflow run that produced this brief. */
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id),
    workflowSlug: text('workflow_slug').notNull(),
    title: text('title').notNull().default(''),
    /** Headline bullet points shown on the portal card. */
    bullets: text('bullets').array().notNull().default(sql`'{}'::text[]`),
    /** Long-form markdown shown in the run detail modal. */
    detailMarkdown: text('detail_markdown').notNull().default(''),
    isPortalVisible: boolean('is_portal_visible').notNull().default(true),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
    /** Admin retraction — set to hide the brief without deleting. */
    retractedAt: timestamp('retracted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    /** Idempotency: one row per run. ON CONFLICT (run_id) DO UPDATE. */
    runIdIdx: uniqueIndex('portal_briefs_run_id_idx').on(table.runId),
    /** Fast lookup for the canonical portal-card query. */
    subaccountSlugIdx: index('portal_briefs_subaccount_slug_idx').on(
      table.subaccountId,
      table.workflowSlug,
      table.publishedAt,
    ).where(sql`${table.retractedAt} IS NULL`),
  }),
);

export type PortalBrief = typeof portalBriefs.$inferSelect;
export type NewPortalBrief = typeof portalBriefs.$inferInsert;
