/**
 * subaccountAgentNoSchedule.ts — Brain Tree OS adoption P4 detector.
 *
 * Info-level finding when a subaccount agent has neither heartbeat nor cron
 * configured. Not a hard error — many agents are intentionally manual-only —
 * but worth surfacing so the operator can confirm.
 */

import type { Detector, WorkspaceHealthFinding } from '../detectorTypes';

export const subaccountAgentNoSchedule: Detector = (ctx) => {
  const findings: WorkspaceHealthFinding[] = [];
  for (const link of ctx.subaccountAgents) {
    if (link.heartbeatEnabled) continue;
    if (link.scheduleCron) continue;

    findings.push({
      detector: 'subaccount_agent.no_schedule',
      severity: 'info',
      resourceKind: 'subaccount_agent',
      resourceId: link.id,
      resourceLabel: `${link.agentName} @ ${link.subaccountName}`,
      message: 'Linked agent has no heartbeat and no cron schedule configured.',
      recommendation: 'Confirm this agent is manual-only by design, or enable heartbeat / set a cron schedule.',
    });
  }
  return findings;
};
