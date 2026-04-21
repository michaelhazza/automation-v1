// Batched linked-entity label resolver + re-export of the pure mask
// builder. The mask builder itself lives in
// agentRunEditPermissionMaskPure.ts so unit tests can import it without
// pulling in Drizzle schemas (which transitively require env validation).
//
// Spec: tasks/live-agent-execution-log-spec.md §4.1a + §5.9 + §7.2.

import { inArray } from 'drizzle-orm';
import { actions } from '../db/schema/actions.js';
import { agentDataSources } from '../db/schema/agentDataSources.js';
import { agentRunPrompts } from '../db/schema/agentRunPrompts.js';
import { agents } from '../db/schema/agents.js';
import { memoryBlocks } from '../db/schema/memoryBlocks.js';
import { policyRules } from '../db/schema/policyRules.js';
import { skills } from '../db/schema/skills.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import { systemSkills } from '../db/schema/systemSkills.js';
import { workspaceMemoryEntries } from '../db/schema/workspaceMemories.js';
import { getOrgScopedDb } from './orgScopedDb.js';

// Mask builder + user-context type — re-exported from the pure module.
export {
  buildPermissionMask,
  type PermissionMaskUserContext,
} from './agentRunEditPermissionMaskPure.js';

// ---------------------------------------------------------------------------
// Batched label resolution (N+1 free — spec §5.9)
// ---------------------------------------------------------------------------

export type LinkedEntityLabelMap = Record<string, string>;

/**
 * Group the refs by type, issue one SELECT per type (max 9 queries per
 * page regardless of size), return a map keyed by `${type}:${id}`.
 * Runs inside the org-scoped transaction; RLS enforces tenant isolation.
 */
export async function resolveLinkedEntityLabels(
  refs: Array<{ type: string; id: string }>,
): Promise<LinkedEntityLabelMap> {
  if (refs.length === 0) return {};
  const db = getOrgScopedDb('agentRunEditPermissionMask.resolveLinkedEntityLabels');
  const out: LinkedEntityLabelMap = {};

  const byType = new Map<string, string[]>();
  for (const ref of refs) {
    const list = byType.get(ref.type) ?? [];
    list.push(ref.id);
    byType.set(ref.type, list);
  }

  for (const [type, ids] of byType) {
    const uniqueIds = Array.from(new Set(ids));
    switch (type) {
      case 'memory_entry': {
        const rows = await db
          .select({
            id: workspaceMemoryEntries.id,
            content: workspaceMemoryEntries.content,
          })
          .from(workspaceMemoryEntries)
          .where(inArray(workspaceMemoryEntries.id, uniqueIds));
        for (const r of rows) {
          out[`${type}:${r.id}`] = `Memory: ${truncateLabel(r.content ?? '')}`;
        }
        break;
      }
      case 'memory_block': {
        const rows = await db
          .select({ id: memoryBlocks.id, name: memoryBlocks.name })
          .from(memoryBlocks)
          .where(inArray(memoryBlocks.id, uniqueIds));
        for (const r of rows) {
          out[`${type}:${r.id}`] = `Memory block: ${r.name}`;
        }
        break;
      }
      case 'policy_rule': {
        const rows = await db
          .select({
            id: policyRules.id,
            toolSlug: policyRules.toolSlug,
            descriptionTemplate: policyRules.descriptionTemplate,
          })
          .from(policyRules)
          .where(inArray(policyRules.id, uniqueIds));
        for (const r of rows) {
          const desc = r.descriptionTemplate ? truncateLabel(r.descriptionTemplate) : '';
          out[`${type}:${r.id}`] = `Rule: ${r.toolSlug}${desc ? ` — ${desc}` : ''}`;
        }
        break;
      }
      case 'skill': {
        const [subRows, sysRows] = await Promise.all([
          db
            .select({ id: skills.id, name: skills.name, slug: skills.slug })
            .from(skills)
            .where(inArray(skills.id, uniqueIds)),
          db
            .select({ id: systemSkills.id, name: systemSkills.name, slug: systemSkills.slug })
            .from(systemSkills)
            .where(inArray(systemSkills.id, uniqueIds)),
        ]);
        for (const r of subRows) out[`${type}:${r.id}`] = `Skill: ${r.name ?? r.slug}`;
        for (const r of sysRows) out[`${type}:${r.id}`] = `Skill: ${r.name ?? r.slug}`;
        break;
      }
      case 'data_source': {
        const rows = await db
          .select({ id: agentDataSources.id, name: agentDataSources.name })
          .from(agentDataSources)
          .where(inArray(agentDataSources.id, uniqueIds));
        for (const r of rows) out[`${type}:${r.id}`] = `Data source: ${r.name}`;
        break;
      }
      case 'agent': {
        const [orgRows, sysRows] = await Promise.all([
          db
            .select({ id: agents.id, name: agents.name })
            .from(agents)
            .where(inArray(agents.id, uniqueIds)),
          db
            .select({ id: systemAgents.id, name: systemAgents.name })
            .from(systemAgents)
            .where(inArray(systemAgents.id, uniqueIds)),
        ]);
        for (const r of orgRows) out[`${type}:${r.id}`] = `Agent: ${r.name}`;
        for (const r of sysRows) out[`${type}:${r.id}`] = `Agent: ${r.name}`;
        break;
      }
      case 'prompt': {
        const rows = await db
          .select({ id: agentRunPrompts.id, assembly: agentRunPrompts.assemblyNumber })
          .from(agentRunPrompts)
          .where(inArray(agentRunPrompts.id, uniqueIds));
        for (const r of rows) out[`${type}:${r.id}`] = `Prompt assembly #${r.assembly}`;
        break;
      }
      case 'llm_request': {
        // No meaningful label at list-view time — the ID is enough.
        for (const id of uniqueIds) out[`${type}:${id}`] = `LLM request ${id.slice(0, 8)}`;
        break;
      }
      case 'action': {
        const rows = await db
          .select({ id: actions.id, actionType: actions.actionType })
          .from(actions)
          .where(inArray(actions.id, uniqueIds));
        for (const r of rows) out[`${type}:${r.id}`] = `Action: ${r.actionType ?? 'unknown'}`;
        break;
      }
      default:
        // Unknown type — leave unresolved; caller falls back to the
        // generic `${type} ${id}` display.
        break;
    }
  }

  return out;
}

function truncateLabel(s: string, max = 60): string {
  const cleaned = s.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + '…';
}
