import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { workspaceMemoryEntries } from './workspaceMemories';

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
    // Backlink to the playbookRun that last wrote this block; drives the
    // per-run rate limit (§7.5 — 10 blocks per run).
    sourceRunId: uuid('source_run_id'),
    // Null = last-edited by a human (Knowledge page). Non-null = last-edited
    // by an agent/playbook. Drives the HITL overwrite rule (§7.5).
    lastEditedByAgentId: uuid('last_edited_by_agent_id').references(() => agents.id),
    // Slug of the playbook that last wrote this block. A playbook can freely
    // rewrite its own blocks without tripping the HITL overwrite rule.
    lastWrittenByPlaybookSlug: text('last_written_by_playbook_slug'),
    // Phase G / spec §7.4 / G7.1 — when true, creating this block or linking
    // a new agent to the sub-account materialises read-only attachments for
    // every linked agent, tagged `source='auto_attach'`. Added in migration 0125.
    autoAttach: boolean('auto_attach').notNull().default(false),
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
  })
);

export type MemoryBlock = typeof memoryBlocks.$inferSelect;
export type NewMemoryBlock = typeof memoryBlocks.$inferInsert;
