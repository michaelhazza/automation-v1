/**
 * staleMacroRunDetector.ts — Phase 1 Showcase §4.6.2 (async detector).
 *
 * Queries iee_runs for browser-mode runs associated with 42 Macro agent_runs
 * (executionMode = 'iee_browser') where lastHeartbeatAt is older than 15
 * minutes. Returns WorkspaceHealthFinding[] for each stuck run.
 *
 * Registered in ASYNC_DETECTORS alongside detectStaleConnectors.
 */

import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { ieeRuns } from '../../../db/schema/ieeRuns.js';
import { agentRuns } from '../../../db/schema/agentRuns.js';
import type { WorkspaceHealthFinding } from '../detectorTypes.js';
import {
  computeStuckMacroRuns,
  MACRO_STUCK_THRESHOLD_MS,
  type MacroRunCandidate,
} from './staleMacroRunDetectorPure.js';

export async function detectStaleMacroRuns(
  organisationId: string,
): Promise<WorkspaceHealthFinding[]> {
  const cutoff = new Date(Date.now() - MACRO_STUCK_THRESHOLD_MS);

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const rows = await db
    .select({
      ieeRunId: ieeRuns.id,
      agentRunId: ieeRuns.agentRunId,
      organisationId: ieeRuns.organisationId,
      lastHeartbeatAt: ieeRuns.lastHeartbeatAt,
      stepCount: ieeRuns.stepCount,
    })
    .from(ieeRuns)
    .innerJoin(agentRuns, eq(ieeRuns.agentRunId, agentRuns.id))
    .where(
      and(
        eq(ieeRuns.organisationId, organisationId),
        eq(ieeRuns.status, 'running'),
        isNotNull(ieeRuns.agentRunId),
        isNotNull(ieeRuns.lastHeartbeatAt),
        eq(agentRuns.executionMode, 'iee_browser'),
        lt(ieeRuns.lastHeartbeatAt, cutoff),
      ),
    );

  const candidates: MacroRunCandidate[] = rows.flatMap((row) => {
    if (!row.agentRunId || !row.lastHeartbeatAt) return [];
    return [
      {
        ieeRunId: row.ieeRunId,
        agentRunId: row.agentRunId,
        organisationId: row.organisationId,
        lastHeartbeatAt: row.lastHeartbeatAt,
        stepCount: row.stepCount,
      },
    ];
  });

  const stuckRuns = computeStuckMacroRuns(candidates, cutoff, 0);

  return stuckRuns.map((finding): WorkspaceHealthFinding => ({
    detector: 'macro.run_stuck',
    severity: 'warning',
    resourceKind: 'org',
    resourceId: finding.ieeRunId,
    resourceLabel: `iee_run:${finding.ieeRunId}`,
    message: `42 Macro IEE run has not emitted a heartbeat for ${Math.round(finding.stuckSinceMs / 60000)} minutes (threshold: ${Math.round(finding.thresholdMs / 60000)} min). Step: ${finding.currentStep}.`,
    recommendation:
      'Inspect the worker logs for this run. If the worker is unresponsive, the run may need to be cancelled and retried.',
  }));
}
