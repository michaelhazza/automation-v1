import { eq, and, desc, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workspaceMemories, workspaceMemoryEntries } from '../../db/schema/index.js';
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

export async function updateSummary(organisationId: string, subaccountId: string, summary: string) {
  const memory = await getOrCreateMemory(organisationId, subaccountId);
  const [updated] = await getOrgScopedDb('read.updateSummary')
    .update(workspaceMemories)
    .set({ summary, updatedAt: new Date() })
    .where(eq(workspaceMemories.id, memory.id))
    .returning();
  return updated;
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
