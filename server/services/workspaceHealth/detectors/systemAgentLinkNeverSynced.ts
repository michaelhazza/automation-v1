/**
 * systemAgentLinkNeverSynced.ts — Brain Tree OS adoption P4 detector.
 *
 * Info-level finding when a system-managed org agent has not been touched
 * in `systemAgentStaleThresholdDays` (default 60). The schema has no
 * dedicated last-sync timestamp, so we use the agent's `updatedAt` column
 * as a proxy for "this row has likely drifted from the upstream system
 * definition since it was created/updated".
 */

import type { Detector, WorkspaceHealthFinding } from '../detectorTypes';

export const systemAgentLinkNeverSynced: Detector = (ctx) => {
  const findings: WorkspaceHealthFinding[] = [];
  const now = ctx.nowMs ?? Date.now();
  const threshold = ctx.systemAgentStaleThresholdDays * 24 * 60 * 60 * 1000;

  for (const link of ctx.systemAgentLinks) {
    const updatedMs = link.updatedAt ? link.updatedAt.getTime() : 0;
    if (updatedMs > 0 && now - updatedMs < threshold) continue;

    findings.push({
      detector: 'system_agent_link.never_synced',
      severity: 'info',
      resourceKind: 'agent',
      resourceId: link.orgAgentId,
      resourceLabel: link.orgAgentName,
      message: link.updatedAt
        ? `System-managed agent has not been updated in over ${ctx.systemAgentStaleThresholdDays} days; the org-tier override may have drifted from the upstream definition.`
        : 'System-managed agent has never been synced from its upstream system definition.',
      recommendation: 'Re-sync the org agent against its upstream system agent template.',
    });
  }
  return findings;
};
