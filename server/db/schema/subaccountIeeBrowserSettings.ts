import { pgTable, uuid, text, integer, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';
import type { ProxyConfig, ProxyLocaleOverrides } from '../../../shared/types/proxyAlignment.js';

export const subaccountIeeBrowserSettings = pgTable(
  'subaccount_iee_browser_settings',
  {
    subaccountId: uuid('subaccount_id').primaryKey().references(() => subaccounts.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('off').$type<'on' | 'off'>(),  // DEFAULT off — §3.5 v7
    rolloutApproved: boolean('rollout_approved').notNull().default(false),
    browserProfileRetentionDays: integer('browser_profile_retention_days').notNull().default(30),
    perTaskCostCeilingCents: integer('per_task_cost_ceiling_cents').notNull().default(100),
    perSubaccountDailyCostCeilingCents: integer('per_subaccount_daily_cost_ceiling_cents').notNull().default(500),
    settingsVersion: integer('settings_version').notNull().default(1),  // ETag source
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    proxyConfig: jsonb('proxy_config').$type<ProxyConfig | null>(),
    proxyLocaleOverrides: jsonb('proxy_locale_overrides').$type<ProxyLocaleOverrides | null>(),
  },
);

export type SubaccountIeeBrowserSettings = typeof subaccountIeeBrowserSettings.$inferSelect;
export type NewSubaccountIeeBrowserSettings = typeof subaccountIeeBrowserSettings.$inferInsert;
