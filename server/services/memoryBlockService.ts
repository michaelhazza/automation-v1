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

import { eq, and, or, asc, isNull, count, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memoryBlocks, memoryBlockAttachments, subaccountAgents } from '../db/schema/index.js';
import type { MemoryBlock } from '../db/schema/memoryBlocks.js';
import {
  decideUpsert,
  MEMORY_BLOCKS_PER_RUN_MAX,
  type MergeStrategy,
  type BlockConfidence,
} from './memoryBlockUpsertPure.js';
import {
  rankBlocksForInjection,
  type CandidateBlock,
} from './memoryBlockServicePure.js';
import { generateEmbedding, formatVectorLiteral } from '../lib/embeddings.js';
import {
  BLOCK_RELEVANCE_THRESHOLD,
  BLOCK_RELEVANCE_TOP_K,
  BLOCK_TOKEN_BUDGET,
} from '../config/limits.js';
import { logger } from '../lib/logger.js';

// ─── Types + pure helpers (re-exported for callers) ─────────────────────────

export type { MemoryBlockForPrompt } from './memoryBlockServicePure.js';
export { formatBlocksForPrompt } from './memoryBlockServicePure.js';
import type { MemoryBlockForPrompt } from './memoryBlockServicePure.js';

// ─── S6: Block status invariant ──────────────────────────────────────────────

/**
 * Global invariant (spec §5.2): No block with status != 'active' is ever
 * injected into an agent's context. Enforced at every DB query that loads
 * blocks for injection. Protected blocks (e.g., config-agent-guidelines) are
 * considered always-active and bypass relevance scoring but not this filter.
 */
const ACTIVE_STATUS = 'active' as const;

/**
 * Known protected block names that must always be included when attached,
 * bypassing relevance scoring but never the status invariant.
 */
const PROTECTED_BLOCK_NAMES: ReadonlySet<string> = new Set([
  'config-agent-guidelines',
]);

function isProtectedBlockName(name: string): boolean {
  return PROTECTED_BLOCK_NAMES.has(name);
}

// ─── Read path (agent run hot path) ──────────────────────────────────────────

/**
 * Load all memory blocks attached to a given agent, ordered by block name
 * for deterministic prompt assembly. Excludes soft-deleted blocks.
 *
 * **Block status invariant (spec §5.2):** Only blocks with `status='active'`
 * are ever returned — this is the single, global filter for every injection
 * path. Draft / pending_review / rejected blocks never reach an agent's
 * context regardless of how they were attached.
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
        // §5.2 global invariant — only active blocks ever surface
        eq(memoryBlocks.status, ACTIVE_STATUS),
        // Phase G / §7.4 — skip tombstoned attachments so a detached
        // auto-attach row does not reappear in the agent's prompt.
        isNull(memoryBlockAttachments.deletedAt),
      ),
    )
    .orderBy(asc(memoryBlocks.name));

  return rows.map((r) => ({
    name: r.name,
    content: r.content,
    permission: r.permission as 'read' | 'read_write',
  }));
}

// ─── S6: Relevance-driven block retrieval ────────────────────────────────────

export interface RelevantBlockParams {
  /** Task context text used as the query embedding. */
  taskContext: string;
  subaccountId: string | null;
  organisationId: string;
  /** Token budget for relevance-path blocks. Default BLOCK_TOKEN_BUDGET. */
  tokenBudget?: number;
  /** Similarity threshold. Default BLOCK_RELEVANCE_THRESHOLD (0.65). */
  threshold?: number;
  /** Top-K relevance matches before token-budget eviction. Default BLOCK_RELEVANCE_TOP_K. */
  topK?: number;
  /** Optional pre-computed task context embedding (avoid double embedding call). */
  embedding?: number[];
}

/**
 * Semantically rank active memory blocks by cosine similarity to the task
 * context. Explicit attachments are handled separately by `getBlocksForAgent()`
 * — this function returns relevance-path matches only.
 *
 * Returns an empty array on embedding failure, no candidates, or if blocks
 * lack embeddings (backfill not yet complete).
 *
 * **Block status invariant:** Query filters `WHERE status='active'`. No other
 * code path may lift this filter.
 *
 * Spec: §5.2 (S6).
 */
export async function getRelevantBlocks(
  params: RelevantBlockParams,
): Promise<CandidateBlock[]> {
  const tokenBudget = params.tokenBudget ?? BLOCK_TOKEN_BUDGET;
  const threshold = params.threshold ?? BLOCK_RELEVANCE_THRESHOLD;
  const topK = params.topK ?? BLOCK_RELEVANCE_TOP_K;

  if (!params.taskContext || params.taskContext.trim().length === 0) {
    return [];
  }

  // 1. Get embedding for the task context (reuse caller-provided if given)
  const embedding = params.embedding ?? (await generateEmbedding(params.taskContext));
  if (!embedding) return [];

  const literal = formatVectorLiteral(embedding);

  // 2. Cosine-rank active blocks in scope (subaccount + org-shared).
  //    Subaccount scope: subaccountId match OR null (org-level blocks).
  const scopeCondition = params.subaccountId
    ? or(
        eq(memoryBlocks.subaccountId, params.subaccountId),
        isNull(memoryBlocks.subaccountId),
      )
    : isNull(memoryBlocks.subaccountId);

  // Over-fetch a larger pool so token-budget eviction has headroom.
  const poolSize = topK * 3;

  const rows = await db
    .select({
      id: memoryBlocks.id,
      name: memoryBlocks.name,
      content: memoryBlocks.content,
      // Cosine distance → similarity (1 - distance). Using <=> cosine distance op.
      distance: sql<number>`${memoryBlocks.embedding} <=> ${literal}::vector(1536)`,
    })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.organisationId, params.organisationId),
        eq(memoryBlocks.status, ACTIVE_STATUS),
        isNull(memoryBlocks.deletedAt),
        // Skip blocks without embeddings (backfill not yet complete)
        sql`${memoryBlocks.embedding} IS NOT NULL`,
        scopeCondition,
      ),
    )
    .orderBy(sql`${memoryBlocks.embedding} <=> ${literal}::vector(1536)`)
    .limit(poolSize);

  // 3. Convert distance → similarity, map to CandidateBlock shape, apply ranker
  const candidates: CandidateBlock[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    content: r.content,
    score: 1 - Number(r.distance),
    source: 'relevance',
    protected: isProtectedBlockName(r.name),
  }));

  return rankBlocksForInjection(candidates, {
    threshold,
    topK,
    tokenBudget,
  });
}

// ─── S6: Composed read path (explicit + relevance + token budget) ────────────

export interface GetBlocksForInjectionParams {
  agentId: string;
  subaccountId: string | null;
  organisationId: string;
  taskContext: string;
  tokenBudget?: number;
  /** Pre-computed task context embedding. */
  embedding?: number[];
}

/**
 * Unified block retrieval for agent run context injection.
 *
 * Composes:
 *   (a) Explicit attachments via getBlocksForAgent() — status=active filtered
 *   (b) Relevance-ranked active blocks via getRelevantBlocks()
 *   (c) Dedupe by block id, preferring explicit over relevance
 *
 * Protected blocks (config-agent-guidelines) are always surfaced when attached
 * and bypass relevance scoring / token-budget eviction.
 *
 * Spec: §5.2 (S6).
 */
export async function getBlocksForInjection(
  params: GetBlocksForInjectionParams,
): Promise<MemoryBlockForPrompt[]> {
  // Load explicit attachments (already filtered by status=active)
  const explicitRows = await db
    .select({
      id: memoryBlocks.id,
      name: memoryBlocks.name,
      content: memoryBlocks.content,
      permission: memoryBlockAttachments.permission,
    })
    .from(memoryBlockAttachments)
    .innerJoin(memoryBlocks, eq(memoryBlockAttachments.blockId, memoryBlocks.id))
    .where(
      and(
        eq(memoryBlockAttachments.agentId, params.agentId),
        eq(memoryBlocks.organisationId, params.organisationId),
        isNull(memoryBlocks.deletedAt),
        eq(memoryBlocks.status, ACTIVE_STATUS),
        isNull(memoryBlockAttachments.deletedAt),
      ),
    );

  const explicitCandidates: CandidateBlock[] = explicitRows.map((r) => ({
    id: r.id,
    name: r.name,
    content: r.content,
    score: 1.0, // explicit = max score; not used for ordering
    source: 'explicit',
    protected: isProtectedBlockName(r.name),
  }));

  // Track permission per block for the final output mapping
  const permissionByBlockId = new Map<string, 'read' | 'read_write'>();
  for (const r of explicitRows) {
    permissionByBlockId.set(r.id, r.permission as 'read' | 'read_write');
  }

  // Load relevance-path matches (also status=active filtered)
  const relevantCandidates = await getRelevantBlocks({
    taskContext: params.taskContext,
    subaccountId: params.subaccountId,
    organisationId: params.organisationId,
    tokenBudget: params.tokenBudget,
    embedding: params.embedding,
  });

  // Compose: rank combined set. Explicit blocks bypass eviction (handled in
  // the pure ranker by source='explicit'); relevance blocks share the budget.
  const ranked = rankBlocksForInjection(
    [...explicitCandidates, ...relevantCandidates],
    {
      threshold: BLOCK_RELEVANCE_THRESHOLD,
      topK: BLOCK_RELEVANCE_TOP_K,
      tokenBudget: params.tokenBudget ?? BLOCK_TOKEN_BUDGET,
    },
  );

  return ranked.map((c) => ({
    name: c.name,
    content: c.content,
    // Explicit blocks preserve their original permission; relevance blocks
    // are read-only by default (no mutation path outside explicit attachment).
    permission: permissionByBlockId.get(c.id) ?? 'read',
  }));
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

  await db.transaction(async (tx) => {
    await tx
      .update(memoryBlocks)
      .set({ content: newContent, updatedAt: new Date() })
      .where(eq(memoryBlocks.id, block.id));

    // Phase 5 S24 — version write in same transaction
    const { writeVersionRow } = await import('./memoryBlockVersionService.js');
    await writeVersionRow({
      blockId: block.id,
      content: newContent,
      changeSource: 'manual_edit',
      tx,
    });
  });

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
  /**
   * Phase G / §7.4 / G7.1 — when true, materialise a read-only attachment
   * for every currently-linked agent in the sub-account. Requires
   * `subaccountId` to be set.
   */
  autoAttach?: boolean;
}): Promise<MemoryBlock> {
  const autoAttach = input.autoAttach === true && !!input.subaccountId;

  // eslint-disable-next-line prefer-const
  let created!: MemoryBlock;
  const { writeVersionRow } = await import('./memoryBlockVersionService.js');
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(memoryBlocks)
      .values({
        organisationId: input.organisationId,
        subaccountId: input.subaccountId ?? null,
        name: input.name,
        content: input.content,
        ownerAgentId: input.ownerAgentId ?? null,
        isReadOnly: input.isReadOnly ?? false,
        autoAttach,
      })
      .returning();
    created = row;

    // Phase 5 S24 — write initial version row atomically with the insert
    await writeVersionRow({
      blockId: row.id,
      content: input.content,
      changeSource: 'seed',
      tx,
    });
  });

  if (autoAttach && input.subaccountId) {
    await materialiseAutoAttachForBlock(created.id, input.subaccountId, input.organisationId);
  }

  return created;
}

/**
 * Phase G / §7.4 / G7.1 — attach a memory block to every currently-linked
 * agent in the sub-account. Uses ON CONFLICT DO NOTHING so a tombstoned
 * attachment (user has explicitly detached) is NOT revived.
 *
 * Safe to call repeatedly (idempotent by unique index on (block_id, agent_id)).
 */
export async function materialiseAutoAttachForBlock(
  blockId: string,
  subaccountId: string,
  organisationId: string,
): Promise<void> {
  const links = await db
    .select({ agentId: subaccountAgents.agentId })
    .from(subaccountAgents)
    .where(
      and(
        eq(subaccountAgents.subaccountId, subaccountId),
        eq(subaccountAgents.organisationId, organisationId),
        eq(subaccountAgents.isActive, true),
      ),
    );
  if (links.length === 0) return;

  const values = links.map((l) => ({
    blockId,
    agentId: l.agentId,
    permission: 'read' as const,
    source: 'auto_attach' as const,
  }));
  await db
    .insert(memoryBlockAttachments)
    .values(values)
    .onConflictDoNothing({
      target: [memoryBlockAttachments.blockId, memoryBlockAttachments.agentId],
    });
}

/**
 * Phase G / §7.4 / G7.2 — called by `subaccountAgentService.linkAgent`.
 * Iterates every `auto_attach=true` memory block in the sub-account and
 * materialises an attachment for the newly-linked agent.
 */
export async function materialiseAutoAttachForAgent(
  agentId: string,
  subaccountId: string,
  organisationId: string,
): Promise<void> {
  const blocks = await db
    .select({ id: memoryBlocks.id })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.subaccountId, subaccountId),
        eq(memoryBlocks.organisationId, organisationId),
        eq(memoryBlocks.autoAttach, true),
        isNull(memoryBlocks.deletedAt),
      ),
    );
  if (blocks.length === 0) return;

  const values = blocks.map((b) => ({
    blockId: b.id,
    agentId,
    permission: 'read' as const,
    source: 'auto_attach' as const,
  }));
  await db
    .insert(memoryBlockAttachments)
    .values(values)
    .onConflictDoNothing({
      target: [memoryBlockAttachments.blockId, memoryBlockAttachments.agentId],
    });
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

  let updated: MemoryBlock | undefined;
  const { writeVersionRow } = await import('./memoryBlockVersionService.js');

  await db.transaction(async (tx) => {
    const [row] = await tx
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
    updated = row;

    // Phase 5 S24 — write version row atomically when content changed
    if (row && updates.content !== undefined) {
      await writeVersionRow({
        blockId: row.id,
        content: updates.content,
        changeSource: 'manual_edit',
        tx,
      });
    }
  });

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
    .select({ id: memoryBlocks.id, status: memoryBlocks.status })
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

  // §5.2 global invariant: non-active blocks are never injected. Reject
  // attachment at the service boundary — the route layer surfaces 409.
  if (block.status !== ACTIVE_STATUS) {
    throw {
      statusCode: 409,
      message: `Cannot attach block with status '${block.status}'. Only active blocks may be attached.`,
      errorCode: 'BLOCK_STATUS_NOT_ACTIVE',
    };
  }

  const [row] = await db
    .insert(memoryBlockAttachments)
    .values({ blockId, agentId, permission, source: 'manual' })
    .onConflictDoUpdate({
      target: [memoryBlockAttachments.blockId, memoryBlockAttachments.agentId],
      set: {
        permission,
        source: 'manual',
        // §7.4 — a manual attach revives a tombstoned row so the agent sees
        // the block again. This is the intended user-initiated re-attach path.
        deletedAt: null,
      },
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
  /**
   * Phase G / §7.4 / spec line 319 — default `true` for blocks created via
   * `knowledgeBindings[]`. When a block is first created by this path the
   * flag is persisted and a read-only attachment is materialised for every
   * currently-linked agent in the sub-account. Ignored on the `update` path
   * — existing blocks keep whatever `autoAttach` they were created with.
   */
  autoAttach?: boolean;
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
  // Spec line 319: "Toggle: autoAttach (default: true for blocks created via
  // knowledgeBindings[])". The caller can override; when omitted, create paths
  // default to true so baseline facts are visible to every agent in the
  // sub-account without manual attachment.
  const autoAttach = params.autoAttach ?? true;

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
      let upsertCreatedId!: string;
      const { writeVersionRow: wvr } = await import('./memoryBlockVersionService.js');

      await db.transaction(async (tx) => {
        const [created] = await tx
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
            autoAttach,
          })
          .returning({ id: memoryBlocks.id });

        upsertCreatedId = created.id;

        // Phase 5 S24 — version row atomically with insert
        await wvr({
          blockId: created.id,
          content: decision.content,
          changeSource: 'playbook_upsert',
          notes: `Created by playbook ${playbookSlug}`,
          tx,
        });
      });

      if (autoAttach) {
        await materialiseAutoAttachForBlock(upsertCreatedId, subaccountId, organisationId);
      }
      return { kind: 'created', blockId: upsertCreatedId, truncated: decision.truncated };
    }
    case 'update': {
      let upsertUpdatedId!: string;
      const { writeVersionRow: wvrUpdate } = await import('./memoryBlockVersionService.js');

      await db.transaction(async (tx) => {
        const [updated] = await tx
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

        upsertUpdatedId = updated.id;

        // Phase 5 S24 — version row atomically with update
        await wvrUpdate({
          blockId: updated.id,
          content: decision.content,
          changeSource: 'playbook_upsert',
          notes: `Updated by playbook ${playbookSlug}`,
          tx,
        });
      });

      return {
        kind: 'updated',
        blockId: upsertUpdatedId,
        truncated: decision.truncated,
        mergeFallback: decision.mergeFallback,
      };
    }
  }
}

/** Re-export the per-run quota for places that want to display it in UI. */
export { MEMORY_BLOCKS_PER_RUN_MAX };

/**
 * Fetch the name of a memory block by ID, scoped to the caller's org.
 * Returns null if the block does not exist or belongs to a different org.
 * Used by route guards that need only the block name before mutating.
 */
export async function getBlockName(blockId: string, orgId: string): Promise<string | null> {
  const meta = await getBlockMeta(blockId, orgId);
  return meta?.name ?? null;
}

/**
 * Fetch name + ownerAgentId for a memory block, scoped to the caller's org.
 * Returns null if the block does not exist or belongs to a different org.
 * Used by route guards that need to compare field values before mutating.
 */
export async function getBlockMeta(
  blockId: string,
  orgId: string,
): Promise<{ name: string; ownerAgentId: string | null } | null> {
  const [row] = await db
    .select({ name: memoryBlocks.name, ownerAgentId: memoryBlocks.ownerAgentId })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, orgId),
        isNull(memoryBlocks.deletedAt),
      ),
    );
  return row ?? null;
}

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

  // §7.4 / G7.3 — soft-delete so future auto-attach iterations (via
  // ON CONFLICT DO NOTHING on the (block_id, agent_id) unique index) do NOT
  // revive the row. User intent to detach is durable.
  const updated = await db
    .update(memoryBlockAttachments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(memoryBlockAttachments.blockId, blockId),
        eq(memoryBlockAttachments.agentId, agentId),
        isNull(memoryBlockAttachments.deletedAt),
      ),
    )
    .returning({ id: memoryBlockAttachments.id });

  return updated.length > 0;
}
