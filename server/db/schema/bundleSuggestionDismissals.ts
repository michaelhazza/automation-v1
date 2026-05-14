import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';

// ---------------------------------------------------------------------------
// Bundle Suggestion Dismissals — per-user permanent dismissal of the
// bundle-save suggestion heuristic (spec §5.12).
// One row per (user, doc_set_hash) pair. No soft-delete — dismissals are
// permanent in v1.
// ---------------------------------------------------------------------------

export const bundleSuggestionDismissals = pgTable(
  'bundle_suggestion_dismissals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    userId: uuid('user_id').notNull().references(() => users.id),

    // SHA-256 of sorted document IDs — engine-version-agnostic (does not include
    // model_family or assembly_version, unlike bundle_resolution_snapshots.prefix_hash).
    docSetHash: text('doc_set_hash').notNull(),

    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // BUNDLE-DISMISS-RLS: 3-column unique key includes organisation_id so that
    // dismissals in org A never collide with dismissals for the same user+hash
    // in org B (multi-org users scenario). Migration 0231 drops the old
    // 2-column index and creates this one.
    orgUserDocSetUniq: uniqueIndex('bundle_suggestion_dismissals_org_user_doc_set_uq')
      .on(t.organisationId, t.userId, t.docSetHash),
    userIdx: index('bundle_suggestion_dismissals_user_idx').on(t.userId),
    orgIdx: index('bundle_suggestion_dismissals_org_idx').on(t.organisationId),
  })
);

export type BundleSuggestionDismissal = typeof bundleSuggestionDismissals.$inferSelect;
export type NewBundleSuggestionDismissal = typeof bundleSuggestionDismissals.$inferInsert;
