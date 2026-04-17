import { pgTable, uuid, text, real, integer, boolean, timestamp, index, uniqueIndex, customType } from 'drizzle-orm/pg-core';

// pgvector custom type — stores embedding as vector(1536) in Postgres
const vector = customType<{ data: number[] | null }>({
  dataType() { return 'vector(1536)'; },
  toDriver(val: number[] | null): string | null {
    if (val === null) return null;
    return `[${val.join(',')}]`;
  },
  fromDriver(val: unknown): number[] | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      return val.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
    return null;
  },
});
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// Workspace Memories — compiled shared memory per workspace (subaccount)
// ---------------------------------------------------------------------------

export const workspaceMemories = pgTable(
  'workspace_memories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),

    // Current compiled memory summary
    summary: text('summary'),

    // Compressed board state for context offloading
    boardSummary: text('board_summary'),

    // Quality threshold — entries below this score are excluded from summaries
    qualityThreshold: real('quality_threshold').notNull().default(0.5),

    // Summarisation trigger
    runsSinceSummary: integer('runs_since_summary').notNull().default(0),
    summaryThreshold: integer('summary_threshold').notNull().default(5),

    // Version tracking
    version: integer('version').notNull().default(0),
    summaryGeneratedAt: timestamp('summary_generated_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('workspace_memories_org_idx').on(table.organisationId),
    uniqueSubaccount: uniqueIndex('workspace_memories_subaccount_unique').on(
      table.organisationId,
      table.subaccountId
    ),
  })
);

export type WorkspaceMemory = typeof workspaceMemories.$inferSelect;
export type NewWorkspaceMemory = typeof workspaceMemories.$inferInsert;

// ---------------------------------------------------------------------------
// Workspace Memory Entries — individual insights extracted from agent runs
// ---------------------------------------------------------------------------

export const workspaceMemoryEntries = pgTable(
  'workspace_memory_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    // Phase D1 (spec §7.2, §7.3) — nullable so manually-authored References
    // (Tiptap) and Block→Reference demotion rows can live here without a
    // source agent run. Migration 0118 drops the NOT NULL constraints.
    agentRunId: uuid('agent_run_id')
      .references(() => agentRuns.id),
    agentId: uuid('agent_id')
      .references(() => agents.id),

    content: text('content').notNull(),
    entryType: text('entry_type')
      .notNull()
      .$type<'observation' | 'decision' | 'preference' | 'issue' | 'pattern'>(),

    // Whether this entry has been rolled into the compiled summary
    includedInSummary: boolean('included_in_summary').notNull().default(false),

    // Quality score (0.0–1.0), computed at insertion time
    qualityScore: real('quality_score'),

    // Semantic embedding for vector search (populated asynchronously)
    embedding: vector('embedding'),

    // LLM-generated context prefix for contextual retrieval (Phase B1)
    embeddingContext: text('embedding_context'),

    // Mem0 scoring columns — access tracking and task scoping (Phase 1C)
    accessCount:    integer('access_count').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    taskSlug:       text('task_slug'),   // null = global memory visible to all tasks

    // Phase 2 Memory & Briefings §4.4 — citation counters (S12/S4 feedback loop)
    // Migration 0146. `injectedCount` is incremented once per run the entry is
    // surfaced to the agent; `citedCount` is incremented when the citation
    // detector flags it as cited in that run's output.
    injectedCount:  integer('injected_count').notNull().default(0),
    citedCount:     integer('cited_count').notNull().default(0),

    // Phase 2C: Hierarchical metadata — auto-classified at write time
    domain: text('domain'),   // e.g. 'crm', 'reporting', 'marketing', 'dev'
    topic:  text('topic'),    // e.g. 'budget', 'campaign', 'pipeline', 'metrics'

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // §7 G6.2 / migration 0126 — soft-delete so "archive" on the Knowledge
    // page is recoverable. All Reference list paths filter IS NULL.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // §7 G6.4 / migration 0127 — back-link populated when a Reference is
    // created via the Insights tab's Promote affordance. Null for
    // References authored directly and for auto-captured insights. Self-
    // referencing FK lives in the SQL migration; Drizzle treats this as a
    // plain uuid because the ORM's builder does not support forward-
    // references to the same table cleanly.
    promotedFromEntryId: uuid('promoted_from_entry_id'),

    // PR Review Hardening — migration 0150 ————————————————————————————————

    // Item 1: lifecycle timestamps. Each async job sets its timestamp on every
    // row it touches so downstream jobs can verify ordering.
    // decayComputedAt: set by nightly decay job. Utility-adjust job checks IS NOT
    //   NULL before running — ensures decay always precedes utility adjustment.
    // qualityComputedAt: set by both decay and utility jobs when qualityScore changes.
    // embeddingComputedAt: set when the entry's embedding vector is written.
    embeddingComputedAt: timestamp('embedding_computed_at', { withTimezone: true }),
    qualityComputedAt:   timestamp('quality_computed_at',   { withTimezone: true }),
    decayComputedAt:     timestamp('decay_computed_at',     { withTimezone: true }),

    // Item 2: citation provenance at write boundary.
    // provenanceSourceType: who created this entry. NULL => isUnverified=true.
    // provenanceSourceId:   UUID of the specific run/upload/playbook.
    // provenanceConfidence: optional [0,1] confidence score.
    // isUnverified: true when no provenance supplied. High-trust paths
    //   (synthesis, utility-adjust) filter these out.
    provenanceSourceType: text('provenance_source_type')
      .$type<'agent_run' | 'manual' | 'playbook' | 'drop_zone' | 'synthesis'>(),
    provenanceSourceId:   uuid('provenance_source_id'),
    provenanceConfidence: real('provenance_confidence'),
    isUnverified:         boolean('is_unverified').notNull().default(false),

    // Item 7: DB-level qualityScore mutation guard.
    // Every UPDATE that changes qualityScore must also set this field to an
    // allowed value; the trigger in migration 0150 raises otherwise.
    qualityScoreUpdater: text('quality_score_updater')
      .$type<'initial_score' | 'system_decay_job' | 'system_utility_job'>(),

    // External review §2.1 — migration 0151 ————————————————————————————————
    //
    // contentHash: STORED GENERATED column — `md5(content)` — auto-maintained
    //   by Postgres on every content mutation. Drizzle does not support
    //   GENERATED ALWAYS columns natively, so this is declared as a regular
    //   text field; the actual storage is managed by migration 0151. Treat
    //   this column as read-only at the application layer.
    // embeddingContentHash: hash of the content used to compute the current
    //   embedding. Set on every embedding write. When `contentHash !=
    //   embeddingContentHash`, the embedding is stale and should be
    //   recomputed.
    contentHash:          text('content_hash'),
    embeddingContentHash: text('embedding_content_hash'),
  },
  (table) => ({
    // M-11: HNSW vector index on workspace_memory_entries.embedding exists in DB
    // and is managed by migration 0029. Drizzle does not support the HNSW index syntax
    // natively — do NOT let drizzle-kit generate a migration that drops it.
    subaccountIdx: index('workspace_memory_entries_subaccount_idx').on(
      table.subaccountId,
      table.includedInSummary
    ),
    agentRunIdx: index('workspace_memory_entries_run_idx').on(table.agentRunId),
    createdAtIdx: index('workspace_memory_entries_created_idx').on(table.createdAt),
    domainIdx: index('workspace_memory_entries_domain_idx').on(table.subaccountId, table.domain),
    // Migration 0107: deduplication constraint for idempotent migration + runtime writes.
    // Actual DB constraint uses md5(content) — Drizzle schema is declarative marker only;
    // the real constraint is managed by the SQL migration.
  })
);

export type WorkspaceMemoryEntry = typeof workspaceMemoryEntries.$inferSelect;
export type NewWorkspaceMemoryEntry = typeof workspaceMemoryEntries.$inferInsert;
