import { eq, and, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { ieeSessions } from '../db/schema/index.js';
import type { IeeSession } from '../db/schema/ieeSessions.js';
import type { PrincipalContext } from './principal/types.js';

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

export async function createSession(
  runId: string,
  agentId: string,
  ctx: PrincipalContext,
): Promise<IeeSession> {
  const scopedDb = getOrgScopedDb('ieeSessionService.createSession');
  const organisationId = ctx.organisationId;

  try {
    const inserted = await scopedDb
      .insert(ieeSessions)
      .values({
        organisationId,
        subaccountId: ctx.subaccountId ?? null,
        agentId,
        runId,
        status: 'active',
      })
      .returning();

    return inserted[0];
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      throw { statusCode: 409, errorCode: 'session_already_exists_for_run', runId };
    }

    throw err;
  }
}

// ---------------------------------------------------------------------------
// heartbeat
// ---------------------------------------------------------------------------

export async function heartbeat(
  sessionId: string,
  ctx: PrincipalContext,
): Promise<void> {
  const scopedDb = getOrgScopedDb('ieeSessionService.heartbeat');
  const organisationId = ctx.organisationId;

  const updated = await scopedDb
    .update(ieeSessions)
    .set({ lastHeartbeatAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(
      and(
        eq(ieeSessions.id, sessionId),
        eq(ieeSessions.organisationId, organisationId),
      ),
    )
    .returning({ id: ieeSessions.id });

  if (updated.length === 0) {
    throw Object.assign(new Error('IEE session not found'), { statusCode: 404 });
  }
}

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

export async function getSession(
  sessionId: string,
  ctx: PrincipalContext,
): Promise<IeeSession | null> {
  const scopedDb = getOrgScopedDb('ieeSessionService.getSession');
  const organisationId = ctx.organisationId;

  const rows = await scopedDb
    .select()
    .from(ieeSessions)
    .where(
      and(
        eq(ieeSessions.id, sessionId),
        eq(ieeSessions.organisationId, organisationId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// tearDown
// ---------------------------------------------------------------------------

/**
 * Atomically claim the terminal state for a session.
 *
 * Opens its own database transaction so the row state is committed before
 * this function returns. Any external side-effect (container release) MUST
 * be performed by the caller AFTER checking `alreadyTornDown === false`.
 * Container release is forbidden inside this function — see plan Rev 3
 * §Chunk 10 external-side-effect boundary.
 */
export async function tearDown(
  sessionId: string,
  reason: 'run_completed' | 'idle_timeout' | 'orphan_cleanup' | 'failed' | 'operator_cancelled',
  ctx: PrincipalContext,
): Promise<{ alreadyTornDown: boolean }> {
  const organisationId = ctx.organisationId;
  const scopedDb = getOrgScopedDb('ieeSessionService.tearDown');

  const rows = await scopedDb
    .update(ieeSessions)
    .set({
      status: 'torn_down',
      releasedAt: sql`NOW()`,
      releaseReason: reason,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(ieeSessions.id, sessionId),
        eq(ieeSessions.organisationId, organisationId),
        inArray(ieeSessions.status, ['active', 'idle']),
      ),
    )
    .returning({ id: ieeSessions.id });

  if (rows.length === 0) {
    logger.debug('iee_session.tear_down_no_op', { sessionId, reason });
    return { alreadyTornDown: true };
  }

  return { alreadyTornDown: false };
}

// ---------------------------------------------------------------------------
// markFailed
// ---------------------------------------------------------------------------

/**
 * Mark a session as failed.
 *
 * Uses `getOrgScopedDb` (not withOrgTx) because this method is intended to
 * be called from within an existing transaction context, e.g. run-engine
 * error handlers.
 */
export async function markFailed(
  sessionId: string,
  ctx: PrincipalContext,
): Promise<void> {
  const scopedDb = getOrgScopedDb('ieeSessionService.markFailed');
  const organisationId = ctx.organisationId;

  const updated = await scopedDb
    .update(ieeSessions)
    .set({
      status: 'failed',
      releaseReason: 'failed',
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(ieeSessions.id, sessionId),
        eq(ieeSessions.organisationId, organisationId),
        inArray(ieeSessions.status, ['active', 'idle']),
      ),
    )
    .returning({ id: ieeSessions.id });

  if (updated.length === 0) {
    logger.warn('iee_session.mark_failed_no_op', { sessionId });
  }
}

// ---------------------------------------------------------------------------
// recordSummary
// ---------------------------------------------------------------------------

/**
 * Persist an execution summary object onto the session row.
 *
 * Uses `getOrgScopedDb` — callers must have an active `withOrgTx` context.
 */
export async function recordSummary(
  sessionId: string,
  summary: object,
  ctx: PrincipalContext,
): Promise<void> {
  const scopedDb = getOrgScopedDb('ieeSessionService.recordSummary');
  const organisationId = ctx.organisationId;

  const updated = await scopedDb
    .update(ieeSessions)
    .set({ summary: summary as unknown as Record<string, unknown>, updatedAt: sql`NOW()` })
    .where(
      and(
        eq(ieeSessions.id, sessionId),
        eq(ieeSessions.organisationId, organisationId),
      ),
    )
    .returning({ id: ieeSessions.id });

  if (updated.length === 0) {
    throw Object.assign(new Error('IEE session not found'), { statusCode: 404 });
  }
}
