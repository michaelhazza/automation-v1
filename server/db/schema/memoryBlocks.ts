import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex, customType, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { workspaceMemoryEntries } from './workspaceMemories';

// pgvector custom type — mirrors the convention in workspaceMemories.ts and
// agentEmbeddings.ts.  Nullable here: embedding is populated asynchronously
// by the memory-blocks-embedding-backfill job (Phase 2).
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

// Typed enums for migration 0129 columns
export type MemoryBlockStatus = 'active' | 'draft' | 'pending_review' | 'rejected';
export type MemoryBlockSource = 'manual' | 'auto_synthesised';
// Phase 5 / W3a types
export type MemoryBlockPriority = 'low' | 'medium' | 'high';
export type MemoryBlockCapturedVia = 'manual_edit' | 'auto_synthesised' | 'user_triggered' | 'approval_suggestion';
export type MemoryBlockDeprecationReason = 'low_quality' | 'user_replaced' | 'conflict_resolved' | 'user_deleted';

// ---------------------------------------------------------------------------
// Memory Blocks — shared named context blocks attached to multiple agents.
// Spec: docs/improvements-roadmap-spec.md P4.2 (Letta pattern).
// ---------------------------------------------------------------------------

export const memoryBlocks = pgTable(
  'memory_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    name: text('name').notNull(),
    content: text('content').notNull(),
    ownerAgentId: uuid('owner_agent_id')
      .references(() => agents.id),
    isReadOnly: boolean('is_read_only').notNull().default(true),
    // Phase D1 (spec §7.3) — provenance for a block that was promoted from
    // a Reference note. ON DELETE SET NULL so deleting the Reference does
    // not cascade the block.
    sourceReferenceId: uuid('source_reference_id')
      .references(() => workspaceMemoryEntries.id, { onDelete: 'set null' }),
    // Phase D2 (spec §8.4, §7.5) — knowledgeBindings[] provenance + safety.
    // confidence: 'low' marks blocks first written by a firstRunOnly binding
    // so the Knowledge page can surface "review recommended". Reset to
    // 'normal' on any human save.
    confidence: text('confidence').notNull().default('normal').$type<'low' | 'normal'>(),
    // Backlink to the WorkflowRun that last wrote this block; drives the
    // per-run rate limit (§7.5 — 10 blocks per run).
    sourceRunId: uuid('source_run_id'),
    // Null = last-edited by a human (Knowledge page). Non-null = last-edited
    // by an agent/Workflow. Drives the HITL overwrite rule (§7.5).
    lastEditedByAgentId: uuid('last_edited_by_agent_id').references(() => agents.id),
    // Slug of the Workflow that last wrote this block. A Workflow can freely
    // rewrite its own blocks without tripping the HITL overwrite rule.
    lastWrittenByWorkflowSlug: text('last_written_by_workflow_slug'),
    // Phase G / spec §7.4 / G7.1 — when true, creating this block or linking
    // a new agent to the sub-account materialises read-only attachments for
    // every linked agent, tagged `source='auto_attach'`. Added in migration 0125.
    autoAttach: boolean('auto_attach').notNull().default(false),

    // Memory & Briefings spec Phase 1 (migration 0129) — §5.2, §5.11
    // status: lifecycle state; only 'active' blocks are ever injected into
    //         agent context (global injection invariant §5.2).
    // source: provenance — 'manual' (human-authored) or 'auto_synthesised'.
    status: text('status').notNull().default('active').$type<MemoryBlockStatus>(),
    source: text('source').notNull().default('manual').$type<MemoryBlockSource>(),

    // Memory & Briefings spec Phase 1 (migration 0130) — §5.2 (S6)
    // Nullable: populated by the memory-blocks-embedding-backfill job in
    // Phase 2.  Required for relevance-driven block retrieval.
    embedding: vector('embedding'),

    // Phase 5 S24 — divergence flag for protected blocks (migration 0149).
    // Set by protectedBlockDivergenceService daily job; null otherwise.
    divergenceDetectedAt: timestamp('divergence_detected_at', { withTimezone: true }),

    // PR Review Hardening — Item 6: explicit canonical version pointer.
    // Set by memoryBlockVersionService.writeVersionRow() in the same transaction
    // as each content mutation. Eliminates "latest by timestamp" ambiguity.
    // Note: FK to memory_block_versions.id is managed by migration 0150 only —
    // importing memoryBlockVersions here would create a circular dependency
    // (memoryBlockVersions already imports memoryBlocks).
    // The partial index memory_blocks_active_version_idx is likewise declared
    // only in migration 0150 — same pattern as the HNSW index in
    // workspaceMemories.ts (Drizzle cannot represent partial indexes on nullable
    // FK columns where the referenced table cannot be imported here).
    activeVersionId: uuid('active_version_id'),

    // Phase 5 / W3a — Learned Rules precedence + deprecation (migration 0197)
    priority: text('priority').default('medium').$type<MemoryBlockPriority>(),
    isAuthoritative: boolean('is_authoritative').notNull().default(false),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    deprecationReason: text('deprecation_reason').$type<MemoryBlockDeprecationReason>(),
    qualityScore: numeric('quality_score', { precision: 3, scale: 2 }).notNull().default('0.50'),
    capturedVia: text('captured_via').notNull().default('manual_edit').$type<MemoryBlockCapturedVia>(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgNameIdx: uniqueIndex('memory_blocks_org_name_idx')
      .on(table.organisationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    orgIdx: index('memory_blocks_org_idx').on(table.organisationId),
    subaccountIdx: index('memory_blocks_subaccount_idx')
      .on(table.subaccountId)
      .where(sql`${table.subaccountId} IS NOT NULL`),
    subaccountAutoAttachIdx: index('memory_blocks_subaccount_auto_attach_idx')
      .on(table.subaccountId)
      .where(sql`${table.autoAttach} = true AND ${table.deletedAt} IS NULL`),
    // Partial index for fast active-block lookup during context injection
    // (migration 0129). Mirrors the WHERE clause in memory_blocks_embedding_hnsw.
    activeIdx: index('memory_blocks_active_idx')
      .on(table.organisationId, table.subaccountId)
      .where(sql`${table.status} = 'active' AND ${table.deletedAt} IS NULL`),
  })
);

export type MemoryBlock = typeof memoryBlocks.$inferSelect;
export type NewMemoryBlock = typeof memoryBlocks.$inferInsert;
