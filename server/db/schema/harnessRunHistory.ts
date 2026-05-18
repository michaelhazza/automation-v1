import { pgTable, uuid, text, numeric, timestamp, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// harness_run_history — system-scoped detection-harness telemetry.
//
// One row per harness run (per-site, per-invocation). Records the outcome,
// score, baseline comparison, and environment fingerprint so regression
// trends are queryable over time.
//
// System-scoped: no organisation_id column. RLS deliberately not applied;
// see spec §7.1 and migration 0370 header for the documented opt-out.
//
// Write path: server/tests/browser-detection-harness/harnessHistoryWriter.ts
// ---------------------------------------------------------------------------

export const harnessRunHistory = pgTable(
  'harness_run_history',
  {
    id:                uuid('id').defaultRandom().primaryKey(),
    siteSlug:          text('site_slug').notNull(),
    mode:              text('mode').notNull(),
    // numeric(4,3) — score in [0.000, 1.000]; nullable (site_unavailable / parse_error)
    score:             numeric('score', { precision: 4, scale: 3 }),
    baselineScore:     numeric('baseline_score', { precision: 4, scale: 3 }),
    baselineTolerance: numeric('baseline_tolerance', { precision: 4, scale: 3 }),
    outcome:           text('outcome').notNull(),
    browserVersion:    text('browser_version').notNull(),
    playwrightVersion: text('playwright_version').notNull(),
    templateDigest:    text('template_digest').notNull(),
    runAt:             timestamp('run_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    siteSlugRunAtIdx: index('harness_run_history_site_slug_run_at_idx')
      .on(table.siteSlug, table.runAt),
  }),
);

export type HarnessRunHistoryRow = typeof harnessRunHistory.$inferSelect;
export type NewHarnessRunHistory = typeof harnessRunHistory.$inferInsert;
