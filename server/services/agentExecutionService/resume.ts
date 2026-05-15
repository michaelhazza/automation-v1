// resumeAgentRun — Sprint 3 P2.1 Sprint 3A library entry point
//
// Reads an `agent_runs` row + its checkpoint payload + the persisted
// message log, validates the `configVersion` against the current
// `configSnapshot` (unless `useLatestConfig` is true), and returns the
// structured state that the Sprint 3B async resume path will hand to
// `runAgenticLoop` via its `startingIteration` + pre-seeded context
// parameters.
//
// Sprint 3A exposes this as a callable library function but does NOT
// wire it to an HTTP endpoint or pg-boss job — that is Sprint 3B. The
// function exists in this sprint so:
//
//   * The schema + projection + resume state are provably consistent
//     end-to-end under unit test (Sprint 3B inherits a tested primitive).
//   * Sprint 3B has a small, concrete surface to integrate with.
//   * The `startingIteration` param on `runAgenticLoop` is exercised by
//     at least one caller, catching signature drift at compile time.
//
// MUST be called inside an active `withOrgTx` block — it uses the
// message service read path which depends on the org-scoped tx.

import { eq, and } from 'drizzle-orm';
import { agentService } from '../agentService.js';
import { agentRuns, agentRunSnapshots, subaccountAgents } from '../../db/schema/index.js';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { streamMessages as streamAgentRunMessages } from '../agentRunMessageService.js';
import { fingerprint } from '../regressionCaptureServicePure.js';
import { buildResumeContext } from '../agentExecutionServicePure.js';
import type { AgentRunCheckpoint, MiddlewareContext } from '../middleware/types.js';
import type { SubaccountAgent } from '../../db/schema/index.js';
import type { AgentRunRequest } from './types.js';

export interface ResumeAgentRunOptions {
  /**
   * When `true`, skip the `configVersion` equality check and rehydrate
   * against whatever `configSnapshot` the `agent_runs` row currently
   * has. Used by admin "force-resume" tooling for debugging. Default
   * `false` — a config drift is a hard refusal.
   */
  useLatestConfig?: boolean;
}

export interface ResumeAgentRunResult {
  /** The checkpoint payload that was read from `agent_run_snapshots`. */
  checkpoint: AgentRunCheckpoint;
  /** The rehydrated middleware context, ready to hand to `runAgenticLoop`. */
  middlewareContext: MiddlewareContext;
  /** Raw messages streamed from `agent_run_messages`. */
  messages: Array<{
    sequenceNumber: number;
    role: 'assistant' | 'user' | 'system';
    content: unknown;
  }>;
  /**
   * Whether the stored `configVersion` matches the live configSnapshot
   * fingerprint. Always `true` when the function returns — if they
   * disagree and `useLatestConfig` is false the call throws instead.
   */
  configVersionMatches: boolean;
}

export async function resumeAgentRun(
  runId: string,
  options: ResumeAgentRunOptions = {},
): Promise<ResumeAgentRunResult> {
  const { useLatestConfig = false } = options;

  // MUST run inside an active withOrgTx block — we use getOrgScopedDb
  // for every read below so a caller that forgets the surrounding
  // transaction fails closed with `missing_org_context` instead of
  // silently returning zero rows under RLS.
  const tx = getOrgScopedDb('agentExecutionService.resumeAgentRun');

  // ── 1. Load the run row — establishes org context + config ──────
  // Defence-in-depth: the ALS context is the authoritative org scope
  // for RLS, but every other read site in this service layers an
  // explicit `organisationId` predicate on top. We cannot layer one
  // here without the caller knowing the org, so we rely on the
  // surrounding tx's RLS policy to keep cross-org reads from leaking.
  const [runRow] = await tx.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!runRow) {
    throw new Error(`resumeAgentRun: run ${runId} not found`);
  }

  // ── 2. Load the checkpoint ───────────────────────────────────────
  // `agent_run_snapshots` has no direct `organisation_id` column —
  // cross-org isolation is enforced by the FK cascade from
  // `agent_runs` (the parent row we already validated above) plus the
  // RLS policy that joins through that FK. No explicit org filter is
  // possible or needed here.
  const [snapshotRow] = await tx
    .select()
    .from(agentRunSnapshots)
    .where(eq(agentRunSnapshots.runId, runId));
  if (!snapshotRow || !snapshotRow.checkpoint) {
    throw new Error(`resumeAgentRun: no checkpoint recorded for run ${runId}`);
  }
  const checkpoint = snapshotRow.checkpoint as AgentRunCheckpoint;

  if (checkpoint.version !== 1) {
    throw new Error(
      `resumeAgentRun: checkpoint version=${checkpoint.version} is not supported by this runtime (expected 1).`,
    );
  }

  // ── 3. configVersion drift check ─────────────────────────────────
  const liveConfigVersion = runRow.configSnapshot
    ? fingerprint(runRow.configSnapshot)
    : '';
  if (!useLatestConfig && liveConfigVersion !== checkpoint.configVersion) {
    throw new Error(
      `resumeAgentRun: configVersion drift — checkpoint=${checkpoint.configVersion}, live=${liveConfigVersion}. Re-run with useLatestConfig=true to override (admin only).`,
    );
  }

  // ── 4. Stream persisted messages up to the checkpoint cursor ─────
  // `messageCursor < 0` is the "no messages written yet" sentinel
  // (see persistCheckpoint). Skip the stream call in that case — a
  // range read with `toSequence = -1` would match nothing anyway, but
  // we want the intent to be explicit so a future maintainer reading
  // a resume trace doesn't second-guess the empty array.
  const messageRows =
    checkpoint.messageCursor < 0
      ? []
      : await streamAgentRunMessages(runId, runRow.organisationId, {
          fromSequence: 0,
          toSequence: checkpoint.messageCursor,
        });

  // ── 5. Load the agent + saLink so we can build a live MiddlewareContext ──
  const agent = await agentService.getAgent(runRow.agentId, runRow.organisationId);

  // Subaccount runs carry a subaccountAgent link; org runs do not. The
  // Sprint 3B async resume path needs the same saLink shape the original
  // executeRun passed to runAgenticLoop; Sprint 3A leaves a minimal stub
  // for org runs since the library entry point is not called from any
  // production code path yet.
  let saLink: SubaccountAgent;
  if (runRow.subaccountAgentId) {
    const [link] = await tx
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.id, runRow.subaccountAgentId),
          eq(subaccountAgents.organisationId, runRow.organisationId),
        ),
      );
    if (!link) {
      throw new Error(
        `resumeAgentRun: subaccount_agent ${runRow.subaccountAgentId} not found for run ${runId}`,
      );
    }
    saLink = link;
  } else {
    // Org-scope runs do not have a subaccountAgents row. Sprint 3B will
    // widen the resume path to accept a union shape; for 3A we cast an
    // empty object because the library entry point is not yet invoked
    // against org-scope runs in production.
    saLink = {} as SubaccountAgent;
  }

  const middlewareContext = buildResumeContext({
    checkpoint,
    runId,
    // Sprint 3B will rebuild a real AgentRunRequest from the triggerContext
    // + run row. For 3A the library caller is the unit test harness, so an
    // empty-ish request is sufficient.
    request: {
      agentId: runRow.agentId,
      organisationId: runRow.organisationId,
      subaccountId: runRow.subaccountId ?? undefined,
      runType: runRow.runType,
      executionScope: 'subaccount' as const,
    } as AgentRunRequest,
    agent: {
      modelId: agent.modelId,
      temperature: agent.temperature ?? 0,
      maxTokens: agent.maxTokens ?? 4096,
    },
    saLink,
    // Wall-clock state is re-initialised on every resume — the original
    // run's startTime is meaningless on a different worker. The budget
    // middleware uses the checkpoint's persisted tokensUsed /
    // toolCallsCount (restored by buildResumeContext) to pick up where
    // the original run left off against the SAME per-iteration limits.
    //
    // Sprint 3A stubs `tokenBudget`, `maxToolCalls`, and `timeoutMs` at
    // neutral values because the library entry point is not yet exposed
    // over HTTP or pg-boss. Sprint 3B re-derives them from
    // `runRow.resolvedLimits` (or re-runs limit resolution with the
    // live agent config) so the resumed iteration sees the same ceilings
    // the original iteration did.
    startTime: Date.now(),
    tokenBudget: runRow.tokenBudget ?? 0,
    maxToolCalls: 0,
    timeoutMs: 0,
  });

  return {
    checkpoint,
    middlewareContext,
    messages: messageRows.map((row) => ({
      sequenceNumber: row.sequenceNumber,
      role: row.role,
      content: row.content,
    })),
    configVersionMatches: liveConfigVersion === checkpoint.configVersion,
  };
}
