// Thin service wrapping inserts into agent_run_prompts.
// Spec: tasks/live-agent-execution-log-spec.md §4.4, §5.6, §6.2.

import { and, eq, sql } from 'drizzle-orm';
import { agentRunPrompts } from '../db/schema/agentRunPrompts.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import type { AgentRunPromptLayerAttributions } from '../../shared/types/agentExecutionLog.js';

export interface PersistAssemblyInput {
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  systemPrompt: string;
  userPrompt: string;
  toolDefinitions: unknown[];
  layerAttributions: AgentRunPromptLayerAttributions;
  totalTokens: number;
}

export interface PersistAssemblyOutput {
  promptRowId: string;
  assemblyNumber: number;
}

/**
 * Persist a fully-assembled prompt for a run. Returns the row's surrogate
 * UUID plus the 1-indexed `assemblyNumber` — the `prompt.assembled` event
 * carries both.
 *
 * `assemblyNumber` is allocated by counting existing rows for the run +
 * 1, inside the org-scoped transaction. Concurrent writes to the same run
 * are rare (the agent loop is single-threaded per run today) but a
 * unique-index on `(run_id, assembly_number)` makes a collision fail
 * loudly rather than silently duplicate.
 */
export async function persistAssembly(
  input: PersistAssemblyInput,
): Promise<PersistAssemblyOutput> {
  const db = getOrgScopedDb('agentRunPromptService.persistAssembly');

  const [countRow] = await db
    .select({
      count: sql<number>`COALESCE(MAX(${agentRunPrompts.assemblyNumber}), 0)`,
    })
    .from(agentRunPrompts)
    .where(eq(agentRunPrompts.runId, input.runId));

  const assemblyNumber = (countRow?.count ?? 0) + 1;

  const [row] = await db
    .insert(agentRunPrompts)
    .values({
      runId: input.runId,
      assemblyNumber,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      toolDefinitions: input.toolDefinitions,
      layerAttributions: input.layerAttributions as unknown as Record<string, unknown>,
      totalTokens: input.totalTokens,
    })
    .returning({ id: agentRunPrompts.id });

  return { promptRowId: row.id, assemblyNumber };
}
