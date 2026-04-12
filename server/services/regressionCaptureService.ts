/**
 * regressionCaptureService — Sprint 2 P1.2 capture orchestration.
 *
 * Runs inside the pg-boss `regression-capture` worker. Reads the state of
 * the rejected agent run, builds a MaterialisedCapture via the pure
 * materialiser, inserts a row into `regression_cases`, and enforces the
 * per-agent ring buffer cap by retiring the oldest `active` case when
 * over.
 *
 * The capture is best-effort: if the source run / snapshot / action has
 * been pruned by the time the job runs, the capture is skipped rather
 * than failing. This is intentional — regression capture is additive,
 * not on the critical review path.
 *
 * See docs/improvements-roadmap-spec.md §P1.2.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  regressionCases,
  reviewItems,
  actions,
  agentRuns,
  agentRunSnapshots,
  agents,
} from '../db/schema/index.js';
import { DEFAULT_REGRESSION_CASE_CAP } from '../config/limits.js';
import {
  materialiseCapture,
  type MaterialiseInputs,
} from './regressionCaptureServicePure.js';

export interface CaptureRegressionFromRejectionInput {
  /** ID of the review_item that was rejected. */
  reviewItemId: string;
  /** Expected organisation — sanity-checked against the row. */
  organisationId: string;
}

export interface CaptureRegressionResult {
  status: 'captured' | 'skipped';
  regressionCaseId?: string;
  reason?: string;
}

/**
 * Entry point the pg-boss job calls. Runs inside the org-scoped tx
 * opened by createWorker — no need to manage the tx here.
 */
export async function captureRegressionFromRejection(
  input: CaptureRegressionFromRejectionInput,
): Promise<CaptureRegressionResult> {
  const tx = getOrgScopedDb('regressionCaptureService');

  // ── 1. Load the review item + linked action ───────────────────────
  const [reviewRow] = await tx
    .select()
    .from(reviewItems)
    .where(
      and(
        eq(reviewItems.id, input.reviewItemId),
        eq(reviewItems.organisationId, input.organisationId),
      ),
    );

  if (!reviewRow) {
    return { status: 'skipped', reason: 'review_item_not_found' };
  }
  if (reviewRow.reviewStatus !== 'rejected') {
    return { status: 'skipped', reason: 'review_item_not_rejected' };
  }

  const [actionRow] = await tx
    .select()
    .from(actions)
    .where(eq(actions.id, reviewRow.actionId));

  if (!actionRow) {
    return { status: 'skipped', reason: 'action_not_found' };
  }

  // ── 2. Load the source run + snapshot ────────────────────────────
  if (!reviewRow.agentRunId) {
    return { status: 'skipped', reason: 'no_source_run' };
  }

  const [runRow] = await tx
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, reviewRow.agentRunId));

  if (!runRow) {
    return { status: 'skipped', reason: 'source_run_pruned' };
  }

  const [snapshotRow] = await tx
    .select()
    .from(agentRunSnapshots)
    .where(eq(agentRunSnapshots.runId, runRow.id));

  // Snapshot is optional — if it's missing (older run that predates
  // the snapshot table) we can still capture, using an empty system
  // prompt. The hash will still be deterministic, just narrower.
  const systemPromptSnapshot = snapshotRow?.systemPromptSnapshot ?? '';

  // ── 3. Transcript ────────────────────────────────────────────────
  // v1: transcript is left empty. agent_runs is not directly linked to
  // agent_conversations (conversations are a chat container, runs are
  // execution lifecycles), so a clean transcript resolver needs
  // additional plumbing that's out of scope for the initial capture
  // service. The core regression assertion — "agent no longer proposes
  // this tool call given the same system prompt + tool manifest" —
  // holds without the transcript, which is stored for future
  // enrichment. See docs/improvements-roadmap-spec.md §P1.2.
  const transcript: MaterialiseInputs['transcript'] = [];

  // ── 4. Tool manifest from the run's resolved skills ─────────────
  const toolManifest = (runRow.resolvedSkillSlugs ?? []).map((slug) => ({
    name: slug,
  }));

  // ── 5. Materialise the capture ──────────────────────────────────
  const actionPayload = (actionRow.payloadJson ?? {}) as Record<string, unknown>;
  const materialised = materialiseCapture({
    systemPromptSnapshot,
    toolManifest,
    transcript,
    runMetadata: {
      agentId: runRow.agentId,
      organisationId: runRow.organisationId,
      subaccountId: runRow.subaccountId ?? null,
    },
    rejectedToolName: actionRow.actionType,
    rejectedArgs: actionPayload,
  });

  // ── 6. Insert the new case ──────────────────────────────────────
  const [inserted] = await tx
    .insert(regressionCases)
    .values({
      organisationId: input.organisationId,
      subaccountId: runRow.subaccountId ?? null,
      agentId: runRow.agentId,
      sourceAgentRunId: runRow.id,
      sourceReviewItemId: reviewRow.id,
      inputContractJson: materialised.inputContract,
      rejectedCallJson: materialised.rejectedCall,
      rejectionReason: actionRow.rejectionComment ?? null,
      inputContractHash: materialised.inputContractHash,
      rejectedCallHash: materialised.rejectedCallHash,
      status: 'active',
    })
    .returning({ id: regressionCases.id });

  if (!inserted) {
    return { status: 'skipped', reason: 'insert_failed' };
  }

  // ── 7. Enforce the per-agent cap ────────────────────────────────
  // Resolve the cap: per-agent override, else the global default.
  const [agentRow] = await tx
    .select({ cap: agents.regressionCaseCap })
    .from(agents)
    // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT for cap lookup; runRow obtained from org-scoped transaction context"
    .where(eq(agents.id, runRow.agentId));

  const cap = agentRow?.cap ?? DEFAULT_REGRESSION_CASE_CAP;

  // Count active cases for this agent. If over the cap, retire the
  // oldest-by-createdAt ones until we're at the cap again. Retirement
  // is a status flip, not a delete, so replay history is preserved.
  const activeCountRows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(regressionCases)
    .where(
      and(
        eq(regressionCases.agentId, runRow.agentId),
        eq(regressionCases.status, 'active'),
      ),
    );

  const activeCount = Number(activeCountRows[0]?.count ?? 0);
  if (activeCount > cap) {
    const overflow = activeCount - cap;
    const victims = await tx
      .select({ id: regressionCases.id })
      .from(regressionCases)
      .where(
        and(
          eq(regressionCases.agentId, runRow.agentId),
          eq(regressionCases.status, 'active'),
        ),
      )
      .orderBy(asc(regressionCases.createdAt))
      .limit(overflow);

    for (const victim of victims) {
      await tx
        .update(regressionCases)
        .set({ status: 'retired', updatedAt: new Date() })
        .where(eq(regressionCases.id, victim.id));
    }
  }

  return { status: 'captured', regressionCaseId: inserted.id };
}
