import { eq, and } from 'drizzle-orm';
import { logger } from '../../../lib/logger.js';
import { db } from '../../../db/index.js';
import { skillAnalyzerJobs } from '../../../db/schema/index.js';
import * as skillAnalyzerConfigService from '../../skillAnalyzerConfigService.js';

/** v2 §11.11.3: systemAdmin recovery for a stuck execution_lock. Only clears
 *  the lock when it has been held longer than
 *  `config.executionLockStaleSeconds` — prevents an operator from accidentally
 *  yanking the rug out from under a live Execute. Router already enforces
 *  `requireSystemAdmin`. */
export async function unlockStaleExecution(params: {
  jobId: string;
  organisationId: string;
  userId: string;
}): Promise<{ unlocked: true; heldForSeconds: number }> {
  const { jobId, organisationId, userId } = params;
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const jobRows = await db
    .select({
      id: skillAnalyzerJobs.id,
      executionLock: skillAnalyzerJobs.executionLock,
      executionStartedAt: skillAnalyzerJobs.executionStartedAt,
    })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  const job = jobRows[0];
  if (!job) throw { statusCode: 404, message: 'Job not found' };
  if (!job.executionLock) {
    throw {
      statusCode: 409,
      message: 'Execution lock is not held — nothing to unlock.',
      errorCode: 'EXECUTION_LOCK_NOT_HELD',
    };
  }
  // A lock with no executionStartedAt is an inconsistent state — never
  // assume infinite age and silently nuke it. Bail with a dedicated code so
  // the operator can investigate (likely needs a direct DB fix).
  if (!job.executionStartedAt) {
    throw {
      statusCode: 409,
      message: 'Execution lock has no start timestamp — refusing to unlock without one. Inspect the job row directly.',
      errorCode: 'EXECUTION_LOCK_NO_START',
    };
  }

  const config = await skillAnalyzerConfigService.getConfig();
  const staleThresholdMs = config.executionLockStaleSeconds * 1000;
  const heldForMs = Date.now() - new Date(job.executionStartedAt).getTime();
  if (heldForMs < staleThresholdMs) {
    throw {
      statusCode: 409,
      message: `Execution lock is not yet stale (held for ${Math.floor(heldForMs / 1000)}s, threshold ${config.executionLockStaleSeconds}s).`,
      errorCode: 'EXECUTION_LOCK_FRESH',
    };
  }

  // Clear the lock, token, and start timestamp. The affected-row check
  // closes the narrow window where the live Execute's `finally` ran between
  // our staleness check and this UPDATE — returning 0 rows means the lock
  // was already released, which we surface distinctly rather than falsely
  // claiming to have unlocked it.
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const cleared = await db
    .update(skillAnalyzerJobs)
    .set({
      executionLock: false,
      executionLockToken: null,
      executionStartedAt: null,
      executionFinishedAt: new Date(),
    })
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.executionLock, true)))
    .returning({ id: skillAnalyzerJobs.id });

  if (!cleared[0]) {
    throw {
      statusCode: 409,
      message: 'Lock was released concurrently by the running Execute. No action needed.',
      errorCode: 'EXECUTION_LOCK_RELEASED_CONCURRENTLY',
    };
  }

  logger.warn('[skillAnalyzer] stale execution lock cleared', {
    jobId,
    userId,
    heldForSeconds: Math.floor(heldForMs / 1000),
    staleThresholdSeconds: config.executionLockStaleSeconds,
  });

  return { unlocked: true, heldForSeconds: Math.floor(heldForMs / 1000) };
}
