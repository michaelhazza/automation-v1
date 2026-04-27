// sweepHandler.ts — 15-minute sweep tick for the system_monitor.
//
// Two-pass design per spec §9.3:
//   Pass 1: Load candidates → evaluate all eligible heuristics → write fire rows.
//   Pass 2: Cluster fires → select top-50 (200 KB cap) → record incident + enqueue triage.
//
// Wraps in withSystemPrincipal (caller's responsibility; sweepJob.ts does it).

import { eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemIncidentEvents } from '../../../db/schema/index.js';
import { logger } from '../../../lib/logger.js';
import { getEligibleHeuristics } from '../heuristics/index.js';
import { baselineReader } from '../baselines/baselineReader.js';
import { recordIncident } from '../../incidentIngestor.js';
import { bucket15min, loadCandidates } from './loadCandidates.js';
import { clusterFires, type HeuristicFireRecord } from './clusterFires.js';
import { selectTopForTriage } from './selectTopForTriage.js';
import { writeHeuristicFire } from './writeHeuristicFire.js';
import { recordSweepTick } from '../synthetic/sweepTickHistory.js';
import type { Evidence } from '../heuristics/types.js';

export interface SweepResult {
  status: 'success' | 'partial_success' | 'failure';
  window: { start: Date; end: Date };
  candidatesEvaluated: number;
  heuristicsEvaluated: number;
  fired: HeuristicFireRecord[];
  suppressed: number;
  insufficientData: number;
  errored: Array<{ heuristicId: string; candidateId: string; err: string }>;
  triagesEnqueued: number;
  capped: { excessCount: number; capKind: 'candidate' | 'payload' } | null;
  durationMs: number;
}

export async function runSweep(now: Date = new Date()): Promise<SweepResult> {
  const startTime = Date.now();
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
  const bucketKey = bucket15min(now);

  const heuristics = getEligibleHeuristics();
  const baselines = baselineReader;

  const firedRecords: HeuristicFireRecord[] = [];
  let suppressedCount = 0;
  let insufficientDataCount = 0;
  const errored: SweepResult['errored'] = [];
  let heuristicsEvaluated = 0;

  // ── Pass 1: Load candidates + evaluate heuristics ──────────────────────────

  let candidates: Awaited<ReturnType<typeof loadCandidates>>['candidates'] = [];
  let limitReached = false;

  try {
    const result = await loadCandidates(now);
    candidates = result.candidates;
    limitReached = result.limitReached;
  } catch (err) {
    logger.error('sweep_load_candidates_failed', {
      bucketKey,
      error: err instanceof Error ? err.message : String(err),
    });
    // Surface the failure to sweep-coverage-degraded — repeated load failures
    // are exactly what §12.5 considers degraded coverage, but the check stays
    // in cold-start unless every completed sweep path feeds the buffer
    // (DEVELOPMENT_GUIDELINES §8.15 — lifecycle hooks fire from every path).
    recordSweepTick({
      bucketKey,
      candidatesEvaluated: 0,
      limitReached: false,
      loadFailed: true,
      completedAt: new Date(),
    });
    return {
      status: 'failure',
      window: { start: windowStart, end: windowEnd },
      candidatesEvaluated: 0,
      heuristicsEvaluated: 0,
      fired: [],
      suppressed: 0,
      insufficientData: 0,
      errored: [],
      triagesEnqueued: 0,
      capped: null,
      durationMs: Date.now() - startTime,
    };
  }

  const heuristicCtx = { baselines, logger, now };

  for (const candidate of candidates) {
    for (const heuristic of heuristics) {
      heuristicsEvaluated++;
      try {
        const result = await heuristic.evaluate(heuristicCtx, candidate);

        if (!result.fired) {
          if ('reason' in result && result.reason === 'insufficient_data') {
            insufficientDataCount++;
            await writeHeuristicFire({
              heuristicId: heuristic.id,
              entityKind: candidate.entityKind,
              entityId: candidate.entityId,
              outcome: 'insufficient_data',
            });
          } else if ('reason' in result && result.reason === 'suppressed') {
            suppressedCount++;
            await writeHeuristicFire({
              heuristicId: heuristic.id,
              entityKind: candidate.entityKind,
              entityId: candidate.entityId,
              outcome: 'suppressed',
              metadata: { suppressionId: result.suppressionId },
            });
          }
          continue;
        }

        const fireRowId = await writeHeuristicFire({
          heuristicId: heuristic.id,
          entityKind: candidate.entityKind,
          entityId: candidate.entityId,
          outcome: 'fired',
          confidence: result.confidence,
          evidence: result.evidence as Evidence,
        });

        firedRecords.push({
          fireRowId,
          heuristicId: heuristic.id,
          entityKind: candidate.entityKind,
          entityId: candidate.entityId,
          confidence: result.confidence,
          evidence: result.evidence as Evidence,
          firedAt: new Date(),
        });
      } catch (err) {
        errored.push({
          heuristicId: heuristic.id,
          candidateId: candidate.entityId,
          err: err instanceof Error ? err.message : String(err),
        });
        logger.error('sweep_heuristic_error', {
          heuristicId: heuristic.id,
          candidateId: candidate.entityId,
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          await writeHeuristicFire({
            heuristicId: heuristic.id,
            entityKind: candidate.entityKind,
            entityId: candidate.entityId,
            outcome: 'errored',
            metadata: { error: err instanceof Error ? err.message : String(err) },
          });
        } catch {
          // Don't let the audit write failure propagate
        }
      }
    }
  }

  // ── Pass 2: Cluster → select top → record incidents ────────────────────────

  const clusters = clusterFires(firedRecords);
  const { selected, capped } = selectTopForTriage(clusters);

  let triagesEnqueued = 0;

  for (const cluster of selected) {
    const topFire = cluster.fires[0];
    if (!topFire) continue;

    const summary = `[Sweep] ${cluster.entityKind} ${cluster.entityId} fired ${cluster.totalFires} heuristic(s); highest confidence: ${(cluster.maxConfidence * 100).toFixed(0)}%`;

    // recordIncident auto-enqueues the triage job when wasInserted=true and severity ≥ medium
    await recordIncident({
      source: 'synthetic',
      severity: 'medium',
      summary,
      fingerprintOverride: `sweep:${cluster.entityKind}:${cluster.entityId}:${bucketKey}`,
      idempotencyKey: `sweep:${cluster.entityKind}:${cluster.entityId}:${bucketKey}`,
      errorDetail: {
        sweepBucketKey: bucketKey,
        entityKind: cluster.entityKind,
        entityId: cluster.entityId,
        totalFires: cluster.totalFires,
        heuristicIds: cluster.fires.map((f) => f.heuristicId),
        maxConfidence: cluster.maxConfidence,
        fireRowIds: cluster.fires.map((f) => f.fireRowId),
      },
    });

    triagesEnqueued++;
  }

  // ── Emit sweep_completed event on a sentinel incident (org-free) ────────────
  // We write a sweep_completed event to the first produced incident if any,
  // or skip if no fires (no incident exists to annotate). The sweep-coverage-
  // degraded synthetic check looks for sweep_completed events in the window.
  if (triagesEnqueued === 0) {
    // No incidents produced this tick — still need to stamp a sweep marker.
    // Use a process-local sentinel: log it so the synthetic check can detect
    // presence of sweep runs even when they produce no fires.
    logger.info('sweep_completed_no_fires', {
      bucketKey,
      candidatesEvaluated: candidates.length,
      heuristicsEvaluated,
    });
  }

  // Per spec §9.3: status is `partial_success` when at least one heuristic errored
  // OR the input cap was hit (capped != null). Successful fires still propagate.
  const overallStatus: 'success' | 'partial_success' =
    errored.length > 0 || capped !== null ? 'partial_success' : 'success';

  const result: SweepResult = {
    status: overallStatus,
    window: { start: windowStart, end: windowEnd },
    candidatesEvaluated: candidates.length,
    heuristicsEvaluated,
    fired: firedRecords,
    suppressed: suppressedCount,
    insufficientData: insufficientDataCount,
    errored,
    triagesEnqueued,
    capped: capped ? { excessCount: capped.excessCount, capKind: capped.capKind } : null,
    durationMs: Date.now() - startTime,
  };

  logger.info('sweep_completed', {
    bucketKey,
    status: result.status,
    candidatesEvaluated: result.candidatesEvaluated,
    heuristicsEvaluated: result.heuristicsEvaluated,
    fired: result.fired.length,
    suppressed: result.suppressed,
    triagesEnqueued: result.triagesEnqueued,
    capped: result.capped ?? null,
    durationMs: result.durationMs,
    candidateLimitReached: limitReached,
  });

  // Feed the sweep-coverage-degraded synthetic check (spec §8.2 / §12.5).
  recordSweepTick({
    bucketKey,
    candidatesEvaluated: result.candidatesEvaluated,
    limitReached,
    loadFailed: false,
    completedAt: new Date(),
  });

  if (capped) {
    logger.warn('sweep_capped', {
      bucketKey,
      excessCount: capped.excessCount,
      capKind: capped.capKind,
    });
  }

  return result;
}
