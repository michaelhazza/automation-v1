import { pgTable, uuid, text, bigint, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { agentRuns } from './agentRuns';
import { ieeRuns } from './ieeRuns';

// ---------------------------------------------------------------------------
// run_artifacts — customer-facing file delivery ledger (spec §6.1.2)
//
// Workers promote artifacts from iee_artifacts → run_artifacts by calling
// fileDeliveryService.upload. Customer-facing UI reads ONLY this table.
// The original iee_artifacts row is never moved.
//
// Key-based idempotency: composite partial unique index on
// (organisation_id, agent_run_id, artifact_kind, content_hash) WHERE
// agent_run_id IS NOT NULL — excludes NULLs set by ON DELETE SET NULL.
// ---------------------------------------------------------------------------

export const runArtifacts = pgTable(
  'run_artifacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    agentRunId: uuid('agent_run_id')
      .references(() => agentRuns.id, { onDelete: 'set null' }),
    ieeRunId: uuid('iee_run_id')
      .references(() => ieeRuns.id, { onDelete: 'set null' }),
    artifactKind: text('artifact_kind')
      .notNull()
      .$type<'report' | 'transcript' | 'media' | 'attachment' | 'log'>(),
    displayName: text('display_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentHash: text('content_hash').notNull(),
    storageProvider: text('storage_provider')
      .notNull()
      .default('s3')
      .$type<'s3' | 'gcs' | 'r2'>(),
    storageKey: text('storage_key').notNull(),
    storageRegion: text('storage_region'),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    downloadCount: integer('download_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgRunIdx: index('run_artifacts_org_run_idx').on(table.organisationId, table.agentRunId),
    retainUntilIdx: index('run_artifacts_retain_until_idx')
      .on(table.retainUntil)
      .where(sql`${table.retainUntil} IS NOT NULL`),
    runKindHashUnique: uniqueIndex('run_artifacts_run_kind_hash_unique')
      .on(table.organisationId, table.agentRunId, table.artifactKind, table.contentHash)
      .where(sql`${table.agentRunId} IS NOT NULL`),
  }),
);

export type RunArtifact = typeof runArtifacts.$inferSelect;
export type NewRunArtifact = typeof runArtifacts.$inferInsert;
