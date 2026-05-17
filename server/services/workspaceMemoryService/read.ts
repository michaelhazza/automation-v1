import { eq, and, desc, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workspaceMemories, workspaceMemoryEntries, agentExecutionLogEdits } from '../../db/schema/index.js';
import { assertScope, assertScopeSingle } from '../../lib/scopeAssertion.js';
import { DEFAULT_ENTRY_LIMIT } from '../../config/limits.js';

// ---------------------------------------------------------------------------
// Read methods
// ---------------------------------------------------------------------------

export async function getMemory(organisationId: string, subaccountId: string) {
  const [memory] = await getOrgScopedDb('read.getMemory')
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

  const [created] = await getOrgScopedDb('read.getOrCreateMemory')
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

  const rows = await getOrgScopedDb('read.listEntries')
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
  const [deleted] = await getOrgScopedDb('read.deleteEntry')
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
  // getOrCreateMemory uses bare db (workspaceMemories has no FORCE RLS), so
  // calling it outside the scoped savepoint is safe for the upsert path.
  const memory = await getOrCreateMemory(organisationId, subaccountId);

  let updated: typeof workspaceMemories.$inferSelect | undefined;

  // Use the org-scoped transaction (from withOrgTx ALS context) so the
  // agentExecutionLogEdits INSERT runs on a connection that already has
  // app.organisation_id set — required by FORCE ROW LEVEL SECURITY WITH CHECK.
  // LAEL-P2-L2: SELECT ... FOR UPDATE on the summary row closes the TOCTOU on
  // prevSummary that the prior SAVEPOINT-only approach could not eliminate.
  // Under READ COMMITTED a concurrent updater could land between this SELECT
  // and the UPDATE; the row-level lock serialises both writers so the audit
  // row's diff matches the actual delta.
  await getOrgScopedDb('read.updateSummary').transaction(async (tx) => {
    const [prevRow] = await tx
      .select({ summary: workspaceMemories.summary })
      .from(workspaceMemories)
      .where(eq(workspaceMemories.id, memory.id))
      .for('update');
    const prevSummary = prevRow?.summary ?? '';

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
  const [updated] = await getOrgScopedDb('read.updateQualityThreshold')
    .update(workspaceMemories)
    .set({ qualityThreshold, updatedAt: new Date() })
    .where(eq(workspaceMemories.id, memory.id))
    .returning();
  return updated;
}
