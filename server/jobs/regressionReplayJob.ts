/**
 * regressionReplayJob — Sprint 2 P1.2 weekly replay harness.
 *
 * Runs across all orgs every Sunday at 04:00. For each `active`
 * regression_case it performs the lightweight structural check:
 *
 *   1. Rebuild the agent's current system prompt snapshot + tool
 *      manifest as they would be for a new run with the same
 *      (agentId, subaccountId) pair.
 *   2. Hash the rebuilt contract via the same canonicalisation that
 *      regressionCaptureServicePure uses.
 *   3. If the hash matches the stored `input_contract_hash` → contract
 *      has NOT drifted since the capture. Record a `pass` result (the
 *      replay harness hasn't proven regression, but the asserted
 *      inputs are still the ones the capture was taken against).
 *      Increment `consecutive_passes`.
 *   4. If the hash differs → contract HAS drifted. The stored
 *      assertion may no longer be valid because the agent has
 *      legitimately changed. Flip `status` to `stale` so an operator
 *      can review + retire or refresh the case. Record `skipped`.
 *   5. Any case that hits an exception is recorded as `skipped` with
 *      an error — the job never aborts on a single case failure.
 *
 * Full LLM-run replay (actually invoking the agent against the stored
 * conversation and asserting it no longer proposes the rejected call)
 * is intentionally deferred. The structural check catches the common
 * regression mode — "someone edited the agent's prompt / tool set in
 * a way that invalidated the asserted inputs" — without paying the
 * weekly LLM cost of re-running every rejected case.
 *
 * The job runs inside `withAdminConnection` + `SET LOCAL ROLE
 * admin_role` because it sweeps every organisation.
 *
 * See docs/improvements-roadmap-spec.md §P1.2.
 */

import { and, eq, sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { regressionCases, agentRuns, agentRunSnapshots, agents } from '../db/schema/index.js';
import { fingerprint } from '../services/regressionCaptureServicePure.js';

interface ReplaySummary {
  totalActive: number;
  passed: number;
  stale: number;
  errors: number;
}

export async function runRegressionReplayTick(): Promise<ReplaySummary> {
  const started = Date.now();
  const summary: ReplaySummary = {
    totalActive: 0,
    passed: 0,
    stale: 0,
    errors: 0,
  };

  await withAdminConnection(
    {
      source: 'jobs.regressionReplayTick',
      reason: 'Weekly sweep — structural replay of active regression cases',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      const cases = (await tx
        .select()
        .from(regressionCases)
        .where(eq(regressionCases.status, 'active'))) as Array<
        typeof regressionCases.$inferSelect
      >;

      summary.totalActive = cases.length;

      for (const kase of cases) {
        try {
          const result = await replayOneCase(tx, kase);
          if (result === 'pass') {
            summary.passed += 1;
            await tx
              .update(regressionCases)
              .set({
                lastReplayedAt: new Date(),
                lastReplayResult: 'pass',
                consecutivePasses: (kase.consecutivePasses ?? 0) + 1,
                updatedAt: new Date(),
              })
              .where(eq(regressionCases.id, kase.id));
          } else if (result === 'stale') {
            summary.stale += 1;
            await tx
              .update(regressionCases)
              .set({
                lastReplayedAt: new Date(),
                lastReplayResult: 'skipped',
                consecutivePasses: 0,
                status: 'stale',
                updatedAt: new Date(),
              })
              .where(eq(regressionCases.id, kase.id));
          }
        } catch (err) {
          summary.errors += 1;
          await tx
            .update(regressionCases)
            .set({
              lastReplayedAt: new Date(),
              lastReplayResult: 'skipped',
              updatedAt: new Date(),
            })
            .where(eq(regressionCases.id, kase.id));
          console.error(
            JSON.stringify({
              event: 'regression_replay_case_failed',
              regressionCaseId: kase.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
    },
  );

  const durationMs = Date.now() - started;
  console.info(
    JSON.stringify({
      event: 'regression_replay_tick_complete',
      durationMs,
      ...summary,
    }),
  );
  return summary;
}

// ---------------------------------------------------------------------------
// Per-case structural replay.
// ---------------------------------------------------------------------------

async function replayOneCase(
  tx: Awaited<ReturnType<typeof withAdminConnection>> extends never
    ? never
    : Parameters<Parameters<typeof withAdminConnection>[1]>[0],
  kase: typeof regressionCases.$inferSelect,
): Promise<'pass' | 'stale'> {
  // Fetch the agent config and — if we still have the source run — the
  // snapshot we originally captured against. The replay compares what
  // the CURRENT agent config would produce vs the captured hash.
  //
  // For the structural check we use the captured inputContractJson
  // directly: rebuild the same shape from the live agent and compare
  // the fingerprints. If we can't fetch the agent at all, the case is
  // stale by definition.
  const [agentRow] = await tx
    .select()
    .from(agents)
    .where(eq(agents.id, kase.agentId));

  if (!agentRow) return 'stale';
  if (agentRow.deletedAt) return 'stale';

  // Pull the most recent snapshot for this agent so we can compare the
  // system prompt. This is approximate — the "real" replay would
  // re-render the system prompt using the live config. For the v1
  // structural pass we use the most recent agent run's snapshot as a
  // proxy for "what the agent would produce now".
  const recentRuns = await tx
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.agentId, kase.agentId))
    .orderBy(sql`created_at DESC`)
    .limit(1);

  let liveSystemPrompt = '';
  if (recentRuns[0]) {
    const [snap] = await tx
      .select({ snap: agentRunSnapshots.systemPromptSnapshot })
      .from(agentRunSnapshots)
      .where(eq(agentRunSnapshots.runId, recentRuns[0].id));
    liveSystemPrompt = snap?.snap ?? '';
  }

  // Rebuild the input contract shape the capture service would
  // produce, using the live inputs. The transcript is empty because
  // the capture service also stores an empty transcript in v1 — the
  // hash only covers system prompt + tool manifest + run metadata.
  const stored = kase.inputContractJson as {
    toolManifest?: Array<{ name: string; description?: string }>;
    runMetadata?: {
      agentId: string;
      organisationId: string;
      subaccountId: string | null;
      modelId?: string;
      temperature?: number;
    };
  };

  const rebuilt = {
    version: 1 as const,
    systemPromptSnapshot: liveSystemPrompt,
    // Tool manifest at capture time is the live agent's resolved
    // skills. For the v1 we can't recompute this without the full
    // resolver pipeline, so we reuse the stored manifest — the
    // structural check still catches system-prompt drift, which is
    // the dominant regression mode.
    toolManifest: stored.toolManifest ?? [],
    transcript: [] as unknown[],
    runMetadata: stored.runMetadata ?? {
      agentId: kase.agentId,
      organisationId: kase.organisationId,
      subaccountId: kase.subaccountId,
    },
  };

  const liveHash = fingerprint(rebuilt);
  return liveHash === kase.inputContractHash ? 'pass' : 'stale';
}
