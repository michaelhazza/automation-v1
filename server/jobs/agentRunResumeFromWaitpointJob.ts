// agentRunResumeFromWaitpointJob — pg-boss handler for agent-run-resume-from-waitpoint.
//
// Enqueued atomically by waitpointService.completeWaitpoint (oauth kind) via
// sendWithTx. Verifies the run is still in a resumable state before calling
// resumeAgentRun so that a duplicate delivery or a late-arriving job (after
// the run was already terminal) is a clean no-op.
//
// **Resume hand-off is INCOMPLETE (deferred to Sprint 3B).** Spec §6.1 says
// this handler "calls resumeAgentRun → hands off to runAgenticLoop". The
// current code only performs the first half — `resumeAgentRun(runId)` returns
// the rehydrated checkpoint + middlewareContext + messages, but the call site
// here discards the return value. `resumeAgentRun` itself does NOT clear
// `agent_runs.blocked_reason` and does NOT call `runAgenticLoop` (see its
// header — it is a Sprint 3A library entry point only). Wiring the result
// to `runAgenticLoop` requires the full executeRun bootstrap (orgProcesses,
// pipeline, mcpClients, mcpLazyRegistry, runContextData, hierarchyContext —
// none of which `resumeAgentRun` returns) and is intentionally scoped to a
// separate "Sprint 3B" build, NOT this one.
//
// Operational consequence: when `WAITPOINT_PRIMITIVE_ENABLED=true` and an
// OAuth waitpoint completes, the worker logs `oauth.resume.deferred_no_handoff`
// and returns. The run stays in `running` status with `blocked_reason` set
// until the 5-minute waitpoint-expiry sweep cancels it. **Do NOT flip the
// flag to true in production until Sprint 3B is wired** — operator gate.
//
// Deferred-items tracking: tasks/todo.md `OPLB-DR-2026-05-19-D1`.
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

  // INCOMPLETE HAND-OFF (deferred to Sprint 3B). See header comment.
  // `resumeAgentRun` rehydrates state but does NOT clear `blocked_reason` and
  // does NOT call `runAgenticLoop`. The return value is intentionally
  // discarded here — wiring it to `runAgenticLoop` requires Sprint 3B work
  // (the full executeRun bootstrap) that is out of scope for this build.
  // The warning log surfaces the gap to operators; the flag must remain
  // default-false in production until Sprint 3B lands.
  const { resumeAgentRun } = await import('../services/agentExecutionService/resume.js');
  await resumeAgentRun(runId);

  logger.warn('oauth.resume.deferred_no_handoff', {
    event: 'oauth.resume.deferred_no_handoff',
    runId,
    organisationId,
    blockedReason: run.blockedReason,
    reason: 'sprint_3b_pending',
    note: 'resumeAgentRun completed but runAgenticLoop hand-off is deferred; run stays blocked until expiry sweep cancels it',
  });
}
