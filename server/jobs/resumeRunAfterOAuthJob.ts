/**
 * OAuth resume restart job — Pre-launch hardening C-P0-2.
 *
 * When an agent run is paused waiting for an OAuth integration to be connected,
 * and the user subsequently completes the OAuth flow, this job resumes the run.
 * Deferred via pg-boss so the resume is durable across process restarts and
 * singletonKey deduplicates within a 60s window to handle double-click / retry.
 */

import { getPgBoss } from '../lib/pgBossInstance.js';
import { logger } from '../lib/logger.js';

export const RESUME_RUN_AFTER_OAUTH_JOB = 'run:resumeAfterOAuth' as const;

export interface ResumeRunAfterOAuthPayload {
  runId:          string;
  organisationId: string;
}

export async function enqueueResumeAfterOAuth(
  payload: ResumeRunAfterOAuthPayload,
): Promise<void> {
  const boss = await getPgBoss();
  await boss.send(RESUME_RUN_AFTER_OAUTH_JOB, payload, {
    priority: 10,
    singletonKey: `resume:${payload.runId}`,
    singletonSeconds: 60,
  });
}

export async function resumeRunAfterOAuthWorker(
  payload: ResumeRunAfterOAuthPayload,
): Promise<void> {
  const { runId, organisationId } = payload;

  const { WorkflowRunPauseStopService } = await import(
    '../services/workflowRunPauseStopService.js'
  );

  logger.info('oauth.resume.start', {
    event: 'oauth.resume.start',
    runId,
    organisationId,
  });

  const result = await WorkflowRunPauseStopService.resumeRun(
    runId,
    organisationId,
    'system',
  );

  logger.info('oauth.resume.complete', {
    event: 'oauth.resume.complete',
    runId,
    organisationId,
    resumed: result.resumed,
    reason: result.reason,
  });
}
