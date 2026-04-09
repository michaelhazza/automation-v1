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

import { eq, and, asc, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memoryBlocks, memoryBlockAttachments } from '../db/schema/index.js';
import type { MemoryBlock } from '../db/schema/memoryBlocks.js';

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
      isReadOnly: input.isReadOnly ?? true,
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
): Promise<{ id: string }> {
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

export async function detachBlock(blockId: string, agentId: string): Promise<boolean> {
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
