import { eq, and, lt, or, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/index.js';
import { emitAgentRunUpdate, emitSubaccountUpdate, emitOrgUpdate } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Stale Run Cleanup — detects and marks dead agent runs as failed
//
// Runs as a periodic pg-boss job (every 5 minutes). Finds runs stuck in
// 'running' status with no recent heartbeat and transitions them to 'failed'.
// ---------------------------------------------------------------------------

// Runs are stale if no activity for this duration
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// Grace period: if a tool is actively running, extend threshold
const TOOL_GRACE_PERIOD_MS = 20 * 60 * 1000; // 20 minutes

// Also catch runs with no lastActivityAt that have been running too long
const LEGACY_STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour (for pre-migration runs)

export const staleRunCleanupService = {
  async cleanupStaleRuns(): Promise<number> {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_MS);
    const toolGraceThreshold = new Date(now.getTime() - TOOL_GRACE_PERIOD_MS);
    const legacyThreshold = new Date(now.getTime() - LEGACY_STALE_THRESHOLD_MS);

    // Find stale running runs — push filtering into DB to use the index
    // Catches: runs with stale heartbeats, OR legacy runs with no heartbeat at all
    const candidates = await db
      .select({
        id: agentRuns.id,
        organisationId: agentRuns.organisationId,
        subaccountId: agentRuns.subaccountId,
        agentId: agentRuns.agentId,
        executionScope: agentRuns.executionScope,
        startedAt: agentRuns.startedAt,
        lastActivityAt: agentRuns.lastActivityAt,
        lastToolStartedAt: agentRuns.lastToolStartedAt,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.status, 'running'),
          or(
            lt(agentRuns.lastActivityAt, staleThreshold),
            isNull(agentRuns.lastActivityAt),
          ),
        )
      )
      .limit(100); // Prevent spike on mass failure

    // Refine in application code: tool grace period + legacy threshold
    const toCleanup = candidates.filter(run => {
      if (run.lastActivityAt) {
        // If a tool is actively running (started after last heartbeat), use grace period
        const lastActivity = run.lastActivityAt ?? run.startedAt;
        const lastTool = run.lastToolStartedAt;
        if (lastTool && lastActivity && lastTool > lastActivity) {
          return lastTool < toolGraceThreshold;
        }
        return true; // Already filtered by DB: lastActivityAt < staleThreshold
      }
      // Legacy: no heartbeat — check startedAt against longer threshold
      return run.startedAt != null && run.startedAt < legacyThreshold;
    });

    for (const run of toCleanup) {
      const durationMs = run.startedAt
        ? now.getTime() - run.startedAt.getTime()
        : null;

      // Race condition guard: only update if STILL running
      const [updated] = await db.update(agentRuns).set({
        status: 'failed',
        errorMessage: 'Run terminated: no activity detected (stale run cleanup)',
        errorDetail: {
          type: 'stale_run',
          lastActivityAt: run.lastActivityAt?.toISOString() ?? null,
          lastToolStartedAt: run.lastToolStartedAt?.toISOString() ?? null,
          detectedAt: now.toISOString(),
          thresholdMs: run.lastActivityAt ? STALE_THRESHOLD_MS : LEGACY_STALE_THRESHOLD_MS,
        },
        completedAt: now,
        durationMs,
        updatedAt: now,
      }).where(
        and(
          eq(agentRuns.id, run.id),
          eq(agentRuns.status, 'running'),
        )
      ).returning({ id: agentRuns.id });

      // If update returned nothing, run completed between scan and update — skip
      if (!updated) continue;

      // Notify UI
      emitAgentRunUpdate(run.id, 'agent:run:failed', {
        agentId: run.agentId,
        status: 'failed',
        reason: 'stale_run_cleanup',
      });

      if (run.executionScope === 'org') {
        emitOrgUpdate(run.organisationId, 'live:agent_failed', {
          runId: run.id, agentId: run.agentId, reason: 'stale',
        });
      } else if (run.subaccountId) {
        emitSubaccountUpdate(run.subaccountId, 'agent:run:failed', {
          runId: run.id, agentId: run.agentId, reason: 'stale',
        });
      }

      logger.info('stale_run_cleanup.cleaned', {
        runId: run.id,
        agentId: run.agentId,
        lastActivityAt: run.lastActivityAt?.toISOString(),
        lastToolStartedAt: run.lastToolStartedAt?.toISOString(),
        durationMs,
      });
    }

    if (toCleanup.length > 0) {
      logger.info('stale_run_cleanup.summary', { cleaned: toCleanup.length });
    }

    return toCleanup.length;
  },
};
