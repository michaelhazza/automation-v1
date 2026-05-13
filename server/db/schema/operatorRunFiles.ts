import { pgTable, uuid, text, integer, bigint, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { agentRuns } from './agentRuns';
import { users } from './users.js';
import { subaccounts } from './subaccounts.js';

// ---------------------------------------------------------------------------
// operator_run_files — per-run operator file artefact pointers
//
// One row per file path per run (latest-metadata model). Version is updated
// in place via the canonical UPSERT (spec §5.7, §9.3):
//
//   INSERT INTO operator_run_files (..., version, ...) VALUES (..., 1, ...)
//   ON CONFLICT (agent_run_id, path) DO UPDATE SET
//     version        = operator_run_files.version + 1,
//     size_bytes     = EXCLUDED.size_bytes,
//     content_sha256 = EXCLUDED.content_sha256,
//     mime_type      = EXCLUDED.mime_type,
//     emitted_by     = EXCLUDED.emitted_by,
//     emitted_at     = NOW()
//   RETURNING version;
//
// Event type is derived from the returned version (1 => file.created,
// >1 => file.modified). Preflight lookups are never the event-type source.
//
// RLS: canonical org-isolation policy on organisation_id (migration 0353).
// No JOIN through agent_runs — direct org column for fast plan.
//
// Partial index on (agent_run_id, path) — enforced by migration 0353 UNIQUE
// constraint. Drizzle's unique() below matches it for typecheck purposes.
//
// Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md
// §4.1, §4.8, §5.7, §6.1, §9.1, §9.3
// Migration: 0353_operator_run_files.sql
// ---------------------------------------------------------------------------

export const operatorRunFiles = pgTable(
  'operator_run_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Tenant scoping — org-isolation RLS policy filters on this column
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),

    // Run FK — row is deleted when the run is deleted
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),

    // Natural key component — file path within the operator workspace
    path: text('path').notNull(),

    // Monotonically increasing version (latest-metadata-row-only model).
    // Starts at 1; incremented by the canonical UPSERT on every write.
    version: integer('version').notNull().default(1),

    // File content metadata
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    contentSha256: text('content_sha256').notNull(),
    mimeType: text('mime_type').notNull(),

    // R2 storage key — opaque pointer into the object store
    storageKey: text('storage_key').notNull(),

    // Owner of the executor agent — null for subaccount-owned agents (spec §4.1, §9.4)
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),

    // Subaccount the operator run belongs to (spec §4.1)
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id, { onDelete: 'cascade' }),

    // Origin of the write event
    emittedBy: text('emitted_by').notNull().$type<'tool_call' | 'watcher'>(),

    emittedAt: timestamp('emitted_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Natural key: one row per (run, path) — version updated in place
    pathRunUniq: unique('operator_run_files_path_run_uniq').on(table.agentRunId, table.path),
    // Composite lookup index for the event bridge and file-list queries
    orgRunIdx: index('operator_run_files_org_run_idx').on(table.organisationId, table.agentRunId),
  }),
);

export type OperatorRunFile = typeof operatorRunFiles.$inferSelect;
export type NewOperatorRunFile = typeof operatorRunFiles.$inferInsert;
