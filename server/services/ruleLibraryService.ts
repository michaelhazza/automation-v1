import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memoryBlocks } from '../db/schema/index.js';
import { writeVersionRow } from './memoryBlockVersionService.js';
import type {
  RuleListFilter,
  RuleListResult,
  RulePatch,
  RuleRow,
  RuleScope,
} from '../../shared/types/briefRules.js';
import type { MemoryBlockDeprecationReason } from '../db/schema/memoryBlocks.js';

function deriveScope(row: typeof memoryBlocks.$inferSelect): RuleScope {
  if (row.ownerAgentId) return { kind: 'agent', agentId: row.ownerAgentId };
  if (row.subaccountId) return { kind: 'subaccount', subaccountId: row.subaccountId };
  return { kind: 'org' };
}

function rowToRuleRow(row: typeof memoryBlocks.$inferSelect): RuleRow {
  let status: RuleRow['status'] = 'active';
  if (row.deprecatedAt) status = 'deprecated';
  else if (row.pausedAt) status = 'paused';

  return {
    id: row.id,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId ?? null,
    ownerAgentId: row.ownerAgentId ?? null,
    text: row.content,
    scope: deriveScope(row),
    priority: (row.priority ?? 'medium') as RuleRow['priority'],
    isAuthoritative: row.isAuthoritative,
    capturedVia: row.capturedVia as RuleRow['capturedVia'],
    status,
    qualityScore: Number(row.qualityScore),
    context: null,
    originatingArtefactId: null,
    originatingBriefId: null,
    createdByUserId: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRules(
  filter: RuleListFilter,
  organisationId: string,
): Promise<RuleListResult> {
  const conditions = [
    eq(memoryBlocks.organisationId, organisationId),
    isNull(memoryBlocks.deletedAt),
  ];

  if (filter.status === 'active') {
    conditions.push(isNull(memoryBlocks.pausedAt));
    conditions.push(isNull(memoryBlocks.deprecatedAt));
  } else if (filter.status === 'paused') {
    conditions.push(isNotNull(memoryBlocks.pausedAt));
    conditions.push(isNull(memoryBlocks.deprecatedAt));
  } else if (filter.status === 'deprecated') {
    conditions.push(isNotNull(memoryBlocks.deprecatedAt));
  }

  if (filter.scopeType === 'subaccount' && filter.scopeId) {
    conditions.push(eq(memoryBlocks.subaccountId, filter.scopeId));
  } else if (filter.scopeType === 'agent' && filter.scopeId) {
    conditions.push(eq(memoryBlocks.ownerAgentId, filter.scopeId));
  } else if (filter.scopeType === 'org') {
    conditions.push(isNull(memoryBlocks.subaccountId));
    conditions.push(isNull(memoryBlocks.ownerAgentId));
  }

  const limit = filter.limit ?? 50;

  if (filter.cursor) {
    conditions.push(gt(memoryBlocks.createdAt, new Date(filter.cursor)));
  }

  const rows = await db
    .select()
    .from(memoryBlocks)
    .where(and(...conditions))
    .orderBy(desc(memoryBlocks.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const cursor = hasMore ? page[page.length - 1]?.createdAt.toISOString() : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memoryBlocks)
    .where(and(...conditions));

  return {
    rules: page.map(rowToRuleRow),
    totalCount: count,
    cursor,
  };
}

export async function patchRule(
  ruleId: string,
  organisationId: string,
  patch: RulePatch,
  actorUserId: string,
): Promise<RuleRow | null> {
  const updates: Partial<typeof memoryBlocks.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (patch.text !== undefined) updates.content = patch.text;
  if (patch.priority !== undefined) updates.priority = patch.priority;
  if (patch.isAuthoritative !== undefined) updates.isAuthoritative = patch.isAuthoritative;

  if (patch.status === 'paused') {
    updates.pausedAt = new Date();
  } else if (patch.status === 'active') {
    // Drizzle treats undefined as "don't touch this column" — pass null to
    // actually clear paused_at so the rule returns to active.
    updates.pausedAt = null;
  }

  const [updated] = await db
    .update(memoryBlocks)
    .set(updates)
    .where(and(eq(memoryBlocks.id, ruleId), eq(memoryBlocks.organisationId, organisationId)))
    .returning();

  if (!updated) return null;

  if (patch.text !== undefined) {
    await writeVersionRow({
      blockId: ruleId,
      content: patch.text,
      changeSource: 'manual_edit',
      actorUserId,
    });
  }

  return rowToRuleRow(updated);
}

export async function deprecateRule(
  ruleId: string,
  organisationId: string,
  reason: MemoryBlockDeprecationReason = 'user_deleted',
): Promise<boolean> {
  const [updated] = await db
    .update(memoryBlocks)
    .set({ deprecatedAt: new Date(), deprecationReason: reason, updatedAt: new Date() })
    .where(and(eq(memoryBlocks.id, ruleId), eq(memoryBlocks.organisationId, organisationId)))
    .returning({ id: memoryBlocks.id });

  return updated !== undefined;
}
