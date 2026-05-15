import { eq, and, or, isNull, asc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agentDataSources } from '../../db/schema/index.js';
import type { DataSourceScope, LoadedDataSource } from './types.js';
import { loadSourceContent } from './externalFetchers.js';

/**
 * Load data sources across the three agent_data_sources scopes:
 *   - agent-wide (agentId matches, no subaccount/scheduled-task scope)
 *   - subaccount-scoped (agentId + subaccountAgentId match)
 *   - scheduled-task-scoped (scheduledTaskId matches — agentId is
 *     denormalised on the row but the scope key is the scheduled task)
 *
 * A single DB round-trip uses OR conditions so hitting all three scopes
 * costs one query. Results are returned in stable priority order; the
 * caller (loadRunContextData) handles scope-precedence sorting and
 * same-name override resolution.
 */
export async function fetchDataSourcesByScope(
  scope: DataSourceScope
): Promise<LoadedDataSource[]> {
  const conditions = [
    // 1. Agent-wide: agentId matches, no subaccount or scheduled task scope
    and(
      eq(agentDataSources.agentId, scope.agentId),
      isNull(agentDataSources.subaccountAgentId),
      isNull(agentDataSources.scheduledTaskId),
    ),
  ];

  if (scope.subaccountAgentId) {
    conditions.push(
      and(
        eq(agentDataSources.agentId, scope.agentId),
        eq(agentDataSources.subaccountAgentId, scope.subaccountAgentId),
      )
    );
  }

  if (scope.scheduledTaskId) {
    conditions.push(
      eq(agentDataSources.scheduledTaskId, scope.scheduledTaskId),
    );
  }

  const rows = await db
    .select()
    .from(agentDataSources)
    .where(or(...conditions))
    .orderBy(asc(agentDataSources.priority));

  const results: LoadedDataSource[] = [];
  for (const source of rows) {
    const resolvedScope: LoadedDataSource['scope'] =
      source.scheduledTaskId ? 'scheduled_task'
      : source.subaccountAgentId ? 'subaccount'
      : 'agent';

    const { content, fetchOk, tokenCount } = await loadSourceContent(source);
    results.push({
      id: source.id,
      scope: resolvedScope,
      name: source.name,
      description: source.description,
      content,
      contentType: source.contentType,
      tokenCount,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      priority: source.priority,
      fetchOk,
      maxTokenBudget: source.maxTokenBudget,
    });
  }

  return results;
}

/**
 * Backwards-compatible wrapper for the legacy fetchAgentDataSources signature.
 * Kept for conversationService.ts:179 (agent-chat surface) which needs agent-
 * level sources only, no scheduled-task or subaccount scoping.
 *
 * The return shape is a subset of LoadedDataSource that matches what the
 * existing buildSystemPrompt consumer at llmService.ts:283 expects.
 */
export async function fetchAgentDataSources(
  agentId: string
): Promise<Array<{
  id: string;
  name: string;
  description: string | null;
  content: string;
  contentType: string;
  tokenCount: number;
  maxTokenBudget: number;
  priority: number;
  fetchOk: boolean;
}>> {
  const loaded = await fetchDataSourcesByScope({ agentId });
  return loaded
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      content: s.content,
      contentType: s.contentType,
      tokenCount: s.tokenCount,
      maxTokenBudget: s.maxTokenBudget,
      priority: s.priority,
      fetchOk: s.fetchOk,
    }));
}
