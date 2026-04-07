/**
 * Reporting Agent end-of-run hook — wires T25 invariant + T16 fingerprint
 * persistence into agentExecutionService.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §6.7.2 (T16),
 * §8.4.2 (T25).
 *
 * Activation: gated on `runMetadata.reportingAgent` being present. Skills
 * involved in the Reporting Agent workflow (transcribe_audio, send_to_slack,
 * and the browser fetch step) populate this bucket as they complete; if it
 * is missing entirely we treat the run as a non-Reporting-Agent run and the
 * hook is a no-op.
 *
 * The persist step is the LAST thing that happens before the run flips to
 * `completed`. If the invariant fails, fingerprint is NOT advanced and the
 * run is rejected via failure('internal_error', ...). Per spec: a partial
 * failure must not poison future runs.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents, agentRuns } from '../db/schema/index.js';
import { failure, FailureError } from '../../shared/iee/failure.js';
import {
  assertReportingAgentRunComplete,
  type ReportingAgentRunState,
  type ReportingAgentTerminationResult,
} from './reportingAgentInvariant.js';

export interface ReportingAgentRunMetadata {
  /** What kind of run this resolved to. */
  terminationResult?: ReportingAgentTerminationResult;
  /** Set by the browser fetch step when content was downloaded + validated. */
  fingerprint?: {
    intent: string;
    sourceUrl: string;
    pageTitle?: string;
    publishedAt?: string;
    contentHash: string;
  };
  /** Set when fingerprint cache was consulted at the start of the run. */
  fingerprintRead?: boolean;
  /** Set by transcribeAudioService on success. */
  transcriptArtifactId?: string;
  /** Set by the report skill on success. */
  reportMarkdownDeliverableId?: string;
  /** Set by sendToSlackService on success. */
  slackPost?: { messageTs: string; permalink: string };
}

export interface ReportingAgentHookInput {
  runId: string;
  subaccountAgentId: string | null | undefined;
  organisationId: string;
  runMetadata: Record<string, unknown> | null | undefined;
}

/**
 * Atomic JSONB merge into agent_runs.run_metadata.reportingAgent.
 *
 * Per pr-reviewer B3: a SELECT-then-UPDATE pattern can lose writes if two
 * skill calls land concurrently (or if the end-of-run hook reads while a
 * skill is still in flight). Postgres `jsonb_set` + `||` operate atomically
 * inside a single UPDATE statement and eliminate the read step.
 *
 * The patch is shallow-merged into runMetadata.reportingAgent.
 */
export async function mergeReportingAgentRunMeta(
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const patchJson = JSON.stringify(patch);
  await db.execute(sql`
    UPDATE agent_runs
       SET run_metadata = jsonb_set(
             COALESCE(run_metadata, '{}'::jsonb),
             '{reportingAgent}',
             COALESCE(run_metadata->'reportingAgent', '{}'::jsonb) || ${patchJson}::jsonb,
             true
           )
     WHERE id = ${runId}
  `);
}

/**
 * Run the end-of-run invariant + fingerprint persist for a successful
 * Reporting Agent run. No-op if the run is not a Reporting Agent run.
 *
 * Throws FailureError (via assertReportingAgentRunComplete) if the run is
 * incomplete. Caller is expected to catch and route to the failed status
 * path rather than `completed`.
 */
export async function finalizeReportingAgentRun(
  input: ReportingAgentHookInput,
): Promise<void> {
  const meta = (input.runMetadata ?? {}) as { reportingAgent?: ReportingAgentRunMetadata };
  const ra = meta.reportingAgent;
  if (!ra) return; // not a Reporting Agent run — no-op

  const terminationResult: ReportingAgentTerminationResult =
    ra.terminationResult ?? 'success';

  // Build the state object for the invariant.
  const state: ReportingAgentRunState = {
    transcriptArtifactId: ra.transcriptArtifactId ?? null,
    reportMarkdownDeliverableId: ra.reportMarkdownDeliverableId ?? null,
    slackPost: ra.slackPost ?? null,
    fingerprintWritten:
      terminationResult === 'no_new_content' ? true : !!ra.fingerprint,
    fingerprintRead: ra.fingerprintRead === true,
    terminationResult,
  };

  assertReportingAgentRunComplete(state);

  // Per pr-reviewer B4: if a fingerprint is present but the run is org-level
  // (no subaccount agent to anchor it on), refuse to silently skip the
  // persist. Surface as an internal_error so the operator notices.
  if (
    terminationResult === 'success' &&
    ra.fingerprint &&
    !input.subaccountAgentId
  ) {
    throw new FailureError(
      failure('internal_error', 'fingerprint_persist_skipped_no_subaccount_agent', {
        runId: input.runId,
        organisationId: input.organisationId,
      }),
    );
  }

  // Persist fingerprint after invariant passes (happy path only).
  if (
    terminationResult === 'success' &&
    ra.fingerprint &&
    input.subaccountAgentId
  ) {
    const fp = ra.fingerprint;
    const [row] = await db
      .select({
        existing: subaccountAgents.lastProcessedFingerprintsByIntent,
      })
      .from(subaccountAgents)
      .where(eq(subaccountAgents.id, input.subaccountAgentId))
      .limit(1);
    const existing = (row?.existing ?? {}) as Record<string, unknown>;
    const nextMap = {
      ...existing,
      [fp.intent]: {
        sourceUrl: fp.sourceUrl,
        pageTitle: fp.pageTitle,
        publishedAt: fp.publishedAt,
        contentHash: fp.contentHash,
        processedAt: new Date().toISOString(),
        agentRunId: input.runId,
      },
    };
    await db
      .update(subaccountAgents)
      .set({
        lastProcessedFingerprintsByIntent: nextMap as never,
        updatedAt: new Date(),
      })
      .where(eq(subaccountAgents.id, input.subaccountAgentId));

    // Mirror onto agent_runs.runMetadata so the run row carries proof of
    // the persist for forensic queries.
    await db
      .update(agentRuns)
      .set({
        runMetadata: { ...(input.runMetadata ?? {}), fingerprintWrittenAt: new Date().toISOString() } as never,
      })
      .where(eq(agentRuns.id, input.runId));
  }
}
