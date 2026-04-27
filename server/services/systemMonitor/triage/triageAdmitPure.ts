// Pure admit-check logic for system_monitor triage — no DB access.
// Extracted so triageHandler.ts can use it and it can be tested without env deps.

import type { SystemIncidentSeverity } from '../../../db/schema/systemIncidents.js';

const ELIGIBLE_SEVERITIES: ReadonlySet<SystemIncidentSeverity> = new Set(['medium', 'high', 'critical']);
export const TRIAGE_ATTEMPT_CAP = 5;

export interface AdmitVerdict {
  admitted: boolean;
  reason?: 'disabled' | 'severity_too_low' | 'self_check' | 'rate_limited';
}

export function checkAdmit(
  severity: SystemIncidentSeverity,
  source: string,
  metadata: Record<string, unknown> | null | undefined,
  triageAttemptCount: number,
): AdmitVerdict {
  if (process.env.SYSTEM_MONITOR_ENABLED === 'false') {
    return { admitted: false, reason: 'disabled' };
  }
  if (!ELIGIBLE_SEVERITIES.has(severity)) {
    return { admitted: false, reason: 'severity_too_low' };
  }
  if (
    source === 'self' ||
    metadata?.isSelfCheck === true ||
    metadata?.isMonitorSelfStuck === true
  ) {
    return { admitted: false, reason: 'self_check' };
  }
  if (triageAttemptCount >= TRIAGE_ATTEMPT_CAP) {
    return { admitted: false, reason: 'rate_limited' };
  }
  return { admitted: true };
}
