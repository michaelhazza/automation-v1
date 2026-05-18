import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// validator_versions — append-only snapshot of registered validator source.
// system-scoped: no organisation_id; validators are process-global artefacts.
// Deterministic-validators spec §5.2 (migration 0379).
// ---------------------------------------------------------------------------

export const validatorVersions = pgTable(
  'validator_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    version: text('version').notNull(),
    sourceText: text('source_text').notNull(),
    sourceHash: text('source_hash').notNull(),
    parameterSchemaJson: jsonb('parameter_schema_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    slugVersionUniq: unique('validator_versions_slug_version_uniq').on(table.slug, table.version),
  })
);

export type ValidatorVersionRow = typeof validatorVersions.$inferSelect;
export type NewValidatorVersion = typeof validatorVersions.$inferInsert;
