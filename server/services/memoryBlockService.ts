/**
 * memoryBlockService — Sprint 5 P4.2 CRUD + permission checks for shared
 * memory blocks (Letta pattern).
 *
 * Read path:
 *   `getBlocksForAgent(agentId, orgId)` — returns all attached blocks in
 *   deterministic name order. Called once at run start by
 *   `agentService.resolveSystemPrompt()` and cached in MiddlewareContext.
 *
 * Write path:
 *   `updateBlock(blockName, newContent, agentId, orgId)` — validates
 *   attachment permission (read_write), ownership, and read-only flag
 *   before updating.
 *
 * Admin CRUD:
 *   `createBlock`, `updateBlockAdmin`, `deleteBlock`, `attachBlock`,
 *   `detachBlock`, `listBlocks`.
 */

import { eq, and, asc, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memoryBlocks, memoryBlockAttachments } from '../db/schema/index.js';
import type { MemoryBlock } from '../db/schema/memoryBlocks.js';
import {
  decideUpsert,
  MEMORY_BLOCKS_PER_RUN_MAX,
  type MergeStrategy,
  type BlockConfidence,
} from './memoryBlockUpsertPure.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MemoryBlockForPrompt {
  name: string;
  content: string;
  permission: 'read' | 'read_write';
}

// ─── Read path (agent run hot path) ──────────────────────────────────────────

/**
 * Load all memory blocks attached to a given agent, ordered by block name
 * for deterministic prompt assembly. Excludes soft-deleted blocks.
 */
export async function getBlocksForAgent(
  agentId: string,
  organisationId: string,
): Promise<MemoryBlockForPrompt[]> {
  const rows = await db
    .select({
      name: memoryBlocks.name,
      content: memoryBlocks.content,
      permission: memoryBlockAttachments.permission,
    })
    .from(memoryBlockAttachments)
    .innerJoin(memoryBlocks, eq(memoryBlockAttachments.blockId, memoryBlocks.id))
    .where(
      and(
        eq(memoryBlockAttachments.agentId, agentId),
        eq(memoryBlocks.organisationId, organisationId),
        isNull(memoryBlocks.deletedAt),
      ),
    )
    .orderBy(asc(memoryBlocks.name));

  return rows.map((r) => ({
    name: r.name,
    content: r.content,
    permission: r.permission as 'read' | 'read_write',
  }));
}

/**
 * Format memory blocks for system prompt injection.
 * Returns null if no blocks are attached.
 */
export function formatBlocksForPrompt(blocks: MemoryBlockForPrompt[]): string | null {
  if (blocks.length === 0) return null;

  const sections = blocks.map(
    (b) => `### ${b.name}\n${b.content}`,
  );

  return `## Shared Context\n\n${sections.join('\n\n')}`;
}

// ─── Write path (skill handler) ──────────────────────────────────────────────

export interface UpdateBlockResult {
  success: boolean;
  error?: string;
}

/**
 * Update a memory block's content. Validates:
 *   1. Block exists and belongs to the org.
 *   2. Agent has a read_write attachment.
 *   3. Agent is the block's owner.
 *   4. Block is not read-only.
 */
export async function updateBlock(
  blockName: string,
  newContent: string,
  agentId: string,
  organisationId: string,
): Promise<UpdateBlockResult> {
  // Find the block by name within the org
  const [block] = await db
    .select()
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.organisationId, organisationId),
        eq(memoryBlocks.name, blockName),
        isNull(memoryBlocks.deletedAt),
      ),
    );

  if (!block) {
    return { success: false, error: `Memory block '${blockName}' not found` };
  }

  if (block.isReadOnly) {
    return { success: false, error: `Memory block '${blockName}' is read-only` };
  }

  if (block.ownerAgentId !== agentId) {
    return { success: false, error: `Agent is not the owner of block '${blockName}'` };
  }

  // Check the agent has read_write permission
  const [attachment] = await db
    .select()
    .from(memoryBlockAttachments)
    .where(
      and(
        eq(memoryBlockAttachments.blockId, block.id),
        eq(memoryBlockAttachments.agentId, agentId),
      ),
    );

  if (!attachment || attachment.permission !== 'read_write') {
    return { success: false, error: `Agent does not have write permission on block '${blockName}'` };
  }

  await db
    .update(memoryBlocks)
    .set({ content: newContent, updatedAt: new Date() })
    .where(eq(memoryBlocks.id, block.id));

  return { success: true };
}

// ─── Admin CRUD ──────────────────────────────────────────────────────────────

export async function createBlock(input: {
  organisationId: string;
  subaccountId?: string | null;
  name: string;
  content: string;
  ownerAgentId?: string | null;
  isReadOnly?: boolean;
}): Promise<MemoryBlock> {
  const [created] = await db
    .insert(memoryBlocks)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId ?? null,
      name: input.name,
      content: input.content,
      ownerAgentId: input.ownerAgentId ?? null,
      isReadOnly: input.isReadOnly ?? false,
    })
    .returning();

  return created;
}

export async function updateBlockAdmin(
  blockId: string,
  organisationId: string,
  updates: { name?: string; content?: string; isReadOnly?: boolean; ownerAgentId?: string | null },
): Promise<MemoryBlock | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.content !== undefined) set.content = updates.content;
  if (updates.isReadOnly !== undefined) set.isReadOnly = updates.isReadOnly;
  if (updates.ownerAgentId !== undefined) set.ownerAgentId = updates.ownerAgentId;

  const [updated] = await db
    .update(memoryBlocks)
    .set(set)
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, organisationId),
        isNull(memoryBlocks.deletedAt),
      ),
    )
    .returning();

  return updated ?? null;
}

export async function deleteBlock(blockId: string, organisationId: string): Promise<boolean> {
  const [deleted] = await db
    .update(memoryBlocks)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, organisationId),
        isNull(memoryBlocks.deletedAt),
      ),
    )
    .returning({ id: memoryBlocks.id });

  return !!deleted;
}

export async function listBlocks(organisationId: string, subaccountId?: string): Promise<MemoryBlock[]> {
  const conditions = [
    eq(memoryBlocks.organisationId, organisationId),
    isNull(memoryBlocks.deletedAt),
  ];
  if (subaccountId) {
    conditions.push(eq(memoryBlocks.subaccountId, subaccountId));
  }

  return db
    .select()
    .from(memoryBlocks)
    .where(and(...conditions))
    .orderBy(asc(memoryBlocks.name));
}

export async function attachBlock(
  blockId: string,
  agentId: string,
  permission: 'read' | 'read_write',
  orgId: string,
): Promise<{ id: string }> {
  // Verify the block belongs to the caller's org before attaching
  const [block] = await db
    .select({ id: memoryBlocks.id })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, orgId),
        isNull(memoryBlocks.deletedAt),
      ),
    );
  if (!block) {
    throw { statusCode: 404, message: 'Memory block not found' };
  }

  const [row] = await db
    .insert(memoryBlockAttachments)
    .values({ blockId, agentId, permission })
    .onConflictDoUpdate({
      target: [memoryBlockAttachments.blockId, memoryBlockAttachments.agentId],
      set: { permission },
    })
    .returning({ id: memoryBlockAttachments.id });

  return row;
}

// ─── Phase D2 — playbook-driven upsert ───────────────────────────────────────

export interface UpsertFromPlaybookParams {
  organisationId: string;
  subaccountId: string;
  /** Memory Block label (matches the `name` column). */
  label: string;
  /** Pre-serialised content from the step output (caller applies `serialiseForBlock`). */
  content: string;
  mergeStrategy: MergeStrategy;
  /** The playbookRun.id firing the binding. */
  sourceRunId: string;
  /** Slug of the playbook whose run is firing. */
  playbookSlug: string;
  /** The agent that owns the write (typically the Configuration Assistant). */
  actorAgentId: string | null;
  /** 'low' on firstRunOnly bindings, 'normal' otherwise. */
  confidence: BlockConfidence;
}

export type UpsertFromPlaybookResult =
  | { kind: 'created'; blockId: string; truncated: boolean }
  | { kind: 'updated'; blockId: string; truncated: boolean; mergeFallback: boolean }
  | { kind: 'skipped'; reason: 'hitl_overwrite'; blockId: string; previewContent: string }
  | { kind: 'skipped'; reason: 'rate_limited' }
  | { kind: 'skipped'; reason: 'empty_output' };

/**
 * Playbook-driven upsert. Called by `finaliseRun()` for each `knowledgeBinding`
 * whose source step completed successfully. Applies:
 *   - the 10-per-run rate limit (§7.5)
 *   - the HITL overwrite rule against human-edited blocks (§7.5)
 *   - the merge strategy with 2000-char truncation (§8.4)
 *
 * All three bits of decision logic live in `memoryBlockUpsertPure.ts` — this
 * wrapper only fetches the existing row, counts prior writes for the run,
 * and persists the decided outcome.
 */
export async function upsertFromPlaybook(
  params: UpsertFromPlaybookParams,
): Promise<UpsertFromPlaybookResult> {
  const {
    organisationId,
    subaccountId,
    label,
    content,
    mergeStrategy,
    sourceRunId,
    playbookSlug,
    actorAgentId,
    confidence,
  } = params;

  // Count how many blocks this run has already written — the per-run quota.
  const [{ value: blocksUpsertedThisRun }] = await db
    .select({ value: count() })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.sourceRunId, sourceRunId),
        isNull(memoryBlocks.deletedAt),
      ),
    );

  // Look up the existing block by label within the sub-account.
  const [existingRow] = await db
    .select()
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.organisationId, organisationId),
        eq(memoryBlocks.subaccountId, subaccountId),
        eq(memoryBlocks.name, label),
        isNull(memoryBlocks.deletedAt),
      ),
    );

  const decision = decideUpsert({
    existing: existingRow
      ? {
          id: existingRow.id,
          content: existingRow.content,
          lastEditedByAgentId: existingRow.lastEditedByAgentId,
          lastWrittenByPlaybookSlug: existingRow.lastWrittenByPlaybookSlug,
          sourceRunId: existingRow.sourceRunId,
        }
      : null,
    label,
    incomingContent: content,
    mergeStrategy,
    playbookSlug,
    blocksUpsertedThisRun: Number(blocksUpsertedThisRun),
  });

  switch (decision.kind) {
    case 'skip_empty':
      return { kind: 'skipped', reason: 'empty_output' };
    case 'skip_rate_limited':
      return { kind: 'skipped', reason: 'rate_limited' };
    case 'skip_hitl_overwrite':
      return {
        kind: 'skipped',
        reason: 'hitl_overwrite',
        blockId: existingRow!.id,
        previewContent: decision.previewContent,
      };
    case 'create': {
      const [created] = await db
        .insert(memoryBlocks)
        .values({
          organisationId,
          subaccountId,
          name: label,
          content: decision.content,
          isReadOnly: false,
          sourceRunId,
          lastEditedByAgentId: actorAgentId,
          lastWrittenByPlaybookSlug: playbookSlug,
          confidence,
        })
        .returning({ id: memoryBlocks.id });
      return { kind: 'created', blockId: created.id, truncated: decision.truncated };
    }
    case 'update': {
      const [updated] = await db
        .update(memoryBlocks)
        .set({
          content: decision.content,
          sourceRunId,
          lastEditedByAgentId: actorAgentId,
          lastWrittenByPlaybookSlug: playbookSlug,
          // Do not touch `confidence` on update — a previously-'low' block can
          // remain 'low' until a human saves it manually. Spec §8.4 last bullet.
          updatedAt: new Date(),
        })
        .where(eq(memoryBlocks.id, existingRow!.id))
        .returning({ id: memoryBlocks.id });
      return {
        kind: 'updated',
        blockId: updated.id,
        truncated: decision.truncated,
        mergeFallback: decision.mergeFallback,
      };
    }
  }
}

/** Re-export the per-run quota for places that want to display it in UI. */
export { MEMORY_BLOCKS_PER_RUN_MAX };

export async function detachBlock(blockId: string, agentId: string, orgId: string): Promise<boolean> {
  // Verify the block belongs to the caller's org before detaching
  const [block] = await db
    .select({ id: memoryBlocks.id })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, orgId),
        isNull(memoryBlocks.deletedAt),
      ),
    );
  if (!block) {
    throw { statusCode: 404, message: 'Memory block not found' };
  }

  const deleted = await db
    .delete(memoryBlockAttachments)
    .where(
      and(
        eq(memoryBlockAttachments.blockId, blockId),
        eq(memoryBlockAttachments.agentId, agentId),
      ),
    )
    .returning({ id: memoryBlockAttachments.id });

  return deleted.length > 0;
}
