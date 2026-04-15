/**
 * knowledgeService — Phase D1 of docs/onboarding-playbooks-spec.md (§7.3).
 *
 * Backs the Unified Knowledge page (References tab + Memory Blocks tab).
 * The CRUD for each store continues to live in the existing services
 * (workspaceMemoryService, memoryBlockService); what this file adds is the
 * promote/demote flow that bridges the two stores while preserving
 * provenance and logging Config History on both sides of the mutation.
 *
 * Contracts (spec §7.3):
 *   promoteReferenceToBlock — creates a memory_blocks row with
 *     sourceReferenceId pointing at the original Reference. The Reference
 *     is NOT deleted (promotion is non-destructive, per spec).
 *   demoteBlockToReference — creates a workspace_memory_entries row and
 *     soft-deletes the source block. Both entities log Config History.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memoryBlocks, workspaceMemoryEntries } from '../db/schema/index.js';
import { configHistoryService } from './configHistoryService.js';

type ReferenceEntryType = 'observation' | 'decision' | 'preference' | 'issue' | 'pattern';

export interface CreateReferenceParams {
  subaccountId: string;
  organisationId: string;
  content: string;
  entryType?: ReferenceEntryType;
}

/**
 * Create a manually-authored Reference (spec §7.2). Routes must not touch the
 * DB directly — the RLS contract gate fails closed on raw `db` imports outside
 * server/services/**.
 */
export async function createReference(params: CreateReferenceParams) {
  const { subaccountId, organisationId, content, entryType } = params;
  const [created] = await db
    .insert(workspaceMemoryEntries)
    .values({
      organisationId,
      subaccountId,
      agentRunId: null,
      agentId: null,
      content,
      entryType: entryType ?? 'observation',
    })
    .returning();
  return created;
}

export interface UpdateReferenceParams {
  referenceId: string;
  subaccountId: string;
  organisationId: string;
  content: string;
}

export async function updateReference(params: UpdateReferenceParams) {
  const { referenceId, subaccountId, organisationId, content } = params;
  const [updated] = await db
    .update(workspaceMemoryEntries)
    .set({ content })
    .where(
      and(
        eq(workspaceMemoryEntries.id, referenceId),
        eq(workspaceMemoryEntries.organisationId, organisationId),
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
      ),
    )
    .returning();
  return updated ?? null;
}

/** Max label length for a Memory Block, matching spec §7.3 (80 chars). */
export const MEMORY_BLOCK_LABEL_MAX = 80;

/** Max content length for a Memory Block, matching spec §7.5 (2000 chars). */
export const MEMORY_BLOCK_CONTENT_MAX = 2000;

export interface PromoteReferenceParams {
  referenceId: string;
  subaccountId: string;
  organisationId: string;
  label: string;
  content: string;
  actorUserId: string | null;
}

export async function promoteReferenceToBlock(
  params: PromoteReferenceParams,
): Promise<{ blockId: string }> {
  const { referenceId, subaccountId, organisationId, label, content, actorUserId } = params;

  if (!label || label.length > MEMORY_BLOCK_LABEL_MAX) {
    throw { statusCode: 400, message: `Label must be 1–${MEMORY_BLOCK_LABEL_MAX} characters` };
  }
  if (!content || content.length > MEMORY_BLOCK_CONTENT_MAX) {
    throw { statusCode: 400, message: `Content must be 1–${MEMORY_BLOCK_CONTENT_MAX} characters` };
  }

  // Verify the Reference exists and belongs to the subaccount + org.
  const [ref] = await db
    .select({ id: workspaceMemoryEntries.id })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.id, referenceId),
        eq(workspaceMemoryEntries.organisationId, organisationId),
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
      ),
    );
  if (!ref) {
    throw { statusCode: 404, message: 'Reference not found' };
  }

  // Reject duplicate labels within the subaccount (spec §7.5 — unique per
  // sub-account). The existing DB constraint is org-scoped on `name`; we
  // narrow to subaccount here at the service layer until a future migration
  // introduces the stricter partial unique index.
  const [dupe] = await db
    .select({ id: memoryBlocks.id })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.organisationId, organisationId),
        eq(memoryBlocks.subaccountId, subaccountId),
        eq(memoryBlocks.name, label),
        isNull(memoryBlocks.deletedAt),
      ),
    );
  if (dupe) {
    throw { statusCode: 409, message: `A Memory Block labelled "${label}" already exists for this sub-account` };
  }

  const [created] = await db
    .insert(memoryBlocks)
    .values({
      organisationId,
      subaccountId,
      name: label,
      content,
      sourceReferenceId: referenceId,
      isReadOnly: false,
    })
    .returning();

  await configHistoryService.recordHistory({
    entityType: 'memory_block',
    entityId: created.id,
    organisationId,
    snapshot: {
      name: created.name,
      content: created.content,
      subaccountId: created.subaccountId,
      sourceReferenceId: created.sourceReferenceId,
      promotedFromReferenceId: referenceId,
    },
    changedBy: actorUserId,
    changeSource: 'ui',
    changeSummary: `Promoted from Reference ${referenceId}`,
  });

  return { blockId: created.id };
}

export interface DemoteBlockParams {
  blockId: string;
  subaccountId: string;
  organisationId: string;
  /** Optional content override — defaults to the block's current content. */
  content?: string;
  actorUserId: string | null;
}

export async function demoteBlockToReference(
  params: DemoteBlockParams,
): Promise<{ referenceId: string }> {
  const { blockId, subaccountId, organisationId, content, actorUserId } = params;

  const [block] = await db
    .select()
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, organisationId),
        eq(memoryBlocks.subaccountId, subaccountId),
        isNull(memoryBlocks.deletedAt),
      ),
    );
  if (!block) {
    throw { statusCode: 404, message: 'Memory block not found' };
  }

  const referenceContent = content ?? block.content;
  if (!referenceContent) {
    throw { statusCode: 400, message: 'Reference content cannot be empty' };
  }

  // Create the Reference. `agentRunId` and `agentId` are nullable post-0118;
  // a demoted block has no source agent run.
  const [createdRef] = await db
    .insert(workspaceMemoryEntries)
    .values({
      organisationId,
      subaccountId,
      agentRunId: null,
      agentId: null,
      content: referenceContent,
      entryType: 'observation',
    })
    .returning({ id: workspaceMemoryEntries.id });

  // Soft-delete the block.
  await db
    .update(memoryBlocks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(memoryBlocks.id, blockId));

  // Log Config History for both sides of the mutation.
  await configHistoryService.recordHistory({
    entityType: 'memory_block',
    entityId: block.id,
    organisationId,
    snapshot: {
      name: block.name,
      content: block.content,
      subaccountId: block.subaccountId,
      deletedAt: new Date().toISOString(),
      demotedToReferenceId: createdRef.id,
    },
    changedBy: actorUserId,
    changeSource: 'ui',
    changeSummary: `Demoted to Reference ${createdRef.id}`,
  });

  await configHistoryService.recordHistory({
    entityType: 'reference_entry',
    entityId: createdRef.id,
    organisationId,
    snapshot: {
      content: referenceContent,
      subaccountId,
      createdByDemotion: true,
      demotedFromBlockId: block.id,
    },
    changedBy: actorUserId,
    changeSource: 'ui',
    changeSummary: `Created by demoting Memory Block ${block.id}`,
  });

  return { referenceId: createdRef.id };
}
