// ---------------------------------------------------------------------------
// iee-cleanup-orphans — periodic maintenance.
// Spec §12.3 + §13.6.1.a (reservation leak sweep).
//
// Three sweeps:
//   1. Workspace orphans  — directories whose ieeRun is no longer pending/running
//   2. Browser session    — TTL report only (deletion is opt-in via env)
//   3. Reservation leak   — pending rows older than IEE_RESERVATION_TTL_MINUTES
//      with reservedCostUsd > 0 → fail the run + release reservation
// ---------------------------------------------------------------------------

import { promises as fs } from 'fs';
import path from 'path';
import { and, eq, lt, isNull, inArray } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { db } from '../db.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { ieeRuns } from '../../../server/db/schema/ieeRuns.js';
import { computeReservations } from '../../../server/db/schema/computeReservations.js';
import { retryUnemittedEvents } from '../persistence/runs.js';

const QUEUE = 'iee-cleanup-orphans';

export async function registerCleanupHandler(boss: PgBoss): Promise<void> {
  await boss.work(QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
    await runCleanup();
  });

  // Schedule every 6 hours via pg-boss schedule API
  try {
    await boss.schedule(QUEUE, '0 */6 * * *');
  } catch (err) {
    logger.warn('iee.cleanup.schedule_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP SWEEP ORDERING CONTRACT (reviewer round 4 #2)
//
// Sweeps run in this exact order. Future maintainers: do not reorder without
// understanding why.
//
//   1. sweepWorkspaceOrphans         — purely filesystem; touches nothing
//                                      that other sweeps depend on. Cheapest
//                                      first.
//
//   2. sweepReservationLeaks         — flips pending+leaked rows to failed
//                                      and releases their reservations. MUST
//                                      run before sweepUnemittedEvents
//                                      because it CREATES new terminal rows
//                                      that the event sweep then needs to
//                                      pick up. Order matters.
//
//   3. sweepBrowserSessionsReportOnly — read-only by default (deletion is
//                                      opt-in). Independent of the others.
//
//   4. sweepUnemittedEvents          — re-publishes iee-run-completed for
//                                      any terminal row whose
//                                      event_emitted_at is still NULL.
//                                      Includes the rows just terminated by
//                                      sweep #2. MUST run last so it sees
//                                      the latest state.
//
// If you add a new sweep, place it at the position dictated by its data
// dependencies, not its discovery order.
// ─────────────────────────────────────────────────────────────────────────────
async function runCleanup(): Promise<void> {
  await sweepWorkspaceOrphans();      // 1
  await sweepReservationLeaks();      // 2 — must precede sweep #4
  await sweepBrowserSessionsReportOnly(); // 3
  await sweepUnemittedEvents();       // 4 — must run last
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep 4: retry iee-run-completed for terminal rows whose event_emitted_at
// is still NULL (reviewer round 3 #1).
// ─────────────────────────────────────────────────────────────────────────────
async function sweepUnemittedEvents(): Promise<void> {
  try {
    const retried = await retryUnemittedEvents();
    if (retried > 0) {
      logger.info('iee.cleanup.events_retried', { count: retried });
    }
  } catch (err) {
    logger.warn('iee.cleanup.event_retry_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep 1: workspace orphans
// ─────────────────────────────────────────────────────────────────────────────
async function sweepWorkspaceOrphans(): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(env.WORKSPACE_BASE_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const candidateIds: string[] = [];
  const candidatePaths: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!/^[0-9a-f-]{36}$/i.test(e.name)) continue;
    const full = path.join(env.WORKSPACE_BASE_DIR, e.name);
    let stat: import('fs').Stats;
    try {
      stat = await fs.stat(full);
    } catch { continue; }
    if (stat.mtimeMs > oneHourAgo) continue;
    candidateIds.push(e.name);
    candidatePaths.push(full);
  }
  if (candidateIds.length === 0) return;

  const activeRows = await db
    .select({ id: ieeRuns.id })
    .from(ieeRuns)
    .where(
      and(
        inArray(ieeRuns.id, candidateIds),
        inArray(ieeRuns.status, ['pending', 'running']),
      ),
    );
  const activeSet = new Set(activeRows.map(r => r.id));
  for (let i = 0; i < candidateIds.length; i++) {
    if (activeSet.has(candidateIds[i])) continue;
    try {
      await fs.rm(candidatePaths[i], { recursive: true, force: true });
      logger.info('iee.cleanup.orphan_removed', { dir: candidatePaths[i], ieeRunId: candidateIds[i] });
    } catch (err) {
      logger.warn('iee.cleanup.orphan_remove_failed', {
        dir: candidatePaths[i],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep 2: reservation leaks (§13.6.1.a)
// ─────────────────────────────────────────────────────────────────────────────
async function sweepReservationLeaks(): Promise<void> {
  const cutoff = new Date(Date.now() - env.IEE_RESERVATION_TTL_MINUTES * 60 * 1000);

  const leaked = await db
    .select({ id: ieeRuns.id })
    .from(ieeRuns)
    .where(
      and(
        eq(ieeRuns.status, 'pending'),
        lt(ieeRuns.createdAt, cutoff),
        isNull(ieeRuns.deletedAt),
      ),
    );

  if (leaked.length === 0) return;

  await db.transaction(async (tx) => {
    for (const r of leaked) {
      await tx.update(ieeRuns)
        .set({
          status: 'failed',
          failureReason: 'environment_error',
          completedAt: new Date(),
          resultSummary: {
            success: false,
            output: 'Reservation TTL expired before pickup',
            stepCount: 0,
            durationMs: 0,
          },
          updatedAt: new Date(),
        })
        .where(eq(ieeRuns.id, r.id));
      await tx.update(computeReservations)
        .set({ status: 'released' })
        .where(eq(computeReservations.idempotencyKey, `iee:${r.id}`));
    }
  });

  logger.warn('iee.cleanup.reservation_leak_swept', {
    count: leaked.length,
    ttlMinutes: env.IEE_RESERVATION_TTL_MINUTES,
  });
  // Reviewer round 3 #2 — per-row audit trail
  for (const r of leaked) {
    logger.info('iee.reservation.released.reconciliation', {
      ieeRunId: r.id,
      reason: 'ttl_expired',
      ttlMinutes: env.IEE_RESERVATION_TTL_MINUTES,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep 3: browser sessions — report only by default (§13.6.1)
// ─────────────────────────────────────────────────────────────────────────────
async function sweepBrowserSessionsReportOnly(): Promise<void> {
  const ttlMs = env.IEE_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  const autoPrune = env.IEE_SESSION_AUTO_PRUNE === 'true';

  let orgEntries: import('fs').Dirent[];
  try {
    orgEntries = await fs.readdir(env.BROWSER_SESSION_DIR, { withFileTypes: true });
  } catch {
    return;
  }

  let staleCount = 0;
  let prunedCount = 0;
  let corruptCount = 0;

  for (const orgDir of orgEntries) {
    if (!orgDir.isDirectory()) continue;
    const orgPath = path.join(env.BROWSER_SESSION_DIR, orgDir.name);
    let sessions: import('fs').Dirent[];
    try { sessions = await fs.readdir(orgPath, { withFileTypes: true }); } catch { continue; }
    for (const s of sessions) {
      if (!s.isDirectory()) continue;
      const sPath = path.join(orgPath, s.name);
      let stat: import('fs').Stats;
      try { stat = await fs.stat(sPath); } catch { continue; }

      // .corrupt.<ts> dirs older than 30d are always cleaned
      if (s.name.includes('.corrupt.') && stat.mtimeMs < cutoff) {
        try {
          await fs.rm(sPath, { recursive: true, force: true });
          corruptCount++;
        } catch { /* swallow */ }
        continue;
      }

      if (stat.mtimeMs >= cutoff) continue;
      staleCount++;
      if (autoPrune) {
        try {
          await fs.rm(sPath, { recursive: true, force: true });
          prunedCount++;
        } catch { /* swallow */ }
      }
    }
  }

  if (staleCount > 0 || corruptCount > 0) {
    logger.info('iee.cleanup.session_sweep', {
      staleCount,
      prunedCount,
      corruptRemovedCount: corruptCount,
      autoPrune,
      ttlDays: env.IEE_SESSION_TTL_DAYS,
    });
  }
}
