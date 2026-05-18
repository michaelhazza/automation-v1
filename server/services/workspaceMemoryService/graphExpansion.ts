import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import type { HybridResult } from './types.js';

// ---------------------------------------------------------------------------
// Phase 1C: Graph-aware context expansion
// ---------------------------------------------------------------------------

export async function expandWithGraph(
  results: HybridResult[],
  scopeFilter: ReturnType<typeof sql>,
  maxExpansion: number,
): Promise<HybridResult[]> {
  if (results.length === 0) return [];

  const existingIds = results.map(r => r.id);

  // Query for entries sharing the same task_slug as any result entry
  const expanded = await getOrgScopedDb('graphExpansion.expandWithGraph').execute<{
    id: string; content: string; agent_id: string | null;
    agent_name: string; subaccount_id: string; created_at: string;
  }>(sql`
    SELECT
      e.id, e.content, e.agent_id,
      COALESCE(a.name, 'Unknown') AS agent_name,
      e.subaccount_id, e.created_at::text AS created_at
    FROM workspace_memory_entries e
    LEFT JOIN agents a ON a.id = e.agent_id
    WHERE ${scopeFilter}
      AND e.id != ALL(${existingIds})
      AND e.task_slug IN (
        SELECT DISTINCT task_slug FROM workspace_memory_entries
        WHERE id = ANY(${existingIds}) AND task_slug IS NOT NULL
      )
    ORDER BY e.created_at DESC
    LIMIT ${maxExpansion}
  `);

  return (expanded as unknown as Array<{
    id: string; content: string; agent_id: string | null;
    agent_name: string; subaccount_id: string; created_at: string;
  }>).map(r => ({
    id: r.id,
    content: r.content,
    rrf_score: 0,
    combined_score: 0,
    source_count: 0,
    agent_id: r.agent_id,
    agent_name: r.agent_name,
    subaccount_id: r.subaccount_id,
    created_at: r.created_at,
    last_accessed_at: null,
    consolidationTier: 'episodic' as const,
    tier: null,
    decayWeight: null,
    tierMultiplier: null,
    memoryConsolidationConfigVersion: null,
    lastAccessedAtAtRetrieval: null,
  }));
}
