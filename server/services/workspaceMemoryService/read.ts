import { eq, and, desc, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workspaceMemories, workspaceMemoryEntries, agentExecutionLogEdits } from '../../db/schema/index.js';
import { assertScope, assertScopeSingle } from '../../lib/scopeAssertion.js';
import { DEFAULT_ENTRY_LIMIT } from '../../config/limits.js';

// ---------------------------------------------------------------------------
// Read methods
// ---------------------------------------------------------------------------

export async function getMemory(organisationId: string, subaccountId: string) {
  const [memory] = await db
    .select()
    .from(workspaceMemories)
    .where(
      and(
        eq(workspaceMemories.organisationId, organisationId),
        eq(workspaceMemories.subaccountId, subaccountId)
      )
    );
  return assertScopeSingle(
    memory ?? null,
    { organisationId, subaccountId },
    'workspaceMemoryService.getMemory',
  );
}

export async function getOrCreateMemory(organisationId: string, subaccountId: string) {
  const existing = await getMemory(organisationId, subaccountId);
  if (existing) return existing;

  const [created] = await db
    .insert(workspaceMemories)
    .values({
      organisationId,
      subaccountId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return created;
}

export async function listEntries(
  subaccountId: string,
  opts?: { limit?: number; offset?: number; includedInSummary?: boolean; organisationId?: string }
) {
  const conditions = [
    eq(workspaceMemoryEntries.subaccountId, subaccountId),
    // §7 G6.2 / migration 0126 — skip archived (soft-deleted) entries.
    isNull(workspaceMemoryEntries.deletedAt),
  ];
  if (opts?.organisationId) {
    conditions.push(eq(workspaceMemoryEntries.organisationId, opts.organisationId));
  }
  if (opts?.includedInSummary !== undefined) {
    conditions.push(eq(workspaceMemoryEntries.includedInSummary, opts.includedInSummary));
  }

  const limit = opts?.limit ?? DEFAULT_ENTRY_LIMIT;
  const offset = opts?.offset ?? 0;

  const rows = await db
    .select()
    .from(workspaceMemoryEntries)
    .where(and(...conditions))
    .orderBy(desc(workspaceMemoryEntries.createdAt))
    .limit(limit)
    .offset(offset);

  // Only assert when the caller provided an expected organisationId.
  // Callers that omit it are legacy single-subaccount callers; the
  // subaccountId filter is the primary guard in that case.
  if (opts?.organisationId) {
    return assertScope(
      rows,
      { organisationId: opts.organisationId, subaccountId },
      'workspaceMemoryService.listEntries',
    );
  }
  return rows;
}

export async function deleteEntry(entryId: string, organisationId: string, subaccountId: string) {
  // §7 G6.2 — soft delete so "archive" / "delete" on the Knowledge page is
  // recoverable via config history / DB restore. All list paths filter
  // IS NULL, so a tombstoned row drops out of the UI immediately.
  const [deleted] = await db
    .update(workspaceMemoryEntries)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(workspaceMemoryEntries.id, entryId),
        eq(workspaceMemoryEntries.organisationId, organisationId),
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
      )
    )
    .returning();
  return deleted ?? null;
}

export async function updateSummary(
  organisationId: string,
  subaccountId: string,
  summary: string,
  options?: {
    /** When set, inserts an agent_execution_log_edits audit row inside the same tx. */
    triggeringRunId?: string;
    /** Required when triggeringRunId is supplied. */
    actorUserId?: string;
  },
) {
  const memory = await getOrCreateMemory(organisationId, subaccountId);

  const prevSummary = memory.summary ?? '';

  let updated: typeof workspaceMemories.$inferSelect | undefined;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workspaceMemories)
      .set({ summary, updatedAt: new Date() })
      .where(eq(workspaceMemories.id, memory.id))
      .returning();
    updated = row;

    // LAEL Phase 2 — audit row for agent-triggered summary edits
    if (row && options?.triggeringRunId && options.actorUserId) {
      const prevLen = prevSummary.length;
      const nextLen = summary.length;
      const editSummary = prevLen !== nextLen || summary !== prevSummary
        ? `Updated content (${prevLen}→${nextLen} chars)`
        : 'No changes detected';

      await tx.insert(agentExecutionLogEdits).values({
        organisationId,
        subaccountId,
        runId: options.triggeringRunId,
        entityType: 'workspace_memory_summary',
        entityId: memory.id,
        editedByUserId: options.actorUserId,
        editSummary,
      });
    }
  });

  return updated!;
}

export async function updateQualityThreshold(organisationId: string, subaccountId: string, qualityThreshold: number) {
  const memory = await getOrCreateMemory(organisationId, subaccountId);
  const [updated] = await db
    .update(workspaceMemories)
    .set({ qualityThreshold, updatedAt: new Date() })
    .where(eq(workspaceMemories.id, memory.id))
    .returning();
  return updated;
}
