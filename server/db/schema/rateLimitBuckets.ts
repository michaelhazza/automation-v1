import { pgTable, text, timestamp, integer, primaryKey, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Rate Limit Buckets — sliding-window rate-limit infrastructure (spec §6.2.1).
// Keyed on caller-defined `key` + window_start; count incremented via UPSERT.
// System-wide (no organisationId). Cleanup TTL = 2 * max(windowSec) = 2 hours
// today (longest call-site window is 3600s; see spec §6.2.4 retention rationale).
// Registered in scripts/rls-not-applicable-allowlist.txt — RLS not applicable.
// ---------------------------------------------------------------------------

export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.key, table.windowStart] }),
    windowStartIdx: index('rate_limit_buckets_window_start_idx').on(table.windowStart),
  }),
);

export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert;
