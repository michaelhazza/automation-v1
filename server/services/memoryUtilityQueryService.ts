import { eq, inArray, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { mvMemoryUtility30d, agents } from '../db/schema/index.js';
import {
  bucketDailySeries,
  type RunForBucketing,
  type DailyBucket,
} from './memoryUtilityDailySeriesPure.js';

export interface AgentUtilityRow {
  agentId: string;
  agentName: string;
  subaccountId: string | null;
  runsMeasuredEntries: number;
  runsUnmeasuredEntries: number;
  totalInjectedEntries: number;
  totalCitedEntries: number;
  totalInjectedBlocks: number;
  totalCitedBlocks: number;
  entryUtility30d: string | null; // numeric from Drizzle returns string
  blockUtility30d: string | null;
}

export interface MemoryUtilityPayload {
  organisationId: string;
  generatedAt: string; // ISO timestamp of the read (transaction_timestamp())
  windowDays: 30;
  agents: AgentUtilityRow[];
  dailySeries: DailyBucket[];
}

export async function getMemoryUtilityForOrg(
  organisationId: string,
): Promise<MemoryUtilityPayload> {
  const db = getOrgScopedDb('memoryUtilityQueryService');

  // MV aggregate rows for this org (filtered — no unfiltered cross-org read).
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const mvRows = await db
    .select()
    .from(mvMemoryUtility30d)
    .where(eq(mvMemoryUtility30d.organisationId, organisationId));

  // Resolve agent names from the agents table.
  const agentIds = [...new Set(mvRows.map((r) => r.agentId))];
  const agentNameMap = new Map<string, string>();
  if (agentIds.length > 0) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const agentRows = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(inArray(agents.id, agentIds));
    for (const a of agentRows) agentNameMap.set(a.id, a.name);
  }

  // DB-anchored "now" — queried independently so the empty-runs path still
  // uses DB time rather than the app clock (spec R2 F7; ChatGPT R1 F3).
  const dbNowRows = await db.execute<{ db_now: Date }>(sql`
    SELECT transaction_timestamp() AS db_now
  `);
  const dbNow: Date = new Date(dbNowRows[0].db_now);

  // Raw agent_runs for daily bucketing — same DB-anchored window so SQL filter
  // and JS bucket boundaries share one clock (spec R2 F7).
  const runRows = await db.execute<{
    id: string;
    created_at: Date;
    injected_entry_ids: string[] | null;
    cited_entry_ids: string[];
    applied_memory_block_ids: string[];
    applied_memory_block_citations: unknown[];
  }>(sql`
    SELECT
      id,
      created_at,
      injected_entry_ids,
      cited_entry_ids,
      applied_memory_block_ids,
      applied_memory_block_citations
    FROM agent_runs
    WHERE organisation_id = ${organisationId}
      AND created_at > transaction_timestamp() - interval '30 days'
  `);

  // Normalise raw JSONB so legacy rows with non-array shapes (scalar JSON,
  // empty object, etc.) cannot leak through to the pure bucketer (ChatGPT R2 F1).
  // The MV side already guards via `jsonb_typeof(...) = 'array'`; this brings
  // the live daily-series path to the same posture.
  const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const forBucketing: RunForBucketing[] = runRows.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at),
    injectedEntryIds: Array.isArray(r.injected_entry_ids)
      ? (r.injected_entry_ids as string[])
      : null,
    citedEntryIds: asArray<string>(r.cited_entry_ids),
    appliedMemoryBlockIds: asArray<string>(r.applied_memory_block_ids),
    appliedMemoryBlockCitations: asArray<unknown>(r.applied_memory_block_citations),
  }));

  const agentRows: AgentUtilityRow[] = mvRows.map((r) => ({
    agentId: r.agentId,
    agentName: agentNameMap.get(r.agentId) ?? r.agentId,
    subaccountId: r.subaccountId ?? null,
    runsMeasuredEntries: r.runsMeasuredEntries,
    runsUnmeasuredEntries: r.runsUnmeasuredEntries,
    totalInjectedEntries: r.totalInjectedEntries,
    totalCitedEntries: r.totalCitedEntries,
    totalInjectedBlocks: r.totalInjectedBlocks,
    totalCitedBlocks: r.totalCitedBlocks,
    entryUtility30d: r.entryUtility30d ?? null,
    blockUtility30d: r.blockUtility30d ?? null,
  }));

  return {
    organisationId,
    generatedAt: dbNow.toISOString(),
    windowDays: 30,
    agents: agentRows,
    dailySeries: bucketDailySeries(forBucketing, dbNow),
  };
}
