/**
 * agentResumeService — handles resuming a blocked agent run after the user
 * connects an OAuth integration.
 *
 * The resume is triggered by the OAuth callback (server-side, no user auth
 * needed — the sha256-hashed token is the credential) or by the client
 * calling POST /api/agent-runs/resume-from-integration.
 *
 * Security model:
 * - The plaintext token is 32 random bytes (256-bit entropy).
 * - Only the sha256 hash is stored in agent_runs.integration_resume_token.
 * - The optimistic predicate UPDATE atomically clears the blocked state and
 *   returns 0 rows if the token is wrong, expired, or already consumed.
 * - A second read distinguishes "already resumed" (idempotent 200) from
 *   "expired/invalid" (410).
 */

import crypto from 'crypto';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { buildThreadContextReadModel } from './conversationThreadContextService.js';
import { formatThreadContextBlock } from './conversationThreadContextServicePure.js';

export interface ResumeResult {
  status: 'resumed' | 'already_resumed';
  runId: string;
}

export interface ResumeError {
  statusCode: 410;
  message: string;
  errorCode: 'RESUME_TOKEN_EXPIRED';
}

export function deriveTokenHash(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Atomically clears the blocked state on an agent_run using the plaintext
 * resume token. Idempotent — a second call with the same token returns
 * { status: 'already_resumed' } instead of an error.
 *
 * Throws { statusCode: 410, ... } if the token is unknown, expired, or
 * the run is not in the blocked state and was not previously resumed with
 * this token.
 */
export async function resumeFromIntegrationConnect(params: {
  resumeToken: string;
  organisationId: string;
  conversationId?: string;
}): Promise<ResumeResult> {
  const { resumeToken, organisationId } = params;

  const tokenHash = deriveTokenHash(resumeToken);
  const tokenHashPrefix = tokenHash.slice(0, 8); // for logs only — never log the full hash

  // Step 1: find the run by token hash (GAP 8 — get the id for the predicate UPDATE).
  // Also handles GAP 6 — 404 if no run is found at all.
  const candidate = await db
    .select({ id: agentRuns.id, blockedReason: agentRuns.blockedReason, runMetadata: agentRuns.runMetadata })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.organisationId, organisationId),
        eq(agentRuns.integrationResumeToken, tokenHash),
      ),
    )
    .limit(1);

  if (candidate.length === 0) {
    throw Object.assign(
      new Error('Run not found'),
      { statusCode: 404, errorCode: 'RUN_NOT_FOUND' as const },
    );
  }

  // Check idempotent path before attempting the UPDATE — if the run was already
  // resumed (blockedReason cleared, last token hash recorded), return 'already_resumed'.
  const candidateRun = candidate[0];
  const candidateMeta = (candidateRun.runMetadata as Record<string, unknown>) ?? {};
  if (candidateRun.blockedReason === null && candidateMeta.lastResumeTokenHash === tokenHash) {
    return { status: 'already_resumed', runId: candidateRun.id };
  }

  // Keep threadContextVersionAtStart in sync with latest context so the DB
  // record is consistent with the next executeRun() re-injection. Fetched
  // before the transaction to avoid extending the lock hold time with a
  // DB round-trip that is not part of the transaction's semantic boundary.
  let freshThreadContextVersion: number | undefined;
  const resumeConvId = params.conversationId ?? (candidateMeta.conversationId as string | undefined);
  if (resumeConvId) {
    try {
      const threadCtx = await buildThreadContextReadModel(resumeConvId, organisationId);
      const block = formatThreadContextBlock(threadCtx);
      if (block) {
        freshThreadContextVersion = threadCtx.version;
      }
    } catch {
      // Fail-open — version sync is best-effort; skip if unavailable
    }
  }

  // Step 2: optimistic UPDATE + metadata write inside one transaction so a
  // parallel scheduler write cannot clobber `runMetadata` between the two
  // statements (the first UPDATE clears blocked_reason; the second writes
  // resume bookkeeping). Either both happen or neither.
  const txResult = await db.transaction(async (tx) => {
    // Conditions: correct run id, same org, currently blocked with 'integration_required',
    // token hash matches, and expiry has not passed.
    const updatedInner = await tx
      .update(agentRuns)
      .set({
        blockedReason: null,
        blockedExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentRuns.id, candidateRun.id),
          eq(agentRuns.organisationId, organisationId),
          eq(agentRuns.blockedReason, 'integration_required'),
          eq(agentRuns.integrationResumeToken, tokenHash),
          gt(agentRuns.blockedExpiresAt, new Date()),
        ),
      )
      .returning({
        id: agentRuns.id,
        runMetadata: agentRuns.runMetadata,
      });

    if (updatedInner.length !== 1) return null;

    const run = updatedInner[0];
    const meta = (run.runMetadata as Record<string, unknown>) ?? {};
    const currentSeq = (meta.currentBlockSequence as number) ?? 1;
    const completedSeqs: number[] = Array.isArray(meta.completedBlockSequences)
      ? (meta.completedBlockSequences as number[])
      : [];

    if (!completedSeqs.includes(currentSeq)) {
      completedSeqs.push(currentSeq);
    }

    await tx
      .update(agentRuns)
      .set({
        runMetadata: {
          ...meta,
          lastResumeTokenHash: tokenHash,
          lastResumeBlockSequence: currentSeq,
          completedBlockSequences: completedSeqs,
          blockedReason: null,
          ...(freshThreadContextVersion !== undefined
            ? { threadContextVersionAtStart: freshThreadContextVersion }
            : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, run.id));

    return { runId: run.id };
  });

  if (txResult !== null) {
    logger.info('run_resumed', {
      runId: txResult.runId,
      conversationId: '', // not available without conversation_id on agent_runs
      blockedReason: 'integration_required',
      integrationId: '', // not stored on run — TODO(v2): store integrationId in runMetadata at block time
      tokenHashPrefix,
      action: 'run_resumed',
    });

    return { status: 'resumed', runId: txResult.runId };
  }

  // 0 rows updated — token is expired or in an unrecognised state → 410.
  // integrationResumeToken is intentionally kept (not cleared) so the
  // idempotent check at the top of this function remains reachable on retries.
  const err = Object.assign(
    new Error('Resume token expired or invalid'),
    { statusCode: 410, errorCode: 'RESUME_TOKEN_EXPIRED' as const },
  );
  throw err;
}

