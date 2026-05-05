import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Per-user preference settings.
// Phase 7 / W3b: suggestion frequency + backoff for approval-gate suggestion panel.

export const userSettings = pgTable(
  'user_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
    // Approval-gate suggestion frequency preference
    suggestionFrequency: text('suggestion_frequency')
      .notNull()
      .default('occasional')
      .$type<'off' | 'occasional' | 'frequent'>(),
    // Set when user hits the skip-streak threshold; clears after the backoff period
    suggestionBackoffUntil: timestamp('suggestion_backoff_until', { withTimezone: true }),
    // Consecutive "Not now" skips since last capture; reset to 0 on save
    skipStreakCount: text('skip_streak_count').notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('user_settings_user_idx').on(table.userId),
  }),
);

export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;
