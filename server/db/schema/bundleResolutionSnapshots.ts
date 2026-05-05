import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { documentBundles } from './documentBundles';
import type { PrefixHashComponents } from '../../../shared/types/cachedContext';

// ---------------------------------------------------------------------------
// Bundle Resolution Snapshots — immutable per-run context captures
// No deletedAt — snapshots are retained indefinitely (v1).
// Retention tiering is deferred (§12.2).
// ---------------------------------------------------------------------------

export const bundleResolutionSnapshots = pgTable(
  'bundle_resolution_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    bundleId: uuid('bundle_id').notNull().references(() => documentBundles.id),
    bundleVersion: integer('bundle_version').notNull(),

    modelFamily: text('model_family').notNull(),
    assemblyVersion: integer('assembly_version').notNull(),

    orderedDocumentVersions: jsonb('ordered_document_versions').notNull().$type<
      Array<{ documentId: string; documentVersion: number; serializedBytesHash: string; tokenCount: number }>
    >(),

    prefixHash: text('prefix_hash').notNull(),
    prefixHashComponents: jsonb('prefix_hash_components').notNull().$type<PrefixHashComponents>(),

    estimatedPrefixTokens: integer('estimated_prefix_tokens').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    bundlePrefixHashUniq: uniqueIndex('bundle_resolution_snapshots_bundle_prefix_hash_uq')
      .on(t.bundleId, t.prefixHash),
    prefixHashLookupIdx: index('bundle_resolution_snapshots_prefix_hash_idx').on(t.prefixHash),
    bundleVersionIdx: index('bundle_resolution_snapshots_bundle_version_idx').on(t.bundleId, t.bundleVersion),
    orgIdx: index('bundle_resolution_snapshots_org_idx').on(t.organisationId),
  })
);

export type BundleResolutionSnapshot = typeof bundleResolutionSnapshots.$inferSelect;
export type NewBundleResolutionSnapshot = typeof bundleResolutionSnapshots.$inferInsert;
