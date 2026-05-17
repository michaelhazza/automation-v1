// ---------------------------------------------------------------------------
// IEE run-id resolver (Hermes Tier 1 Phase C §7.6)
// ---------------------------------------------------------------------------
//
// The cost breaker requires an `agent_runs.id` (`runId`) to look up the
// per-run cost ceiling. IEE-sourced calls (`sourceType='iee'`) may or may
// not carry `runId` directly; when they don't, `ieeRunId` is the handle
// and the parent `agent_run_id` lives on `iee_runs`.
//
// Kept local to the router per §7.6: the breaker stays agnostic about how
// its `runId` was derived, and the router already owns `iee_runs` reads
// for other routing metadata. One indexed primary-key lookup per
// `routeCall`; no memoisation across calls (the cache key would be
// `routeCall` invocation itself, and each invocation runs once).
import { db } from '../../db/index.js';
import { ieeRuns } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export async function resolveRunIdFromIee(ieeRunId: string | undefined): Promise<string | null> {
  if (!ieeRunId) return null;
  const [row] = await db
    .select({ agentRunId: ieeRuns.agentRunId })
    .from(ieeRuns)
    .where(eq(ieeRuns.id, ieeRunId))
    .limit(1);
  return row?.agentRunId ?? null;
}
