import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workspaceMemoryEntries } from '../../db/schema/index.js';
import { routeCall } from '../llmRouter.js';

// ---------------------------------------------------------------------------
// Mem0 dedup helpers
// ---------------------------------------------------------------------------

export interface DedupeEntry {
  content: string;
  entryType: string;
  op: 'ADD' | 'UPDATE' | 'DELETE';
  existingId?: string;
  updatedContent?: string;
}

export const DEDUP_SYSTEM = `You are a memory deduplication assistant.
Given new facts and existing facts, classify each new fact as ADD, UPDATE, or DELETE.
- ADD: new information not in existing facts
- UPDATE: amends an existing fact (provide existing_id and updated_fact)
- DELETE: makes an existing fact wrong or obsolete (provide existing_id)

Output ONLY valid JSON: { "ops": [{ "type": "ADD"|"UPDATE"|"DELETE", "fact": "...", "existing_id"?: "uuid", "updated_fact"?: "..." }] }
If all are new: { "ops": [{ "type": "ADD", "fact": "..." }, ...] }`;

export async function deduplicateEntries(
  newEntries: Array<{ content: string; entryType: string }>,
  subaccountId: string,
  taskSlug: string | null,
  organisationId: string,
  runId: string,
): Promise<DedupeEntry[]> {
  if (newEntries.length === 0) return [];

  // Load recent candidate entries for comparison (top 20 by recency).
  // §7 G6.2 — skip archived Reference notes so dedup does not re-surface
  // content that the user intentionally removed from the workspace.
  const taskFilter = taskSlug
    ? and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
        sql`(task_slug = ${taskSlug} OR task_slug IS NULL)`,
      )
    : and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
      );

  const candidates = await getOrgScopedDb('dedup.deduplicateEntries')
    .select({ id: workspaceMemoryEntries.id, content: workspaceMemoryEntries.content })
    .from(workspaceMemoryEntries)
    .where(taskFilter)
    .orderBy(desc(workspaceMemoryEntries.createdAt))
    .limit(20);

  // If no existing entries, all are ADD — skip LLM call
  if (candidates.length === 0) {
    return newEntries.map(e => ({ ...e, op: 'ADD' as const }));
  }

  try {
    const response = await routeCall({
      system: DEDUP_SYSTEM,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          new_facts: newEntries.map(e => ({ content: e.content, type: e.entryType })),
          existing_facts: candidates.map(c => ({ id: c.id, fact: c.content })),
        }),
      }],
      maxTokens: 1024,
      temperature: 0.1,
      context: {
        organisationId,
        subaccountId,
        runId,
        sourceType: 'agent_run',
        taskType: 'memory_compile',
        executionPhase: 'execution',
        routingMode: 'ceiling',
      },
    });

    const parsed = JSON.parse(response.content) as {
      ops: Array<{ type: 'ADD' | 'UPDATE' | 'DELETE'; fact?: string; existing_id?: string; updated_fact?: string }>;
    };

    const result: DedupeEntry[] = [];
    const opsLimit = Math.min(parsed.ops.length, newEntries.length);
    for (let i = 0; i < opsLimit; i++) {
      const op = parsed.ops[i];
      const source = newEntries[i];
      result.push({
        content: op.fact ?? source.content,
        entryType: source.entryType,
        op: op.type,
        existingId: op.existing_id,
        updatedContent: op.updated_fact,
      });
    }
    return result;
  } catch {
    // Dedup failed — fall through to ADD all (safe degradation)
    return newEntries.map(e => ({ ...e, op: 'ADD' as const }));
  }
}
