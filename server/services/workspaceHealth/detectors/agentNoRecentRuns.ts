/**
 * agentNoRecentRuns.ts — Brain Tree OS adoption P4 detector.
 *
 * Triggers a warning when an active agent has no runs in the last
 * `noRecentRunsThresholdDays` (default 30).
 */

import type { Detector, WorkspaceHealthFinding } from '../detectorTypes';

export const agentNoRecentRuns: Detector = (ctx) => {
  const findings: WorkspaceHealthFinding[] = [];
  const now = ctx.nowMs ?? Date.now();
  const threshold = ctx.noRecentRunsThresholdDays * 24 * 60 * 60 * 1000;

  for (const agent of ctx.agents) {
    if (agent.status !== 'active') continue;

    const lastRunMs = agent.lastRunAt ? agent.lastRunAt.getTime() : 0;
    const idleMs = now - lastRunMs;
    if (idleMs < threshold) continue;

    findings.push({
      detector: 'agent.no_recent_runs',
      severity: 'warning',
      resourceKind: 'agent',
      resourceId: agent.id,
      resourceLabel: agent.name,
      message: agent.lastRunAt
        ? `Agent has not run in the last ${ctx.noRecentRunsThresholdDays} days.`
        : 'Agent has never run.',
      recommendation: 'Trigger a manual run or check if the agent is still in use; deactivate it if it is no longer needed.',
    });
  }

  return findings;
};
