import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';

// ---------------------------------------------------------------------------
// Document Bundles — the backend attachment unit for cached context
// is_auto_created = true  → unnamed bundle (invisible to users)
// is_auto_created = false → named bundle (visible in "Your bundles")
// ---------------------------------------------------------------------------

export const documentBundles = pgTable(
  'document_bundles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    // NULL iff is_auto_created=true. Enforced by DB CHECK constraint.
    name: text('name'),
    description: text('description'),

    isAutoCreated: boolean('is_auto_created').notNull().default(true),

    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),

    // Bumped on any membership edit.
    currentVersion: integer('current_version').notNull().default(1),

    // Written by bundleUtilizationJob (registered Phase 2, enabled Phase 6).
    utilizationByModelFamily: jsonb('utilization_by_model_family').$type<
      Record<string, { utilizationRatio: number; estimatedPrefixTokens: number; computedAt: string }>
    >(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    orgNameUniq: uniqueIndex('document_bundles_org_name_uq')
      .on(t.organisationId, t.name)
      .where(sql`${t.deletedAt} IS NULL AND ${t.name} IS NOT NULL`),
    orgIdx: index('document_bundles_org_idx').on(t.organisationId),
    subaccountIdx: index('document_bundles_subaccount_idx')
      .on(t.subaccountId)
      .where(sql`${t.subaccountId} IS NOT NULL`),
    namedBundleLookupIdx: index('document_bundles_named_lookup_idx')
      .on(t.organisationId, t.subaccountId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.isAutoCreated} = false`),
  })
);

export type DocumentBundle = typeof documentBundles.$inferSelect;
export type NewDocumentBundle = typeof documentBundles.$inferInsert;
