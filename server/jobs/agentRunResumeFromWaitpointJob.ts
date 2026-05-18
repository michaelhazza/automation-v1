// agentRunResumeFromWaitpointJob — pg-boss handler for agent-run-resume-from-waitpoint.
//
// Enqueued atomically by waitpointService.completeWaitpoint (oauth kind) via
// sendWithTx. Verifies the run is still in a resumable state before handing
// off to resumeAgentRun so that a duplicate delivery or a late-arriving job
// (after the run was already terminal) is a clean no-op.
//
// Org context: the calling createWorker wrapper opens a withOrgTx block using
// organisationId from the payload, so getOrgScopedDb is safe to call here.
//
// Spec: docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md §6.1, §8.3

import { eq } from 'drizzle-orm';
import { agentRuns } from '../db/schema/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { isTerminalRunStatus } from '../../shared/runStatus.js';

export interface AgentRunResumeFromWaitpointPayload {
  runId: string;
  organisationId: string;
  subaccountId: string;
}

export async function runFn(payload: AgentRunResumeFromWaitpointPayload): Promise<void> {
  const { runId, organisationId } = payload;

  const db = getOrgScopedDb('agentRunResumeFromWaitpointJob.runFn');

  const [run] = await db
    .select({ id: agentRuns.id, status: agentRuns.status, blockedReason: agentRuns.blockedReason })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);

  if (!run) {
    logger.info('agent_run_resume_skipped_terminal', {
      runId,
      organisationId,
      reason: 'run_not_found',
    });
    return;
  }

  // A run is resumable when it has a blockedReason set AND has not reached a
  // terminal status. Terminal runs must not be re-entered — pg-boss retries
  // would otherwise spin forever against an immovable row.
  const isResumable = run.blockedReason !== null && !isTerminalRunStatus(run.status);

  if (!isResumable) {
    logger.info('agent_run_resume_skipped_terminal', {
      runId,
      organisationId,
      status: run.status,
      blockedReason: run.blockedReason,
    });
    return;
  }

  const { resumeAgentRun } = await import('../services/agentExecutionService/resume.js');
  await resumeAgentRun(runId);
}
