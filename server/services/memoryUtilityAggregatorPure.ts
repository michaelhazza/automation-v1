// Pure aggregation helper for memory utility metrics (spec §5.1, §12.1).
// Replicates the per_run + per_agent_sums CTE logic from migration 0345
// for testability of the aggregation contract in isolation.
// Zero DB imports — all DB logic lives in memoryUtilityQueryService.ts.

/**
 * One agent_runs row as consumed by the aggregator.
 * `injectedEntryIds` is the JS representation of the nullable JSONB column:
 *   null       = pre-migration / malformed (unmeasured)
 *   string[]   = measured (may be empty)
 */
export interface AgentRunForAggregation {
  injectedEntryIds: string[] | null;
  citedEntryIds: string[];
  appliedMemoryBlockIds: string[];
  appliedMemoryBlockCitations: unknown[];
}

export interface AgentUtilityAggregate {
  runsMeasuredEntries: number;
  runsUnmeasuredEntries: number;
  totalInjectedEntries: number;
  totalCitedEntries: number;
  totalInjectedBlocks: number;
  totalCitedBlocks: number;
  /** null when totalInjectedEntries === 0 (no measured runs with injections) */
  entryUtility30d: number | null;
  /** null when totalInjectedBlocks === 0 */
  blockUtility30d: number | null;
}

/**
 * Returns true for measured runs — injectedEntryIds is a real array value
 * (including empty). Mirrors the SQL: `jsonb_typeof(r.injected_entry_ids) = 'array'`.
 */
export function isMeasured(injectedEntryIds: string[] | null): boolean {
  return Array.isArray(injectedEntryIds);
}

/**
 * Aggregate a set of agent run rows into per-agent utility metrics.
 * Mirrors the per_run + per_agent_sums CTEs in migration 0345.
 */
export function aggregateAgentRuns(runs: AgentRunForAggregation[]): AgentUtilityAggregate {
  let runsMeasuredEntries = 0;
  let runsUnmeasuredEntries = 0;
  let totalInjectedEntries = 0;
  let totalCitedEntries = 0;
  let totalInjectedBlocks = 0;
  let totalCitedBlocks = 0;

  for (const run of runs) {
    const measured = isMeasured(run.injectedEntryIds);
    if (measured) {
      runsMeasuredEntries += 1;
      totalInjectedEntries += (run.injectedEntryIds as string[]).length;
      totalCitedEntries += run.citedEntryIds.length;
    } else {
      runsUnmeasuredEntries += 1;
    }
    totalInjectedBlocks += run.appliedMemoryBlockIds.length;
    totalCitedBlocks += run.appliedMemoryBlockCitations.length;
  }

  const entryUtility30d =
    totalInjectedEntries > 0 ? totalCitedEntries / totalInjectedEntries : null;
  const blockUtility30d =
    totalInjectedBlocks > 0 ? totalCitedBlocks / totalInjectedBlocks : null;

  return {
    runsMeasuredEntries,
    runsUnmeasuredEntries,
    totalInjectedEntries,
    totalCitedEntries,
    totalInjectedBlocks,
    totalCitedBlocks,
    entryUtility30d,
    blockUtility30d,
  };
}
