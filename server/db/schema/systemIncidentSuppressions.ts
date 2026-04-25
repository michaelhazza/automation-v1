// BYPASSES RLS — every reader MUST be sysadmin-gated at the route/service layer.
import { pgTable, uuid, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { users } from './users';

export const systemIncidentSuppressions = pgTable(
  'system_incident_suppressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    organisationId: uuid('organisation_id').references(() => organisations.id), // null = suppress everywhere
    reason: text('reason').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Visibility feedback counters — incremented each time this rule blocks an occurrence.
    // Surfaces in the admin suppression tab so operators can gauge whether suppressions
    // are still relevant vs. silently masking a growing problem.
    suppressedCount: integer('suppressed_count').notNull().default(0),
    lastSuppressedAt: timestamp('last_suppressed_at', { withTimezone: true }),

    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    fingerprintIdx: index('system_incident_suppressions_fingerprint_idx').on(table.fingerprint, table.expiresAt),
    // One suppression rule per fingerprint per org-or-global scope.
    // .nullsNotDistinct() mirrors migration 0226 — without it the Drizzle
    // schema drifts from the DB and a future drizzle-kit generate would try
    // to recreate the index with the old (NULLS DISTINCT) semantics, silently
    // reverting the fix that makes ON CONFLICT work for global suppressions.
    fpOrgUnique: unique('system_incident_suppressions_fp_org_unique').on(table.fingerprint, table.organisationId).nullsNotDistinct(),
  })
);

export type SystemIncidentSuppression = typeof systemIncidentSuppressions.$inferSelect;
export type NewSystemIncidentSuppression = typeof systemIncidentSuppressions.$inferInsert;
